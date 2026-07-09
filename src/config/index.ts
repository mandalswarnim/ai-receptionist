import dotenv from 'dotenv';
import { z } from 'zod';

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
  OPENAI_MODEL: z.string().default('gpt-4o'),
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
  RELAY_SPEECH_MODEL: z.string().default('nova-2-general'),

  // Call recording (enables accurate post-call transcription).
  // The greeting includes a recording disclosure line when this is on.
  RECORD_CALLS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

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
  return result.data;
}

export const config = loadConfig();

export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';

/** wss:// equivalent of BASE_URL, used for the ConversationRelay WebSocket. */
export const wsBaseUrl = config.BASE_URL.replace(/^http/, 'ws');
