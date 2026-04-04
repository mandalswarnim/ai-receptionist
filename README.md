# AI Receptionist

A production-ready AI phone receptionist that handles missed calls, collects caller information, and emails a structured summary to your team.

## How It Works

```
Incoming Call → Ring Receptionist (15-25s)
                     │
          ┌──────────┴──────────┐
     Answered                Not Answered
          │                        │
   Transfer & exit           AI takes over
                                   │
                        Greet → Collect Info
                        → Confirm → Goodbye
                                   │
                     Transcribe → Extract Data
                                   │
                     Email + Slack + SMS (urgent)
```

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Telephony   | Twilio (calls, recording, TTS)      |
| STT         | OpenAI Whisper                      |
| AI/LLM      | OpenAI GPT-4o                       |
| Backend     | Node.js + TypeScript + Express      |
| Database    | PostgreSQL via Prisma               |
| Email       | SendGrid                            |
| Alerts      | Slack Webhooks + Twilio SMS         |

---

## Setup

### 1. Prerequisites

- Node.js 20+
- PostgreSQL database
- Twilio account with a phone number
- OpenAI API key
- SendGrid account

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all required values.

### 4. Set up the database

```bash
npm run db:generate
npm run db:migrate
```

### 5. Start the server

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build && npm start
```

### 6. Expose publicly (development)

Twilio needs a public URL to send webhooks. Use ngrok:

```bash
ngrok http 3000
```

Copy the `https://xxxxx.ngrok.io` URL into your `.env` as `BASE_URL`.

### 7. Configure Twilio webhooks

```bash
npx ts-node scripts/setup-twilio.ts
```

This sets your Twilio phone number's voice URL to point at your server.

---

## API Endpoints

### Twilio Webhooks (called by Twilio)

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| POST   | `/api/webhooks/incoming-call`     | New incoming call                  |
| POST   | `/api/webhooks/dial-status`       | Receptionist dial result           |
| POST   | `/api/webhooks/gather`            | Caller speech input                |
| POST   | `/api/webhooks/recording`         | Call recording ready               |
| POST   | `/api/webhooks/call-status`       | Final call status                  |

### Admin API

| Method | Path                      | Description                          |
|--------|---------------------------|--------------------------------------|
| GET    | `/api/calls`              | List all calls (paginated)           |
| GET    | `/api/calls?search=james` | Search by name/phone/email/company   |
| GET    | `/api/calls?urgency=urgent` | Filter by urgency                  |
| GET    | `/api/calls/:id`          | Get call details + transcript turns  |
| GET    | `/api/calls/:id/transcript` | Get full transcript               |
| DELETE | `/api/calls/:id`          | Delete a call record                 |
| GET    | `/api/calls/stats`        | Summary statistics                   |
| GET    | `/api/calls/health`       | Health check + active call count     |

### Example responses

**GET /api/calls**
```json
{
  "data": [
    {
      "id": "uuid",
      "callSid": "CA...",
      "callerName": "James Wilson",
      "callerCompany": "Apex Solutions",
      "callerPhone": "0207 123 4567",
      "urgency": "HIGH",
      "summary": "James Wilson from Apex Solutions called to discuss a partnership...",
      "duration": 142,
      "emailSent": true,
      "startedAt": "2026-04-04T10:32:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 47, "pages": 3 }
}
```

**GET /api/calls/stats**
```json
{
  "total": 47,
  "byStatus": { "COMPLETED": 44, "FAILED": 2, "IN_PROGRESS": 1 },
  "byUrgency": { "LOW": 12, "MEDIUM": 22, "HIGH": 8, "URGENT": 3 },
  "avgDurationSeconds": 98,
  "activeCalls": 0
}
```

---

## Testing

### Simulate a full call (no Twilio required)

```bash
npx ts-node scripts/test-flow.ts
```

This runs a simulated conversation through the AI and prints the transcript, extracted data, and email content.

### Test with a real call

1. Start your server with ngrok running
2. Call your Twilio number
3. Let it ring (don't answer) until the AI picks up
4. Speak naturally — give your name, reason for calling, etc.
5. Check your email and the `/api/calls` endpoint

---

## Environment Variables

| Variable                  | Required | Description                                      |
|---------------------------|----------|--------------------------------------------------|
| `PORT`                    | No       | Server port (default: 3000)                      |
| `NODE_ENV`                | No       | `development` or `production`                    |
| `BASE_URL`                | Yes      | Public HTTPS URL for Twilio webhooks             |
| `TWILIO_ACCOUNT_SID`      | Yes      | Twilio Account SID (starts with AC)              |
| `TWILIO_AUTH_TOKEN`       | Yes      | Twilio Auth Token                                |
| `TWILIO_PHONE_NUMBER`     | Yes      | Your Twilio number in E.164 format               |
| `RECEPTIONIST_PHONE_NUMBER` | Yes    | Human receptionist's number                      |
| `DIAL_TIMEOUT_SECONDS`    | No       | Seconds to ring before AI takes over (default 20)|
| `OPENAI_API_KEY`          | Yes      | OpenAI API key                                   |
| `OPENAI_MODEL`            | No       | GPT model (default: gpt-4o)                      |
| `WHISPER_MODEL`           | No       | Whisper model (default: whisper-1)               |
| `SENDGRID_API_KEY`        | Yes      | SendGrid API key                                 |
| `EMAIL_FROM`              | Yes      | Sender email address                             |
| `RECEPTIONIST_EMAIL`      | Yes      | Where to send call summaries                     |
| `DATABASE_URL`            | Yes      | PostgreSQL connection URL                        |
| `COMPANY_NAME`            | No       | Your company name (used in AI greeting)          |
| `COMPANY_TIMEZONE`        | No       | Timezone for timestamps (default: UTC)           |
| `SLACK_WEBHOOK_URL`       | No       | Slack incoming webhook URL                       |
| `ALERT_SMS_NUMBER`        | No       | Number to SMS for urgent calls                   |

---

## Production Deployment

### Docker (recommended)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY prisma ./prisma
RUN npx prisma generate
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Build:
```bash
npm run build
docker build -t ai-receptionist .
```

### Environment checklist

- [ ] `NODE_ENV=production`
- [ ] `BASE_URL` is your real HTTPS domain (not ngrok)
- [ ] Twilio webhooks updated to production URL
- [ ] Database migrations run: `npm run db:migrate`
- [ ] Logs directory exists and is writable
- [ ] SendGrid sender verified

---

## Architecture Notes

- **Conversation state** is held in-memory (a `Map` keyed by `callSid`). For multi-instance deployments, replace with Redis.
- **Recording transcription** uses OpenAI Whisper on the MP3 from Twilio. If the recording isn't ready yet, the system falls back to the turn-by-turn conversation log.
- **Post-call processing** runs asynchronously (`setImmediate`) so it never blocks the TwiML response back to Twilio.
- **Twilio signature validation** is enforced in production. In development it's skipped (safe since ngrok URLs are ephemeral).
