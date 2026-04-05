/**
 * Twilio service: TwiML builders and Twilio REST API helpers.
 */

import twilio from 'twilio';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { config } from '../config';
import { logger } from '../lib/logger';

export const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

// ─── TwiML builders ──────────────────────────────────────────────────────────

/**
 * Greeting TwiML: the AI says hello and immediately listens for a response.
 * This is the first thing callers hear when the AI picks up.
 */
export function buildGreetingTwiml(callSid: string, greeting: string): string {
  const twiml = new VoiceResponse();

  twiml.say({ voice: 'Polly.Joanna-Neural', language: 'en-US' }, greeting);

  const gather = twiml.gather({
    input: ['speech'],
    speechTimeout: 'auto',
    speechModel: 'phone_call',
    language: 'en-US',
    action: `${config.BASE_URL}/api/webhooks/gather?callSid=${callSid}`,
    method: 'POST',
    timeout: 10,
  });

  // Fallback prompt if caller says nothing
  gather.say(
    { voice: 'Polly.Joanna-Neural', language: 'en-US' },
    "I didn't catch that. Could you please speak your response?"
  );

  // If gather times out, loop back
  twiml.redirect(`${config.BASE_URL}/api/webhooks/gather?callSid=${callSid}&noInput=true`);

  return twiml.toString();
}

/**
 * Gather TwiML: AI speaks a response and listens for the next caller input.
 */
export function buildGatherTwiml(callSid: string, message: string): string {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: ['speech'],
    speechTimeout: 'auto',
    speechModel: 'phone_call',
    language: 'en-US',
    action: `${config.BASE_URL}/api/webhooks/gather?callSid=${callSid}`,
    method: 'POST',
    timeout: 10,
  });

  gather.say({ voice: 'Polly.Joanna-Neural', language: 'en-US' }, message);

  // Timeout fallback
  twiml.say(
    { voice: 'Polly.Joanna-Neural', language: 'en-US' },
    "I'm still here. Take your time."
  );
  twiml.redirect(`${config.BASE_URL}/api/webhooks/gather?callSid=${callSid}&noInput=true`);

  return twiml.toString();
}

/**
 * Closing TwiML: AI speaks a goodbye message and hangs up.
 * Triggers call recording completion.
 */
export function buildClosingTwiml(message: string): string {
  const twiml = new VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna-Neural', language: 'en-US' }, message);
  twiml.hangup();
  return twiml.toString();
}

/**
 * Error TwiML: used when something goes wrong mid-call.
 */
export function buildErrorTwiml(): string {
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: 'Polly.Joanna-Neural', language: 'en-US' },
    "I'm sorry, I'm experiencing a technical difficulty. Please try calling again, and someone will assist you. Goodbye."
  );
  twiml.hangup();
  return twiml.toString();
}

// ─── Recording helpers ───────────────────────────────────────────────────────

/**
 * Fetches a recording as a Buffer for transcription.
 */
export async function fetchRecordingBuffer(recordingUrl: string): Promise<Buffer> {
  const url = `${recordingUrl}.mp3`;
  const response = await fetch(url, {
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64'),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch recording: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Sends an SMS alert for urgent calls.
 */
export async function sendUrgentSms(
  to: string,
  callerName: string,
  message: string
): Promise<void> {
  if (!config.ALERT_SMS_NUMBER) return;

  await twilioClient.messages.create({
    to,
    from: config.TWILIO_PHONE_NUMBER,
    body: `🚨 URGENT CALL from ${callerName}: ${message.substring(0, 140)}`,
  });

  logger.info('Urgent SMS alert sent', { to, callerName });
}
