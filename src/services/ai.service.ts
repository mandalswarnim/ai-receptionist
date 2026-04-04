/**
 * AI service: drives the conversation using GPT-4o and extracts structured data.
 */

import OpenAI from 'openai';
import { config } from '../config';
import { ConversationState, ExtractedCallData, ConversationStep } from '../types';
import { logger } from '../lib/logger';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a professional AI receptionist for ${config.COMPANY_NAME}. Your job is to take messages from callers when the human receptionist is unavailable.

Your personality:
- Warm, professional, and efficient
- Patient with callers who are confused or frustrated
- Never robotic — speak naturally
- Keep responses concise (1-3 sentences). This is a phone call.

Your goal is to collect:
1. Caller's full name (required)
2. Company name (optional — ask once, don't push)
3. Best phone number to reach them (required — confirm it back digit by digit)
4. Email address (optional — ask once, confirm spelling)
5. Purpose of the call / message (required)
6. Whether the matter is urgent

Rules:
- Never claim to be human if asked directly
- Never make promises about response times — say "someone will be in touch"
- If the caller is rude or aggressive, remain professional and politely redirect
- If audio is unclear, ask them to repeat ("I'm sorry, I didn't quite catch that. Could you repeat?")
- Confirm collected details before ending the call
- Keep each response under 40 words where possible

When the caller has confirmed their details, end with:
"Thank you for calling ${config.COMPANY_NAME}. I've noted everything down and someone will be in touch with you shortly. Have a great day. Goodbye."`;
}

// ─── Conversation response ───────────────────────────────────────────────────

export async function generateResponse(
  state: ConversationState,
  callerInput: string
): Promise<{ response: string; nextStep: ConversationStep }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...state.turns.map((t) => ({
      role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: t.content,
    })),
    { role: 'user', content: callerInput },
  ];

  // Append a meta-instruction to help the model track state
  messages.push({
    role: 'system',
    content: `Current conversation step: ${state.step}
Collected so far: ${JSON.stringify(state.collectedInfo)}
Determine the best next step from: collect_name, collect_company, collect_phone, collect_email, collect_message, collect_urgency, confirm, closing.
Respond with a JSON object: { "response": "<what to say to the caller>", "nextStep": "<step>", "extracted": { "name?": "", "company?": "", "phone?": "", "email?": "", "message?": "", "urgency?": "low|medium|high|urgent" } }
Only include extracted fields that were mentioned in the caller's latest message.`,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 300,
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
      response: parsed.response || "I'm sorry, I didn't quite understand. Could you repeat that?",
      nextStep: parsed.nextStep || state.step,
    };
  } catch (err) {
    logger.error('AI response generation failed', { callSid: state.callSid, err });
    return {
      response: "I'm sorry, I'm having a technical difficulty. Could you please repeat that?",
      nextStep: state.step,
    };
  }
}

// ─── Greeting ───────────────────────────────────────────────────────────────

export function buildGreeting(): string {
  return (
    `Hello, thank you for calling ${config.COMPANY_NAME}. ` +
    `Our receptionist is currently unavailable, but I'm the virtual assistant and I'm happy to take a message. ` +
    `Could I start by getting your full name please?`
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

If information was not provided, use an empty string. For urgency, infer from context if not explicitly stated.`;

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
