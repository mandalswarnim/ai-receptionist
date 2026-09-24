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

function buildPersonaPrompt(callerNumber: string, keypadAvailable: boolean): string {
  const keypadLine = keypadAvailable
    ? `\n- Numbers are easy to mishear over the phone. When you ask for a phone number, offer the keypad: "or you can type it on your keypad and press hash". Text in [square brackets] from the caller is keypad input, not speech — treat it as exact.`
    : '';

  return `You are ${config.PERSONA_NAME}, the friendly receptionist who answers calls for ${config.COMPANY_NAME} when the team can't get to the phone. You're speaking on a live phone call and your words are read aloud by text-to-speech.

How you speak:
- Sound like a real person on the phone: contractions, warm and relaxed, small acknowledgements ("Lovely, thanks James.", "Right, got it.", "Perfect.").
- Keep it short — one or two sentences, under 30 words. Ask exactly ONE question per turn.
- Vary your wording. Never use the same acknowledgement twice in a row, and never sound scripted.
- Plain spoken words only: no emojis, no markdown, no lists, no stage directions, no headings.
- Read phone numbers back digit by digit ("oh seven seven, one two three...") and spell emails out when confirming.
- The caller's speech comes from speech recognition and may be slightly garbled — infer the most likely meaning from context rather than asking them to repeat unless it's a name, number, or email.${keypadLine}

What you need before saying goodbye:
1. Their name (required)
2. Company (optional — ask once, drop it if they skip it)
3. Best number to reach them (required). ${
    isDialableNumber(callerNumber)
      ? `They're calling from ${callerNumber} — just ask "is the number you're calling from the best one to reach you on?" instead of making them dictate one.`
      : `Their caller ID is withheld, so you'll need to ask them for a number.`
  }
4. Email (optional — ask once, confirm spelling if given)
5. What the call is about (required — get enough detail to be useful)
6. Whether it's urgent

Ground rules:
- You are an AI assistant. If asked directly, say so briefly and cheerfully, then carry on. Never claim to be human.
- Never promise response times — "someone will get back to you" is the line.
- If the caller is rude, stay warm and steer back to taking the message.
- Once you have the required details, confirm the key points in one short sentence, then wrap up warmly and say goodbye.`;
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
    { role: 'system', content: buildPersonaPrompt(state.from, false) },
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
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        buildPersonaPrompt(state.from, true) +
        `\n\nReply with plain conversational text only. When the conversation is finished and you have said goodbye, append the exact token ${END_CALL_TOKEN} at the very end of your reply.`,
    },
    ...historyMessages(state),
  ];

  const stream = await liveClient.chat.completions.create(
    {
      model: config.OPENAI_MODEL,
      messages,
      temperature: 0.6,
      max_tokens: 200,
      stream: true,
    },
    { signal }
  );

  const filter = new SentinelFilter(onToken);
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (!filter.push(delta)) {
      stream.controller.abort();
      break;
    }
  }
  filter.end();

  return { fullText: filter.spoken.trim(), endCall: filter.endCall };
}

// ─── Greeting ───────────────────────────────────────────────────────────────

export function buildGreeting(): string {
  const disclosure = config.RECORD_CALLS
    ? ' Just to let you know, this call may be recorded.'
    : '';
  return (
    `Hi, thanks for calling ${config.COMPANY_NAME}! This is ${config.PERSONA_NAME}.${disclosure} ` +
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
}

export async function extractStructuredData(input: ExtractionInput | string): Promise<ExtractedCallData> {
  const params: ExtractionInput = typeof input === 'string' ? { liveTranscript: input } : input;

  const sources = [
    `LIVE TRANSCRIPT (from real-time speech recognition, with speaker labels):\n${params.liveTranscript}`,
  ];
  if (params.audioTranscript) {
    sources.push(
      `AUDIO TRANSCRIPT (transcribed from the call recording after the call — more accurate for names, spellings and numbers, but has no speaker labels):\n${params.audioTranscript}`
    );
  }

  const prompt = `You are a data extraction assistant. Extract structured information about the caller from a phone call between an AI receptionist (${config.PERSONA_NAME} at ${config.COMPANY_NAME}) and a caller.

${sources.join('\n\n')}

Caller ID (the number they called from): ${isDialableNumber(params.callerNumber) ? params.callerNumber : 'withheld (do not use as the phone number)'}
${params.known && Object.keys(params.known).length ? `Details already confirmed during the call: ${JSON.stringify(params.known)}` : ''}

Rules:
- Where the two transcripts disagree on a name, spelling, email or number, prefer the audio transcript.
- Keypad input appears in [square brackets] and is exact — always prefer it for phone numbers.
- If the caller confirmed the number they're calling from is the best one, use the caller ID above as the phone.
- The transcripts come from speech recognition: normalise obvious mis-transcriptions ("at gmail dot com" → "@gmail.com", digits spoken as words → numerals, "oh" in a number → 0).
- Do not invent details. Use an empty string for anything not provided.
- "message": a concise account of what the caller wants (2-3 sentences max), in the third person.
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
