/**
 * Transcription service: converts call recordings to text.
 * Defaults to gpt-4o-transcribe (markedly more accurate than whisper-1 on
 * phone audio); the model is configurable via WHISPER_MODEL.
 */

import OpenAI from 'openai';
import { toFile } from 'openai';
import { config } from '../config';
import { fetchRecordingBuffer } from './twilio.service';
import { logger } from '../lib/logger';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export async function transcribeRecording(
  recordingUrl: string,
  contextHint?: string
): Promise<string> {
  logger.info('Starting transcription', { recordingUrl, model: config.WHISPER_MODEL });

  try {
    const buffer = await fetchRecordingBuffer(recordingUrl);

    const file = await toFile(buffer, 'recording.mp3', { type: 'audio/mpeg' });

    // A short context prompt biases the model toward the names and terms we
    // expect to hear, which noticeably improves accuracy on proper nouns.
    const prompt =
      `Phone call between ${config.PERSONA_NAME}, the receptionist at ${config.COMPANY_NAME}, ` +
      `and a caller leaving a message with their name, phone number, and email.` +
      (contextHint ? ` ${contextHint}` : '');

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: config.WHISPER_MODEL,
      language: 'en',
      prompt,
      response_format: 'text',
    });

    const text = typeof transcription === 'string' ? transcription : (transcription as { text: string }).text;
    logger.info('Transcription complete', { length: text.length });
    return text;
  } catch (err) {
    logger.error('Transcription failed', { recordingUrl, err });
    throw err;
  }
}

/**
 * Builds a readable transcript from conversation turns when audio
 * transcription is not available (e.g. recording still processing).
 */
export function buildTurnsTranscript(
  turns: Array<{ role: 'assistant' | 'caller'; content: string }>
): string {
  return turns
    .map((t) => `${t.role === 'assistant' ? 'AI Receptionist' : 'Caller'}: ${t.content}`)
    .join('\n');
}
