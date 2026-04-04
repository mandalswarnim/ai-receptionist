import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  // Server
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().url(),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().startsWith('AC'),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_PHONE_NUMBER: z.string().startsWith('+'),
  RECEPTIONIST_PHONE_NUMBER: z.string().startsWith('+'),
  DIAL_TIMEOUT_SECONDS: z.string().default('20'),

  // OpenAI
  OPENAI_API_KEY: z.string().startsWith('sk-'),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  WHISPER_MODEL: z.string().default('whisper-1'),

  // SendGrid
  SENDGRID_API_KEY: z.string().startsWith('SG.'),
  EMAIL_FROM: z.string().email(),
  EMAIL_FROM_NAME: z.string().default('AI Receptionist'),
  RECEPTIONIST_EMAIL: z.string().email(),

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
