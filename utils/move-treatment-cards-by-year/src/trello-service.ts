import {
  assertTrelloBoard,
  assertTrelloBoards,
  assertTrelloCards,
  assertTrelloList,
  assertTrelloLists,
  assertTrelloOrgs,
  getClient,
  type TrelloBoard,
  type TrelloCard,
  type TrelloList,
} from '@aultfarms/trello';
import type { CardListName, DatedCard } from './cards.js';

export type TrelloOrganization = {
  id: string;
  name: string;
  displayName: string;
};

export type TrelloRequestValue = string | number | boolean | undefined;
export type TrelloRequestParameters = Record<string, TrelloRequestValue>;

export interface TrelloApi {
  request(
    method: 'get' | 'put' | 'post' | 'delete',
    path: string,
    parameters: TrelloRequestParameters,
  ): Promise<unknown>;
}

export type SourceLivestockBoard = {
  board: TrelloBoard;
  lists: Record<CardListName, TrelloList>;
  cards: Record<CardListName, TrelloCard[]>;
};

export type DestinationPlan = {
  organization: TrelloOrganization;
  listName: CardListName;
  board?: TrelloBoard;
  list?: TrelloList;
  createBoard: boolean;
  createList: boolean;
};

export type MoveFailure = {
  card: DatedCard;
  error: unknown;
};

export type MoveProgress = {
  attempted: number;
  total: number;
  card: DatedCard;
  moved: boolean;
};

export type MoveResult = {
  moved: DatedCard[];
  failed: MoveFailure[];
  remaining: DatedCard[];
  cancelled: boolean;
};

type MoveOptions = {
  requestDelayMs?: number;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  shouldStop?: () => boolean;
  onProgress?: (progress: MoveProgress) => void;
  onRetry?: (card: DatedCard, attempt: number, delayMs: number) => void;
};

const DEFAULT_REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_ATTEMPTS = 4;

export function createTrelloApi(): TrelloApi {
  const client = getClient();
  const request = client.request as unknown as TrelloApi['request'];
  return {
    request: (method, path, parameters) => request(method, path, parameters),
  };
}

export async function listOrganizations(api: TrelloApi): Promise<TrelloOrganization[]> {
  const response = await api.request('get', '/members/me/organizations', {
    fields: 'id,name,displayName',
  });
  assertTrelloOrgs(response);

  return response
    .map(organization => ({
      id: organization.id,
      name: organization.name,
      displayName: typeof organization.displayName === 'string'
        ? organization.displayName
        : organization.name,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function loadSourceLivestockBoard(
  api: TrelloApi,
  organization: TrelloOrganization,
): Promise<SourceLivestockBoard> {
  const boards = await listOpenBoards(api, organization.id);
  const board = findUniqueNamedResource(boards, 'Livestock', 'board', organization.displayName);
  if (!board) {
    throw new Error(`No open "Livestock" board exists in ${organization.displayName}.`);
  }

  const openLists = await listOpenLists(api, board.id);
  const treatments = findUniqueNamedResource(
    openLists,
    'Treatments',
    'list',
    `${organization.displayName} / Livestock`,
  );
  const dead = findUniqueNamedResource(
    openLists,
    'Dead',
    'list',
    `${organization.displayName} / Livestock`,
  );

  if (!treatments || !dead) {
    const missing = [
      treatments ? undefined : 'Treatments',
      dead ? undefined : 'Dead',
    ].filter((name): name is CardListName => name !== undefined);
    throw new Error(
      `Missing required ${missing.map(name => `"${name}"`).join(' and ')} list`
      + `${missing.length === 1 ? '' : 's'} in ${organization.displayName} / Livestock.`,
    );
  }

  const [ treatmentCards, deadCards ] = await Promise.all([
    listOpenCards(api, treatments.id),
    listOpenCards(api, dead.id),
  ]);

  return {
    board,
    lists: {
      Treatments: treatments,
      Dead: dead,
    },
    cards: {
      Treatments: treatmentCards,
      Dead: deadCards,
    },
  };
}

export async function inspectDestination(
  api: TrelloApi,
  organization: TrelloOrganization,
  listName: CardListName,
): Promise<DestinationPlan> {
  const boards = await listOpenBoards(api, organization.id);
  const board = findUniqueNamedResource(boards, 'Livestock', 'board', organization.displayName);
  if (!board) {
    return {
      organization,
      listName,
      createBoard: true,
      createList: true,
    };
  }

  const lists = await listOpenLists(api, board.id);
  const list = findUniqueNamedResource(
    lists,
    listName,
    'list',
    `${organization.displayName} / Livestock`,
  );
  return {
    organization,
    listName,
    board,
    list,
    createBoard: false,
    createList: !list,
  };
}

export async function ensureDestination(
  api: TrelloApi,
  organization: TrelloOrganization,
  listName: CardListName,
): Promise<{ board: TrelloBoard; list: TrelloList }> {
  const current = await inspectDestination(api, organization, listName);
  const board = current.board ?? await createLivestockBoard(api, organization.id);

  if (current.list) return { board, list: current.list };
  const list = await createList(api, board.id, listName);
  return { board, list };
}

export async function moveCards(
  api: TrelloApi,
  cards: DatedCard[],
  destination: { board: TrelloBoard; list: TrelloList },
  options: MoveOptions = {},
): Promise<MoveResult> {
  const moved: DatedCard[] = [];
  const failed: MoveFailure[] = [];
  const sleep = options.sleep ?? delay;
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (const [ index, card ] of cards.entries()) {
    if (options.shouldStop?.()) {
      return {
        moved,
        failed,
        remaining: cards.slice(index),
        cancelled: true,
      };
    }

    let didMove = false;
    try {
      await retryTransient(
        () => api.request('put', `/cards/${card.card.id}`, {
          idBoard: destination.board.id,
          idList: destination.list.id,
          pos: 'bottom',
        }),
        {
          maxAttempts,
          sleep,
          onRetry: (attempt, retryDelayMs) => {
            options.onRetry?.(card, attempt, retryDelayMs);
          },
        },
      );
      moved.push(card);
      didMove = true;
    } catch (error) {
      failed.push({ card, error });
    }

    options.onProgress?.({
      attempted: index + 1,
      total: cards.length,
      card,
      moved: didMove,
    });

    if (index < cards.length - 1 && !options.shouldStop?.()) {
      await sleep(requestDelayMs);
    }
  }

  return {
    moved,
    failed,
    remaining: [],
    cancelled: false,
  };
}

export function describeDestinationChanges(plan: DestinationPlan): string {
  if (plan.createBoard) {
    return `Create the "Livestock" board and its "${plan.listName}" list.`;
  }
  if (plan.createList) {
    return `Create the "${plan.listName}" list on the existing "Livestock" board.`;
  }
  return 'Use the existing "Livestock" board and destination list.';
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function listOpenBoards(api: TrelloApi, organizationId: string): Promise<TrelloBoard[]> {
  const response = await api.request('get', `/organizations/${organizationId}/boards`, {
    fields: 'id,name',
    filter: 'open',
  });
  assertTrelloBoards(response);
  return response;
}

async function listOpenLists(api: TrelloApi, boardId: string): Promise<TrelloList[]> {
  const response = await api.request('get', `/boards/${boardId}/lists/open`, {
    fields: 'id,name,idBoard,pos',
  });
  assertTrelloLists(response);
  return response;
}

async function listOpenCards(api: TrelloApi, listId: string): Promise<TrelloCard[]> {
  const response = await api.request('get', `/lists/${listId}/cards`, {
    fields: 'id,name,idList,idBoard,pos,closed,dateLastActivity,desc,labels',
    filter: 'open',
  });
  assertTrelloCards(response);
  return response;
}

async function createLivestockBoard(api: TrelloApi, organizationId: string): Promise<TrelloBoard> {
  const response = await api.request('post', '/boards', {
    name: 'Livestock',
    idOrganization: organizationId,
    defaultLists: false,
  });
  assertTrelloBoard(response);
  return response;
}

async function createList(
  api: TrelloApi,
  boardId: string,
  listName: CardListName,
): Promise<TrelloList> {
  const response = await api.request('post', '/lists', {
    name: listName,
    idBoard: boardId,
    pos: 'bottom',
  });
  assertTrelloList(response);
  return response;
}

function findUniqueNamedResource<T extends { name: string }>(
  resources: T[],
  name: string,
  resourceType: 'board' | 'list',
  location: string,
): T | undefined {
  const matches = resources.filter(resource => resource.name === name);
  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} open "${name}" ${resourceType}s in ${location}; `
      + 'rename or close duplicates before continuing.',
    );
  }
  return matches[0];
}

async function retryTransient<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts: number;
    sleep: (milliseconds: number) => Promise<void>;
    onRetry?: (attempt: number, delayMs: number) => void;
  },
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.maxAttempts || !isTransientError(error)) throw error;
      const retryDelayMs = 1_000 * (2 ** (attempt - 1));
      options.onRetry?.(attempt + 1, retryDelayMs);
      await options.sleep(retryDelayMs);
      attempt += 1;
    }
  }
}

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    statusCode?: unknown;
    response?: { statusCode?: unknown };
  };
  const statusCode = typeof candidate.response?.statusCode === 'number'
    ? candidate.response.statusCode
    : candidate.statusCode;
  if (typeof statusCode === 'number') {
    return statusCode === 429 || statusCode >= 500;
  }

  const retryableCodes = new Set([
    'EAI_AGAIN',
    'ECONNRESET',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);
  if (typeof candidate.code === 'string' && retryableCodes.has(candidate.code)) return true;

  return typeof candidate.message === 'string'
    && /(?:rate limit|status(?: code)? 429|\b429\b)/i.test(candidate.message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
