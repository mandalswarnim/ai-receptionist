/**
 * Builds a DEMO business for a pub from your research notes: the notes go to
 * the LLM, the extracted profile is printed for review, and it's saved once
 * you confirm. Re-running for the same pub updates its demo.
 *
 * Usage:
 *   npm run demo:new -- "<pub name>" "<research notes>"
 *   npm run demo:new -- "<pub name>" notes.txt        (notes from a file)
 *   npm run demo:new -- --from-sheet "<pub name>"     (from its Prospects row)
 *
 * Options:
 *   --yes         save without asking
 *   --activate    also make it the active demo on the running server
 *                 (BASE_URL, needs ADMIN_API_KEY)
 *   --persona X   receptionist name (default PERSONA_NAME)
 */

import { existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline/promises';
import { config } from '../src/config';
import { db } from '../src/lib/db';
import { buildDemoDraft, DemoDraft, prospectNotes, saveDemo, slugify } from '../src/services/demo-builder.service';
import { getSheets } from '../src/services/sheets.service';
import { buildGreeting } from '../src/services/ai.service';

interface Args {
  pubName: string;
  /** null with --from-sheet: read from the Prospects row. */
  notes: string | null;
  yes: boolean;
  activate: boolean;
  persona: string;
}

function usage(): never {
  console.error(
    'Usage: npm run demo:new -- "<pub name>" "<research notes | notes file>" [--yes] [--activate] [--persona Name]\n' +
      '       npm run demo:new -- --from-sheet "<pub name>" [--yes] [--activate] [--persona Name]'
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let yes = false;
  let activate = false;
  let persona = config.PERSONA_NAME;
  let fromSheet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--activate') activate = true;
    else if (arg === '--from-sheet') fromSheet = true;
    else if (arg === '--persona') persona = argv[++i] ?? usage();
    else if (arg.startsWith('--')) usage();
    else positional.push(arg);
  }
  const [pubName, notesArg] = positional;
  if (!pubName?.trim()) usage();
  if (fromSheet) return { pubName: pubName.trim(), notes: null, yes, activate, persona };
  if (!notesArg?.trim()) usage();
  const notes = existsSync(notesArg) ? readFileSync(notesArg, 'utf8') : notesArg;
  return { pubName: pubName.trim(), notes, yes, activate, persona };
}

function printDraft(pubName: string, slug: string, persona: string, draft: DemoDraft): void {
  const show = (label: string, value: string | null) => console.log(`  ${label.padEnd(14)} ${value ?? '—'}`);
  console.log(`\n${pubName}  (slug "${slug}", DEMO)\n`);
  show('Receptionist', persona);
  show('Hours', draft.openingHours);
  show('Address', draft.address);
  show('Booking via', draft.bookingSystem);
  show('Booking notes', draft.bookingInstructions);
  show('Food & drink', draft.menuNotes);
  console.log(`  FAQs`);
  if (draft.faqs.length === 0) console.log('    —');
  for (const f of draft.faqs) console.log(`    Q: ${f.q}\n    A: ${f.a}`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** The active demo lives in the server's memory, so it's set through its API. */
async function activate(slug: string): Promise<void> {
  const curl = `curl -X POST ${config.BASE_URL}/api/demo/active -H "Authorization: Bearer $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{"slug":"${slug}"}'`;
  if (!config.ADMIN_API_KEY) {
    console.log(`\nADMIN_API_KEY isn't set, so it can't be activated from here. Once it is:\n  ${curl}`);
    return;
  }
  try {
    const res = await fetch(`${config.BASE_URL}/api/demo/active`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.ADMIN_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    const body = (await res.json()) as { active?: { expiresAt: string }; answers?: string; warning?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    const until = new Date(body.active!.expiresAt).toLocaleTimeString('en-GB', { timeZone: config.COMPANY_TIMEZONE });
    console.log(`\nActive until ${until}: answers ${body.answers}. Ring ${config.TWILIO_PHONE_NUMBER} to hear it.`);
    if (body.warning) console.log(`Warning: ${body.warning}`);
  } catch (err) {
    console.log(`\nCouldn't activate it on ${config.BASE_URL} (${(err as Error).message}). Is the server running? Or run:\n  ${curl}`);
  }
}

/** The prospect's research, using the pub name exactly as the sheet spells it. */
async function fromSheet(pubName: string): Promise<{ pubName: string; notes: string } | null> {
  const sheets = getSheets();
  if (!sheets) {
    console.error('Google Sheets sync is off: set GOOGLE_SHEETS_ID and GOOGLE_SERVICE_ACCOUNT_JSON (see README).');
    return null;
  }
  const prospects = await sheets.getProspects();
  const prospect = prospects.find((p) => p.pubName.toLowerCase() === pubName.toLowerCase());
  if (!prospect) {
    console.error(`No "${pubName}" in the Prospects tab.`);
    if (prospects.length) console.error(`Pubs in the sheet: ${prospects.map((p) => p.pubName).join(', ')}`);
    return null;
  }
  const notes = prospectNotes(prospect);
  if (!notes) {
    console.error(`"${prospect.pubName}" has no research notes, address or booking system in the sheet yet.`);
    return null;
  }
  return { pubName: prospect.pubName, notes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.notes === null) {
    const prospect = await fromSheet(args.pubName);
    if (!prospect) {
      process.exitCode = 1;
      return;
    }
    Object.assign(args, prospect);
  }
  const slug = slugify(args.pubName);
  if (!slug) usage();

  const existing = await db.business.findUnique({ where: { slug } });
  if (existing?.mode === 'LIVE') {
    console.error(`"${slug}" is a LIVE business. Pick a different pub name rather than overwrite a real customer.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Reading the notes for ${args.pubName}...`);
  const draft = await buildDemoDraft(args.pubName, args.notes!);
  printDraft(args.pubName, slug, args.persona, draft);

  const data = { name: args.pubName, personaName: args.persona, ...draft };
  console.log(`\n  Greeting       "${buildGreeting({ ...data, id: null, slug, mode: 'DEMO', greeting: null, notifyEmail: null, calendlyEventType: null })}"`);

  const verb = existing ? 'Update the existing demo' : 'Save this demo';
  if (!args.yes && !(await confirm(`\n${verb}? [y/N] `))) {
    console.log('Not saved.');
    return;
  }

  await saveDemo(args.pubName, args.persona, draft);
  console.log(`${existing ? 'Updated' : 'Saved'} "${slug}".`);

  if (args.activate) await activate(slug);
  else console.log(`To make it the active demo, re-run with --activate or POST /api/demo/active {"slug":"${slug}"}.`);
}

main()
  .catch((err) => {
    console.error('Failed to build the demo:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
