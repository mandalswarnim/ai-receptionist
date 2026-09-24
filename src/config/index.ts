import dotenv from 'dotenv';
import { z } from 'zod';
import { createHmac } from 'crypto';

dotenv.config();

const configSchema = z.object({
  // Server
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().url(),

  // Twilio (AI agent phone number — business forwards missed calls here)
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().startsWith('+'),

  // OpenAI
  OPENAI_API_KEY: z.string().startsWith('sk-'),
  // Conversation model: this is on the critical path of every turn, so
  // time-to-first-token matters more than raw intelligence. gpt-4.1-mini is
  // roughly 2-3x faster to first token than gpt-4o and plenty for taking a
  // message. Bump to gpt-4.1 / gpt-4o if you find it makes mistakes.
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  // Post-call extraction model: runs once per call, off the critical path,
  // so use the most accurate model you're happy paying for.
  EXTRACTION_MODEL: z.string().default('gpt-4.1'),
  // Post-call speech-to-text model. gpt-4o-transcribe is noticeably more
  // accurate than whisper-1 on phone audio; set WHISPER_MODEL=whisper-1 to revert.
  WHISPER_MODEL: z.string().default('gpt-4o-transcribe'),

  // Persona & voice
  PERSONA_NAME: z.string().default('Maya'),
  // Any Twilio <Say> voice. Generative voices sound far more human than Neural.
  // British female: Polly.Amy-Generative | US female: Polly.Joanna-Generative
  // US male: Polly.Matthew-Generative   | Google: Google.en-GB-Chirp3-HD-Aoede
  TTS_VOICE: z.string().default('Polly.Amy-Generative'),
  TTS_LANGUAGE: z.string().default('en-GB'),

  // Live speech recognition (webhook/Gather mode)
  // deepgram_nova-2 is far more accurate on conversational speech than phone_call.
  SPEECH_MODEL: z.string().default('deepgram_nova-2'),
  // Seconds of silence that ends a caller's utterance. Lower = snappier,
  // higher = safer for callers who pause mid-sentence.
  SPEECH_TIMEOUT: z.string().default('2'),
  // Extra comma-separated vocabulary hints for speech recognition (names,
  // product terms, local place names, etc.)
  SPEECH_HINTS: z.string().default(''),

  // ConversationRelay mode (streaming voice: ElevenLabs TTS + Deepgram STT + barge-in)
  USE_CONVERSATION_RELAY: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  RELAY_TTS_PROVIDER: z.string().default('ElevenLabs'),
  // ElevenLabs voice ID. Default "Amelia" — a warm British female voice.
  RELAY_VOICE: z.string().default('ZF6FPAbjXT4488VcRRnw'),
  RELAY_TRANSCRIPTION_PROVIDER: z.string().default('Deepgram'),
  // nova-3-general is markedly better than nova-2 on names, spelled-out
  // emails and digit strings — exactly what a receptionist has to get right.
  RELAY_SPEECH_MODEL: z.string().default('nova-3-general'),

  // Call recording (enables accurate post-call transcription).
  // The greeting includes a recording disclosure line when this is on.
  RECORD_CALLS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  // How long (ms) post-call processing waits for Twilio's recording to land
  // before falling back to the live transcript. The recording usually arrives
  // 2-10s after hangup; waiting for it means the summary email is built from
  // the accurate audio transcript instead of live STT. 0 disables the wait.
  RECORDING_WAIT_MS: z.coerce.number().int().min(0).default(25_000),

  // Call limits
  // Timeout (ms) for each live-conversation LLM request. The SDK default is
  // 10 minutes, which on a phone call means dead air.
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(8_000),
  // Seconds of caller silence (after the AI finishes speaking) before the AI
  // checks in; the same again with no response ends the call.
  SILENCE_TIMEOUT_S: z.coerce.number().int().min(5).default(12),
  // Hard cap on call length. The AI wraps up politely when it's reached.
  MAX_CALL_DURATION_S: z.coerce.number().int().min(60).default(600),
  // How long a SIGTERM waits for live calls and post-call processing (emails)
  // to finish before exiting. Keep it inside your host's shutdown grace period.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(25_000),

  // Email (Gmail SMTP)
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().default('587'),
  SMTP_USER: z.string().email(),          // Your Gmail address
  SMTP_PASS: z.string().min(1),           // Gmail App Password
  EMAIL_FROM_NAME: z.string().default('AI Receptionist'),
  BUSINESS_EMAIL: z.string().email(),     // Where call summaries are sent

  // Database
  DATABASE_URL: z.string().url(),

  // Company
  COMPANY_NAME: z.string().default('The Company'),
  COMPANY_TIMEZONE: z.string().default('UTC'),

  // Optional
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  ALERT_SMS_NUMBER: z.string().startsWith('+').optional(),

  // Security
  // Bearer token required on /api/calls/* (the admin API). Without it the
  // admin API is disabled — call records hold real people's details.
  ADMIN_API_KEY: z.string().min(16).optional(),
  // Skips Twilio webhook signature validation. Only for local testing where
  // signatures can't match (e.g. curl); ngrok works fine with validation on.
  // Refused in production.
  SKIP_TWILIO_SIGNATURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

function loadConfig() {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    result.error.issues.forEach((issue) => {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  if (result.data.SKIP_TWILIO_SIGNATURE && result.data.NODE_ENV === 'production') {
    console.error('❌ SKIP_TWILIO_SIGNATURE=true is not allowed in production');
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';

/** wss:// equivalent of BASE_URL, used for the ConversationRelay WebSocket. */
export const wsBaseUrl = config.BASE_URL.replace(/^http/, 'ws');

/**
 * Shared secret embedded in the ConversationRelay WebSocket URL. Twilio does
 * not sign WebSocket upgrades, so without this anyone who discovers the
 * endpoint could open sessions and burn LLM tokens. Derived from the Twilio
 * auth token so there is nothing extra to configure.
 */
export const relayAuthToken = createHmac('sha256', config.TWILIO_AUTH_TOKEN)
  .update('conversation-relay')
  .digest('hex')
  .slice(0, 32);
