import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config', () => ({ config: { OPENAI_API_KEY: 'sk-test', EXTRACTION_MODEL: 'gpt-4.1' } }));
vi.mock('../src/lib/db', () => ({ db: {} }));

import { buildDemoPrompt, normalizeDraft, prospectNotes, slugify } from '../src/services/demo-builder.service';

describe('slugify', () => {
  it.each([
    ['The Crown', 'the-crown'],
    ["The King's Arms (Marlow)", 'the-kings-arms-marlow'],
    ['Fox & Hounds', 'fox-and-hounds'],
    ['  Café Rouge!  ', 'cafe-rouge'],
  ])('%s -> %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('normalizeDraft', () => {
  it('turns blank fields into null and drops empty FAQs', () => {
    expect(
      normalizeDraft({
        openingHours: ' Mon–Sun 12–11pm ',
        address: '',
        bookingSystem: '   ',
        bookingInstructions: null,
        menuNotes: 'Sunday roasts 12–5pm.',
        faqs: [
          { q: 'Dogs allowed?', a: 'Yes, in the bar.' },
          { q: '', a: 'orphan answer' },
        ],
      })
    ).toEqual({
      openingHours: 'Mon–Sun 12–11pm',
      address: null,
      bookingSystem: null,
      bookingInstructions: null,
      menuNotes: 'Sunday roasts 12–5pm.',
      faqs: [{ q: 'Dogs allowed?', a: 'Yes, in the bar.' }],
    });
  });

  it('survives malformed output', () => {
    expect(normalizeDraft({ openingHours: 42, faqs: 'nope' })).toMatchObject({ openingHours: null, faqs: [] });
  });

  it('caps the FAQ list', () => {
    const faqs = Array.from({ length: 15 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
    expect(normalizeDraft({ faqs }).faqs).toHaveLength(10);
  });
});

describe('buildDemoPrompt', () => {
  const prompt = buildDemoPrompt('The Crown', 'Rang 3 times, nobody answered (review, Aug). Dogs welcome.');

  it('includes the notes and forbids inventing facts', () => {
    expect(prompt).toContain('Dogs welcome.');
    expect(prompt).toContain('Never invent');
  });

  it('keeps sales research out of what callers hear', () => {
    expect(prompt).toContain('Leave out anything that is sales research');
    expect(prompt).toMatch(/reviews, complaints about the phone/);
  });
});

describe('prospectNotes', () => {
  it('builds notes from the Prospects row, leaving out sales-only columns', () => {
    expect(
      prospectNotes({ address: '2 High St, Marlow', bookingSystem: 'ResDiary', researchNotes: 'Dogs welcome. Roasts 12–5.' })
    ).toBe('Address: 2 High St, Marlow\nBooking system: ResDiary\nNotes: Dogs welcome. Roasts 12–5.');
  });

  it('is empty when the row has nothing to build from', () => {
    expect(prospectNotes({ address: '', bookingSystem: '', researchNotes: '' })).toBe('');
  });
});
