# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

An AI phone receptionist for UK pubs and restaurants. When a business misses a call,
it forwards to a Twilio number, the AI ("Maya") answers, takes a message, and emails
a structured summary.

We are now adding a **sales workflow**: Swarnim calls pubs himself and conferences
in a demo receptionist that answers as *that pub*, so the owner hears exactly what
their callers would get. Read `PLAN.md` before starting any feature work; it is the
source of truth for scope and order. Sales process and call script live in
`docs/sales/PLAYBOOK.md`. How the pieces fit together: `docs/ARCHITECTURE.md`.

## Stack

- Node.js 20+, TypeScript, Express, `ws`
- Twilio ConversationRelay (ElevenLabs voice, Deepgram STT) with a Gather/Polly fallback
- OpenAI: `gpt-4.1-mini` live, `gpt-4.1` post-call extraction, `gpt-4o-transcribe` on recordings
- PostgreSQL + Prisma
- Gmail SMTP (Nodemailer), optional Slack
- Marketing site in `website/` (Next.js, separate package, has its own CLAUDE.md)

## Layout

```
src/config/index.ts            Zod-validated env. Add every new env var here AND to .env.example
src/services/ai.service.ts     System prompt, greeting, streaming replies, extraction
src/services/relay.service.ts  ConversationRelay WebSocket session (the live call loop)
src/services/twilio.service.ts TwiML builders, Twilio REST helpers
src/services/call.service.ts   Post-call pipeline: recording -> transcript -> extraction -> DB -> email
src/services/business.service.ts Business profiles and call -> business routing (owned number > active demo > default)
src/services/demo.service.ts   In-memory active demo (30-minute TTL)
src/services/sheets.service.ts Google Sheets sync (header-based columns, first-empty-row writes)
src/services/cockpit.service.ts Calling cockpit: agent leg -> press 1 -> conference -> pub; demo participant; outcome
src/api/routes/cockpit.ts      Cockpit API (admin auth); page is public/cockpit.html at GET /cockpit
src/lib/calling-hours.ts       CALLING_HOURS window (UK time)
src/services/demo-builder.service.ts Research notes -> DEMO business profile (LLM)
src/api/routes/webhooks.ts     Twilio webhooks (signature-validated)
src/api/routes/calls.ts        Admin API (Bearer ADMIN_API_KEY)
src/api/routes/businesses.ts   Admin CRUD for businesses
src/api/routes/demo.ts         Admin: set / clear the active demo
prisma/schema.prisma           Call, ConversationTurn
tests/                         vitest
scripts/                       ts-node utilities (setup-twilio, test-call, test-flow)
```

## Commands

```bash
npm run dev            # ts-node-dev
npm test               # vitest
npm run lint
npm run typecheck
npm run db:migrate:dev # create/apply a migration locally
npm run db:seed        # create the default business from env vars (idempotent)
npm run demo:new -- "<pub name>" "<notes | notes file>" [--activate]   # build a DEMO business from research notes
npm run demo:new -- --from-sheet "<pub name>"                         # ...from its Prospects row
npm run sheets:check   # read-only: Sheets access + column headers
npx ts-node scripts/test-flow.ts   # simulate a call with no phone
```

Before calling any task done: `npm run typecheck && npm run lint && npm test` all pass.

## Rules

1. **Don't break the inbound missed-call path.** It is the product. Every change must keep
   a forwarded call working end to end. If you touch `relay.service.ts`, `ai.service.ts` or
   `webhooks.ts`, add or update tests.
2. **No business details hardcoded or read straight from env in new code.** `COMPANY_NAME`,
   `PERSONA_NAME`, `BUSINESS_EMAIL` etc. are being replaced by a `Business` record (PLAN.md
   Phase 1). Keep env values only as the fallback default business.
3. **Twilio webhooks stay signature-validated.** Never weaken `validateTwilioSignature`.
4. **The AI always says it is an AI assistant** when asked, and demo calls say so in the
   greeting. Recording disclosure stays on when `RECORD_CALLS=true`.
5. **No autonomous outbound sales calls.** The AI never dials a prospect on its own. Outbound
   legs are only ever started by a human from the calling cockpit (PLAN.md Phase 3).
   This is a legal constraint (PECR), not a preference.
6. **Do-not-call list is checked in code** before any outbound leg to a prospect is created.
7. Secrets (Twilio, OpenAI, Google service-account JSON) only via env. Never commit them,
   never log them.
8. Small, reviewable commits, one phase task at a time. Update the checkbox in `PLAN.md`
   when a task is finished.
9. British English in all caller-facing text (prompts, greetings, emails).

## Google Sheet (sales pipeline)

Spreadsheet ID: `1ISOr0C6qAbH8KVk3M-IjNmydXqS0vwO3oXIJTCxm73k` (owner mswarnim1@gmail.com).
Tabs and columns are fixed; the code must match them exactly:

- `Prospects`: Pub name | Area | Address | Phone | Website | Contact name | Contact role |
  Booking system | Research notes | Best time to call | Status | Next action date | Times called (formula, don't write)
- `Call Log`: Date | Pub name | Time | Spoke to | Reached decision maker (checkbox) |
  AI demo used (checkbox) | Outcome | Demo reaction (1–5) | Main objection | Next step | Follow-up date | Notes
- `Leads`: Pub name | Contact name | Role | Phone | Email | Stage | Plan | Monthly value (£) | Trial start | Next follow-up | Notes
- `Do Not Call`: Pub name | Phone | Date added | Reason | How they asked
- `Dashboard`: formulas only. Never write to it from code.

Dropdown values (must match exactly):
- Prospects Status: Not called, Calling, Callback, Demo done, Lead, Not interested, Do not call
- Call Log Outcome: No answer, Gatekeeper, Call back later, Interested, Not interested, Asked not to be called
- Leads Stage: Interested, Trial offered, Trial live, Paying, Lost
- Leads Plan: Starter £69, Pro £129, Group

Access from code is via a Google Cloud service account that the sheet is shared with
(PLAN.md Phase 2). Append rows; never reorder or delete the user's rows.
