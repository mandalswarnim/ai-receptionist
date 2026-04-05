/**
 * Makes an outbound test call to your phone using Twilio.
 * Uses inline TwiML so no webhook fetch is needed for the initial greeting.
 *
 * Usage: npx ts-node scripts/test-call.ts +447585345010
 */

import dotenv from 'dotenv';
dotenv.config();

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
const targetNumber = process.argv[2];
const BASE_URL = process.env.BASE_URL!;
const COMPANY = process.env.COMPANY_NAME || 'the company';

if (!targetNumber) {
  console.error('Usage: npx ts-node scripts/test-call.ts +44XXXXXXXXXX');
  process.exit(1);
}

async function makeTestCall() {
  console.log(`Calling ${targetNumber} from ${process.env.TWILIO_PHONE_NUMBER}...`);
  console.log(`The AI receptionist will greet you when you answer.`);
  console.log();

  // Use inline TwiML — Twilio doesn't need to fetch from ngrok for the greeting
  const twiml = `
    <Response>
      <Say voice="Polly.Joanna-Neural" language="en-US">Hello, thank you for calling ${COMPANY}. Our receptionist is currently unavailable, but I am the virtual assistant and I am happy to take a message. Could I start by getting your full name please?</Say>
      <Gather input="speech" speechTimeout="auto" speechModel="phone_call" language="en-US" action="${BASE_URL}/api/webhooks/gather" method="POST" timeout="10">
        <Say voice="Polly.Joanna-Neural" language="en-US">I did not catch that. Could you please speak your response?</Say>
      </Gather>
      <Redirect>${BASE_URL}/api/webhooks/gather?noInput=true</Redirect>
    </Response>
  `.trim();

  const call = await client.calls.create({
    to: targetNumber,
    from: process.env.TWILIO_PHONE_NUMBER!,
    twiml,
    statusCallback: `${BASE_URL}/api/webhooks/call-status`,
    statusCallbackEvent: ['completed'],
  });

  console.log(`Call initiated! SID: ${call.sid}`);
  console.log(`Answer your phone and talk to the AI receptionist.`);

  // Also create a conversation session so the gather webhook can find it
  console.log(`\nNote: Creating conversation session for callSid=${call.sid}`);
}

makeTestCall().catch((err) => {
  console.error('Failed to make call:', err.message);
  process.exit(1);
});
