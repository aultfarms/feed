import assert from 'node:assert/strict';
import test from 'node:test';
import type { GrainBoard } from '@aultfarms/trucking';
import {
  createGrainTrelloService,
  type GrainClient,
  type LoadGrainBoard,
  type TrelloRequestParameters,
} from '../trello-service.js';

type ApiMethod = Parameters<GrainClient['request']>[0];

type ApiCall = {
  method: ApiMethod;
  path: string;
  parameters: TrelloRequestParameters;
};

class FakeClient implements GrainClient {
  readonly calls: ApiCall[] = [];
  readonly connections: Array<{ org?: string }> = [];

  constructor(private readonly response: unknown) {}

  async request(
    method: ApiMethod,
    path: string,
    parameters: TrelloRequestParameters,
  ): Promise<unknown> {
    this.calls.push({ method, path, parameters });
    return this.response;
  }

  async connect(options: { org?: string }): Promise<void> {
    this.connections.push(options);
  }
}

test('listOrganizations normalizes missing display names and sorts choices', async () => {
  const client = new FakeClient([
    { id: '2', name: 'zulu', displayName: 'Zulu Farms' },
    { id: '1', name: 'alpha' },
  ]);
  const service = createGrainTrelloService(client, async () => emptyBoard());

  assert.deepEqual(await service.listOrganizations(), [
    { id: '1', name: 'alpha', displayName: 'alpha' },
    { id: '2', name: 'zulu', displayName: 'Zulu Farms' },
  ]);
  assert.deepEqual(client.calls, [
    {
      method: 'get',
      path: '/members/me/organizations',
      parameters: { fields: 'id,name,displayName' },
    },
  ]);
});

test('loadBoard connects to the selected organization and forces a fresh grain load', async () => {
  const client = new FakeClient([]);
  const calls: Parameters<LoadGrainBoard>[0][] = [];
  const expectedBoard = emptyBoard();
  const loader: LoadGrainBoard = async options => {
    calls.push(options);
    return expectedBoard;
  };
  const service = createGrainTrelloService(client, loader);
  const organization = {
    id: 'org',
    name: 'ault-farms',
    displayName: 'Ault Farms',
  };

  assert.equal(await service.loadBoard(organization), expectedBoard);
  assert.deepEqual(client.connections, [ { org: 'Ault Farms' } ]);
  assert.equal(calls[0]?.client, client);
  assert.equal(calls[0]?.force, true);
});

test('loadBoard propagates connection and grain-library errors', async () => {
  const client = new FakeClient([]);
  const service = createGrainTrelloService(client, async () => {
    throw new Error('Could not load Grain Hauling');
  });

  await assert.rejects(
    service.loadBoard({ id: 'org', name: 'org', displayName: 'Org' }),
    /Could not load Grain Hauling/,
  );
});

function emptyBoard(): GrainBoard {
  return {
    sellerLists: [],
    webControls: {
      idList: 'controls',
      settings: {
        drivers: [],
        destinations: [],
        crops: [],
      },
    },
    errors: [],
  };
}
