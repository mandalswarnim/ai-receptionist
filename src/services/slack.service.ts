/**
 * Optional Slack notification service for call summaries.
 */

import { config } from '../config';
import { ExtractedCallData } from '../types';
import { logger } from '../lib/logger';

function urgencyEmoji(urgency: string): string {
  return { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[urgency] ?? '⚪';
}

export async function sendSlackNotification(
  data: ExtractedCallData,
  callSid: string,
  timestamp: Date
): Promise<void> {
  if (!config.SLACK_WEBHOOK_URL) return;

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
          { type: 'mrkdwn', text: `*Name:*\n${data.name || '—'}` },
          { type: 'mrkdwn', text: `*Company:*\n${data.company || '—'}` },
          { type: 'mrkdwn', text: `*Phone:*\n${data.phone || '—'}` },
          { type: 'mrkdwn', text: `*Email:*\n${data.email || '—'}` },
          {
            type: 'mrkdwn',
            text: `*Urgency:*\n${urgencyEmoji(data.urgency)} ${data.urgency.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${timestamp.toLocaleString()}`,
          },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Message:*\n${data.message}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Summary:*\n${data.summary}` },
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
