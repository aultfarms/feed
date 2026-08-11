import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBushels,
  renderReport,
} from '../report.js';
import type { GrainTotalsReport } from '../totals.js';

test('renderReport shows monthly rows, crop totals, and the overall list summary', () => {
  const output = renderReport({
    lists: [
      {
        idList: 'first',
        name: 'Seller A - Buyer A',
        deliveries: 2,
        crops: [
          {
            crop: 'CORN',
            monthly: [
              { month: '2023-12', deliveries: 1, bushels: 500 },
              { month: '2024-01', deliveries: 1, bushels: 734.5678 },
            ],
            deliveries: 2,
            bushels: 1_234.5678,
          },
        ],
      },
    ],
    totalDeliveries: 2,
  });

  assert.match(output, /Seller A - Buyer A — CORN/);
  assert.match(output, /Month/);
  assert.ok(output.indexOf('2023-12') < output.indexOf('2024-01'));
  assert.match(output, /Total/);
  assert.match(output, /1,234\.568/);
  assert.match(output, /Overall totals/);
  assert.match(output, /Seller \/ buyer list/);
});

test('renderReport explicitly includes empty lists and an empty board', () => {
  const oneEmptyList = renderReport({
    lists: [
      {
        idList: 'empty',
        name: 'Empty Seller - Empty Buyer',
        crops: [],
        deliveries: 0,
      },
    ],
    totalDeliveries: 0,
  });
  assert.match(oneEmptyList, /Empty Seller - Empty Buyer\nNo deliveries\./);
  assert.match(oneEmptyList, /0\.00/);

  const emptyBoard: GrainTotalsReport = {
    lists: [],
    totalDeliveries: 0,
  };
  const noLists = renderReport(emptyBoard);
  assert.match(noLists, /No seller\/buyer lists were found\./);
  assert.match(noLists, /No lists/);
});

test('formatBushels uses grouped digits and two to three decimal places', () => {
  assert.equal(formatBushels(1000), '1,000.00');
  assert.equal(formatBushels(1000.5), '1,000.50');
  assert.equal(formatBushels(1000.5678), '1,000.568');
});
