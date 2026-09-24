import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

const mocks = vi.hoisted(() => ({
  config: { SILENCE_TIMEOUT_S: 10, MAX_CALL_DURATION_S: 600 },
  streamResponse: vi.fn(),
  finishCall: vi.fn(),
  endCall: vi.fn(),
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/ai.service', () => ({
  streamResponse: mocks.streamResponse,
  buildGreeting: () => 'Hi, this is Maya. Could I take your name?',
  SILENCE_NUDGE: 'Are you still there?',
  SILENCE_GOODBYE: 'I will let you go. Goodbye!',
  TIME_LIMIT_GOODBYE: 'I need to wrap up here. Goodbye!',
}));
vi.mock('../src/services/call.service', () => ({
  createInitialCallRecord: vi.fn().mockResolvedValue(undefined),
  finishCall: mocks.finishCall,
}));
vi.mock('../src/services/twilio.service', () => ({
  startCallRecording: vi.fn().mockResolvedValue(undefined),
  endCall: mocks.endCall,
}));

import { handleRelayConnection, speechDurationMs } from '../src/services/relay.service';
import * as conversationSvc from '../src/services/conversation.service';

const CALL_SID = 'CA_RELAY';
const GREETING = 'Hi, this is Maya. Could I take your name?';

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  sent: Array<{ type: string; token: string; last: boolean }> = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  receive(msg: Record<string, unknown>) {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }
  /** Everything spoken, joined per `last: true` boundary. */
  spoken(): string[] {
    const out: string[] = [];
    let cur = '';
    for (const m of this.sent) {
      cur += m.token;
      if (m.last) {
        if (cur) out.push(cur);
        cur = '';
      }
    }
    return out;
  }
}

function reply(text: string, endCall = false) {
  mocks.streamResponse.mockImplementationOnce(async (_state, onToken: (t: string) => void) => {
    onToken(text);
    return { fullText: text, endCall };
  });
}

async function connect(): Promise<FakeSocket> {
  const ws = new FakeSocket();
  handleRelayConnection(ws as unknown as WebSocket);
  ws.receive({ type: 'setup', callSid: CALL_SID, from: '+447700900123' });
  await vi.advanceTimersByTimeAsync(0);
  return ws;
}

async function say(ws: FakeSocket, text: string) {
  ws.receive({ type: 'prompt', voicePrompt: text, last: true });
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.config.SILENCE_TIMEOUT_S = 10;
  mocks.config.MAX_CALL_DURATION_S = 600;
});

afterEach(() => {
  conversationSvc.destroyAllSessions();
  vi.useRealTimers();
});

describe('relay conversation', () => {
  it('streams the reply and records both turns', async () => {
    const ws = await connect();
    reply('Lovely, thanks James.');

    await say(ws, "It's James");

    expect(ws.spoken()).toEqual(['Lovely, thanks James.']);
    expect(conversationSvc.getSession(CALL_SID)?.turns.map((t) => t.content)).toEqual([
      GREETING,
      "It's James",
      'Lovely, thanks James.',
    ]);
  });

  it('hangs up after the goodbye has been spoken', async () => {
    const ws = await connect();
    const goodbye = 'Thanks James, someone will be in touch. Bye!';
    reply(goodbye, true);

    await say(ws, "That's everything");
    expect(mocks.endCall).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(speechDurationMs(goodbye));
    expect(mocks.endCall).toHaveBeenCalledWith(CALL_SID);
  });

  it('ignores speech after the goodbye', async () => {
    const ws = await connect();
    reply('Bye!', true);
    await say(ws, "That's all");

    await say(ws, 'thanks');

    expect(mocks.streamResponse).toHaveBeenCalledTimes(1);
  });

  it('stays on the line when the caller talks over the goodbye', async () => {
    const ws = await connect();
    reply('Thanks, bye now!', true);
    await say(ws, "That's all");

    ws.receive({ type: 'interrupt', utteranceUntilInterrupt: 'Thanks,' });
    reply('Of course — what else?');
    await say(ws, 'Wait, one more thing');
    await vi.advanceTimersByTimeAsync(speechDurationMs('Thanks, bye now!'));

    expect(mocks.endCall).not.toHaveBeenCalled();
    expect(ws.spoken().at(-1)).toBe('Of course — what else?');
    // History reflects what the caller actually heard
    const turns = conversationSvc.getSession(CALL_SID)!.turns.map((t) => t.content);
    expect(turns).toContain('Thanks,');
    expect(turns).not.toContain('Thanks, bye now!');
  });

  it('submits keypad digits as one exact turn', async () => {
    const ws = await connect();
    reply('Got it, thanks.');

    for (const digit of ['0', '7', '7', '0', '#']) ws.receive({ type: 'dtmf', digit });
    await vi.advanceTimersByTimeAsync(0);

    const turns = conversationSvc.getSession(CALL_SID)!.turns;
    expect(turns[1]).toEqual({ role: 'caller', content: '[Caller typed on keypad: 0770]' });
  });

  it('nudges a silent caller once, then says goodbye and hangs up', async () => {
    const ws = await connect();

    await vi.advanceTimersByTimeAsync(speechDurationMs(GREETING) + 10_000);
    expect(ws.spoken()).toEqual(['Are you still there?']);

    await vi.advanceTimersByTimeAsync(speechDurationMs('Are you still there?') + 10_000);
    expect(ws.spoken().at(-1)).toBe('I will let you go. Goodbye!');

    await vi.advanceTimersByTimeAsync(speechDurationMs('I will let you go. Goodbye!'));
    expect(mocks.endCall).toHaveBeenCalledWith(CALL_SID);
  });

  it('resets the silence clock when the caller speaks', async () => {
    const ws = await connect();
    await vi.advanceTimersByTimeAsync(speechDurationMs(GREETING) + 9_000);
    reply('Thanks!');
    await say(ws, 'James');

    await vi.advanceTimersByTimeAsync(speechDurationMs('Thanks!') + 9_000);

    expect(ws.spoken()).toEqual(['Thanks!']);
  });

  it('wraps up at the max call duration', async () => {
    mocks.config.SILENCE_TIMEOUT_S = 10_000; // keep silence handling out of the way
    const ws = await connect();

    await vi.advanceTimersByTimeAsync(600_000);
    expect(ws.spoken().at(-1)).toBe('I need to wrap up here. Goodbye!');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.endCall).toHaveBeenCalledWith(CALL_SID);
  });

  it('hands the conversation to post-call processing on close', async () => {
    const ws = await connect();
    reply('Thanks James.');
    await say(ws, "It's James");

    ws.emit('close');

    expect(mocks.finishCall).toHaveBeenCalledTimes(1);
    const [state] = mocks.finishCall.mock.calls[0];
    expect(state.callSid).toBe(CALL_SID);
    expect(state.turns).toHaveLength(3);
    expect(conversationSvc.getSession(CALL_SID)).toBeUndefined();
  });

  it('apologises and keeps listening when generation fails', async () => {
    const ws = await connect();
    mocks.streamResponse.mockRejectedValueOnce(new Error('timeout'));

    await say(ws, 'Hello?');

    expect(ws.spoken().at(-1)).toMatch(/lost you for a second/);
    expect(mocks.endCall).not.toHaveBeenCalled();
  });
});
