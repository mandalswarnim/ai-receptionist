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
    // 1. Build transcript (from recording if already available, else from
    //    conversation turns — the recording webhook upgrades it later)
    let transcript: string;
    if (recordingUrl && state.turns.length > 0) {
      try {
        const audioTranscript = await transcribeRecording(recordingUrl);
        transcript =
          audioTranscript.length > 50
            ? audioTranscript
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

/** Closes out a call record that ended before the caller said anything. */
export async function markCallCompleted(callSid: string): Promise<void> {
  await db.call.updateMany({
    where: { callSid },
    data: { status: 'COMPLETED', endedAt: new Date() },
  });
}

/**
 * Called when the call recording becomes available (usually seconds after the
 * call ends and the summary email has already gone out). Replaces the
 * live-STT transcript with an accurate audio transcription, and backfills any
 * caller details the live conversation missed.
 */
export async function enhanceCallWithRecording(
  callSid: string,
  recordingUrl: string,
  recordingSid: string,
  duration: number
): Promise<void> {
  const call = await db.call.findUnique({ where: { callSid } });
  if (!call) {
    logger.warn('Recording ready for unknown call', { callSid });
    return;
  }

  await db.call.update({
    where: { callSid },
    data: { recordingUrl, recordingSid, duration },
  });

  // Nothing to transcribe against for calls that never got going
  if (call.status === 'IN_PROGRESS') return;

  try {
    const contextHint = call.callerName ? `The caller's name is ${call.callerName}.` : undefined;
    const transcript = await transcribeRecording(recordingUrl, contextHint);
    if (transcript.length < 20) return;

    const updates: Record<string, unknown> = { transcript };

    // If the live conversation failed to capture key details, the accurate
    // audio transcript often has them — re-extract and backfill.
    if (!call.callerName || !call.message) {
      const extracted = await extractStructuredData(transcript);
      if (!call.callerName && extracted.name) updates['callerName'] = extracted.name;
      if (!call.callerCompany && extracted.company) updates['callerCompany'] = extracted.company;
      if (!call.callerPhone && extracted.phone) updates['callerPhone'] = extracted.phone;
      if (!call.callerEmail && extracted.email) updates['callerEmail'] = extracted.email;
      if (!call.message && extracted.message) {
        updates['message'] = extracted.message;
        updates['summary'] = extracted.summary;
      }
    }

    await db.call.update({ where: { callSid }, data: updates });
    logger.info('Call record enhanced with audio transcript', { callSid });
  } catch (err) {
    logger.error('Failed to enhance call with recording', { callSid, err });
  }
}
