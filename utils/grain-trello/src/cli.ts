import * as prompts from '@clack/prompts';
import { renderReport } from './report.js';
import {
  errorMessage,
  createGrainTrelloService,
  type GrainTrelloService,
  type TrelloOrganization,
} from './trello-service.js';
import { buildGrainTotals } from './totals.js';

class PromptCancelledError extends Error {}

export async function runCli(
  service: GrainTrelloService = createGrainTrelloService(),
): Promise<number> {
  prompts.intro('Grain Hauling totals');

  try {
    const organizations = await withSpinner(
      'Connecting to Trello and loading organizations',
      'Connected to Trello',
      () => service.listOrganizations(),
    );
    if (organizations.length === 0) {
      throw new Error('No Trello organizations are available to this account.');
    }

    const organization = await chooseOrganization(organizations);
    const board = await withSpinner(
      `Loading ${organization.displayName} / Grain Hauling`,
      `Loaded ${organization.displayName} / Grain Hauling`,
      () => service.loadBoard(organization),
    );

    const result = buildGrainTotals(board);
    if (!result.report) {
      for (const error of result.errors) prompts.log.error(error);
      prompts.outro('Totals were withheld because malformed cards would make the report incomplete.');
      return 1;
    }

    prompts.log.message(renderReport(result.report));

    const listCount = result.report.lists.length;
    const deliveryCount = result.report.totalDeliveries;
    prompts.outro(
      `Reported ${deliveryCount} deliver${deliveryCount === 1 ? 'y' : 'ies'} `
      + `across ${listCount} seller/buyer list${listCount === 1 ? '' : 's'}.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      prompts.cancel('Report cancelled; nothing was changed.');
      return 0;
    }

    prompts.log.error(errorMessage(error));
    prompts.outro('Stopped because of an error.');
    return 1;
  }
}

async function chooseOrganization(
  organizations: TrelloOrganization[],
): Promise<TrelloOrganization> {
  if (organizations.length === 1) {
    const organization = organizations[0]!;
    prompts.log.info(`Using ${organization.displayName}.`);
    return organization;
  }

  const organizationId = unwrapPrompt(await prompts.autocomplete({
    message: 'Which organization contains the Grain Hauling board?',
    placeholder: 'Type to filter organizations',
    maxItems: 10,
    options: organizations.map(organization => ({
      value: organization.id,
      label: organization.displayName,
      hint: organization.name === organization.displayName ? undefined : organization.name,
    })),
  }));
  const organization = organizations.find(candidate => candidate.id === organizationId);
  if (!organization) throw new Error('The selected organization is no longer available.');
  return organization;
}

async function withSpinner<T>(
  startMessage: string,
  successMessage: string,
  operation: () => Promise<T>,
): Promise<T> {
  const spinner = prompts.spinner();
  spinner.start(startMessage);
  try {
    const result = await operation();
    spinner.stop(successMessage);
    return result;
  } catch (error) {
    spinner.error(errorMessage(error));
    throw error;
  }
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (prompts.isCancel(value)) throw new PromptCancelledError();
  return value;
}
