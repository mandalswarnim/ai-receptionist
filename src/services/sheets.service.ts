/**
 * Google Sheets sync for the sales pipeline (spreadsheet layout in CLAUDE.md).
 *
 * Columns are found by their header in row 1, never by letter, so the sheet
 * can be rearranged. Writes touch only the cells they set: checkboxes,
 * formulas (Times called) and the user's own rows are left alone.
 *
 * Off unless GOOGLE_SHEETS_ID and GOOGLE_SERVICE_ACCOUNT_JSON are both set.
 */

import { auth, sheets as sheetsApi } from '@googleapis/sheets';
import { config } from '../config';
import { logger } from '../lib/logger';

// ─── Sheet vocabulary (must match the sheet exactly) ─────────────────────────

export const TABS = {
  prospects: 'Prospects',
  callLog: 'Call Log',
  doNotCall: 'Do Not Call',
} as const;

export const PROSPECT_STATUSES = [
  'Not called',
  'Calling',
  'Callback',
  'Demo done',
  'Lead',
  'Not interested',
  'Do not call',
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const CALL_OUTCOMES = [
  'No answer',
  'Gatekeeper',
  'Call back later',
  'Interested',
  'Not interested',
  'Asked not to be called',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Headers the app reads or writes, per tab. Other columns are ignored. */
export const REQUIRED_HEADERS: Record<(typeof TABS)[keyof typeof TABS], string[]> = {
  Prospects: [
    'Pub name', 'Area', 'Address', 'Phone', 'Website', 'Contact name', 'Contact role',
    'Booking system', 'Research notes', 'Best time to call', 'Status', 'Next action date', 'Times called',
  ],
  'Call Log': [
    'Date', 'Pub name', 'Time', 'Spoke to', 'Reached decision maker', 'AI demo used', 'Outcome',
    'Demo reaction (1–5)', 'Main objection', 'Next step', 'Follow-up date', 'Notes',
  ],
  'Do Not Call': ['Pub name', 'Phone', 'Date added', 'Reason', 'How they asked'],
};

export interface Prospect {
  /** 1-based sheet row, for updates. */
  row: number;
  pubName: string;
  area: string;
  address: string;
  phone: string;
  website: string;
  contactName: string;
  contactRole: string;
  bookingSystem: string;
  researchNotes: string;
  bestTimeToCall: string;
  status: string;
  nextActionDate: string;
  timesCalled: string;
}

export interface DoNotCallEntry {
  pubName: string;
  phone: string;
  dateAdded: string;
  reason: string;
  howTheyAsked: string;
}

export interface CallLogEntry {
  date: Date;
  pubName: string;
  spokeTo?: string;
  reachedDecisionMaker?: boolean;
  aiDemoUsed?: boolean;
  outcome?: CallOutcome;
  demoReaction?: number;
  mainObjection?: string;
  nextStep?: string;
  followUpDate?: Date;
  notes?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/** The two Sheets calls we use; a fake in tests. */
export interface SheetsClient {
  getValues(range: string): Promise<string[][]>;
  /** Writes each range (USER_ENTERED, so dates and checkboxes are typed). */
  updateCells(data: Array<{ range: string; value: string | number | boolean }>): Promise<void>;
}

function googleClient(spreadsheetId: string, keyBase64: string): SheetsClient {
  const credentials = JSON.parse(Buffer.from(keyBase64, 'base64').toString('utf8')) as Record<string, string>;
  const api = sheetsApi({
    version: 'v4',
    auth: new auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
  });
  return {
    async getValues(range) {
      const res = await api.spreadsheets.values.get({ spreadsheetId, range });
      return (res.data.values ?? []).map((row) => row.map((cell) => String(cell ?? '')));
    },
    async updateCells(data) {
      await api.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: data.map(({ range, value }) => ({ range, values: [[value]] })),
        },
      });
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const cell = (s: string | undefined) => (s ?? '').trim();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Comparable form of a UK phone number: "+44 20 7946 0000", "+44 (0)20 7946 0000",
 * "020 7946 0000" and "02079460000" all become "02079460000".
 */
export function normalizeUkPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits.startsWith('44')) return digits;
  // "+44 (0)20 ..." keeps its trunk 0 after the country code
  const national = digits.slice(2);
  return national.startsWith('0') ? national : `0${national}`;
}

export function isOnDoNotCall(phone: string, list: DoNotCallEntry[]): boolean {
  const target = normalizeUkPhone(phone);
  return !!target && list.some((entry) => normalizeUkPhone(entry.phone) === target);
}

/** ISO date and 24h time in the business timezone; USER_ENTERED makes them real dates. */
function sheetDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.COMPANY_TIMEZONE }).format(date);
}
function sheetTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.COMPANY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

interface Table {
  tab: string;
  headers: string[];
  rows: string[][];
  col(header: string): number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export function createSheetsService(client: SheetsClient) {
  // Writes go one at a time: two calls ending together must not both pick
  // the same empty row.
  let writeQueue: Promise<unknown> = Promise.resolve();
  const serialise = <T>(task: () => Promise<T>): Promise<T> => {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
  };

  async function readTable(tab: string): Promise<Table> {
    const [headerRow = [], ...rows] = await client.getValues(`${quote(tab)}!A1:ZZ`);
    const headers = headerRow.map(cell);
    return {
      tab,
      headers,
      rows,
      col(header) {
        const i = headers.indexOf(header);
        if (i === -1) throw new Error(`Sheet "${tab}" has no "${header}" column (row 1 headers: ${headers.join(', ')})`);
        return i;
      },
    };
  }

  /**
   * Row number (1-based) of the first row after the header whose key columns
   * are all empty. Tabs with checkboxes filled down have "FALSE" in every row,
   * so the Sheets "append" call would add rows at the very bottom instead.
   */
  function firstEmptyRow(table: Table, keyHeaders: string[]): number {
    const keys = keyHeaders.map((h) => table.col(h));
    const i = table.rows.findIndex((row) => keys.every((k) => !cell(row[k])));
    return (i === -1 ? table.rows.length : i) + 2;
  }

  /** Writes the given header -> value cells into one row. */
  async function writeRow(table: Table, row: number, values: Record<string, string | number | boolean>) {
    await client.updateCells(
      Object.entries(values).map(([header, value]) => ({
        range: `${quote(table.tab)}!${columnLetter(table.col(header))}${row}`,
        value,
      }))
    );
  }

  /** Prospects with a pub name, skipping the template's example row. */
  async function getProspects(): Promise<Prospect[]> {
    const t = await readTable(TABS.prospects);
    const get = (row: string[], header: string) => cell(row[t.col(header)]);
    return t.rows
      .map((row, i) => ({
        row: i + 2,
        pubName: get(row, 'Pub name'),
        area: get(row, 'Area'),
        address: get(row, 'Address'),
        phone: get(row, 'Phone'),
        website: get(row, 'Website'),
        contactName: get(row, 'Contact name'),
        contactRole: get(row, 'Contact role'),
        bookingSystem: get(row, 'Booking system'),
        researchNotes: get(row, 'Research notes'),
        bestTimeToCall: get(row, 'Best time to call'),
        status: get(row, 'Status'),
        nextActionDate: get(row, 'Next action date'),
        timesCalled: get(row, 'Times called'),
      }))
      .filter((p) => p.pubName && !/^example\b/i.test(p.pubName));
  }

  return {
    getProspects,

    /** Read-only check that every tab exists and has the headers the app uses. */
    async checkLayout(): Promise<Array<{ tab: string; missing: string[] }>> {
      const results = [];
      for (const [tab, headers] of Object.entries(REQUIRED_HEADERS)) {
        const t = await readTable(tab);
        results.push({ tab, missing: headers.filter((h) => !t.headers.includes(h)) });
      }
      return results;
    },

    async findProspect(pubName: string): Promise<Prospect | undefined> {
      return (await getProspects()).find((p) => sameName(p.pubName, pubName));
    },

    async getDoNotCall(): Promise<DoNotCallEntry[]> {
      const t = await readTable(TABS.doNotCall);
      const get = (row: string[], header: string) => cell(row[t.col(header)]);
      return t.rows
        .map((row) => ({
          pubName: get(row, 'Pub name'),
          phone: get(row, 'Phone'),
          dateAdded: get(row, 'Date added'),
          reason: get(row, 'Reason'),
          howTheyAsked: get(row, 'How they asked'),
        }))
        .filter((e) => e.pubName || e.phone);
    },

    /** Adds a Call Log row; returns its row number. Unset fields are left blank. */
    appendCallLog(entry: CallLogEntry): Promise<number> {
      return serialise(async () => {
        const t = await readTable(TABS.callLog);
        const row = firstEmptyRow(t, ['Date', 'Pub name']);
        const values: Record<string, string | number | boolean> = {
          Date: sheetDate(entry.date),
          'Pub name': entry.pubName,
          Time: sheetTime(entry.date),
        };
        if (entry.spokeTo) values['Spoke to'] = entry.spokeTo;
        if (entry.reachedDecisionMaker !== undefined) values['Reached decision maker'] = entry.reachedDecisionMaker;
        if (entry.aiDemoUsed !== undefined) values['AI demo used'] = entry.aiDemoUsed;
        if (entry.outcome) values['Outcome'] = entry.outcome;
        if (entry.demoReaction !== undefined) values['Demo reaction (1–5)'] = entry.demoReaction;
        if (entry.mainObjection) values['Main objection'] = entry.mainObjection;
        if (entry.nextStep) values['Next step'] = entry.nextStep;
        if (entry.followUpDate) values['Follow-up date'] = sheetDate(entry.followUpDate);
        if (entry.notes) values['Notes'] = entry.notes;
        await writeRow(t, row, values);
        return row;
      });
    },

    /** Adds a number to Do Not Call. */
    appendDoNotCall(entry: { pubName: string; phone: string; date: Date; reason?: string; howTheyAsked?: string }) {
      return serialise(async () => {
        const t = await readTable(TABS.doNotCall);
        const row = firstEmptyRow(t, ['Pub name', 'Phone']);
        const values: Record<string, string> = {
          'Pub name': entry.pubName,
          // Leading apostrophe keeps "01628..." as text instead of a number
          Phone: `'${entry.phone}`,
          'Date added': sheetDate(entry.date),
        };
        if (entry.reason) values['Reason'] = entry.reason;
        if (entry.howTheyAsked) values['How they asked'] = entry.howTheyAsked;
        await writeRow(t, row, values);
        return row;
      });
    },

    /** Sets a prospect's Status (and Next action date, when given). */
    updateProspectStatus(pubName: string, status: ProspectStatus, nextActionDate?: Date): Promise<void> {
      return serialise(async () => {
        if (!PROSPECT_STATUSES.includes(status)) throw new Error(`Unknown prospect status "${status}"`);
        const t = await readTable(TABS.prospects);
        const nameCol = t.col('Pub name');
        const i = t.rows.findIndex((row) => sameName(cell(row[nameCol]), pubName));
        if (i === -1) throw new Error(`No prospect called "${pubName}" in the ${TABS.prospects} tab`);
        const values: Record<string, string> = { Status: status };
        if (nextActionDate) values['Next action date'] = sheetDate(nextActionDate);
        await writeRow(t, i + 2, values);
      });
    },
  };
}

export type SheetsService = ReturnType<typeof createSheetsService>;

let service: SheetsService | null | undefined;

/** The configured Sheets service, or null when the sync is off. */
export function getSheets(): SheetsService | null {
  if (service !== undefined) return service;
  if (!config.GOOGLE_SHEETS_ID || !config.GOOGLE_SERVICE_ACCOUNT_JSON) {
    service = null;
    return service;
  }
  try {
    service = createSheetsService(googleClient(config.GOOGLE_SHEETS_ID, config.GOOGLE_SERVICE_ACCOUNT_JSON));
  } catch (err) {
    // A malformed key must not take calls down with it
    logger.error('Google Sheets sync disabled: GOOGLE_SERVICE_ACCOUNT_JSON is not valid base64 JSON', {
      message: (err as Error).message,
    });
    service = null;
  }
  return service;
}
