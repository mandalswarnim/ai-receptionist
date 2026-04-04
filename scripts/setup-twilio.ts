/**
 * Sets up Twilio webhooks on your Twilio phone number.
 * Run once after deployment: npx ts-node scripts/setup-twilio.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
const BASE_URL = process.env.BASE_URL!;
const PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER!;

async function setup(): Promise<void> {
  console.log('Setting up Twilio webhooks...');
  console.log('Base URL:', BASE_URL);
  console.log('Phone number:', PHONE_NUMBER);

  // Find the incoming phone number
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: PHONE_NUMBER });

  if (numbers.length === 0) {
    console.error(`Phone number ${PHONE_NUMBER} not found in your Twilio account`);
    process.exit(1);
  }

  const number = numbers[0]!;

  // Update webhooks
  await client.incomingPhoneNumbers(number.sid).update({
    voiceUrl: `${BASE_URL}/api/webhooks/incoming-call`,
    voiceMethod: 'POST',
    statusCallback: `${BASE_URL}/api/webhooks/call-status`,
    statusCallbackMethod: 'POST',
  });

  console.log('\nTwilio webhooks configured:');
  console.log(`  Voice URL:       ${BASE_URL}/api/webhooks/incoming-call`);
  console.log(`  Status Callback: ${BASE_URL}/api/webhooks/call-status`);
  console.log('\nSetup complete!');
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
