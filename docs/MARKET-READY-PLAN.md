# Market-Ready Plan

From "working software" to "a pub pays for this and relies on it every Friday night", legally,
in the UK.

> **Not legal advice.** The compliance section is a checklist of what applies and what to do,
> written to be taken to a solicitor or data-protection adviser for a one-off review before the
> first paying customer. Fees and thresholds change: check the linked sources before relying on a
> figure.

---

## 1. What "market ready" means

We are ready to sell when all of these are true:

1. **It works in a real pub.** A forwarded call during a busy service is answered, the booking or
   message reaches the manager's phone within a minute, and nothing the AI says is untrue.
2. **It doesn't fail silently.** If our server, OpenAI or Twilio has a problem, the caller still
   gets a way to leave a message, and we know about it before the pub does.
3. **It's legal.** Our sales calls, the pub's callers' data, call recording and the AI's
   disclosure all meet UK rules, with the paperwork to prove it.
4. **The numbers work.** Real cost per minute is measured and every tier's per-minute price
   leaves a margin.
5. **We can onboard and support a pub** without heroics: forwarding set up in under 10 minutes,
   a clear contract, billing, and a support route.
6. **A pub can see what it owes.** It logs in to a dashboard, sees its calls, minutes used and
   the running bill for the month, and is charged automatically.

---

## Pricing model

### How a pub pays

| Charge | Amount | When |
|---|---|---|
| **Setup** | **£50** one-off | When the pub signs up (covers number, forwarding setup, onboarding call) |
| **Usage** | **Per minute of AI-answered calls**, rate depends on tier (to be set; see below) | Billed monthly in arrears |

No monthly subscription: a quiet month costs little, a busy month costs more. The pub sees its
minutes and running bill in the dashboard at any time.

### The four tiers

From cheapest to most complete: **Agathos → Arete → Aristeia → Axiom**. A higher tier costs more
per minute and does more on each call. Draft feature split, to be agreed:

| Feature | Agathos | Arete | Aristeia | Axiom |
|---|:-:|:-:|:-:|:-:|
| AI answers missed calls 24/7, says it's an AI | ✓ | ✓ | ✓ | ✓ |
| Takes messages (name, number, reason, urgency) | ✓ | ✓ | ✓ | ✓ |
| Email summary of every call | ✓ | ✓ | ✓ | ✓ |
| Dashboard: calls, minutes, this month's bill, invoices | ✓ | ✓ | ✓ | ✓ |
| Answers questions from the pub's facts (hours, address, parking, dogs) | Basic (up to 10 FAQs) | Full (hours, menu notes, unlimited FAQs) | Full | Full |
| Table booking requests captured | — | ✓ | ✓ | ✓ |
| Instant SMS alert to the manager (bookings + urgent) | — | 1 number | Up to 3 numbers | Unlimited |
| Transcripts in the dashboard | — | ✓ | ✓ | ✓ |
| Edit hours, menu, FAQs yourself in the dashboard | — | ✓ | ✓ | ✓ |
| Call recordings in the dashboard | — | — | ✓ | ✓ |
| Custom greeting, receptionist name and voice | — | — | ✓ | ✓ |
| WhatsApp alerts | — | — | ✓ | ✓ |
| SMS confirmation to the caller once the pub confirms | — | — | ✓ | ✓ |
| Weekly report (calls caught, bookings, busiest times) | — | — | ✓ | ✓ |
| Booking-system integration (ResDiary, Collins) — bookings go straight in the diary | — | — | — | ✓ |
| Multiple sites under one login (pub groups) | — | — | — | ✓ |
| Slack / API / data export | — | — | — | ✓ |
| Support | Email | Email | Priority (phone/WhatsApp) | Named contact |

Why this split: **Agathos** is the "never miss a message" entry point. **Arete** is the real pub
product (bookings + instant SMS), and probably where most pubs should land. **Aristeia** adds
polish and the caller's experience. **Axiom** is for groups and pubs on a booking system.

Build status: everything in Agathos and most of Arete exists or is in Stage B. Aristeia and Axiom
features are Stage E, so **launch with Agathos and Arete** and show the top two as "coming soon"
rather than selling features that don't exist yet.

### What counts as a billable minute (proposal)

Usage pricing only works if the pub trusts the meter. Proposed rules, shown on the pricing page:

- Billable time runs from the moment the AI answers to the moment the call ends.
- Each call is rounded **up to the next whole minute** (simple to explain), or per second
  (fairer, less familiar): decide.
- **Not billed:** calls where the caller never speaks (silent, instant hang-ups, robocalls,
  wrong numbers under ~10 seconds). The app already marks these `NO_ANSWER`.
- Demo calls and our test calls are never billed.
- **Spend cap:** the pub can set a monthly limit; when it's reached we email them and either keep
  answering (and bill) or switch to a simple voicemail. Avoids bill shock.

### Setting the per-minute prices (later, from real data)

Work out each tier's rate from measured costs, not guesses:

1. **Measure our cost per minute** on pilot calls, per tier, because higher tiers cost more to run:
   Twilio inbound voice + ConversationRelay + speech-to-text + text-to-speech (ElevenLabs) +
   OpenAI (live replies + post-call extraction + transcription) + SMS/WhatsApp alerts per call +
   recording storage.
2. **Add fixed cost per pub per month:** Twilio number rental, share of hosting, monitoring, email.
3. **Typical usage:** average calls per pub per month × average call length (from pilots).
4. **Rate per minute** = (variable cost per minute ÷ (1 − target gross margin)), checked so that a
   *quiet* pub still covers its fixed costs. If it doesn't, see the minimum-charge decision below.
5. Compare the resulting monthly bill for a typical pub with what a part-time person answering
   the phone would cost: that's the value story for the pricing page.

> **Honest flag:** with no monthly fee, a pub that gets few missed calls might pay less each
> month than its phone number and hosting cost us. Options: a small monthly minimum
> (e.g. "minimum £X a month, which includes your first N minutes"), a higher per-minute rate on
> Agathos, or accept it as acquisition cost. Decide once pilot usage is known.

---

## 2. Where we are (October 2026)

| Area | Status |
|---|---|
| Missed-call receptionist (LIVE) | Works end to end for **one** business; takes messages only; email summary |
| Demo receptionists, Sheets sync, calling cockpit | Built, unit-tested, **not yet tested on a real call** |
| Demand | **Not validated** (PLAN Phase 0 not done) |
| Bookings in the live product | **Missing** (the demo promises them) |
| Instant alerts to the pub | **Missing** (email only) |
| Monitoring, backups, fallback | **Missing** |
| UK compliance paperwork | **Not started** |
| Customer dashboard (login, usage, bill) | **Not started** |
| Usage metering and billing | **Not started** (call durations are already stored per call) |
| Contracts, onboarding | **Not started** |

---

## 3. The stages

Each stage has a gate. Don't start the next stage's spending until the gate is met.

| Stage | Goal | Rough effort | Gate |
|---|---|---|---|
| **A. Prove it** | Real test calls + 10 pub conversations | 1 week | ≥3 decision makers hear the demo, ≥2 ask about a trial |
| **B. Make it work in a pub** | Live product matches the demo; instant alerts; safe failure | 2–3 weeks | 3 pilot pubs run 2 weeks with no missed booking |
| **C. Make it legal** | UK compliance done, runs alongside B | 2–4 weeks (mostly paperwork) | Solicitor/adviser sign-off |
| **D. Ready to sell** | Dashboard, metering, billing, tier rates, onboarding | 3–4 weeks | First paying customer signed |
| **E. Scale** | 10+ pubs reliably | ongoing | — |

---

## Stage A: Prove it (this week)

**Owner: Swarnim.** No new code.

- [ ] Go-live checklist in the README (deploy, migrate, seed, Google Sheets, `setup-twilio.ts`).
- [ ] Test call with a second phone as the "pub" through the cockpit. Confirm the demo joins.
      If it doesn't, unset `TWILIO_DEMO_APP_SID` and retry.
- [ ] Ring the Twilio number from another phone: still answers as the normal business.
- [ ] **Before any real pub call: screen numbers against TPS/CTPS** (see C2). Until that's
      automated, check each number manually and note it in the sheet.
- [ ] Phase 0: 10 real pubs. Log every call. Note in particular:
  - How many hang up or object when the AI says it's an AI
  - How the demo sounds in a three-way call (lag, garbling)
  - What owners ask: price, bookings, "does it work with ResDiary", "what if it gets it wrong"
- [ ] **Gate decision.** If it fails: fix the pitch, not the code.

---

## Stage B: Make it work in a pub

### B1. Bookings in the live product (must-have) — code

The demo takes bookings; the live product only takes messages. Close the gap.

- [ ] One prompt for LIVE and DEMO pubs (the demo prompt is the target): bookings, questions from
      the pub's facts, messages.
- [ ] Booking capture: name, party size, date, time, number, notes (high chair, dog,
      accessibility). Stored as structured fields on the Call, not just in the summary.
- [ ] The AI never confirms a booking. Script: "I've passed that to the team, they'll confirm
      by text shortly." Only say "by text" if B2 is live.
- [ ] Opening-hours awareness: don't take a booking for when the pub is shut.
- [ ] Large groups / deposits / special events: follow the pub's booking rules; otherwise
      "the team will call you to arrange it".

### B2. Instant alerts to the manager (must-have) — code

Email is read the next morning. A booking request needs a phone in someone's pocket.

- [ ] SMS (Twilio) to one or more manager numbers per business for every booking request and
      every urgent message, within ~30 seconds of the call ending. Short: "Booking: Sarah, 4 ppl,
      Sat 18 Oct 7:30pm, 07700 900123. Reply or call to confirm."
- [ ] Optional: SMS confirmation to the **caller** once the pub confirms (later, needs a reply flow).
- [ ] WhatsApp later (needs Meta business verification and templates).
- [ ] Email stays as the full record.

### B3. Safe failure (must-have) — config + code

- [ ] **Twilio fallback URL** on every number: a static TwiML that says sorry and records a
      voicemail, emailed/SMSed to the pub. Used when our server doesn't answer.
- [ ] If the LLM fails mid-call: switch to plain message-taking with canned lines instead of
      apologising and retrying.
- [ ] Uptime monitor on `/api/calls/health` (e.g. Better Stack, UptimeRobot) → SMS to Swarnim.
- [ ] Error tracking (e.g. Sentry) for the server.
- [ ] Daily health email: calls handled, failures, emails/SMS not delivered.
- [ ] Automated daily database backups, and one restore actually tested.

### B4. Real-world guardrails in the prompt — code

- [ ] **Allergens:** never give allergen or dietary safety advice; always "I'll get the team
      to confirm that with you". (Pubs carry the liability for allergen information.)
- [ ] **Emergencies:** if a caller describes an emergency, tell them to hang up and dial 999.
- [ ] No prices, offers or availability unless they're in the pub's facts.
- [ ] Complaints: take details, never argue or promise refunds.
- [ ] Callers trying to misuse it (prompt injection, abuse, long silent calls): already capped at
      10 minutes; add a test set of hostile calls.

### B5. Multi-pub onboarding (PLAN Phase 4) — code

- [ ] "Start trial" in the cockpit: DEMO → LIVE copy, tier, manager phone(s), notify email.
      Takes the £50 setup payment (or marks it invoiced).
- [ ] A Twilio number per pub (so calls route by the dialled number), bought and configured
      by script. Needs the Twilio UK regulatory bundle (see C6).
- [ ] Forwarding guides per UK provider (BT, Sky, Virgin, Vodafone, Plusnet, common VoIP
      systems) with "no answer after N rings" settings. Many pubs will need a phone call to set
      this up: budget for it.
- [ ] A test call during onboarding that the pub owner hears.

### B6. Call quality — measure and tune

- [ ] Real-call recordings from pilots (with consent): check names, numbers, dates.
- [ ] Measure response lag on direct calls and in the conference demo.
- [ ] Track: share of callers who hang up after "AI assistant"; share of calls where the
      phone number was captured correctly.

### B7. Pilot

- [ ] 3 friendly pubs, free, 2 weeks, with weekly check-ins.
- [ ] **Gate:** no missed or wrong booking, manager gets every alert, owner would pay.

---

## Stage C: Make it legal (UK)

Runs alongside Stage B. Most of this is documents, not code.

### C1. Company basics

- [ ] Trade through a **limited company** (limits personal liability). Business bank account.
- [ ] **Insurance:** professional indemnity (a missed booking or wrong information costs a pub
      money) and cyber insurance (we hold personal data).
- [ ] VAT: register when turnover approaches the threshold (£90,000 at time of writing; check
      gov.uk). Decide whether prices are quoted ex-VAT.

### C2. Sales calls: PECR (our cold calls to pubs)

Applies to the calling cockpit. The ICO enforces it, with fines.

- [ ] **Screen every number against the TPS and the CTPS** before calling, and re-screen at
      least every 28 days. Pubs run by sole traders or partnerships count as individuals (TPS);
      companies and LLPs are corporate subscribers (CTPS). Get licensed access (via TPS Ltd or a
      screening provider) and add the check to the cockpit alongside our own Do Not Call tab.
      *Code: a `TPS/CTPS checked` date column + a block in `checkCanDial`.*
- [ ] Never withhold caller ID (the cockpit already uses our Twilio number). Make sure the number
      can be called back and reaches us or a voicemail saying who we are.
- [ ] Honour objections immediately (the cockpit's "Asked not to be called" → Do Not Call).
- [ ] **AI joining a live call:** the AI only joins after the person agrees, during a call we
      started as a human. Record that agreement in the Call Log ("agreed to hear demo"). Ask the
      solicitor to confirm this isn't treated as an automated marketing call.
- [ ] Keep the sales data lawful too: our Prospects sheet is personal data (names, roles). We're
      the controller. Legitimate interests, documented in a short LIA; privacy notice on the website
      covering prospects; delete prospects who say no after a set period.

### C3. UK GDPR: the pub's callers' data

When a pub uses the product, **the pub is the controller** of its callers' data and **we are its
processor**.

- [ ] **ICO data protection fee:** register and pay (tier 1 for micro businesses; about £52 a year
      at time of writing; check ico.org.uk).
- [ ] **Data Processing Agreement (Article 28)** with every pub: what we process, why, for how
      long, our security measures, our sub-processors, breach notification, deletion at the end.
      Template from the solicitor, signed as part of the contract.
- [ ] **Sub-processor list** with their DPAs and where data goes: Twilio (calls, recordings),
      OpenAI (conversation, transcription), ElevenLabs (speech), Deepgram (speech recognition via
      Twilio), Google (only for our sales data), our hosting provider, our email provider.
- [ ] **International transfers:** most of these process data in the US. Rely on the UK–US data
      bridge where the provider is certified, or the UK IDTA / Addendum in their DPA. Check each
      one and list it. Prefer EU/UK regions where offered (e.g. hosting, database).
- [ ] **Turn off model training** on our data where providers allow it (OpenAI API data isn't used
      for training by default; confirm and document for each).
- [ ] **DPIA** (Data Protection Impact Assessment): recommended, because it's new technology
      recording and analysing calls. A few pages; the ICO has a template.
- [ ] **Record of processing activities (RoPA):** a short table, required in practice.
- [ ] **Retention and deletion:** e.g. recordings 30 days, transcripts and call records 12 months,
      then deleted automatically. *Code: a nightly retention job (nothing deletes data today).*
- [ ] **Subject requests:** a process to find, export or delete one caller's data within a month
      when a pub asks. *Code: admin search/delete by phone number.*
- [ ] **Breach procedure:** who decides, how we tell the pub without undue delay so they can tell
      the ICO within 72 hours where required.
- [ ] **Security basics:** strong admin key or proper logins, 2FA on Twilio/OpenAI/Google/hosting,
      encrypted backups, least-privilege access, secrets only in env.
- [ ] **Template privacy wording for the pub** to add to their website/booking page ("calls may
      be answered by an AI assistant and recorded…"), since they're the controller.

### C4. Call recording and the AI disclosure

- [ ] Callers hear that the call may be recorded (already in the greeting when `RECORD_CALLS=true`).
- [ ] Callers hear that they're speaking to an AI (already in the demo greeting; make it the
      default for LIVE pubs too, and say so whenever asked, which the prompt already does).
- [ ] Decide whether recordings are needed at all after transcription. Fewer recordings = less
      risk. Option: transcribe, then delete the audio within days.

### C5. Contracts and terms (B2B)

- [ ] **Terms of service** for pubs: what the service does and doesn't do (it doesn't confirm
      bookings, it can mishear), the pub's responsibilities (check alerts, confirm bookings, keep
      their facts up to date, set up forwarding), fair use (minutes), changes, termination.
- [ ] **Liability cap** (e.g. fees paid in the last 12 months) and exclusion of indirect losses
      such as lost bookings. Have the solicitor check it's reasonable.
- [ ] **Service level:** a realistic uptime target and support hours. No promise of 100%.
- [ ] Trial terms: 14 days free, what happens at the end, no auto-charge without agreement.
- [ ] Website: privacy notice, cookie notice if analytics are added, company details (name,
      number, registered office) as required for a limited company.

### C6. Telecoms

- [ ] **Twilio UK regulatory bundle:** UK numbers need a verified business address and identity
      in Twilio before purchase. Do it once for the company.
- [ ] Use UK geographic or 03 numbers so pubs' forwarding costs stay low and callers see a normal
      number. Check how much forwarding to the number costs on the pub's tariff.
- [ ] Twilio account upgraded, UK geo-permissions on, spending alerts set.

### C7. Sign-off

- [ ] One-off review by a solicitor or data-protection consultant of: DPA, terms, privacy
      notices, DPIA, the PECR approach to AI demos. Budget a few hundred to low thousands of pounds.

---

## Stage D: Ready to sell

### D1. Tiers in the product — code

- [ ] `Business.tier` (AGATHOS | ARETE | ARISTEIA | AXIOM) and a single place that says which
      features each tier has. Features check the tier, not ad-hoc flags.
- [ ] Gate the features from the tier table (e.g. bookings and SMS alerts only from Arete).
- [ ] Changing tier takes effect from the next call; the bill splits minutes by tier.

### D2. Usage metering — code

- [ ] Store **billable seconds** per call (from Twilio's call duration, not our own timer),
      with the rules in "What counts as a billable minute".
- [ ] Mark demo, test and non-billable calls so they never reach an invoice.
- [ ] Monthly usage per business (minutes × tier rate), closed on the 1st of each month.
- [ ] Reconcile monthly against Twilio's own usage records, so our meter is provably right.
- [ ] Spend cap per business, with an email at 80% and 100%.

### D3. Customer dashboard — code

- [ ] **Logins** per pub (email + password with 2FA option, or email magic link), one or more
      users per pub. Replaces sharing the admin key; the admin side stays separate.
- [ ] **This month:** calls answered, billable minutes, running bill, spend cap.
- [ ] **Calls:** list with summary; transcripts and recordings by tier.
- [ ] **Invoices:** past months, downloadable PDF.
- [ ] **Settings (Arete and up):** opening hours, menu notes, FAQs, alert numbers, notify email.
- [ ] Security: per-pub data isolation (a pub can only ever see its own calls), rate-limited
      login, audit log of setting changes. This is personal data: a leak between pubs is a breach.
- [ ] Hosted on our domain with HTTPS; works on a phone (landlords will check it on their mobile).

### D4. Billing — code + Swarnim

- [ ] Payment provider that handles **one-off + metered** charges: Stripe (card; usage-based
      billing built in) or GoCardless (direct debit; popular with UK small businesses; variable
      amounts with advance notice). Decide.
- [ ] £50 setup charged at sign-up; usage invoiced monthly in arrears from the meter.
- [ ] Invoices with company details, and VAT once registered.
- [ ] Failed payment handling: reminder emails, then pause service after a stated period.
- [ ] Terms (C5) state the per-minute rates, how minutes are counted, the setup fee, notice for
      price changes, and that the dashboard figure is what gets billed.

### D5. Pricing — Swarnim

- [ ] Measure costs on pilots and set the four per-minute rates (method in "Pricing model").
- [ ] Decide the minimum-charge question.
- [ ] Pricing page on the website: setup fee, per-minute rates, tier table, billable-minute rules,
      a "typical pub pays about £X a month" example from pilot data.

### D6. Selling and support

- [ ] **Onboarding pack:** forwarding guide, what the AI says, how alerts look, how to use the
      dashboard, who to call.
- [ ] **Support:** one phone/WhatsApp number and email, response times stated in the terms.
- [ ] **Proof:** one case study from a pilot ("X calls answered, Y bookings caught in 2 weeks").
- [ ] Sales playbook updated with the objections heard in Stage A, the pilot results and the
      pricing pitch (setup + pay for what you use).
- [ ] Gate: first paying customer on signed terms and DPA, billed through the system.

---

## Stage E: Scale (10+ pubs)

- [ ] Move in-memory state (live sessions, active demo, cockpit) to Redis so more than one server
      instance can run and deploys don't drop calls.
- [ ] Load test a Friday 7pm burst (many simultaneous calls); check OpenAI rate limits and Twilio
      concurrency.
- [ ] Build the Aristeia and Axiom features: recordings and custom voice in the dashboard,
      WhatsApp, caller SMS confirmations, weekly reports, multi-site logins, Slack/API/export.
- [ ] Booking-system integrations (ResDiary first, then Collins/DesignMyNight) so bookings go
      straight into the diary (Axiom).

---

## 4. Honest risk register

| Risk | Likelihood | Impact | What we do |
|---|---|---|---|
| Pub owners don't want it, or callers hang up on an AI | Medium | Fatal | Stage A gate; measure hang-ups in pilots |
| The AI says something false (a booking "confirmed", a wrong opening time, allergen advice) | Medium | High (reputation, liability) | B1/B4 guardrails, terms, insurance |
| Booking request not seen in time → no-show or double booking | High with email only | High | B2 instant SMS before any paid customer |
| Forwarding not set up right, or callers hang up during the 15–25s before forwarding | High | Medium | Onboarding test call; per-provider guide; suggest fewer rings |
| Server or provider outage on a Friday night | Low–Medium | High | B3 fallback voicemail, monitoring |
| Deploy or crash mid-call drops calls (single instance) | Medium | Low–Medium | Deploy off-peak; Redis in Stage E |
| Cold-calling a TPS/CTPS number | High without screening | High (ICO fine) | C2 screening before any more sales calls |
| A data breach or a GDPR complaint | Low | High | C3 documents, security basics, retention job |
| Costs per minute higher than expected | Medium | Medium | Measure in pilots before setting rates; price changes need notice in the terms |
| Usage pricing: quiet pubs cost more than they pay | Medium | Medium | Minimum-charge decision once pilot usage is known |
| Bill shock or disputes about minutes | Medium | Medium | Clear billable-minute rules, spend cap, dashboard shows every call, meter reconciled with Twilio |
| Spam/robocalls run up a pub's bill | Medium | Low–Medium | Silent and very short calls not billed; spend cap |
| Dashboard leaks one pub's calls to another | Low | High (breach) | Per-pub isolation tests, security review before launch |
| Noisy pubs and accents garble names and numbers | High | Medium | Keypad entry, read-back, post-call re-transcription, measure |
| Lag in the three-way demo makes the AI sound worse than it is | Medium | Medium | Measure in Stage A; offer a direct demo call as a backup |
| One-person business: Swarnim is the support line | High | Medium | Clear support hours in terms; monitoring alerts; simple runbooks |

---

## 5. Decisions needed from Swarnim

1. **Bookings promise:** "the team will confirm by text" (needs B2 and the pub to reply), or
   "the team will be in touch to confirm" (works with email alone, weaker)?
2. **Alerts:** SMS only to start, or WhatsApp too (more setup, preferred by many landlords)?
3. **Recordings:** keep audio (better accuracy, more GDPR risk) or transcribe and delete?
4. **Pilot pubs:** who are the 3 friendly pubs?
5. **Company and insurance:** is the limited company set up? Which insurer?
6. **Solicitor:** who reviews the documents, and budget?
7. **Tier features:** agree or change the draft tier table.
8. **Billing unit:** round each call up to the minute, or bill per second?
9. **Minimum charge:** none, a small monthly minimum, or a higher Agathos rate?
10. **Payment provider:** Stripe (card) or GoCardless (direct debit)?
11. **Pilot pricing:** pilots free, or £50 setup only and usage free for the pilot period?
12. **Over the spend cap:** keep answering and bill, or switch to voicemail?

---

## 6. Suggested order for the next 8 weeks

| Week | Code (Claude + Swarnim) | Business (Swarnim) |
|---|---|---|
| 1 | Fixes from the first real test calls; TPS/CTPS block in the cockpit | Go live; test calls; TPS/CTPS access; ICO fee; Phase 0 calls |
| 2 | B1 bookings in LIVE, B2 SMS alerts, B4 guardrails | Phase 0 continues; find 3 pilot pubs; Twilio regulatory bundle |
| 3 | B3 fallback + monitoring + backups; D1 tiers; D2 metering (billable seconds per call) | Solicitor engaged; DPA + terms drafted; insurance; agree tier table |
| 4 | B5 Start trial + per-pub numbers; forwarding guides | Pilots start (cost measurement on); DPIA + RoPA |
| 5 | D3 dashboard: logins, this month, calls | Pilot check-ins; choose payment provider |
| 6 | D3 dashboard: settings, invoices; retention job; subject-request search | Set per-minute rates from pilot costs; pricing page |
| 7 | D4 billing: setup fee, monthly usage invoices, failed payments; security review of the dashboard | Terms finalised with rates; solicitor sign-off |
| 8 | Fix what pilots and the review found | First paying customer |

---

## Sources to check

- ICO, PECR guidance on electronic and telephone marketing: <https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/>
- ICO data protection fee: <https://ico.org.uk/for-organisations/data-protection-fee/>
- ICO guide to UK GDPR (processors, contracts, DPIAs, international transfers): <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/>
- TPS / CTPS (screening access for businesses): <https://www.tpsonline.org.uk/>
- Stripe usage-based billing: <https://docs.stripe.com/billing/subscriptions/usage-based>
- GoCardless (UK direct debit): <https://gocardless.com/>
- Food Standards Agency, allergen guidance for food businesses: <https://www.food.gov.uk/business-guidance/allergen-guidance-for-food-businesses>
- VAT registration threshold: <https://www.gov.uk/vat-registration>
- Twilio UK regulatory requirements for phone numbers: <https://www.twilio.com/en-us/guidelines/gb/regulatory>
