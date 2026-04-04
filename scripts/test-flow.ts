/**
 * Local test script that simulates a full call flow without Twilio.
 * Run: npx ts-node scripts/test-flow.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import * as conversationSvc from '../src/services/conversation.service';
import * as aiSvc from '../src/services/ai.service';
import { buildTurnsTranscript } from '../src/services/transcription.service';
import { extractStructuredData } from '../src/services/ai.service';
import { sendCallSummaryEmail } from '../src/services/email.service';

const FAKE_CALL_SID = 'CA_TEST_' + Date.now();
const FAKE_FROM = '+14155551234';

async function simulateConversation(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  AI Receptionist — Simulated Call Flow Test');
  console.log('═══════════════════════════════════════════════\n');

  // 1. Create session
  const state = conversationSvc.createSession(FAKE_CALL_SID, FAKE_FROM);
  const greeting = aiSvc.buildGreeting();
  conversationSvc.addTurn(FAKE_CALL_SID, 'assistant', greeting);
  conversationSvc.advanceStep(FAKE_CALL_SID, 'collect_name');

  console.log('[AI]:', greeting, '\n');

  // 2. Simulate caller inputs
  const callerInputs = [
    "Hi, my name is James Wilson",
    "I'm calling from Apex Solutions",
    "My phone number is 0207 123 4567",
    "My email is james.wilson at apex solutions dot co dot uk",
    "I wanted to discuss a partnership opportunity regarding your enterprise software package. We're very interested.",
    "Yes, it's fairly urgent — we have a board meeting next Friday",
    "Yes, that all sounds correct. Thank you",
  ];

  for (const input of callerInputs) {
    const currentState = conversationSvc.getSession(FAKE_CALL_SID);
    if (!currentState) break;

    console.log('[Caller]:', input);

    const { response, nextStep } = await aiSvc.generateResponse(currentState, input);
    conversationSvc.addTurn(FAKE_CALL_SID, 'caller', input);
    conversationSvc.advanceStep(FAKE_CALL_SID, nextStep);
    conversationSvc.addTurn(FAKE_CALL_SID, 'assistant', response);

    console.log('[AI]:', response);
    console.log('  → Step:', nextStep, '\n');

    if (nextStep === 'closing') break;

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  // 3. Build transcript
  const finalState = conversationSvc.destroySession(FAKE_CALL_SID);
  if (!finalState) {
    console.error('No final state found');
    return;
  }

  const transcript = buildTurnsTranscript(finalState.turns);
  console.log('\n═══════════════════════════════════════════════');
  console.log('  TRANSCRIPT');
  console.log('═══════════════════════════════════════════════');
  console.log(transcript);

  // 4. Extract structured data
  console.log('\n═══════════════════════════════════════════════');
  console.log('  EXTRACTED DATA');
  console.log('═══════════════════════════════════════════════');
  const extracted = await extractStructuredData(transcript);
  console.log(JSON.stringify(extracted, null, 2));

  // 5. Test email (uncomment if SendGrid is configured)
  // console.log('\n Sending test email...');
  // await sendCallSummaryEmail(extracted, FAKE_CALL_SID, finalState.startedAt);
  // console.log(' Email sent!');

  console.log('\n Test flow complete.\n');
}

simulateConversation().catch(console.error);
