import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config', () => ({ config: { COMPANY_TIMEZONE: 'Europe/London' } }));
vi.mock('../src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  columnLetter,
  createSheetsService,
  isOnDoNotCall,
  normalizeUkPhone,
  REQUIRED_HEADERS,
  SheetsClient,
} from '../src/services/sheets.service';

/** An in-memory spreadsheet that behaves like the Sheets API for our two calls. */
class FakeSheet implements SheetsClient {
  tabs: Record<string, string[][]> = {};
  writes: Array<{ range: string; value: unknown }> = [];

  async getValues(range: string): Promise<string[][]> {
    const tab = range.match(/^'(.+)'!/)![1]!.replace(/''/g, "'");
    if (!this.tabs[tab]) throw new Error(`Unable to parse range: ${range}`);
    // The API trims trailing empty rows
    const rows = this.tabs[tab]!.map((r) => [...r]);
    while (rows.length && rows[rows.length - 1]!.every((c) => !c)) rows.pop();
    return rows;
  }

  async updateCells(data: Array<{ range: string; value: string | number | boolean }>): Promise<void> {
    for (const { range, value } of data) {
      this.writes.push({ range, value });
      const [, tab, col, row] = range.match(/^'(.+)'!([A-Z]+)(\d+)$/)!;
      const c = col!.charCodeAt(0) - 65;
      const grid = this.tabs[tab!]!;
      const r = Number(row) - 1;
      while (grid.length <= r) grid.push([]);
      grid[r]![c] = String(value).toUpperCase() === 'TRUE' ? 'TRUE' : String(value);
    }
  }
}

let sheet: FakeSheet;
let svc: ReturnType<typeof createSheetsService>;

beforeEach(() => {
  sheet = new FakeSheet();
  sheet.tabs = {
    Prospects: [
      REQUIRED_HEADERS.Prospects,
      ['Example: The Crown (delete this row)', 'Islington', '1 Example St', '020 7946 0000', '', 'Sam', 'Landlord', 'ResDiary', 'notes', '', 'Not called', '', '0'],
      ['The Swan', 'Marlow', '2 High St', '01628 000000', '', '', '', 'phone only', 'Dogs welcome', '', 'Not called', '', '=COUNTIF(...)'],
    ],
    // Checkboxes filled down every row, as in the real sheet
    'Call Log': [
      REQUIRED_HEADERS['Call Log'],
      ['', '', '', '', 'FALSE', 'FALSE'],
      ['', '', '', '', 'FALSE', 'FALSE'],
      ['', '', '', '', 'FALSE', 'FALSE'],
    ],
    'Do Not Call': [REQUIRED_HEADERS['Do Not Call'], ['The Bell', '+44 1628 111111', '2026-10-01', 'Not interested', 'Phone']],
  };
  svc = createSheetsService(sheet);
});

describe('getProspects', () => {
  it('skips the template example row and reads columns by header', async () => {
    const prospects = await svc.getProspects();
    expect(prospects).toHaveLength(1);
    expect(prospects[0]).toMatchObject({ row: 3, pubName: 'The Swan', area: 'Marlow', bookingSystem: 'phone only' });
  });

  it('still works when the columns are rearranged', async () => {
    const [headers, , swan] = sheet.tabs['Prospects']!;
    const order = [...headers!.keys()].reverse();
    sheet.tabs['Prospects'] = [order.map((i) => headers![i]!), order.map((i) => swan![i] ?? '')];
    expect((await svc.getProspects())[0]).toMatchObject({ pubName: 'The Swan', researchNotes: 'Dogs welcome' });
  });

  it('names the missing column when a header is renamed', async () => {
    sheet.tabs['Prospects']![0] = REQUIRED_HEADERS.Prospects.map((h) => (h === 'Pub name' ? 'Name' : h));
    await expect(svc.getProspects()).rejects.toThrow('Sheet "Prospects" has no "Pub name" column');
  });

  it('finds a prospect by name, ignoring case', async () => {
    expect((await svc.findProspect('the swan'))?.row).toBe(3);
  });
});

describe('appendCallLog', () => {
  it('fills the first empty row, not the bottom of the checkbox-filled tab', async () => {
    const row = await svc.appendCallLog({
      date: new Date('2026-10-13T13:05:00Z'),
      pubName: 'The Swan',
      aiDemoUsed: true,
      notes: 'AI demo: booked a table for 4.',
    });

    expect(row).toBe(2);
    expect(sheet.writes).toEqual([
      { range: "'Call Log'!A2", value: '2026-10-13' },
      { range: "'Call Log'!B2", value: 'The Swan' },
      { range: "'Call Log'!C2", value: '14:05' },
      { range: "'Call Log'!F2", value: true },
      { range: "'Call Log'!L2", value: 'AI demo: booked a table for 4.' },
    ]);
  });

  it('never touches cells it was not given (e.g. Reached decision maker)', async () => {
    await svc.appendCallLog({ date: new Date(), pubName: 'The Swan', aiDemoUsed: true });
    expect(sheet.writes.some((w) => w.range.startsWith("'Call Log'!E"))).toBe(false);
  });

  it('gives two calls ending together different rows', async () => {
    const [a, b] = await Promise.all([
      svc.appendCallLog({ date: new Date(), pubName: 'The Swan' }),
      svc.appendCallLog({ date: new Date(), pubName: 'The Bell' }),
    ]);
    expect([a, b]).toEqual([2, 3]);
  });

  it('adds below the last row once the tab is full', async () => {
    sheet.tabs['Call Log'] = [REQUIRED_HEADERS['Call Log'], ['2026-10-01', 'The Bell', '10:00']];
    expect(await svc.appendCallLog({ date: new Date(), pubName: 'The Swan' })).toBe(3);
  });
});

describe('updateProspectStatus', () => {
  it('writes only Status and Next action date, never the Times called formula', async () => {
    await svc.updateProspectStatus('The Swan', 'Callback', new Date('2026-10-20T09:00:00Z'));
    expect(sheet.writes).toEqual([
      { range: "'Prospects'!K3", value: 'Callback' },
      { range: "'Prospects'!L3", value: '2026-10-20' },
    ]);
    expect(sheet.tabs['Prospects']![2]![12]).toBe('=COUNTIF(...)');
  });

  it('refuses an unknown pub or status', async () => {
    await expect(svc.updateProspectStatus('The Nowhere', 'Lead')).rejects.toThrow('No prospect called');
    // @ts-expect-error — not one of the sheet's dropdown values
    await expect(svc.updateProspectStatus('The Swan', 'Maybe')).rejects.toThrow('Unknown prospect status');
    expect(sheet.writes).toEqual([]);
  });
});

describe('do not call', () => {
  it('reads the list', async () => {
    expect(await svc.getDoNotCall()).toEqual([
      { pubName: 'The Bell', phone: '+44 1628 111111', dateAdded: '2026-10-01', reason: 'Not interested', howTheyAsked: 'Phone' },
    ]);
  });

  it('matches numbers however they are written', async () => {
    const list = await svc.getDoNotCall();
    expect(isOnDoNotCall('01628 111111', list)).toBe(true);
    expect(isOnDoNotCall('+441628111111', list)).toBe(true);
    expect(isOnDoNotCall('01628 222222', list)).toBe(false);
    expect(isOnDoNotCall('', list)).toBe(false);
  });

  it('normalises UK numbers', () => {
    expect(normalizeUkPhone('+44 (0)20 7946 0000')).toBe('02079460000');
    expect(normalizeUkPhone('+44 20 7946 0000')).toBe('02079460000');
    expect(normalizeUkPhone('020 7946 0000')).toBe('02079460000');
  });
});

describe('checkLayout', () => {
  it('reports every tab as complete for the real layout', async () => {
    expect(await svc.checkLayout()).toEqual([
      { tab: 'Prospects', missing: [] },
      { tab: 'Call Log', missing: [] },
      { tab: 'Do Not Call', missing: [] },
    ]);
  });
});

it('columnLetter', () => {
  expect([0, 11, 25, 26, 27].map(columnLetter)).toEqual(['A', 'L', 'Z', 'AA', 'AB']);
});
