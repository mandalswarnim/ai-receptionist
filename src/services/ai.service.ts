/**
 * AI service: drives the conversation and extracts structured data.
 *
 * Two conversation modes share one persona:
 *  - generateResponse(): JSON single-shot, used by the webhook/Gather flow
 *  - streamResponse():   plain-text token streaming, used by ConversationRelay
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config';
import { ConversationState, ExtractedCallData, ConversationStep } from '../types';
import { logger } from '../lib/logger';

import { END_CALL_TOKEN, SentinelFilter } from '../lib/sentinel';
import { normalizeUrgency, URGENCY_VALUES } from '../lib/urgency';
import { isDialableNumber } from '../lib/phone';
import type { BusinessProfile } from './business.service';
import * as appointmentSvc from './appointment.service';

export { END_CALL_TOKEN, normalizeUrgency };

// Live turns are on the caller's critical path: fail fast (one quick retry)
// rather than leave dead air. The SDK default is a 10-minute timeout.
const liveClient = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: config.LLM_TIMEOUT_MS,
  maxRetries: 1,
});

// Post-call extraction runs off the critical path and can afford to wait.
const extractionClient = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
  timeout: 60_000,
  maxRetries: 2,
});

// ─── System prompt ──────────────────────────────────────────────────────────

/** What the receptionist knows about the business, or '' when nothing is set. */
function knowledgeBlock(business: BusinessProfile): string {
  const lines: string[] = [];
  if (business.openingHours) lines.push(`- Opening hours: ${business.openingHours}`);
  if (business.address) lines.push(`- Address: ${business.address}`);
  if (business.bookingSystem) lines.push(`- Bookings are managed in: ${business.bookingSystem}`);
  if (business.bookingInstructions) lines.push(`- Booking notes: ${business.bookingInstructions}`);
  if (business.menuNotes) lines.push(`- Food and drink: ${business.menuNotes}`);
  for (const faq of business.faqs) lines.push(`- Q: ${faq.q} A: ${faq.a}`);
  if (lines.length === 0) return '';
  return `\n\nWhat you know about ${business.name} (only state facts from this list; if asked anything else, say you'll get the team to come back to them):\n${lines.join('\n')}`;
}

const HOW_YOU_SPEAK = `How you speak:
- Sound like a real person on the phone: contractions, warm and relaxed, small acknowledgements ("Lovely, thanks James.", "Right, got it.", "Perfect.").
- Keep it short — one or two sentences, under 30 words. Ask exactly ONE question per turn.
- Vary your wording. Never use the same acknowledgement twice in a row, and never sound scripted.
- Plain spoken words only: no emojis, no markdown, no lists, no stage directions, no headings.
- Read phone numbers back digit by digit ("oh seven seven, one two three...") and spell emails out when confirming.
- The caller's speech comes from speech recognition and may be slightly garbled — infer the most likely meaning from context rather than asking them to repeat unless it's a name, number, or email.`;

const WRAP_UP_RULE = `- Once you have the required details, confirm the key points in one short sentence and ask if there's anything else you can help with. Only say goodbye after they've said there's nothing else — if they add something, take it down and ask again.`;

function phoneInstruction(callerNumber: string): string {
  return isDialableNumber(callerNumber)
    ? `They're calling from ${callerNumber} — just ask "is the number you're calling from the best one to reach you on?" instead of making them dictate one.`
    : `Their caller ID is withheld, so you'll need to ask them for a number.`;
}

/** LIVE: takes a message for a business that missed the call. */
function buildLivePrompt(business: BusinessProfile, callerNumber: string, keypadLine: string): string {
  return `You are ${business.personaName}, the friendly receptionist who answers calls for ${business.name} when the team can't get to the phone. You're speaking on a live phone call and your words are read aloud by text-to-speech.${knowledgeBlock(business)}

${HOW_YOU_SPEAK}${keypadLine}

What you need before saying goodbye:
1. Their name (required)
2. Company (optional — ask once, drop it if they skip it)
3. Best number to reach them (required). ${phoneInstruction(callerNumber)}
4. Email (optional — ask once, confirm spelling if given)
5. What the call is about (required — get enough detail to be useful)
6. Whether it's urgent

Ground rules:
- You are an AI assistant. If asked directly, say so briefly and cheerfully, then carry on. Never claim to be human.
- Never promise response times — "someone will get back to you" is the line.
- If the caller is rude, stay warm and steer back to taking the message.
${WRAP_UP_RULE}`;
}

/**
 * DEMO: answers as a prospect pub, so the owner hears exactly what their
 * callers would get — bookings, questions about the place, and messages.
 */
function buildDemoPrompt(
  business: BusinessProfile,
  callerNumber: string,
  keypadLine: string,
  appointmentsOn: boolean
): string {
  const bookingLine = appointmentsOn
    ? `- Booking: use the diary, as set out under "Booking appointments" below. ${phoneInstruction(callerNumber)}`
    : `- Booking a table: get their name, how many people, the date and the time, then the best number to reach them. ${phoneInstruction(callerNumber)} Read the booking back in one sentence and confirm it with "I've pencilled that in, the team will confirm by text." Never say a booking is guaranteed or check availability — you can't see the diary.`;
  return `You are ${business.personaName}, the AI assistant who answers the phone for ${business.name}. You're speaking on a live phone call and your words are read aloud by text-to-speech. Use British English.${knowledgeBlock(business)}

${HOW_YOU_SPEAK}${keypadLine}

What callers usually want, and how to handle it:
${bookingLine}
- Questions about the place (hours, food, parking, dogs, events): answer from what you know above. If it isn't there, say you'll get the team to come back to them, and take their name and number.
- Anything else: take a message with their name, best number, and what it's about.

Ground rules:
- You are an AI assistant. If asked directly, say so briefly and cheerfully, then carry on. Never claim to be human.
- Never promise response times — "someone will get back to you" is the line.
- If the caller is rude, stay warm and steer back to helping them.
${WRAP_UP_RULE}`;
}

/**
 * `appointmentsOn` is true only where the booking tools are offered (the
 * streaming relay loop); the prompt's booking section is added by the caller.
 */
export function buildSystemPrompt(
  business: BusinessProfile,
  callerNumber: string,
  keypadAvailable: boolean,
  appointmentsOn = false
): string {
  const keypadLine = keypadAvailable
    ? `\n- Numbers are easy to mishear over the phone. When you ask for a phone number, offer the keypad: "or you can type it on your keypad and press hash". Text in [square brackets] from the caller is keypad input, not speech — treat it as exact.`
    : '';
  return business.mode === 'DEMO'
    ? buildDemoPrompt(business, callerNumber, keypadLine, appointmentsOn)
    : buildLivePrompt(business, callerNumber, keypadLine);
}

function historyMessages(state: ConversationState): OpenAI.Chat.ChatCompletionMessageParam[] {
  return state.turns.map((t) => ({
    role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: t.content,
  }));
}

// ─── Validation of model output ──────────────────────────────────────────────

const extractedSchema = z.object({
  name: z.string().catch(''),
  company: z.string().catch(''),
  phone: z.string().catch(''),
  email: z.string().catch(''),
  message: z.string().catch(''),
  urgency: z.unknown().transform((v) => normalizeUrgency(v)),
  summary: z.string().catch(''),
});

export function normalizeExtractedData(raw: unknown): ExtractedCallData {
  const parsed = extractedSchema.safeParse(raw ?? {});
  const data = parsed.success
    ? parsed.data
    : { name: '', company: '', phone: '', email: '', message: '', urgency: 'medium' as const, summary: '' };
  return {
    ...data,
    name: data.name.trim(),
    company: data.company.trim(),
    phone: data.phone.replace(/[^\d+]/g, ''),
    email: data.email.trim().toLowerCase().replace(/\s+/g, ''),
  };
}

const partialExtractedSchema = z
  .object({
    name: z.string().optional(),
    company: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    message: z.string().optional(),
    urgency: z.unknown().optional(),
  })
  .partial();

const STEPS: ConversationStep[] = [
  'greeting',
  'collect_name',
  'collect_company',
  'collect_phone',
  'collect_email',
  'collect_message',
  'collect_urgency',
  'confirm',
  'closing',
];

// ─── Webhook mode: JSON response ─────────────────────────────────────────────

/**
 * Generates the next reply. The caller's latest utterance must already be the
 * last entry in state.turns (via conversationSvc.addTurn).
 */
export async function generateResponse(state: ConversationState): Promise<{
  response: string;
  nextStep: ConversationStep;
  extracted: Partial<ExtractedCallData>;
}> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(state.business, state.from, false) },
    ...historyMessages(state),
  ];

  // Meta-instruction to keep the model's state tracking on rails
  messages.push({
    role: 'system',
    content: `Current conversation step: ${state.step}
Collected so far: ${JSON.stringify(state.collectedInfo)}
Determine the best next step from: ${STEPS.slice(1).join(', ')}.
Only include extracted fields that were mentioned in the caller's latest message. Do not re-ask for anything already collected. Use nextStep "closing" only for the turn where you say goodbye.`,
  });

  try {
    const completion = await liveClient.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receptionist_turn',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['response', 'nextStep', 'extracted'],
            properties: {
              response: { type: 'string', description: 'What to say to the caller' },
              nextStep: { type: 'string', enum: STEPS.slice(1) },
              extracted: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'company', 'phone', 'email', 'message', 'urgency'],
                description: 'Fields mentioned in the latest caller message; null when not mentioned',
                properties: {
                  name: { type: ['string', 'null'] },
                  company: { type: ['string', 'null'] },
                  phone: { type: ['string', 'null'] },
                  email: { type: ['string', 'null'] },
                  message: { type: ['string', 'null'] },
                  urgency: {
                    type: ['string', 'null'],
                    description: 'One of low, medium, high, urgent',
                  },
                },
              },
            },
          },
        },
      },
      temperature: 0.6,
      max_tokens: 250,
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      response?: string;
      nextStep?: string;
      extracted?: Record<string, unknown>;
    };

    // Drop nulls so only newly-mentioned fields overwrite collectedInfo
    const extractedRaw = Object.fromEntries(
      Object.entries(parsed.extracted ?? {}).filter(([, v]) => v !== null && v !== '')
    );
    const extractedParsed = partialExtractedSchema.safeParse(extractedRaw);
    const extracted: Partial<ExtractedCallData> = {};
    if (extractedParsed.success) {
      const { urgency, ...rest } = extractedParsed.data;
      Object.assign(extracted, rest);
      if (urgency !== undefined) extracted.urgency = normalizeUrgency(urgency);
    }

    const nextStep = STEPS.includes(parsed.nextStep as ConversationStep)
      ? (parsed.nextStep as ConversationStep)
      : state.step;

    logger.debug('AI response generated', { callSid: state.callSid, step: state.step, nextStep });

    return {
      response: parsed.response || "Sorry, I didn't quite catch that — could you say it again?",
      nextStep,
      extracted,
    };
  } catch (err) {
    logger.error('AI response generation failed', { callSid: state.callSid, err });
    return {
      response: "Sorry, I lost you for a second there. Could you say that again?",
      nextStep: state.step,
      extracted: {},
    };
  }
}

// ─── Relay mode: streaming plain-text response ───────────────────────────────

/** Tool rounds allowed in one reply (e.g. check availability, then book). */
const MAX_TOOL_ROUNDS = 3;

/**
 * Streams a conversational reply token by token. The caller's latest
 * utterance must already be the last entry in state.turns. Calls onToken for
 * each text chunk as it arrives (never containing the END_CALL sentinel), and
 * resolves with the full reply plus whether the model signalled call end.
 *
 * Pass an AbortSignal to cancel generation when the caller barges in with a
 * new prompt — otherwise the superseded stream keeps consuming tokens.
 */
export async function streamResponse(
  state: ConversationState,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<{ fullText: string; endCall: boolean }> {
  const appointmentsOn = appointmentSvc.appointmentsEnabled(state.business);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        buildSystemPrompt(state.business, state.from, true, appointmentsOn) +
        (appointmentsOn ? appointmentSvc.promptSection(state) : '') +
        `\n\nReply with plain conversational text only. Only when the caller has confirmed there's nothing else and you have said goodbye, append the exact token ${END_CALL_TOKEN} at the very end of your reply.`,
    },
    ...historyMessages(state),
  ];

  const filter = new SentinelFilter(onToken);
  // Each round streams the model's reply; a round that ends in tool calls
  // runs them and streams again, so "let me check the diary" is spoken while
  // the check runs. The last round may not call tools, so the caller always
  // hears an answer.
  for (let round = 1; ; round++) {
    const toolsAllowed = appointmentsOn && round <= MAX_TOOL_ROUNDS;
    const stream = await liveClient.chat.completions.create(
      {
        model: config.OPENAI_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 200,
        stream: true,
        ...(appointmentsOn
          ? { tools: appointmentSvc.TOOLS, tool_choice: toolsAllowed ? ('auto' as const) : ('none' as const), parallel_tool_calls: false }
          : {}),
      },
      { signal }
    );

    let roundText = '';
    const calls: Array<{ id: string; name: string; args: string }> = [];
    let sawSentinel = false;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const text = delta?.content ?? '';
      roundText += text;
      if (!filter.push(text)) {
        sawSentinel = true;
        stream.controller.abort();
        break;
      }
      for (const tc of delta?.tool_calls ?? []) {
        const call = (calls[tc.index] ??= { id: '', name: '', args: '' });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.args += tc.function.arguments;
      }
    }

    if (sawSentinel || calls.length === 0 || !toolsAllowed) break;

    messages.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } })),
    });
    for (const call of calls) {
      // Not cancelled on barge-in: a booking that went through must be
      // recorded on the session, or the next turn wouldn't know about it.
      const result = await appointmentSvc.runTool(state, call.name, call.args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
    if (signal?.aborted) break;
    // Keep the words of the two rounds apart when spoken
    if (roundText && !/\s$/.test(roundText)) filter.push(' ');
  }
  filter.end();

  return { fullText: filter.spoken.trim(), endCall: filter.endCall };
}

// ─── Greeting ───────────────────────────────────────────────────────────────

function partOfDay(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: config.COMPANY_TIMEZONE }).format(now)
  );
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

export function buildGreeting(
  business: Pick<BusinessProfile, 'mode' | 'name' | 'personaName' | 'greeting'>,
  now: Date = new Date()
): string {
  const disclosure = config.RECORD_CALLS
    ? ' Just to let you know, this call may be recorded.'
    : '';

  if (business.mode === 'DEMO') {
    // Demo calls always say up front that it's an AI answering
    if (business.greeting) {
      const aiNote = /\bAI\b/i.test(business.greeting) ? '' : " You're speaking to an AI assistant.";
      return `${business.greeting}${aiNote}${disclosure}`;
    }
    return (
      `Good ${partOfDay(now)}, ${business.name}, you're speaking to ${business.personaName}, the AI assistant.${disclosure} ` +
      `How can I help?`
    );
  }

  if (business.greeting) return `${business.greeting}${disclosure}`;
  return (
    `Hi, thanks for calling ${business.name}! This is ${business.personaName}.${disclosure} ` +
    `The team can't get to the phone right now, but I can take a message — could I start with your name, please?`
  );
}

// Canned lines for call limits (silence / max duration), shared by both modes
export const SILENCE_NUDGE = "Are you still there? No rush — I'm here whenever you're ready.";
export const SILENCE_GOODBYE =
  "I can't seem to hear anything, so I'll let you go. Feel free to call back any time. Goodbye!";
export const TIME_LIMIT_GOODBYE =
  "I'm sorry, I need to wrap up the call here — I've passed on everything you've told me and someone will get back to you. Goodbye!";

// ─── Data extraction ─────────────────────────────────────────────────────────

export interface ExtractionInput {
  /** Turn-by-turn transcript from live STT (has speaker labels). */
  liveTranscript: string;
  /** Post-call transcription of the recording (more accurate, no labels). */
  audioTranscript?: string;
  /** Caller ID the call came from, used when they say "this number is fine". */
  callerNumber?: string;
  /** Anything the live conversation already pinned down. */
  known?: Partial<ExtractedCallData>;
  /** The business the call was for (names the receptionist in the prompt). */
  business: BusinessProfile;
}

export async function extractStructuredData(params: ExtractionInput): Promise<ExtractedCallData> {
  const sources = [
    `LIVE TRANSCRIPT (from real-time speech recognition, with speaker labels):\n${params.liveTranscript}`,
  ];
  if (params.audioTranscript) {
    sources.push(
      `AUDIO TRANSCRIPT (transcribed from the call recording after the call — more accurate for names, spellings and numbers, but has no speaker labels):\n${params.audioTranscript}`
    );
  }

  const prompt = `You are a data extraction assistant. Extract structured information about the caller from a phone call between an AI receptionist (${params.business.personaName} at ${params.business.name}) and a caller.

${sources.join('\n\n')}

Caller ID (the number they called from): ${isDialableNumber(params.callerNumber) ? params.callerNumber : 'withheld (do not use as the phone number)'}
${params.known && Object.keys(params.known).length ? `Details already confirmed during the call: ${JSON.stringify(params.known)}` : ''}

Rules:
- Where the two transcripts disagree on a name, spelling, email or number, prefer the audio transcript.
- Keypad input appears in [square brackets] and is exact — always prefer it for phone numbers.
- If the caller confirmed the number they're calling from is the best one, use the caller ID above as the phone.
- The transcripts come from speech recognition: normalise obvious mis-transcriptions ("at gmail dot com" → "@gmail.com", digits spoken as words → numerals, "oh" in a number → 0).
- Do not invent details. Use an empty string for anything not provided.
- "message": a concise account of what the caller wants (2-3 sentences max), in the third person. For a table booking, include the party size, date and time.
- "summary": a 3-5 sentence professional summary suitable for email, covering who called, what they want, urgency, and any requested follow-up.
- "urgency": one of low, medium, high, urgent — infer from context if not stated.`;

  const completion = await extractionClient.chat.completions.create({
    model: config.EXTRACTION_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'call_extraction',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'company', 'phone', 'email', 'message', 'urgency', 'summary'],
          properties: {
            name: { type: 'string' },
            company: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            message: { type: 'string' },
            urgency: { type: 'string', enum: URGENCY_VALUES },
            summary: { type: 'string' },
          },
        },
      },
    },
    temperature: 0.1,
    max_tokens: 700,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';

  try {
    const data = normalizeExtractedData(JSON.parse(raw));
    logger.info('Structured data extracted from transcript');
    return data;
  } catch {
    logger.error('Failed to parse extracted data', { raw });
    return {
      name: '',
      company: '',
      phone: '',
      email: '',
      message: 'Could not extract message from transcript.',
      urgency: 'medium',
      summary: params.liveTranscript.substring(0, 500),
    };
  }
}
