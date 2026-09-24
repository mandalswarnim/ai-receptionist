/**
 * Call service: orchestrates post-call processing.
 * Handles transcription → data extraction → DB persistence → notifications.
 */

import { db } from '../lib/db';
import { logger } from '../lib/logger';
import { transcribeRecording, buildTurnsTranscript } from './transcription.service';
import { extractStructuredData, normalizeUrgency } from './ai.service';
import { sendCallSummaryEmail } from './email.service';
import { sendSlackNotification } from './slack.service';
import { sendUrgentSms } from './twilio.service';
import { config } from '../config';
import { withRetry } from '../lib/retry';
import { isDialableNumber } from '../lib/phone';
import { ConversationState, ExtractedCallData } from '../types';

// ─── Recording hand-off ──────────────────────────────────────────────────────
//
// Twilio's recording callback lands a few seconds after the call ends. If
// post-call processing is still running, it waits (briefly) for the recording
// so the summary email is built from the accurate audio transcript rather
// than live STT. If the recording arrives after processing has finished, the
// webhook upgrades the stored record instead (see enhanceCallWithRecording).

interface RecordingInfo {
  recordingUrl: string;
  recordingSid: string;
  duration: number;
}

const recordingWaiters = new Map<string, (info?: RecordingInfo) => void>();
// Recordings that landed before processing registered a waiter (rare, but
// the hangup → recording-ready gap can be very short on tiny calls).
const earlyRecordings = new Map<string, RecordingInfo>();
const EARLY_RECORDING_TTL_MS = 60_000;

// Set during shutdown: stop waiting for recordings so emails go out before
// the process exits (the live transcript is used instead).
let shuttingDown = false;

function waitForRecording(callSid: string, timeoutMs: number): Promise<RecordingInfo | undefined> {
  const early = earlyRecordings.get(callSid);
  if (early) {
    earlyRecordings.delete(callSid);
    return Promise.resolve(early);
  }
  if (shuttingDown) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      recordingWaiters.delete(callSid);
      resolve(undefined);
    }, timeoutMs);
    timer.unref();
    recordingWaiters.set(callSid, (info) => {
      clearTimeout(timer);
      recordingWaiters.delete(callSid);
      resolve(info);
    });
  });
}

/**
 * Entry point for the recording webhook. Hands the recording to in-flight
 * post-call processing when there is one, otherwise enhances the stored call.
 */
export async function handleRecordingReady(info: RecordingInfo & { callSid: string }): Promise<void> {
  const waiter = recordingWaiters.get(info.callSid);
  if (waiter) {
    waiter(info);
    return;
  }
  earlyRecordings.set(info.callSid, info);
  setTimeout(() => earlyRecordings.delete(info.callSid), EARLY_RECORDING_TTL_MS).unref();
  await enhanceCallWithRecording(info.callSid, info.recordingUrl, info.recordingSid, info.duration);
}

// ─── In-flight tracking ──────────────────────────────────────────────────────
//
// Post-call processing runs after the call has hung up, so nothing else
// keeps the process alive for it. Track it so a deploy (SIGTERM) can wait for
// the email to go out instead of silently dropping the message.

const inflight = new Set<Promise<void>>();

/** Runs post-call processing in the background, tracked for shutdown. */
export function runPostCall(state: ConversationState, duration?: number): void {
  const task: Promise<void> = processCompletedCall(state, undefined, undefined, duration)
    .catch((err) => {
      logger.error('Post-call processing failed', { callSid: state.callSid, err });
    })
    .finally(() => inflight.delete(task));
  inflight.add(task);
}

/**
 * Waits for in-flight post-call processing to finish. Recording waits are cut
 * short so extraction proceeds immediately with the live transcript.
 */
export async function drainPostCallTasks(): Promise<void> {
  shuttingDown = true;
  for (const resolve of [...recordingWaiters.values()]) resolve(undefined);
  if (inflight.size > 0) logger.info('Waiting for post-call processing', { count: inflight.size });
  await Promise.all([...inflight]);
}

export function pendingPostCallCount(): number {
  return inflight.size;
}

function toDbUrgency(urgency: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  return normalizeUrgency(urgency).toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

async function transcribeSafely(recordingUrl: string, contextHint?: string): Promise<string | undefined> {
  try {
    const text = await transcribeRecording(recordingUrl, contextHint);
    return text.trim().length > 20 ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Email body used when AI extraction failed: the raw transcript, capped. */
export function fallbackSummary(transcript: string): string {
  const MAX = 4000;
  const body = transcript.length > MAX ? `${transcript.slice(0, MAX)}\n…(truncated)` : transcript;
  return `The automatic summary could not be generated for this call. Full transcript:\n\n${body}`;
}

function sendEmailWithRetry(data: ExtractedCallData, callSid: string, startedAt: Date): Promise<void> {
  return withRetry(() => sendCallSummaryEmail(data, callSid, startedAt), {
    attempts: 3,
    baseDelayMs: 2000,
    onRetry: (err, attempt) => logger.warn('Call summary email failed — retrying', { callSid, attempt, err }),
  });
}

// ─── Email resend sweep ──────────────────────────────────────────────────────
//
// Calls whose summary email never went out (SMTP down, server restarted
// mid-retry...) are resent here. Silent calls have no summary, so they are
// never picked up. The age window skips calls still being processed and
// stops very old messages from suddenly being delivered.

const RESEND_MIN_AGE_MS = 5 * 60_000;
const RESEND_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export async function resendPendingEmails(): Promise<void> {
  const now = Date.now();
  const pending = await db.call.findMany({
    where: {
      status: 'COMPLETED',
      emailSent: false,
      summary: { not: null },
      endedAt: { lt: new Date(now - RESEND_MIN_AGE_MS), gt: new Date(now - RESEND_MAX_AGE_MS) },
    },
    orderBy: { endedAt: 'asc' },
    take: 20,
  });
  if (pending.length === 0) return;

  logger.info('Resending unsent call summary emails', { count: pending.length });
  for (const call of pending) {
    const data: ExtractedCallData = {
      name: call.callerName ?? '',
      company: call.callerCompany ?? '',
      phone: call.callerPhone || (isDialableNumber(call.from) ? call.from : ''),
      email: call.callerEmail ?? '',
      message: call.message ?? '',
      urgency: normalizeUrgency(call.urgency?.toLowerCase()),
      summary: call.summary ?? '',
    };
    try {
      await sendCallSummaryEmail(data, call.callSid, call.startedAt);
      await db.call.update({
        where: { id: call.id },
        data: { emailSent: true, emailSentAt: new Date() },
      });
      logger.info('Resent call summary email', { callSid: call.callSid });
    } catch (err) {
      // SMTP is probably still down — try again on the next sweep.
      logger.error('Resend of call summary email failed', { callSid: call.callSid, err });
      return;
    }
  }
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export async function processCompletedCall(
  state: ConversationState,
  recordingUrl?: string,
  recordingSid?: string,
  duration?: number
): Promise<void> {
  const { callSid } = state;
  const startedProcessing = Date.now();
  logger.info('Processing completed call', { callSid, hasRecording: !!recordingUrl });

  try {
    // 1. Wait briefly for the recording so extraction can use the accurate
    //    audio transcript. Falls back to the live transcript on timeout.
    if (!recordingUrl && config.RECORD_CALLS && config.RECORDING_WAIT_MS > 0) {
      const info = await waitForRecording(callSid, config.RECORDING_WAIT_MS);
      if (info) {
        ({ recordingUrl, recordingSid } = info);
        duration ??= info.duration;
        logger.info('Recording arrived in time for extraction', {
          callSid,
          waitedMs: Date.now() - startedProcessing,
        });
      } else {
        logger.info('Recording not ready — extracting from live transcript', { callSid });
      }
    }

    const liveTranscript = buildTurnsTranscript(state.turns);
    const audioTranscript = recordingUrl ? await transcribeSafely(recordingUrl) : undefined;

    // 2. Extract structured data from both transcripts. If extraction fails
    //    (OpenAI outage, timeout...) the business still gets an email built
    //    from the raw transcript rather than nothing at all.
    let extractedData: Partial<ExtractedCallData> = {};
    let extractionFailed = false;
    try {
      extractedData = await extractStructuredData({
        liveTranscript,
        audioTranscript,
        callerNumber: state.from,
        known: state.collectedInfo,
      });
    } catch (err) {
      extractionFailed = true;
      logger.error('Extraction failed — falling back to raw transcript', { callSid, err });
    }

    // Seed with what the conversation service already collected
    const finalData: ExtractedCallData = {
      name: extractedData.name || state.collectedInfo.name || '',
      company: extractedData.company || state.collectedInfo.company || '',
      phone: extractedData.phone || state.collectedInfo.phone || (isDialableNumber(state.from) ? state.from : ''),
      email: extractedData.email || state.collectedInfo.email || '',
      message: extractedData.message || state.collectedInfo.message || '',
      urgency: normalizeUrgency(extractedData.urgency || state.collectedInfo.urgency),
      summary: extractionFailed
        ? fallbackSummary(audioTranscript ?? liveTranscript)
        : extractedData.summary || extractedData.message || liveTranscript.slice(0, 500),
    };

    // 3. Persist to database
    const turns = state.turns.map((t, i) => ({ role: t.role, content: t.content, sequence: i }));
    const callFields = {
      status: 'COMPLETED' as const,
      endedAt: new Date(),
      duration,
      recordingUrl,
      recordingSid,
      callerName: finalData.name,
      callerCompany: finalData.company,
      callerPhone: finalData.phone,
      callerEmail: finalData.email,
      message: finalData.message,
      urgency: toDbUrgency(finalData.urgency),
      summary: finalData.summary,
      transcript: audioTranscript ?? liveTranscript,
    };

    // The record normally already exists (created when the call started), so
    // the update branch must write the turns too — replacing any from an
    // earlier attempt. Nested writes run in a single transaction.
    let saved = false;
    try {
      await db.call.upsert({
        where: { callSid },
        create: {
          callSid,
          from: state.from,
          to: config.TWILIO_PHONE_NUMBER,
          startedAt: state.startedAt,
          ...callFields,
          turns: { create: turns },
        },
        update: {
          ...callFields,
          turns: { deleteMany: {}, create: turns },
        },
      });
      saved = true;
    } catch (err) {
      // Still send the email — it is the deliverable. Log the data so the
      // message is recoverable from logs if the email fails as well.
      logger.error('Failed to save call — sending email anyway', { callSid, err, finalData });
    }

    // 4. Notify — email is the deliverable; Slack/SMS run alongside it
    const [emailResult] = await Promise.allSettled([
      sendEmailWithRetry(finalData, callSid, state.startedAt),
      sendSlackNotification(finalData, callSid, state.startedAt).catch((err) =>
        logger.error('Slack notification error', { err })
      ),
      finalData.urgency === 'urgent' && config.ALERT_SMS_NUMBER
        ? sendUrgentSms(config.ALERT_SMS_NUMBER, finalData.name || 'Unknown', finalData.message).catch(
            (err) => logger.error('Urgent SMS error', { err })
          )
        : Promise.resolve(),
    ]);

    if (emailResult.status === 'rejected') {
      // The record stays COMPLETED with emailSent=false; resendPendingEmails()
      // picks it up on the next sweep.
      logger.error('Call summary email failed after retries — queued for resend', {
        callSid,
        err: emailResult.reason,
        ...(saved ? {} : { finalData }),
      });
    } else if (saved) {
      await db.call.update({
        where: { callSid },
        data: { emailSent: true, emailSentAt: new Date() },
      });
    }

    logger.info('Call processing complete', {
      callSid,
      urgency: finalData.urgency,
      usedAudioTranscript: !!audioTranscript,
      extractionFailed,
      emailSent: emailResult.status === 'fulfilled',
      totalMs: Date.now() - startedProcessing,
    });
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
export async function markCallNoInput(callSid: string): Promise<void> {
  await db.call.updateMany({
    where: { callSid },
    data: { status: 'NO_ANSWER', endedAt: new Date() },
  });
}

/**
 * Hands a finished conversation to post-call processing, or closes the record
 * quietly when the caller never spoke. Callers must have already taken the
 * session out of the store (destroySession) — that is the once-only guard.
 */
export function finishCall(state: ConversationState, duration?: number): void {
  if (state.turns.some((t) => t.role === 'caller')) {
    runPostCall(state, duration);
  } else {
    markCallNoInput(state.callSid).catch((err) =>
      logger.error('Failed to close call record', { callSid: state.callSid, err })
    );
  }
}

/**
 * Called when the recording lands after post-call processing has already
 * finished (i.e. it missed the RECORDING_WAIT_MS window). Replaces the
 * live-STT transcript with an accurate audio transcription, and backfills any
 * caller details the live conversation missed.
 */
export async function enhanceCallWithRecording(
  callSid: string,
  recordingUrl: string,
  recordingSid: string,
  duration: number
): Promise<void> {
  const call = await db.call.findUnique({ where: { callSid }, include: { turns: { orderBy: { sequence: 'asc' } } } });
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
      const extracted = await extractStructuredData({
        liveTranscript: buildTurnsTranscript(
          call.turns.map((t) => ({ role: t.role as 'assistant' | 'caller', content: t.content }))
        ),
        audioTranscript: transcript,
        callerNumber: call.from,
      });
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
