/**
 * Demo builder: turns a pub's research notes into a DEMO business profile,
 * so a demo receptionist can be ready in a couple of minutes.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../lib/db';

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 60_000, maxRetries: 2 });

/** What the LLM fills in; everything else on a Business is set by the caller. */
export interface DemoDraft {
  openingHours: string | null;
  address: string | null;
  bookingSystem: string | null;
  bookingInstructions: string | null;
  menuNotes: string | null;
  faqs: Array<{ q: string; a: string }>;
}

/** "The King's Arms (Marlow)" -> "the-kings-arms-marlow" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Blank or whitespace-only strings become null, so the prompt skips them. */
const text = z
  .string()
  .nullable()
  .catch(null)
  .transform((v) => (v && v.trim() ? v.trim() : null));

const draftSchema = z.object({
  openingHours: text,
  address: text,
  bookingSystem: text,
  bookingInstructions: text,
  menuNotes: text,
  faqs: z
    .array(z.object({ q: z.string().trim(), a: z.string().trim() }))
    .catch([])
    .transform((faqs) => faqs.filter((f) => f.q && f.a).slice(0, 10)),
});

export function normalizeDraft(raw: unknown): DemoDraft {
  return draftSchema.parse(raw ?? {});
}

/**
 * Research notes from a Prospects row. Best time to call and the contact are
 * left out: they're for the salesperson, not the demo.
 */
export function prospectNotes(p: { address: string; bookingSystem: string; researchNotes: string }): string {
  return [
    p.address && `Address: ${p.address}`,
    p.bookingSystem && `Booking system: ${p.bookingSystem}`,
    p.researchNotes && `Notes: ${p.researchNotes}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildDemoPrompt(pubName: string, notes: string): string {
  return `You are setting up an AI phone receptionist demo for a UK pub called "${pubName}". The receptionist will answer the pub's phone, take table bookings and answer callers' questions, using only the facts you extract here.

RESEARCH NOTES (written by a salesperson, may be terse or messy):
${notes}

Extract the facts a caller could ask about. Rules:
- Use ONLY what the notes say. Never invent hours, prices, dishes, policies or facts. If something isn't in the notes, use null (or leave it out of the FAQs).
- Leave out anything that is sales research rather than information for callers: reviews, complaints about the phone or service, contact names and roles, whether it's a group or independent, best time to call, and opinions about the pub.
- Write in British English, short and plain, as the receptionist would say it on the phone.
- "openingHours": opening hours, plus kitchen or food-service hours if given (e.g. "Mon–Sat 12–11pm, Sun 12–10:30pm. Food 12–9pm, Sunday roasts 12–5pm").
- "address": the address, if given.
- "bookingSystem": the booking system named in the notes (ResDiary, Collins, OpenTable, SevenRooms, "phone only"...), if given.
- "bookingInstructions": booking policies stated in the notes (deposits, large groups, walk-ins), if any.
- "menuNotes": a sentence or two on food and drink highlights from the notes.
- "faqs": up to 8 questions callers would realistically ask that the notes answer (dogs, parking, garden, live sport, function room, kids, accessibility, events). Each answer one short sentence.`;
}

export async function buildDemoDraft(pubName: string, notes: string): Promise<DemoDraft> {
  const nullableString = { type: ['string', 'null'] };
  const completion = await client.chat.completions.create({
    model: config.EXTRACTION_MODEL,
    messages: [{ role: 'user', content: buildDemoPrompt(pubName, notes) }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'demo_business',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['openingHours', 'address', 'bookingSystem', 'bookingInstructions', 'menuNotes', 'faqs'],
          properties: {
            openingHours: nullableString,
            address: nullableString,
            bookingSystem: nullableString,
            bookingInstructions: nullableString,
            menuNotes: nullableString,
            faqs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['q', 'a'],
                properties: { q: { type: 'string' }, a: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    temperature: 0.1,
    max_tokens: 1200,
  });

  return normalizeDraft(JSON.parse(completion.choices[0]?.message?.content ?? '{}'));
}

/**
 * Saves (or updates) a pub's DEMO business. Refuses to touch a LIVE business
 * with the same slug: that's a real customer.
 */
export async function saveDemo(
  pubName: string,
  persona: string,
  draft: DemoDraft
): Promise<{ slug: string; created: boolean }> {
  const slug = slugify(pubName);
  if (!slug) throw new Error(`Can't make a slug from "${pubName}"`);
  const existing = await db.business.findUnique({ where: { slug } });
  if (existing?.mode === 'LIVE') throw new Error(`"${slug}" is a LIVE business and won't be overwritten`);
  const data = { name: pubName, personaName: persona, ...draft };
  await db.business.upsert({ where: { slug }, create: { slug, mode: 'DEMO', ...data }, update: data });
  return { slug, created: !existing };
}
