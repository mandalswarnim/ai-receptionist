/**
 * Email service: sends structured call summary emails via SendGrid.
 */

import sgMail from '@sendgrid/mail';
import { config } from '../config';
import { ExtractedCallData } from '../types';
import { logger } from '../lib/logger';

sgMail.setApiKey(config.SENDGRID_API_KEY);

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: config.COMPANY_TIMEZONE,
  }).format(date);
}

function urgencyBadge(urgency: string): string {
  const badges: Record<string, string> = {
    urgent: '🔴 URGENT',
    high: '🟠 High',
    medium: '🟡 Medium',
    low: '🟢 Low',
  };
  return badges[urgency] ?? '⚪ Unknown';
}

function buildHtmlEmail(data: ExtractedCallData, callSid: string, timestamp: Date): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Missed Call Message</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #1e40af; color: white; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .header p { margin: 4px 0 0; font-size: 14px; opacity: 0.85; }
    .body { padding: 32px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; margin-bottom: 24px;
      background: ${data.urgency === 'urgent' ? '#fee2e2' : data.urgency === 'high' ? '#ffedd5' : data.urgency === 'medium' ? '#fef9c3' : '#dcfce7'};
      color: ${data.urgency === 'urgent' ? '#991b1b' : data.urgency === 'high' ? '#9a3412' : data.urgency === 'medium' ? '#854d0e' : '#166534'};
    }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin: 0 0 12px; }
    .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-size: 14px; color: #6b7280; width: 120px; flex-shrink: 0; }
    .detail-value { font-size: 14px; color: #111827; font-weight: 500; }
    .message-box { background: #f9fafb; border-left: 4px solid #1e40af; padding: 16px; border-radius: 0 4px 4px 0; font-size: 14px; color: #374151; line-height: 1.6; }
    .summary-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 16px; font-size: 14px; color: #1e40af; line-height: 1.6; }
    .footer { padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Missed Call Message</h1>
      <p>${formatTimestamp(timestamp)} &bull; Call ID: ${callSid}</p>
    </div>
    <div class="body">
      <div class="badge">${urgencyBadge(data.urgency)}</div>

      <div class="section">
        <h2>Caller Details</h2>
        <div class="detail-row">
          <span class="detail-label">Name</span>
          <span class="detail-value">${data.name || '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Company</span>
          <span class="detail-value">${data.company || '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Phone</span>
          <span class="detail-value">${data.phone || '—'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Email</span>
          <span class="detail-value">${data.email || '—'}</span>
        </div>
      </div>

      <div class="section">
        <h2>Message</h2>
        <div class="message-box">${data.message || 'No message recorded.'}</div>
      </div>

      <div class="section">
        <h2>AI Summary</h2>
        <div class="summary-box">${data.summary}</div>
      </div>
    </div>
    <div class="footer">
      Sent by the ${config.COMPANY_NAME} AI Receptionist &bull; ${formatTimestamp(timestamp)}
    </div>
  </div>
</body>
</html>`;
}

function buildTextEmail(data: ExtractedCallData, callSid: string, timestamp: Date): string {
  return `
NEW MISSED CALL MESSAGE — ${config.COMPANY_NAME}
================================================
Received: ${formatTimestamp(timestamp)}
Call ID:  ${callSid}
Urgency:  ${data.urgency.toUpperCase()}

CALLER DETAILS
--------------
Name:     ${data.name || '—'}
Company:  ${data.company || '—'}
Phone:    ${data.phone || '—'}
Email:    ${data.email || '—'}

MESSAGE
-------
${data.message || 'No message recorded.'}

AI SUMMARY
----------
${data.summary}

---
Sent by the ${config.COMPANY_NAME} AI Receptionist
`.trim();
}

export async function sendCallSummaryEmail(
  data: ExtractedCallData,
  callSid: string,
  timestamp: Date
): Promise<void> {
  const callerDisplay = data.name || data.phone || 'Unknown Caller';
  const subject = `New Missed Call Message from ${callerDisplay}`;

  const msg = {
    to: config.RECEPTIONIST_EMAIL,
    from: {
      email: config.EMAIL_FROM,
      name: config.EMAIL_FROM_NAME,
    },
    subject,
    text: buildTextEmail(data, callSid, timestamp),
    html: buildHtmlEmail(data, callSid, timestamp),
  };

  await sgMail.send(msg);
  logger.info('Call summary email sent', {
    to: config.RECEPTIONIST_EMAIL,
    callSid,
    caller: callerDisplay,
  });
}
