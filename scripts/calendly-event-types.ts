/**
 * Lists the Calendly event types CALENDLY_API_TOKEN can book into, with the
 * URI to set as a business's calendlyEventType. Read-only.
 *
 * Usage: npm run calendly:event-types
 *   then: PATCH /api/businesses/<slug> { "calendlyEventType": "<uri>" }
 */

import { calendlyConfigured, listEventTypes } from '../src/services/calendly.service';

async function main() {
  if (!calendlyConfigured()) {
    console.error('Set CALENDLY_API_TOKEN first (Calendly → Integrations → API & Webhooks).');
    process.exitCode = 1;
    return;
  }
  const types = await listEventTypes();
  if (types.length === 0) {
    console.log('No event types on this Calendly account.');
    return;
  }
  for (const t of types) {
    const where = t.locations.map((l) => l.kind).join(', ') || 'no location';
    console.log(`${t.active ? '✓' : '✗ (inactive)'} ${t.name} — ${t.durationMinutes} min, ${where}`);
    console.log(`    ${t.uri}\n`);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
