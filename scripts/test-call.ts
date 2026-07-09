/**
 * Makes an outbound test call to your phone using Twilio.
 * The call fetches TwiML from your running server's incoming-call webhook, so
 * it exercises the real flow in whichever mode is configured
 * (ConversationRelay or Gather webhooks).
 *
 * Usage: npx ts-node scripts/test-call.ts +447585345010
 */

import dotenv from 'dotenv';
dotenv.config();

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
const targetNumber = process.argv[2];
const BASE_URL = process.env.BASE_URL!;

if (!targetNumber) {
  console.error('Usage: npx ts-node scripts/test-call.ts +44XXXXXXXXXX');
  process.exit(1);
}

async function makeTestCall() {
  console.log(`Calling ${targetNumber} from ${process.env.TWILIO_PHONE_NUMBER}...`);
  console.log(`Make sure the server is running and BASE_URL (${BASE_URL}) is reachable.`);
  console.log();

  const call = await client.calls.create({
    to: targetNumber,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: `${BASE_URL}/api/webhooks/incoming-call`,
    method: 'POST',
    statusCallback: `${BASE_URL}/api/webhooks/call-status`,
    statusCallbackEvent: ['completed'],
  });

  console.log(`Call initiated! SID: ${call.sid}`);
  console.log(`Answer your phone and talk to the AI receptionist.`);
}

makeTestCall().catch((err) => {
  console.error('Failed to make call:', err.message);
  process.exit(1);
});
