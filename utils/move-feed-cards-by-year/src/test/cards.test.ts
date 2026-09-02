import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrelloCard } from '@aultfarms/trello';
import {
  cardsOlderThan,
  parseCalendarDate,
  validateCards,
} from '../cards.js';

function feedName(
  date: string,
  extras: { source?: string; loadNumber?: string; weight?: string; dest?: string; driver?: string } = {},
): string {
  const source = extras.source ?? 'CIE';
  const loadNumber = extras.loadNumber ?? '1';
  const weight = extras.weight ?? '12,345';
  const dest = extras.dest ?? 'DEST';
  const driver = extras.driver ?? 'driver';
  return `${date}: ${source} ${loadNumber}.  ${weight} lbs - ${dest} - ${driver}`;
}

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

test('validateCards uses the Feed Delivered parser and validates the parsed calendar date', () => {
  const result = validateCards([
    card('valid', feedName('2024-02-29')),
    card('bad-format', feedName('2024-2-29')),
    card('bad-date', feedName('2023-02-29')),
  ]);

  assert.deepEqual(result.valid.map(entry => entry.card.id), [ 'valid' ]);
  assert.equal(result.valid[0]?.date.iso, '2024-02-29');
  assert.deepEqual(
    result.errors.map(error => error.card.id),
    [ 'bad-format', 'bad-date' ],
  );
  assert.match(result.errors[1]?.message ?? '', /not a real calendar date/);
});

test('validateCards reports cards that are not feed delivered titles', () => {
  const result = validateCards([
    card('valid', feedName('2024-02-29')),
    card('bad-format', 'RED12 died'),
  ]);

  assert.deepEqual(result.valid.map(entry => entry.card.id), [ 'valid' ]);
  assert.deepEqual(result.errors.map(error => error.card.id), [ 'bad-format' ]);
  assert.match(result.errors[0]?.message ?? '', /Unable to parse feed delivered card/);
});

test('cardsOlderThan excludes the cutoff day and sorts by card-title date then position', () => {
  const result = validateCards([
    card('cutoff', feedName('2024-01-01'), 1),
    card('later-position', feedName('2023-12-31'), 20),
    card('earlier-position', feedName('2023-12-31', { loadNumber: '2' }), 10),
    card('oldest', feedName('2022-05-01'), 30),
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
