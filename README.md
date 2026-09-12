# AI Receptionist — Swarnim AI

A production-ready AI phone receptionist. When a customer calls your business and nobody answers, the call forwards to this system. The AI picks up, has a full conversation, collects the caller's details, and emails a structured summary to you.

---

## How It Works

```
Customer calls business phone
         │
   Business doesn't pick up
         │
   Call forwards to Twilio number  ← set up "forward on no answer" on your phone
         │
   AI answers immediately ("Maya")
         │
   Greets caller → Collects name, company,
   phone, email, message, urgency
   (caller can interrupt the AI mid-sentence)
         │
   Confirms details → Goodbye → Hangup
         │
   ┌─────┴──────────────────────────────────┐
   │         POST-CALL                      │
   │  Wait (≤25s) for the call recording    │
   │  Recording → gpt-4o-transcribe         │
   │  Live + audio transcript → structured  │
   │  extraction (strict JSON schema)       │
   │  Save to PostgreSQL → Email summary    │
   └────────────────────────────────────────┘
```

---

## Conversation Modes

The receptionist has two interchangeable voice pipelines, switched with one
env var (`USE_CONVERSATION_RELAY`):

| | **ConversationRelay** (default) | **Gather webhooks** (fallback) |
|---|---|---|
| Voice | ElevenLabs "Amelia" (British female, genuinely human) | Amazon Polly Generative (`Polly.Amy-Generative`) |
| Live transcription | Deepgram Nova-3 (streaming, auto end-of-turn) | Deepgram Nova-2 via Twilio Gather |
| Caller can interrupt | ✅ native barge-in | ✅ within each Gather |
| Keypad phone-number entry | ✅ (digits + `#`) | ❌ |
| Latency | Lowest (token streaming straight to TTS) | Moderate (turn-based) |
| Transport | WebSocket (`/api/relay`) | HTTP webhooks |

Both modes share the same persona, post-call pipeline, database, and email.

---

## Tech Stack

| Layer      | Technology                                            |
|------------|-------------------------------------------------------|
| Telephony  | Twilio (ConversationRelay or Gather/Say)              |
| AI Voice   | ElevenLabs (relay) / Amazon Polly Generative (webhook)|
| Live STT   | Deepgram Nova                                         |
| Post-call STT | OpenAI gpt-4o-transcribe (on the call recording)   |
| LLM        | OpenAI gpt-4.1-mini live (streaming), gpt-4.1 post-call |
| Backend    | Node.js + TypeScript + Express + ws                   |
| Database   | PostgreSQL + Prisma ORM                               |
| Email      | Gmail SMTP via Nodemailer                             |

---

## Prerequisites

- Node.js 20+
- PostgreSQL (installed via Homebrew on Mac)
- Twilio account (**paid/upgraded** — trial blocks TwiML execution)
- OpenAI API key with credits
- Gmail account with an App Password

---

## Setup from Scratch

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```env
PORT=3000
NODE_ENV=development
BASE_URL=https://your-ngrok-url.ngrok-free.app

# Twilio — AI agent number (business forwards missed calls here)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+44xxxxxxxxxx

# OpenAI
OPENAI_API_KEY=sk-proj-xxxxxxxx
OPENAI_MODEL=gpt-4o
WHISPER_MODEL=gpt-4o-transcribe

# Persona & voice (see .env.example for all options)
PERSONA_NAME=Maya
USE_CONVERSATION_RELAY=true
RECORD_CALLS=true

# Gmail SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx    # Gmail App Password (16 chars)
EMAIL_FROM_NAME=AI Receptionist
BUSINESS_EMAIL=where-summaries-go@email.com

# Database
DATABASE_URL=postgresql://yourmacusername@localhost:5432/ai_receptionist

# Company
COMPANY_NAME=Your Company Name
COMPANY_TIMEZONE=Europe/London
```

### 3. Get your Gmail App Password

1. Go to https://myaccount.google.com/security → turn on **2-Step Verification**
2. Go to https://myaccount.google.com/apppasswords
3. App name: `AI Receptionist` → Create
4. Copy the 16-character password into `SMTP_PASS`

### 4. Set up PostgreSQL

```bash
# Install (Mac)
brew install postgresql@17
brew services start postgresql@17

# Create database
createdb ai_receptionist

# Run migrations
npm run db:migrate:dev
# When prompted for migration name, type: init
```

### 5. Start the server

```bash
npm run dev
```

You should see:
```
AI Receptionist running { port: '3000', company: 'Your Company' }
Database connected
SMTP connection verified
```

### 6. Expose publicly with ngrok

Open a new terminal:
```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL → paste into `.env` as `BASE_URL` → restart the server.

### 7. Configure Twilio webhooks

```bash
npx ts-node scripts/setup-twilio.ts
```

Output:
```
Twilio webhooks configured:
  Voice URL:       https://xxxx.ngrok-free.app/api/webhooks/incoming-call
  Status Callback: https://xxxx.ngrok-free.app/api/webhooks/call-status
```

### 8. Set up call forwarding on your business phone

In your phone settings or provider portal, enable:
> **"Forward on no answer" → your Twilio number**

---

## Testing

### Unit tests

```bash
npm test
```

### Inspect the TwiML the server returns (no phone needed)

```bash
npx ts-node scripts/print-twiml.ts
```

### Test the AI conversation locally (no phone needed)

```bash
npx ts-node scripts/test-flow.ts
```

Simulates a full call conversation, prints the transcript and extracted JSON, no Twilio required.

### Test with a real call (outbound)

```bash
npx ts-node scripts/test-call.ts +44xxxxxxxxxx
```

Twilio calls your phone. Answer it and talk to the AI.

> **Note:** Requires a paid/upgraded Twilio account. Trial accounts play a disclaimer and hang up before TwiML executes.

### Test with an inbound call

Once call forwarding is set up on your business phone, call your business number and don't answer. The call forwards to Twilio and the AI picks up.

---

## API Endpoints

### Admin

All admin routes except `/health` require `Authorization: Bearer <ADMIN_API_KEY>`
when `ADMIN_API_KEY` is set (mandatory in production).

| Method | Path                        | Description                        |
|--------|-----------------------------|------------------------------------|
| GET    | `/api/calls/health`         | Health check + active call count   |
| GET    | `/api/calls/stats`          | Summary statistics                 |
| GET    | `/api/calls`                | List all calls (paginated)         |
| GET    | `/api/calls?search=james`   | Search by name/phone/email/company |
| GET    | `/api/calls?urgency=urgent` | Filter by urgency                  |
| GET    | `/api/calls/:id`            | Full call + conversation turns     |
| GET    | `/api/calls/:id/transcript` | Full transcript                    |
| DELETE | `/api/calls/:id`            | Delete a call record               |

### Twilio Webhooks (called by Twilio automatically)

| Method | Path                              | Description              |
|--------|-----------------------------------|--------------------------|
| POST   | `/api/webhooks/incoming-call`     | Forwarded call arrives   |
| POST   | `/api/webhooks/gather`            | Caller speaks            |
| POST   | `/api/webhooks/recording`         | Recording ready          |
| POST   | `/api/webhooks/call-status`       | Call ends                |

---

## Example Email Output

**Subject:** `New Missed Call Message from James Wilson`

The email includes:
- Caller name, company, phone, email
- Urgency badge (🔴 URGENT / 🟠 High / 🟡 Medium / 🟢 Low)
- Full message
- AI-generated summary
- Timestamp

---

## Environment Variables

| Variable           | Required | Description                                  |
|--------------------|----------|----------------------------------------------|
| `BASE_URL`         | Yes      | Public HTTPS URL (ngrok in dev)              |
| `TWILIO_ACCOUNT_SID` | Yes    | Starts with `AC`                             |
| `TWILIO_AUTH_TOKEN`  | Yes    | Twilio auth token                            |
| `TWILIO_PHONE_NUMBER`| Yes    | Your Twilio number in `+E.164` format        |
| `OPENAI_API_KEY`   | Yes      | Must have billing credits                    |
| `OPENAI_MODEL`     | No       | Live conversation model. Default: `gpt-4.1-mini` (fastest to first token) |
| `EXTRACTION_MODEL` | No       | Post-call extraction model. Default: `gpt-4.1` |
| `WHISPER_MODEL`    | No       | Post-call STT. Default: `gpt-4o-transcribe`  |
| `PERSONA_NAME`     | No       | Receptionist's name. Default: `Maya`         |
| `USE_CONVERSATION_RELAY` | No | `true` (default) = streaming ElevenLabs voice; `false` = Polly webhooks |
| `RELAY_VOICE`      | No       | ElevenLabs voice ID. Default: Amelia (British female) |
| `RELAY_SPEECH_MODEL` | No     | Deepgram model for relay STT. Default: `nova-3-general` |
| `TTS_VOICE`        | No       | Webhook-mode voice. Default: `Polly.Amy-Generative` |
| `TTS_LANGUAGE`     | No       | Default: `en-GB`                             |
| `SPEECH_MODEL`     | No       | Webhook-mode live STT. Default: `deepgram_nova-2` |
| `SPEECH_TIMEOUT`   | No       | Silence (s) ending an utterance. Default: `2` |
| `SPEECH_HINTS`     | No       | Extra comma-separated vocabulary hints        |
| `RECORD_CALLS`     | No       | Default: `true`. Greeting discloses recording; check consent rules for your jurisdiction |
| `RECORDING_WAIT_MS`| No       | Wait for the recording before extracting/emailing. Default: `25000` |
| `ADMIN_API_KEY`    | Prod     | Bearer token for `/api/calls/*`. Admin API is disabled in prod without it |
| `SMTP_HOST`        | No       | Default: `smtp.gmail.com`                    |
| `SMTP_PORT`        | No       | Default: `587`                               |
| `SMTP_USER`        | Yes      | Your Gmail address                           |
| `SMTP_PASS`        | Yes      | Gmail App Password (16 chars, no spaces)     |
| `EMAIL_FROM_NAME`  | No       | Default: `AI Receptionist`                   |
| `BUSINESS_EMAIL`   | Yes      | Where call summaries are sent                |
| `DATABASE_URL`     | Yes      | PostgreSQL connection string                 |
| `COMPANY_NAME`     | No       | Default: `The Company`                       |
| `COMPANY_TIMEZONE` | No       | Default: `UTC`                               |
| `SLACK_WEBHOOK_URL`| No       | Slack notifications (optional)               |
| `ALERT_SMS_NUMBER` | No       | SMS alert for urgent calls (optional)        |

---

## Production Deployment

### Build

```bash
npm run build
npm start
```

### Checklist

- [ ] `NODE_ENV=production`
- [ ] `BASE_URL` is a real HTTPS domain (not ngrok)
- [ ] Twilio account is upgraded (not trial)
- [ ] OpenAI API has billing credits
- [ ] Run `npm run db:migrate` after deploy
- [ ] Twilio webhooks updated to production URL via `npx ts-node scripts/setup-twilio.ts`
- [ ] `ADMIN_API_KEY` set to a long random string

---

## Folder Structure

```
src/
├── index.ts                      # Express app + startup
├── config/index.ts               # Zod-validated env config
├── types/index.ts                # TypeScript types
├── lib/
│   ├── db.ts                     # Prisma singleton
│   ├── logger.ts                 # Winston logger
│   ├── sentinel.ts               # Strips [END_CALL] from the token stream
│   ├── dtmf.ts                   # Keypad digit buffering
│   ├── urgency.ts                # Normalises model output onto the urgency enum
│   └── html.ts                   # HTML escaping for emails
├── services/
│   ├── conversation.service.ts   # In-memory call session state
│   ├── ai.service.ts             # GPT-4o conversation (JSON + streaming) + extraction
│   ├── twilio.service.ts         # TwiML builders (Gather + ConversationRelay), recording
│   ├── relay.service.ts          # ConversationRelay WebSocket session handling
│   ├── transcription.service.ts  # Post-call audio transcription (gpt-4o-transcribe)
│   ├── call.service.ts           # Post-call orchestration + recording enhancement
│   ├── email.service.ts          # Gmail SMTP emails
│   └── slack.service.ts          # Slack alerts (optional)
└── api/
    ├── middleware/index.ts
    └── routes/
        ├── webhooks.ts            # Twilio webhook handlers
        └── calls.ts               # Admin REST API
prisma/
└── schema.prisma                  # Call + ConversationTurn models
tests/                             # vitest unit tests (npm test)
scripts/
├── setup-twilio.ts                # Wire Twilio webhooks automatically
├── print-twiml.ts                 # Print the TwiML for an incoming call
├── test-call.ts                   # Make a real outbound test call
└── test-flow.ts                   # Simulate a call locally (no Twilio)
```
