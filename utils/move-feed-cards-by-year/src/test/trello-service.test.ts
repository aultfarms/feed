import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrelloBoard, TrelloCard, TrelloList } from '@aultfarms/trello';
import { parseCalendarDate, type DatedCard } from '../cards.js';
import {
  ensureDestination,
  inspectDestination,
  listOrganizations,
  loadSourceFeedBoard,
  moveCards,
  type TrelloApi,
  type TrelloRequestParameters,
} from '../trello-service.js';

type ApiMethod = Parameters<TrelloApi['request']>[0];

type ApiCall = {
  method: ApiMethod;
  path: string;
  parameters: TrelloRequestParameters;
};

class FakeApi implements TrelloApi {
  readonly calls: ApiCall[] = [];

  constructor(
    private readonly handler: (call: ApiCall) => unknown | Promise<unknown>,
  ) {}

  async request(
    method: ApiMethod,
    path: string,
    parameters: TrelloRequestParameters,
  ): Promise<unknown> {
    const call = { method, path, parameters };
    this.calls.push(call);
    return this.handler(call);
  }
}

const sourceOrganization = {
  id: 'source-org',
  name: 'source-slug',
  displayName: 'Source Org',
};

const destinationOrganization = {
  id: 'destination-org',
  name: 'destination-slug',
  displayName: 'Destination Org',
};

test('listOrganizations normalizes display names and sorts choices', async () => {
  const api = new FakeApi(() => [
    { id: '2', name: 'zulu', displayName: 'Zulu Farms' },
    { id: '1', name: 'alpha' },
  ]);

  assert.deepEqual(await listOrganizations(api), [
    { id: '1', name: 'alpha', displayName: 'alpha' },
    { id: '2', name: 'zulu', displayName: 'Zulu Farms' },
  ]);
});

test('loadSourceFeedBoard resolves Feed Delivered and fetches its cards', async () => {
  const deliveredCard = card('delivered-card', 'delivered');
  const api = new FakeApi(call => {
    if (call.path === '/organizations/source-org/boards') return [ board('board') ];
    if (call.path === '/boards/board/lists/open') {
      return [ list('delivered', 'Feed Delivered') ];
    }
    if (call.path === '/lists/delivered/cards') return [ deliveredCard ];
    throw new Error(`Unexpected request: ${call.method} ${call.path}`);
  });

  const result = await loadSourceFeedBoard(api, sourceOrganization);

  assert.equal(result.board.id, 'board');
  assert.equal(result.list.id, 'delivered');
  assert.deepEqual(result.cards, [ deliveredCard ]);
});

test('inspectDestination rejects ambiguous duplicate Feed boards', async () => {
  const api = new FakeApi(() => [
    board('first'),
    board('second'),
  ]);

  await assert.rejects(
    inspectDestination(api, destinationOrganization),
    /Found 2 open "Feed" boards/,
  );
});

test('ensureDestination creates a board without default lists and creates only Feed Delivered', async () => {
  const api = new FakeApi(call => {
    if (call.method === 'get') return [];
    if (call.path === '/boards') return board('created-board');
    if (call.path === '/lists') return list('created-list', 'Feed Delivered', 'created-board');
    throw new Error(`Unexpected request: ${call.method} ${call.path}`);
  });

  const result = await ensureDestination(api, destinationOrganization);

  assert.deepEqual(result, {
    board: board('created-board'),
    list: list('created-list', 'Feed Delivered', 'created-board'),
  });
  assert.deepEqual(api.calls[1], {
    method: 'post',
    path: '/boards',
    parameters: {
      name: 'Feed',
      idOrganization: 'destination-org',
      defaultLists: false,
    },
  });
  assert.deepEqual(api.calls[2], {
    method: 'post',
    path: '/lists',
    parameters: {
      name: 'Feed Delivered',
      idBoard: 'created-board',
      pos: 'bottom',
    },
  });
});

test('moveCards retries transient errors, paces requests, and reports permanent failures', async () => {
  const attempts = new Map<string, number>();
  const api = new FakeApi(call => {
    const count = (attempts.get(call.path) ?? 0) + 1;
    attempts.set(call.path, count);

    if (call.path === '/cards/retry' && count === 1) {
      throw Object.assign(new Error('temporary server error'), {
        response: { statusCode: 500 },
      });
    }
    if (call.path === '/cards/fail') {
      throw Object.assign(new Error('invalid destination'), {
        response: { statusCode: 400 },
      });
    }
    return {};
  });
  const sleeps: number[] = [];
  const retries: Array<{ id: string; attempt: number; delayMs: number }> = [];
  const progress: Array<{ id: string; moved: boolean }> = [];

  const result = await moveCards(
    api,
    [ datedCard('retry'), datedCard('fail'), datedCard('success') ],
    {
      board: board('destination-board'),
      list: list('destination-list', 'Feed Delivered', 'destination-board'),
    },
    {
      sleep: async milliseconds => {
        sleeps.push(milliseconds);
      },
      onRetry: (entry, attempt, delayMs) => {
        retries.push({ id: entry.card.id, attempt, delayMs });
      },
      onProgress: current => {
        progress.push({ id: current.card.card.id, moved: current.moved });
      },
    },
  );

  assert.deepEqual(result.moved.map(entry => entry.card.id), [ 'retry', 'success' ]);
  assert.deepEqual(result.failed.map(entry => entry.card.card.id), [ 'fail' ]);
  assert.deepEqual(result.remaining, []);
  assert.equal(result.cancelled, false);
  assert.deepEqual(sleeps, [ 1_000, 200, 200 ]);
  assert.deepEqual(retries, [ { id: 'retry', attempt: 2, delayMs: 1_000 } ]);
  assert.deepEqual(progress, [
    { id: 'retry', moved: true },
    { id: 'fail', moved: false },
    { id: 'success', moved: true },
  ]);
  assert.deepEqual(api.calls[0]?.parameters, {
    idBoard: 'destination-board',
    idList: 'destination-list',
    pos: 'bottom',
  });
});

test('moveCards stops cleanly between requests when cancellation is requested', async () => {
  const api = new FakeApi(() => ({}));
  const entries = [ datedCard('first'), datedCard('second'), datedCard('third') ];

  const result = await moveCards(
    api,
    entries,
    {
      board: board('destination-board'),
      list: list('destination-list', 'Feed Delivered', 'destination-board'),
    },
    {
      sleep: async () => undefined,
      shouldStop: () => api.calls.length >= 1,
    },
  );

  assert.deepEqual(result.moved.map(entry => entry.card.id), [ 'first' ]);
  assert.deepEqual(result.remaining.map(entry => entry.card.id), [ 'second', 'third' ]);
  assert.equal(result.cancelled, true);
  assert.equal(api.calls.length, 1);
});

function board(id: string): TrelloBoard {
  return { id, name: 'Feed' };
}

function list(id: string, name: string, idBoard = 'board'): TrelloList {
  return { id, idBoard, name, pos: 1 };
}

function card(id: string, name: string): TrelloCard {
  return {
    id,
    idList: 'list',
    idBoard: 'board',
    name,
    pos: 1,
    closed: false,
    dateLastActivity: '2024-01-01T00:00:00.000Z',
    desc: '',
    labels: [],
  };
}

function datedCard(id: string): DatedCard {
  const date = parseCalendarDate('2020-01-01');
  assert.ok(date);
  return {
    card: card(id, `2020-01-01: CIE 1.  12,345 lbs - DEST - ${id}`),
    date,
  };
}
