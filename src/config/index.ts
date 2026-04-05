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
  WHISPER_MODEL: z.string().default('whisper-1'),

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
