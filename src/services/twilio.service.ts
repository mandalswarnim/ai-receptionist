/**
 * Twilio service: TwiML builders and Twilio REST API helpers.
 */

import twilio from 'twilio';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { config, wsBaseUrl, relayAuthToken } from '../config';
import { logger } from '../lib/logger';

export const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

// ─── Shared TTS / STT settings ───────────────────────────────────────────────

const SAY_ATTRS = {
  voice: config.TTS_VOICE as never,
  language: config.TTS_LANGUAGE as never,
};

/** Vocabulary hints improve live speech recognition of expected words. */
function speechHints(): string {
  const base = [
    config.COMPANY_NAME,
    config.PERSONA_NAME,
    'yes',
    'no',
    'urgent',
    'email',
    'phone number',
    'message',
    'at gmail dot com',
    'at outlook dot com',
  ];
  if (config.SPEECH_HINTS) base.push(...config.SPEECH_HINTS.split(','));
  return base
    .map((h) => h.trim())
    .filter(Boolean)
    .join(',');
}

function addGather(twiml: VoiceResponse, callSid: string, message: string): void {
  const gather = twiml.gather({
    input: ['speech'],
    speechTimeout: config.SPEECH_TIMEOUT,
    speechModel: config.SPEECH_MODEL,
    language: config.TTS_LANGUAGE as never,
    hints: speechHints(),
    profanityFilter: false,
    action: `${config.BASE_URL}/api/webhooks/gather?callSid=${callSid}`,
    method: 'POST',
    timeout: 6,
    // Always POST to the action, even on silence — no <Redirect> dance needed
    actionOnEmptyResult: true,
  });

  // Speaking inside <Gather> means the caller can barge in mid-sentence and
  // nothing they say while the AI is talking gets lost.
  gather.say(SAY_ATTRS, message);
}

// ─── TwiML builders (webhook/Gather mode) ────────────────────────────────────

/**
 * Greeting TwiML: the AI says hello while already listening, so callers can
 * interrupt and speech during the greeting is captured.
 */
export function buildGreetingTwiml(callSid: string, greeting: string): string {
  const twiml = new VoiceResponse();
  addGather(twiml, callSid, greeting);
  return twiml.toString();
}

/**
 * Gather TwiML: AI speaks a response and listens for the next caller input.
 */
export function buildGatherTwiml(callSid: string, message: string): string {
  const twiml = new VoiceResponse();
  addGather(twiml, callSid, message);
  return twiml.toString();
}

/**
 * Closing TwiML: AI speaks a goodbye message and hangs up.
 */
export function buildClosingTwiml(message: string): string {
  const twiml = new VoiceResponse();
  twiml.say(SAY_ATTRS, message);
  twiml.hangup();
  return twiml.toString();
}

/**
 * Error TwiML: used when something goes wrong mid-call.
 */
export function buildErrorTwiml(): string {
  const twiml = new VoiceResponse();
  twiml.say(
    SAY_ATTRS,
    "I'm really sorry, something's gone wrong on my end. Please call back in a moment and I'll be right here. Goodbye."
  );
  twiml.hangup();
  return twiml.toString();
}

// ─── TwiML builder (ConversationRelay mode) ──────────────────────────────────

/**
 * ConversationRelay TwiML: Twilio streams caller speech to our WebSocket as
 * text and speaks whatever text we send back (ElevenLabs TTS + Deepgram STT),
 * with barge-in handled natively.
 */
export function buildRelayTwiml(greeting: string): string {
  const twiml = new VoiceResponse();
  twiml.connect().conversationRelay({
    url: `${wsBaseUrl}/api/relay?token=${relayAuthToken}`,
    welcomeGreeting: greeting,
    welcomeGreetingInterruptible: 'speech',
    ttsProvider: config.RELAY_TTS_PROVIDER,
    voice: config.RELAY_VOICE,
    transcriptionProvider: config.RELAY_TRANSCRIPTION_PROVIDER,
    speechModel: config.RELAY_SPEECH_MODEL,
    transcriptionLanguage: config.TTS_LANGUAGE,
    ttsLanguage: config.TTS_LANGUAGE,
    interruptible: 'speech',
    // Bias STT toward the words we expect (company, persona, "at gmail dot com")
    hints: speechHints(),
    // Lets callers type their phone number instead of dictating it
    dtmfDetection: true,
    // Reads "07700 900123" and "james@acme.co.uk" naturally instead of
    // spelling punctuation out
    elevenlabsTextNormalization: 'auto',
    profanityFilter: false,
  });
  return twiml.toString();
}

// ─── Recording helpers ───────────────────────────────────────────────────────

/**
 * Starts a full-call recording via the REST API (TwiML alone can't record a
 * live conversational call). Fire-and-forget: a failed recording should never
 * break the call itself.
 */
export async function startCallRecording(callSid: string): Promise<void> {
  if (!config.RECORD_CALLS) return;
  try {
    await twilioClient.calls(callSid).recordings.create({
      recordingChannels: 'dual',
      recordingStatusCallback: `${config.BASE_URL}/api/webhooks/recording`,
      recordingStatusCallbackEvent: ['completed'],
    });
    logger.info('Call recording started', { callSid });
  } catch (err) {
    logger.error('Failed to start call recording', { callSid, err });
  }
}

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
 * Ends a live call gracefully via the REST API (used by relay mode after the
 * goodbye has been spoken).
 */
export async function endCall(callSid: string): Promise<void> {
  try {
    await twilioClient.calls(callSid).update({ status: 'completed' });
    logger.info('Call ended via REST API', { callSid });
  } catch (err) {
    logger.error('Failed to end call', { callSid, err });
  }
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
