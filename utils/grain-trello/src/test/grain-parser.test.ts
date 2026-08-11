import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  TrelloCard,
  TrelloList,
} from '@aultfarms/trello';
import { grain } from '@aultfarms/trucking';

test('grainCardToRecord parses a driver when the card title ends after the driver', () => {
  const result = grain.grainCardToRecord(
    card('2025-10-29: 1,104.286 bu CORN.  OP Nutrition Peru - Tkt #72557 - Brock'),
    list(),
  );

  assert.ok(!('error' in result));
  assert.equal(result.date, '2025-10-29');
  assert.equal(result.bushels, 1_104.286);
  assert.equal(result.crop, 'CORN');
  assert.equal(result.dest, 'OP Nutrition Peru');
  assert.equal(result.ticket, '72557');
  assert.equal(result.driver, 'Brock');
  assert.equal(result.note, '');
});

test('grainCardToRecord treats the driver as arbitrary text', () => {
  for (const driver of [ 'Maria Lopez', 'Driver-2', 'A. J. Smith' ]) {
    const result = grain.grainCardToRecord(
      card(`2025-10-29: 1,104.286 bu CORN.  OP Nutrition Peru - Tkt #72557 - ${driver}`),
      list(),
    );

    assert.ok(!('error' in result));
    assert.equal(result.driver, driver);
    assert.equal(result.note, '');
  }
});

test('grainCardToRecord still separates a driver from a following note', () => {
  const result = grain.grainCardToRecord(
    card('2025-10-29: 1,104.286 bu CORN.  OP Nutrition Peru - Tkt #72557 - Brock.  Corrected ticket'),
    list(),
  );

  assert.ok(!('error' in result));
  assert.equal(result.driver, 'Brock');
  assert.equal(result.note, 'Corrected ticket');
});

function card(name: string): TrelloCard {
  return {
    id: 'card',
    idList: 'list',
    idBoard: 'board',
    name,
    pos: 1,
    closed: false,
    dateLastActivity: '2025-10-29T00:00:00.000Z',
    desc: '',
    labels: [],
  };
}

function list(): TrelloList {
  return {
    id: 'list',
    idBoard: 'board',
    name: 'Seller - Buyer',
    pos: 1,
  };
}
