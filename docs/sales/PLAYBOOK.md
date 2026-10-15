# Sales Playbook

How Swarnim finds, calls and converts pubs. The Google Sheet "AI Receptionist – Sales
Pipeline" is where all of this is tracked.

## The daily routine (5 calls a day)

Five calls a day is a good starting pace while the script is still changing. It works out
at about 25 dials a week. Pubs often don't answer or you get bar staff, so expect roughly
one or two real conversations with a decision maker a day. That's enough to learn fast
without burning through your area.

| When | What | Time |
|---|---|---|
| Morning or evening before | Research the next 5 pubs, fill their `Prospects` rows | 50 min (10 min each, hard cap) |
| Tue–Thu, 2:30–5:00pm | Make the 5 calls back to back | 30–45 min |
| Straight after each call | Log it in `Call Log` before dialling the next | 1–2 min |
| Friday | Review the `Dashboard`, change one thing in the script | 15 min |

Suggestions:

- **Call in one block, not spread through the day.** You get into rhythm by the third call, and
  the 2:30–5pm window is when landlords are free. Avoid 12–2pm, after 5:30pm, Friday evening and
  all weekend.
- **Count dials, judge on conversations.** "5 dials" is the input; "decision makers reached" is
  what tells you if the list and timing are right.
- **Mondays are for callbacks and research**, since many landlords take Monday off and
  Monday-afternoon calls often go to staff.
- **After 50 dials, look at the numbers** before changing anything big. Fewer than 1 in 4
  reaching a decision maker means fix timing or ask better at the gatekeeper stage. Fewer than
  half of decision makers agreeing to the demo means fix the opener.
- **Scale up only when the demo works.** Once 3+ of every 10 decision makers ask about a trial,
  go to 10 dials a day.
- Every number that says "don't call again" goes on `Do Not Call` that day. The Prospects row
  turns red so you never ring it by mistake.

## Researching a pub (10 minutes max)

Fill these `Prospects` columns:

1. **Phone, address, website**: from Google Maps or their website.
2. **Booking system**: look at the "Book a table" button. ResDiary, Collins (DesignMyNight),
   OpenTable, SevenRooms, or "phone only". Phone-only and small pubs miss the most calls.
3. **Research notes**: what the demo needs and what the opener uses.
   - Opening hours and kitchen hours
   - 3–4 menu points (Sunday roast times, dog friendly, live sport, function room)
   - Any Google review mentioning the phone: "couldn't get through", "nobody answered",
     "rang three times". Note the date. This is your best opener.
   - Group or independent. Groups have a head office; independents decide on the spot.
4. **Contact name and role** if the site or reviews show it (landlord replies to reviews are
   often signed).
5. **Best time to call**: default Tue–Thu 2:30–5pm unless their hours say otherwise.

Good targets: independent pubs with food, a busy weekend trade, phone bookings, and no
full-time front of house. Skip chains with central reservations until you have case studies.

## The call

Goal of the call: get them to hear the demo. Goal of the demo: get them to agree to a free
14-day trial. Not to explain the technology.

**1. Get to the right person**
> "Hi, is the landlord or manager about? It's Swarnim, it's about the pub's phone line, takes
> two minutes."

If they're not in: "When's the best time to catch them?" Log as `Call back later` with the
date in Follow-up date. Ask the name.

**2. Opener (to the decision maker)**
> "Hi [name], I'll be quick. I work reception at a private members' club in London, and I've
> built something for pubs that miss calls when the bar's busy. I noticed [a review mentioned
> nobody picked up / you take bookings by phone]. Can I show you in 60 seconds what your callers
> would hear instead?"

**3. Bring in the demo**
> "I'll put you through. It'll answer as [pub name]. Try booking a table for Friday, or ask it
> anything a customer would."

Add call, dial the Twilio number, merge, mute yourself. Don't talk over it.

**4. Close (while they're still on)**
> "So that's what anyone gets when you can't get to the phone, and the booking comes to you by
> email straight away. I'd like to set it up on your line for 14 days free. You just turn on
> 'forward when busy' on your phone. Shall I send the details to your email?"

Get the email. Log as `Interested`, add a `Leads` row with Stage `Trial offered`.

## Objections

| They say | You say |
|---|---|
| "We don't miss calls." | "Most places think that. Fridays at 8pm when the bar's three deep, who answers? Try it free for two weeks and the summary emails will tell you." |
| "Customers want a real person." | "So do I, which is why it only picks up when your team can't. Better than ringing out. It also tells callers it's an assistant." |
| "How much?" | "£50 to set it up, then you only pay for the calls it actually answers, by the minute. No monthly fee, and you can see every call and your bill in your own dashboard. One extra table of four on a Saturday covers a lot of minutes." (Once pilot data is in, add: "A typical pub pays about £X a month.") |
| "Send me an email." | "Will do. What's the best address? And while I've got you, can I give you 60 seconds on the demo so the email makes sense?" |
| "We use ResDiary already." | "Great, people can book online, but plenty still ring. This catches those calls and takes the booking details for you." |
| "Not interested." | "No problem. Shall I take you off my list?" If yes, add to `Do Not Call`. |

## Rules you follow on every call

- Say who you are and why you're calling within the first sentence.
- Business lines registered with the Corporate TPS (CTPS) must not be cold-called. Check before
  you add a pub to the list once volume grows; at 5 a day, ask on the call and honour any
  "we're on the TPS" immediately.
- Never withhold your number. Use a number that people can call back on.
- Only conference in the AI after they agree, and say it's an AI.
- "Don't call again" is permanent. Add to `Do Not Call` the same day.
- If you ever record a sales call, tell them first.

*Not legal advice. If volume grows past a few hundred calls a month, get a proper PECR
compliance check and a CTPS screening subscription.*

## What to log

Every dial gets a `Call Log` row, including no answers. The `Dashboard` works out reach rate,
demo rate and interest rate from those rows, so skipping "No answer" rows makes the numbers lie.
