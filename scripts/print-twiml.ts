/**
 * Prints the TwiML the server would return for an incoming call, so you can
 * eyeball voice/STT settings without placing a call.
 * Run: npx ts-node scripts/print-twiml.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { buildRelayTwiml, buildGatherTwiml } from '../src/services/twilio.service';
import { buildGreeting } from '../src/services/ai.service';

console.log('--- ConversationRelay mode ---');
console.log(buildRelayTwiml(buildGreeting()).replace(/token=[0-9a-f]+/, 'token=<redacted>'));
console.log('\n--- Gather/webhook mode ---');
console.log(buildGatherTwiml('CA_EXAMPLE', buildGreeting()));
process.exit(0);
