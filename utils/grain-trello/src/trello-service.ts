import {
  assertTrelloOrgs,
  client as trelloClient,
  getClient,
} from '@aultfarms/trello';
import {
  grain,
  type GrainBoard,
} from '@aultfarms/trucking';

export type TrelloOrganization = {
  id: string;
  name: string;
  displayName: string;
};

export type TrelloRequestValue = string | number | boolean | undefined;
export type TrelloRequestParameters = Record<string, TrelloRequestValue>;

export interface GrainClient {
  request(
    method: 'get' | 'put' | 'post' | 'delete',
    path: string,
    parameters: TrelloRequestParameters,
  ): Promise<unknown>;
  connect(options: { org?: string }): Promise<void>;
}

export type LoadGrainBoard = (options: {
  client: GrainClient;
  force: true;
}) => Promise<GrainBoard>;

export interface GrainTrelloService {
  listOrganizations(): Promise<TrelloOrganization[]>;
  loadBoard(organization: TrelloOrganization): Promise<GrainBoard>;
}

export function createGrainTrelloService(
  client: GrainClient = getClient(),
  loadGrainBoard: LoadGrainBoard = defaultLoadGrainBoard,
): GrainTrelloService {
  return {
    async listOrganizations(): Promise<TrelloOrganization[]> {
      const response = await client.request('get', '/members/me/organizations', {
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
    },

    async loadBoard(organization: TrelloOrganization): Promise<GrainBoard> {
      await client.connect({ org: organization.displayName });
      return loadGrainBoard({ client, force: true });
    },
  };
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

const defaultLoadGrainBoard: LoadGrainBoard = options => grain.grainBoard({
  client: options.client as trelloClient.Client,
  force: options.force,
});
