import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GrainBoard,
  GrainRecord,
  GrainSellerList,
} from '@aultfarms/trucking';
import {
  buildGrainTotals,
  parseGrainDate,
} from '../totals.js';

test('parseGrainDate normalizes valid dates and rejects impossible dates', () => {
  assert.deepEqual(parseGrainDate('2024-2-29'), {
    iso: '2024-02-29',
    month: '2024-02',
    ordinal: 20_240_229,
  });
  assert.equal(parseGrainDate('2023-02-29'), undefined);
  assert.equal(parseGrainDate('2024-13-01'), undefined);
  assert.equal(parseGrainDate('24-01-01'), undefined);
});

test('buildGrainTotals preserves list order and separates crops and chronological months', () => {
  const result = buildGrainTotals(board([
    sellerList('first', 'Seller A - Buyer A', [
      record({ date: '2024-02-20', bushels: 100.125, crop: 'CORN' }),
      record({ date: '2024-01-10', bushels: 75.25, crop: 'BEANS', ticket: 'B-1' }),
      record({ date: '2023-12-31', bushels: 50.5, crop: 'CORN', ticket: 'C-2' }),
      record({ date: '2024-02-01', bushels: 25.375, crop: 'CORN', ticket: 'C-3' }),
    ]),
    sellerList('second', 'Seller B - Buyer B', []),
  ]));

  assert.deepEqual(result.errors, []);
  assert.ok(result.report);
  assert.equal(result.report.totalDeliveries, 4);
  assert.deepEqual(
    result.report.lists.map(list => list.name),
    [ 'Seller A - Buyer A', 'Seller B - Buyer B' ],
  );

  const first = result.report.lists[0];
  assert.ok(first);
  assert.equal(first.deliveries, 4);
  assert.deepEqual(first.crops.map(crop => crop.crop), [ 'BEANS', 'CORN' ]);

  const corn = first.crops[1];
  assert.ok(corn);
  assert.deepEqual(corn.monthly, [
    { month: '2023-12', deliveries: 1, bushels: 50.5 },
    { month: '2024-02', deliveries: 2, bushels: 125.5 },
  ]);
  assert.equal(corn.deliveries, 3);
  assert.equal(corn.bushels, 176);

  assert.deepEqual(result.report.lists[1]?.crops, []);
  assert.equal(result.report.lists[1]?.deliveries, 0);
});

test('buildGrainTotals withholds the report and describes every invalid record', () => {
  const invalid = record({
    date: '2023-02-29',
    bushels: Number.NaN,
    crop: '',
    dest: '',
    ticket: '',
    driver: '',
    cardName: 'bad card',
  });
  const result = buildGrainTotals(board([
    sellerList('list', 'Seller - Buyer', [ invalid ]),
  ], [ 'A different card did not match the main pattern' ]));

  assert.equal(result.report, undefined);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0] ?? '', /Grain parser: A different card/);
  assert.match(result.errors[1] ?? '', /Card "bad card" in list "Seller - Buyer"/);
  assert.match(result.errors[1] ?? '', /not a real calendar date/);
  assert.match(result.errors[1] ?? '', /finite positive number/);
  assert.match(result.errors[1] ?? '', /crop is missing/);
  assert.match(result.errors[1] ?? '', /destination is missing/);
  assert.match(result.errors[1] ?? '', /ticket is missing/);
  assert.match(result.errors[1] ?? '', /driver is missing/);
});

function board(sellerLists: GrainSellerList[], errors: string[] = []): GrainBoard {
  return {
    sellerLists,
    webControls: {
      idList: 'controls',
      settings: {
        drivers: [],
        destinations: [],
        crops: [],
      },
    },
    errors,
  };
}

function sellerList(
  idList: string,
  name: string,
  records: GrainRecord[],
): GrainSellerList {
  return { idList, name, records };
}

function record(overrides: Partial<GrainRecord> = {}): GrainRecord {
  return {
    date: '2024-02-01',
    sellerList: {
      name: 'Seller A - Buyer A',
      idList: 'first',
    },
    dest: 'Buyer A',
    bushels: 100,
    ticket: 'C-1',
    crop: 'CORN',
    driver: 'Driver',
    id: 'card',
    idList: 'first',
    cardName: 'valid card',
    dateLastActivity: '2024-02-01T00:00:00.000Z',
    ...overrides,
  };
}
