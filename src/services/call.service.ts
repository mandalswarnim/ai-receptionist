/**
 * Call service: orchestrates post-call processing.
 * Handles transcription → data extraction → DB persistence → notifications.
 */

import { db } from '../lib/db';
import { logger } from '../lib/logger';
import { transcribeRecording, buildTurnsTranscript } from './transcription.service';
import { extractStructuredData } from './ai.service';
import { sendCallSummaryEmail } from './email.service';
import { sendSlackNotification } from './slack.service';
import { sendUrgentSms } from './twilio.service';
import { config } from '../config';
import { ConversationState } from '../types';

export async function processCompletedCall(
  state: ConversationState,
  recordingUrl?: string,
  recordingSid?: string,
  duration?: number
): Promise<void> {
  const { callSid } = state;
  logger.info('Processing completed call', { callSid, hasRecording: !!recordingUrl });

  try {
    // 1. Build transcript (from recording if available, else from conversation turns)
    let transcript: string;
    if (recordingUrl && state.turns.length > 0) {
      try {
        const whisperTranscript = await transcribeRecording(recordingUrl);
        // Prefer Whisper but fall back to turn-based if too short
        transcript =
          whisperTranscript.length > 50
            ? whisperTranscript
            : buildTurnsTranscript(state.turns);
      } catch {
        transcript = buildTurnsTranscript(state.turns);
      }
    } else {
      transcript = buildTurnsTranscript(state.turns);
    }

    // 2. Extract structured data
    const extractedData = await extractStructuredData(transcript);

    // Seed with what the conversation service already collected
    const finalData = {
      name: extractedData.name || state.collectedInfo.name || '',
      company: extractedData.company || state.collectedInfo.company || '',
      phone: extractedData.phone || state.collectedInfo.phone || state.from,
      email: extractedData.email || state.collectedInfo.email || '',
      message: extractedData.message || state.collectedInfo.message || '',
      urgency: extractedData.urgency || state.collectedInfo.urgency || 'medium',
      summary: extractedData.summary,
    };

    // 3. Persist to database
    const callRecord = await db.call.upsert({
      where: { callSid },
      create: {
        callSid,
        from: state.from,
        to: config.TWILIO_PHONE_NUMBER,
        status: 'COMPLETED',
        startedAt: state.startedAt,
        endedAt: new Date(),
        duration,
        recordingUrl,
        recordingSid,
        callerName: finalData.name,
        callerCompany: finalData.company,
        callerPhone: finalData.phone,
        callerEmail: finalData.email,
        message: finalData.message,
        urgency: finalData.urgency.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
        summary: finalData.summary,
        transcript,
        turns: {
          create: state.turns.map((t, i) => ({
            role: t.role,
            content: t.content,
            sequence: i,
          })),
        },
      },
      update: {
        status: 'COMPLETED',
        endedAt: new Date(),
        duration,
        recordingUrl,
        recordingSid,
        callerName: finalData.name,
        callerCompany: finalData.company,
        callerPhone: finalData.phone,
        callerEmail: finalData.email,
        message: finalData.message,
        urgency: finalData.urgency.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
        summary: finalData.summary,
        transcript,
      },
    });

    // 4. Send email notification
    await sendCallSummaryEmail(finalData, callSid, state.startedAt);
    await db.call.update({
      where: { id: callRecord.id },
      data: { emailSent: true, emailSentAt: new Date() },
    });

    // 5. Slack notification (non-blocking)
    sendSlackNotification(finalData, callSid, state.startedAt).catch((err) =>
      logger.error('Slack notification error', { err })
    );

    // 6. SMS alert for urgent calls
    if (finalData.urgency === 'urgent' && config.ALERT_SMS_NUMBER) {
      await sendUrgentSms(
        config.ALERT_SMS_NUMBER,
        finalData.name || 'Unknown',
        finalData.message
      );
    }

    logger.info('Call processing complete', { callSid, urgency: finalData.urgency });
  } catch (err) {
    logger.error('Failed to process completed call', { callSid, err });

    // Still attempt to save the raw state
    await db.call
      .upsert({
        where: { callSid },
        create: {
          callSid,
          from: state.from,
          to: config.TWILIO_PHONE_NUMBER,
          status: 'FAILED',
          startedAt: state.startedAt,
          endedAt: new Date(),
          transcript: buildTurnsTranscript(state.turns),
        },
        update: {
          status: 'FAILED',
          endedAt: new Date(),
          transcript: buildTurnsTranscript(state.turns),
        },
      })
      .catch(() => null);
  }
}

export async function createInitialCallRecord(
  callSid: string,
  from: string
): Promise<void> {
  await db.call.upsert({
    where: { callSid },
    create: {
      callSid,
      from,
      to: config.TWILIO_PHONE_NUMBER,
      status: 'IN_PROGRESS',
    },
    update: { status: 'IN_PROGRESS' },
  });
}
