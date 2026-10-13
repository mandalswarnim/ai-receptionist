# Sales Workflow Plan

**Goal:** turn the AI receptionist into its own sales demo. Swarnim researches a pub, calls
it, and conferences in a demo receptionist that answers as that pub ("Good afternoon,
The Crown, how can I help?"). The owner tries booking a table, hears the AI handle it, and
Swarnim closes for a free trial while still on the line. Every call and lead lands in the
Google Sheet.

**Why this shape:** a human makes every outbound call. The AI only joins a call the
prospect has agreed to. That keeps us on the right side of PECR (automated marketing calls
need prior consent, and AI calls are likely treated as automated) and it converts better,
because the demo is the pitch.

**Not in scope:** the AI dialling prospects by itself, bulk dialling, scraped contact lists,
paid lead data. Research is done by hand (see `docs/sales/PLAYBOOK.md`).

Each phase ends with something usable. Do them in order. Tick boxes as tasks are merged.

---

## Phase 0: Prove it with no code (this week)

Before building anything, test whether pub owners stay on the line.

- [ ] Set `.env` for one real pub you've researched: `COMPANY_NAME`, `PERSONA_NAME`, and
      temporarily edit the greeting in `buildGreeting()` to answer as the pub. Restart.
- [ ] Call the pub from your mobile. When the owner agrees, tap **Add call**, dial the Twilio
      number, tap **Merge**. Mute yourself while the AI talks.
- [ ] Do this with 10 pubs. Log every call in the Sheet's `Call Log` tab.
- [ ] Decision gate: if at least 3 of the decision makers you reach agree to hear the demo and
      2 or more ask about price or a trial, continue to Phase 1. If not, fix the script first,
      not the code.

---

## Phase 1: Multi-tenant demo receptionists

Today the business is defined by env vars, so the app can only be one business. Demos need
one receptionist per prospect, switchable in seconds.

### 1.1 `Business` model
- [ ] Prisma model `Business`:
      `id, slug (unique), name, mode (DEMO | LIVE), personaName, greeting (nullable, overrides default),
      openingHours (text), address, bookingSystem, bookingInstructions (text),
      menuNotes (text), faqs (Json, [{q, a}]), notifyEmail (nullable), twilioNumber (nullable, unique),
      createdAt, updatedAt`
- [ ] `Call.businessId` (nullable FK) so every call record knows which business it was for.
- [ ] Migration + seed script that creates the default business from the current env vars,
      so nothing changes for existing setups.

### 1.2 Business-aware prompts
- [ ] Refactor `ai.service.ts` (`systemPrompt`, `buildGreeting`, extraction prompt),
      `twilio.service.ts` (`speechHints`), `transcription.service.ts`, `email.service.ts`
      and `slack.service.ts` to take a `Business` instead of reading `config.COMPANY_NAME` etc.
- [ ] Demo mode prompt: answers as the pub, uses its hours, menu notes, FAQs and booking
      system; for a booking request, collects name, party size, date and time and confirms it
      ("I've pencilled that in, the team will confirm by text"). Says it's an AI assistant in
      the greeting and whenever asked.
- [ ] Demo calls never email the prospect. Summaries for DEMO businesses go to `BUSINESS_EMAIL`
      (Swarnim) with a "Demo call" subject prefix.
- [ ] Tests: prompt builder snapshot tests for a LIVE and a DEMO business; existing tests still pass.

### 1.3 Routing a call to the right business
- [ ] Resolution order when a call arrives: (1) `To` number matches `Business.twilioNumber`
      (real customers, later); (2) an **active demo** is set; (3) default business.
- [ ] Active demo: in-memory `{ businessId, expiresAt }` with a 30-minute TTL.
      `POST /api/demo/active { slug }` (admin auth) sets it, `DELETE` clears it,
      `GET` shows it. Pass `businessId` into the relay session via the ConversationRelay
      `<Parameter>` / setup message so the live loop doesn't depend on global state mid-call.
- [ ] Admin CRUD: `GET/POST/PATCH/DELETE /api/businesses`.

### 1.4 Quick demo builder
- [ ] `scripts/new-demo.ts "<pub name>" "<research notes>"`: sends the notes to the LLM,
      gets back a strict-JSON `Business` (hours, menu notes, FAQs, booking system), prints
      it for review, saves it as DEMO on confirmation. Notes in, demo out in under 2 minutes.

**Done when:** Swarnim can create a demo for a pub from his notes, set it active, ring the
Twilio number, and hear "Good afternoon, The Crown…", while a forwarded call to a LIVE
business still behaves exactly as before.

---

## Phase 2: Google Sheets sync

The Sheet stays the place Swarnim works. The app reads prospects from it and writes demo
results back. Spreadsheet ID and exact column names are in `CLAUDE.md`.

- [ ] Google Cloud project, Sheets API enabled, service account; share the sheet with the
      service account email (Editor). Env: `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`
      (base64). Add both to `config` and `.env.example`. Document setup in README.
- [ ] `src/services/sheets.service.ts` using `googleapis`: `getProspects()`,
      `getDoNotCall()`, `appendCallLog(row)`, `updateProspectStatus(name, status, nextActionDate)`.
      Header-name based column lookup (read row 1), never hardcoded letters.
- [ ] `scripts/new-demo.ts --from-sheet "<pub name>"`: builds the demo from the Prospects row
      (Research notes, Booking system, Address, Best time to call).
- [ ] After a DEMO call ends: append a Call Log row (Date, Pub name, Time, AI demo used = TRUE,
      Notes = one-line AI summary + link to admin transcript). Swarnim fills the outcome.
- [ ] Unit tests with a mocked Sheets client.

**Done when:** a prospect added to the Sheet can become a live demo with one command, and
each demo call appears in `Call Log` without typing.

---

## Phase 3: Calling cockpit

Replace the phone "Add call / Merge" trick with a page that does it in one click and logs
the outcome.

- [ ] `website/` or a small page served by the API at `/cockpit` (admin auth): shows the next
      prospect from the Sheet (Status = Not called or Callback, Next action date due), the
      research notes, best time to call, and Times called.
- [ ] **Call** button: Twilio calls Swarnim's mobile first (`AGENT_PHONE_NUMBER`), then dials the
      pub into a named Twilio Conference (`<Dial><Conference>`). Caller ID is our Twilio number,
      never withheld.
- [ ] Before dialling: phone number checked against the `Do Not Call` tab and refused if found.
      Calls only allowed Mon–Fri 09:00–20:00 and Sat 10:00–17:00 Europe/London unless overridden.
- [ ] **Bring in demo** button: sets that pub's demo active and adds a ConversationRelay participant
      to the conference (Participants API, TwiML URL that returns the relay TwiML for that
      business). Swarnim can stay on, muted, and unmute to take over.
- [ ] **Remove AI** button: removes the AI participant, call continues between humans.
- [ ] Outcome form after hang-up (Outcome, Reached decision maker, Demo reaction, Objection,
      Next step, Follow-up date, Notes) writes to `Call Log` and updates `Prospects` Status.
      "Asked not to be called" also appends to `Do Not Call`.
- [ ] Conference status callbacks logged; recording of the conference only if
      `RECORD_SALES_CALLS=true` and the prospect has been told.

**Done when:** a full sales call, from picking the prospect to logging the outcome, happens on
one page with no manual dialling or typing into the Sheet.

---

## Phase 4: Follow-ups and trial onboarding

- [ ] Daily 08:30 email digest (reuse `email.service`): follow-ups due today, callbacks, trials
      ending in the next 3 days. Read from the Sheet.
- [ ] "Start trial" in the cockpit: copies the DEMO business to a LIVE business, asks for
      notify email and the pub's forwarding setup, assigns a Twilio number, and adds/updates the
      `Leads` row (Stage = Trial live, Trial start = today).
- [ ] One-page "how to forward your missed calls" instructions per UK network, emailed on trial start.
- [ ] Optional: `scripts/fsa-pubs.ts <local authority>` pulls pub names and addresses from the
      Food Standards Agency hygiene-rating API (free, no key) into a CSV for pasting into
      `Prospects`. Phone numbers still added by hand during research.

**Done when:** no follow-up depends on Swarnim remembering it, and turning an interested pub
into a working trial takes under 10 minutes.

---

## Later (only after paying customers)

- Booking-system integrations (ResDiary, Collins) so demo and live calls make real bookings.
- Per-customer dashboard on the website.
- Inbound "hear your demo" line on the marketing site and flyers.

## Environment variables to add (as phases land)

| Var | Phase | Purpose |
|---|---|---|
| `GOOGLE_SHEETS_ID` | 2 | Sales pipeline spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 2 | Base64 service-account key |
| `AGENT_PHONE_NUMBER` | 3 | Swarnim's mobile, called first by the cockpit |
| `RECORD_SALES_CALLS` | 3 | Default `false` |
| `CALLING_HOURS` | 3 | Override allowed calling window |
