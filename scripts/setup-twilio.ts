/**
 * Sets up Twilio for this server (safe to re-run after every BASE_URL change):
 *  - points your Twilio number's webhooks at BASE_URL
 *  - creates or updates the "AI Receptionist demo" TwiML App that the calling
 *    cockpit adds to sales calls, and prints its SID for TWILIO_DEMO_APP_SID
 *
 * Run once after deployment: npx ts-node scripts/setup-twilio.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
const BASE_URL = process.env.BASE_URL!;
const PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER!;
const DEMO_APP_NAME = 'AI Receptionist demo (calling cockpit)';

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

  // TwiML App the cockpit adds to a conference as the demo receptionist. It
  // uses the same incoming-call webhook, which recognises the cockpit's leg.
  const appSettings = {
    friendlyName: DEMO_APP_NAME,
    voiceUrl: `${BASE_URL}/api/webhooks/incoming-call`,
    voiceMethod: 'POST',
    statusCallback: `${BASE_URL}/api/webhooks/call-status`,
    statusCallbackMethod: 'POST',
  };
  const [existing] = await client.applications.list({ friendlyName: DEMO_APP_NAME, limit: 1 });
  const app = existing
    ? await client.applications(existing.sid).update(appSettings)
    : await client.applications.create(appSettings);

  console.log(`\nDemo TwiML App ${existing ? 'updated' : 'created'}: ${app.sid}`);
  if (process.env.TWILIO_DEMO_APP_SID !== app.sid) {
    console.log(`  Add this to your .env and server env:\n  TWILIO_DEMO_APP_SID=${app.sid}`);
  }
  console.log('\nSetup complete!');
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
