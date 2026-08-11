import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrelloCard } from '@aultfarms/trello';
import {
  cardsOlderThan,
  parseCalendarDate,
  validateCards,
} from '../cards.js';

test('parseCalendarDate normalizes valid dates and rejects impossible dates', () => {
  assert.deepEqual(parseCalendarDate('2024-2-29'), {
    iso: '2024-02-29',
    ordinal: 20_240_229,
    year: 2024,
    month: 2,
    day: 29,
  });
  assert.equal(parseCalendarDate('2023-02-29'), undefined);
  assert.equal(parseCalendarDate('2024-13-01'), undefined);
  assert.equal(parseCalendarDate('24-01-01'), undefined);
});

test('validateCards uses the Treatments parser and validates the parsed calendar date', () => {
  const result = validateCards('Treatments', [
    card('valid', '2024-02-29: LA200: RED12 BLUE3'),
    card('bad-format', '2024-2-29: LA200: RED12'),
    card('bad-date', '2023-02-29: LA200: RED12'),
  ]);

  assert.deepEqual(result.valid.map(entry => entry.card.id), [ 'valid' ]);
  assert.equal(result.valid[0]?.date.iso, '2024-02-29');
  assert.deepEqual(
    result.errors.map(error => error.card.id),
    [ 'bad-format', 'bad-date' ],
  );
  assert.match(result.errors[1]?.message ?? '', /not a real calendar date/);
});

test('validateCards accepts the established Dead format and reports invalid cards', () => {
  const result = validateCards('Dead', [
    card('valid', '2024-2-29: RED12'),
    card('bad-date', '2023-2-29: RED12'),
    card('bad-format', 'RED12 died'),
  ]);

  assert.deepEqual(result.valid.map(entry => entry.card.id), [ 'valid' ]);
  assert.equal(result.valid[0]?.date.iso, '2024-02-29');
  assert.deepEqual(
    result.errors.map(error => error.card.id),
    [ 'bad-date', 'bad-format' ],
  );
});

test('cardsOlderThan excludes the cutoff day and sorts by card-title date then position', () => {
  const result = validateCards('Treatments', [
    card('cutoff', '2024-01-01: LA200: RED12', 1),
    card('later-position', '2023-12-31: LA200: RED12', 20),
    card('earlier-position', '2023-12-31: LA200: BLUE3', 10),
    card('oldest', '2022-05-01: LA200: GREEN7', 30),
  ]);
  const cutoff = parseCalendarDate('2024-01-01');
  assert.ok(cutoff);

  assert.deepEqual(
    cardsOlderThan(result.valid, cutoff).map(entry => entry.card.id),
    [ 'oldest', 'earlier-position', 'later-position' ],
  );
});

function card(id: string, name: string, pos = 1): TrelloCard {
  return {
    id,
    idList: 'list',
    idBoard: 'board',
    name,
    pos,
    closed: false,
    dateLastActivity: '2024-01-01T00:00:00.000Z',
    desc: '',
    labels: [],
  };
}
