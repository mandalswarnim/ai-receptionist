/**
 * WhatsApp call summaries for businesses: who gets what, and sending it.
 *
 * Only businesses ever get WhatsApp messages, never callers. Every tier
 * gets email; tiers with `whatsappAlerts` choose email, WhatsApp or both.
 * A message we start has to use a Meta-approved template, sent through
 * Twilio's Content API with the summary as its variables.
 */

import { config } from '../config';
import { logger } from '../lib/logger';
import { hasFeature } from '../lib/tiers';
import type { ExtractedCallData } from '../types';
import type { BusinessProfile } from './business.service';
import { twilioClient } from './twilio.service';

type ChannelBusiness = Pick<BusinessProfile, 'mode' | 'tier' | 'notifyChannel' | 'whatsappNumbers' | 'whatsappOptInAt'>;

export function whatsappConfigured(): boolean {
  return !!config.TWILIO_WHATSAPP_FROM && !!config.TWILIO_WHATSAPP_TEMPLATE_SID;
}

/**
 * Where a call summary goes. Anything that would stop a WhatsApp from
 * arriving (demo call, tier without it, no numbers, no opt-in, WhatsApp not
 * set up) means email instead, so a message is never dropped.
 */
export function summaryChannels(business: ChannelBusiness): { email: boolean; whatsapp: boolean } {
  const whatsappReady =
    business.mode === 'LIVE' &&
    hasFeature(business.tier, 'whatsappAlerts') &&
    business.whatsappNumbers.length > 0 &&
    !!business.whatsappOptInAt &&
    whatsappConfigured();
  if (!whatsappReady || business.notifyChannel === 'EMAIL') return { email: true, whatsapp: false };
  return { email: business.notifyChannel === 'BOTH', whatsapp: true };
}

/**
 * Template values. WhatsApp rejects variables that are empty or contain new
 * lines, tabs or runs of spaces, and caps their length.
 */
function variable(value: string, max: number, fallback: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const URGENCY_LABELS: Record<ExtractedCallData['urgency'], string> = {
  urgent: 'URGENT',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Variables for the call summary template:
 *   {{1}} business  {{2}} caller  {{3}} number  {{4}} message  {{5}} urgency
 */
export function templateVariables(data: ExtractedCallData, businessName: string): Record<string, string> {
  return {
    '1': variable(businessName, 100, 'your business'),
    '2': variable(data.name, 100, 'Unknown caller'),
    '3': variable(data.phone, 30, 'not given'),
    '4': variable(data.message || data.summary, 900, 'No message left.'),
    '5': URGENCY_LABELS[data.urgency] ?? 'Medium',
  };
}

/**
 * Sends the summary to each of the business's WhatsApp numbers. Succeeds if
 * at least one was accepted by Twilio; throws if none were.
 */
export async function sendWhatsAppSummary(
  data: ExtractedCallData,
  callSid: string,
  business: Pick<BusinessProfile, 'name' | 'whatsappNumbers'>
): Promise<void> {
  if (!whatsappConfigured()) throw new Error('WhatsApp is not configured');
  const contentVariables = JSON.stringify(templateVariables(data, business.name));

  const results = await Promise.allSettled(
    business.whatsappNumbers.map((to) =>
      twilioClient.messages.create({
        from: `whatsapp:${config.TWILIO_WHATSAPP_FROM}`,
        to: `whatsapp:${to}`,
        contentSid: config.TWILIO_WHATSAPP_TEMPLATE_SID,
        contentVariables,
      })
    )
  );

  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  failed.forEach((r) => logger.warn('WhatsApp summary to one number failed', { callSid, err: r.reason }));
  if (failed.length === results.length) {
    throw failed[0]?.reason ?? new Error('No WhatsApp numbers to send to');
  }
  logger.info('WhatsApp call summary sent', { callSid, sent: results.length - failed.length, failed: failed.length });
}
