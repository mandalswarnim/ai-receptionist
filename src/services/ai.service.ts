/**
 * AI service: drives the conversation and extracts structured data.
 *
 * Two conversation modes share one persona:
 *  - generateResponse(): JSON single-shot, used by the webhook/Gather flow
 *  - streamResponse():   plain-text token streaming, used by ConversationRelay
 */

import OpenAI from 'openai';
import { config } from '../config';
import { ConversationState, ExtractedCallData, ConversationStep } from '../types';
import { logger } from '../lib/logger';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/** Sentinel the model appends after its goodbye so we know to hang up. */
export const END_CALL_TOKEN = '[END_CALL]';

// ─── System prompt ──────────────────────────────────────────────────────────

function buildPersonaPrompt(callerNumber: string): string {
  return `You are ${config.PERSONA_NAME}, the friendly receptionist who answers calls for ${config.COMPANY_NAME} when the team can't get to the phone. You're speaking on a live phone call and your words are read aloud by text-to-speech.

How you speak:
- Sound like a real person on the phone: contractions, warm and relaxed, small acknowledgements ("Lovely, thanks James.", "Right, got it.", "Perfect.").
- Keep it short — one or two sentences, under 30 words. Ask exactly ONE question per turn.
- Vary your wording. Never use the same acknowledgement twice in a row, and never sound scripted.
- Plain spoken words only: no emojis, no markdown, no lists, no stage directions, no headings.
- Read phone numbers back digit by digit ("oh seven seven, one two three...") and spell emails out when confirming.
- The caller's speech comes from speech recognition and may be slightly garbled — infer the most likely meaning from context rather than asking them to repeat unless it's a name, number, or email.

What you need before saying goodbye:
1. Their name (required)
2. Company (optional — ask once, drop it if they skip it)
3. Best number to reach them (required). They're calling from ${callerNumber} — if that looks like a real number, just ask "is the number you're calling from the best one to reach you on?" instead of making them dictate one.
4. Email (optional — ask once, confirm spelling if given)
5. What the call is about (required — get enough detail to be useful)
6. Whether it's urgent

Ground rules:
- You are an AI assistant. If asked directly, say so briefly and cheerfully, then carry on. Never claim to be human.
- Never promise response times — "someone will get back to you" is the line.
- If the caller is rude, stay warm and steer back to taking the message.
- Once you have the required details, confirm the key points in one short sentence, then wrap up warmly and say goodbye.`;
}

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
    { role: 'system', content: buildPersonaPrompt(state.from) },
    ...state.turns.map((t) => ({
      role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: t.content,
    })),
  ];

  // Meta-instruction to keep the model's state tracking on rails
  messages.push({
    role: 'system',
    content: `Current conversation step: ${state.step}
Collected so far: ${JSON.stringify(state.collectedInfo)}
Determine the best next step from: collect_name, collect_company, collect_phone, collect_email, collect_message, collect_urgency, confirm, closing.
Respond with a JSON object: { "response": "<what to say to the caller>", "nextStep": "<step>", "extracted": { "name?": "", "company?": "", "phone?": "", "email?": "", "message?": "", "urgency?": "low|medium|high|urgent" } }
Only include extracted fields that were mentioned in the caller's latest message. Do not re-ask for anything already collected.`,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      response: string;
      nextStep: ConversationStep;
      extracted?: Partial<ExtractedCallData>;
    };

    logger.debug('AI response generated', {
      callSid: state.callSid,
      step: state.step,
      nextStep: parsed.nextStep,
    });

    return {
      response: parsed.response || "Sorry, I didn't quite catch that — could you say it again?",
      nextStep: parsed.nextStep || state.step,
      extracted: parsed.extracted ?? {},
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
 */
export async function streamResponse(
  state: ConversationState,
  onToken: (token: string) => void
): Promise<{ fullText: string; endCall: boolean }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        buildPersonaPrompt(state.from) +
        `\n\nReply with plain conversational text only. When the conversation is finished and you have said goodbye, append the exact token ${END_CALL_TOKEN} at the very end of your reply.`,
    },
    ...state.turns.map((t) => ({
      role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: t.content,
    })),
  ];

  const stream = await openai.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages,
    temperature: 0.6,
    max_tokens: 200,
    stream: true,
  });

  // Hold back any trailing text that could be the start of the sentinel so it
  // is never spoken, even when the sentinel is split across chunks.
  let pending = '';
  let spoken = '';
  let endCall = false;

  const flushSafe = (final: boolean) => {
    let safeLen = pending.length;
    if (!final) {
      for (let keep = Math.min(END_CALL_TOKEN.length - 1, pending.length); keep > 0; keep--) {
        if (END_CALL_TOKEN.startsWith(pending.slice(pending.length - keep))) {
          safeLen = pending.length - keep;
          break;
        }
      }
    }
    if (safeLen > 0) {
      const out = pending.slice(0, safeLen);
      pending = pending.slice(safeLen);
      spoken += out;
      onToken(out);
    }
  };

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? '';
    if (!delta) continue;
    pending += delta;

    const idx = pending.indexOf(END_CALL_TOKEN);
    if (idx !== -1) {
      endCall = true;
      pending = pending.slice(0, idx);
      flushSafe(true);
      break;
    }
    flushSafe(false);
  }
  flushSafe(true);

  return { fullText: spoken.trim(), endCall };
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

// ─── Data extraction ─────────────────────────────────────────────────────────

export async function extractStructuredData(
  transcript: string
): Promise<ExtractedCallData> {
  const prompt = `You are a data extraction assistant. Extract structured information from the following call transcript between an AI receptionist and a caller.

Transcript:
${transcript}

Return a JSON object with these exact keys:
{
  "name": "caller's full name or empty string",
  "company": "caller's company or empty string",
  "phone": "best phone number to reach caller or empty string",
  "email": "caller's email address or empty string",
  "message": "concise summary of what the caller wants (2-3 sentences max)",
  "urgency": "one of: low, medium, high, urgent",
  "summary": "a 3-5 sentence professional summary suitable for email, including who called, what they want, urgency, and requested follow-up"
}

The transcript comes from speech recognition, so lightly normalise obvious mis-transcriptions (e.g. "at gmail dot com" → "@gmail.com", digits spoken as words → numerals). If information was not provided, use an empty string. For urgency, infer from context if not explicitly stated.`;

  const completion = await openai.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 600,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';

  try {
    const data = JSON.parse(raw) as ExtractedCallData;
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
      summary: transcript.substring(0, 500),
    };
  }
}
