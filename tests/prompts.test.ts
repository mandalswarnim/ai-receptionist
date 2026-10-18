import { describe, it, expect, vi } from 'vitest';
import type { BusinessProfile } from '../src/services/business.service';

const mocks = vi.hoisted(() => ({
  config: {
    OPENAI_API_KEY: 'sk-test',
    LLM_TIMEOUT_MS: 8000,
    RECORD_CALLS: true,
    COMPANY_TIMEZONE: 'Europe/London',
  },
}));

vi.mock('../src/config', () => ({ config: mocks.config }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildGreeting, buildSystemPrompt } from '../src/services/ai.service';

const LIVE: BusinessProfile = {
  id: 'biz-default',
  slug: 'default',
  name: 'Acme Plumbing',
  mode: 'LIVE',
  personaName: 'Maya',
  greeting: null,
  openingHours: null,
  address: null,
  bookingSystem: null,
  bookingInstructions: null,
  menuNotes: null,
  faqs: [],
  notifyEmail: 'owner@acme.test',
  calendlyEventType: null,
};

const DEMO: BusinessProfile = {
  id: 'biz-crown',
  slug: 'the-crown',
  name: 'The Crown',
  mode: 'DEMO',
  personaName: 'Maya',
  greeting: null,
  openingHours: 'Mon–Thu 12–11pm, Fri–Sat 12pm–midnight, Sun 12–10:30pm',
  address: '1 High Street, Marlow',
  bookingSystem: 'ResDiary',
  bookingInstructions: 'Tables of 8 or more need a deposit.',
  menuNotes: 'Sunday roasts served 12–5pm. Vegan options on every menu.',
  faqs: [{ q: 'Are dogs allowed?', a: 'Yes, in the bar and garden.' }],
  notifyEmail: 'landlord@thecrown.test',
  calendlyEventType: null,
};

// 2pm in London (BST)
const AFTERNOON = new Date('2026-10-13T13:00:00Z');

describe('system prompt', () => {
  it('LIVE business', () => {
    expect(buildSystemPrompt(LIVE, '+447700900123', true)).toMatchSnapshot();
  });

  it('DEMO business', () => {
    expect(buildSystemPrompt(DEMO, '+447700900123', true)).toMatchSnapshot();
  });

  it('adds nothing about the business when no details are set', () => {
    expect(buildSystemPrompt(LIVE, '+447700900123', false)).not.toContain('What you know about');
  });

  it('gives a LIVE business with details the same knowledge', () => {
    const prompt = buildSystemPrompt({ ...DEMO, mode: 'LIVE' }, '+447700900123', false);
    expect(prompt).toContain('Opening hours: Mon–Thu');
    expect(prompt).toContain('Q: Are dogs allowed? A: Yes, in the bar and garden.');
    expect(prompt).toContain("when the team can't get to the phone");
  });

  it('DEMO with appointments on books through the diary instead of pencilling in', () => {
    const prompt = buildSystemPrompt(DEMO, '+447700900123', true, true);
    expect(prompt).toContain('Booking: use the diary');
    expect(prompt).not.toContain('pencilled');
  });

  it('DEMO takes bookings and confirms them as pencilled in', () => {
    const prompt = buildSystemPrompt(DEMO, 'anonymous', false);
    expect(prompt).toContain('how many people, the date and the time');
    expect(prompt).toContain("I've pencilled that in, the team will confirm by text.");
    expect(prompt).toContain('caller ID is withheld');
  });
});

describe('greeting', () => {
  it('LIVE keeps the message-taking greeting', () => {
    expect(buildGreeting(LIVE, AFTERNOON)).toBe(
      'Hi, thanks for calling Acme Plumbing! This is Maya. Just to let you know, this call may be recorded. ' +
        "The team can't get to the phone right now, but I can take a message — could I start with your name, please?"
    );
  });

  it('DEMO answers as the pub and says it is an AI', () => {
    expect(buildGreeting(DEMO, AFTERNOON)).toBe(
      "Good afternoon, The Crown, you're speaking to Maya, the AI assistant. " +
        'Just to let you know, this call may be recorded. How can I help?'
    );
  });

  it('DEMO uses the time of day in the business timezone', () => {
    expect(buildGreeting(DEMO, new Date('2026-10-13T08:00:00Z'))).toMatch(/^Good morning/);
    expect(buildGreeting(DEMO, new Date('2026-10-13T18:30:00Z'))).toMatch(/^Good evening/);
  });

  it('a custom DEMO greeting still says it is an AI and keeps the disclosure', () => {
    const greeting = buildGreeting({ ...DEMO, greeting: 'The Crown, how can I help?' }, AFTERNOON);
    expect(greeting).toBe(
      "The Crown, how can I help? You're speaking to an AI assistant. Just to let you know, this call may be recorded."
    );
  });

  it('a custom greeting that already mentions AI is used as written', () => {
    const greeting = buildGreeting({ ...DEMO, greeting: "The Crown's AI assistant here, how can I help?" }, AFTERNOON);
    expect(greeting).toBe(
      "The Crown's AI assistant here, how can I help? Just to let you know, this call may be recorded."
    );
  });
});
