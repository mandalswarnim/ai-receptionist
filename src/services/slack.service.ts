/**
 * Optional Slack notification service for call summaries.
 */

import { config } from '../config';
import { ExtractedCallData } from '../types';
import { logger } from '../lib/logger';

/**
 * Escapes caller-derived text for Slack mrkdwn. Without it a caller whose
 * name transcribes as "<!channel>" would ping the whole channel, and "<url|x>"
 * would render as a disguised link.
 */
export function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Slack rejects section text over 3000 chars (the fallback summary can be longer). */
function truncate(value: string, max = 2900): string {
  return value.length > max ? `${value.slice(0, max)}… (see email for the full text)` : value;
}

function urgencyEmoji(urgency: string): string {
  return { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[urgency] ?? '⚪';
}

export async function sendSlackNotification(
  data: ExtractedCallData,
  callSid: string,
  timestamp: Date
): Promise<void> {
  if (!config.SLACK_WEBHOOK_URL) return;

  // Header is plain_text (rendered literally); everything mrkdwn is escaped.
  const name = escapeSlack(data.name);
  const company = escapeSlack(data.company);
  const phone = escapeSlack(data.phone);
  const email = escapeSlack(data.email);

  const payload = {
    text: `*New Missed Call* ${urgencyEmoji(data.urgency)} ${data.urgency.toUpperCase()}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📞 Missed Call from ${data.name || 'Unknown'}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Name:*\n${name || '—'}` },
          { type: 'mrkdwn', text: `*Company:*\n${company || '—'}` },
          { type: 'mrkdwn', text: `*Phone:*\n${phone || '—'}` },
          { type: 'mrkdwn', text: `*Email:*\n${email || '—'}` },
          {
            type: 'mrkdwn',
            text: `*Urgency:*\n${urgencyEmoji(data.urgency)} ${data.urgency.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${timestamp.toLocaleString('en-GB', { timeZone: config.COMPANY_TIMEZONE })}`,
          },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Message:*\n${truncate(escapeSlack(data.message))}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Summary:*\n${truncate(escapeSlack(data.summary))}` },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Call ID: ${callSid}` }],
      },
    ],
  };

  const response = await fetch(config.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    logger.error('Slack notification failed', { status: response.status });
  } else {
    logger.info('Slack notification sent', { callSid });
  }
}
