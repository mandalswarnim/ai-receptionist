/**
 * Transcription service: converts call recordings to text using OpenAI Whisper.
 */

import OpenAI from 'openai';
import { toFile } from 'openai';
import { config } from '../config';
import { fetchRecordingBuffer } from './twilio.service';
import { logger } from '../lib/logger';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export async function transcribeRecording(recordingUrl: string): Promise<string> {
  logger.info('Starting transcription', { recordingUrl });

  try {
    const buffer = await fetchRecordingBuffer(recordingUrl);

    const file = await toFile(buffer, 'recording.mp3', { type: 'audio/mpeg' });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: config.WHISPER_MODEL,
      language: 'en',
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
 * Builds a readable transcript from conversation turns when Whisper
 * transcription is not available (e.g. for very short calls).
 */
export function buildTurnsTranscript(
  turns: Array<{ role: 'assistant' | 'caller'; content: string }>
): string {
  return turns
    .map((t) => `${t.role === 'assistant' ? 'AI Receptionist' : 'Caller'}: ${t.content}`)
    .join('\n');
}
