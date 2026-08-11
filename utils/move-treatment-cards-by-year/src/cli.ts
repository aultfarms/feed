import * as prompts from '@clack/prompts';
import {
  CARD_LIST_NAMES,
  calendarDateFromDate,
  cardsOlderThan,
  validateCards,
  type CardListName,
  type CardValidationResult,
} from './cards.js';
import {
  createTrelloApi,
  describeDestinationChanges,
  ensureDestination,
  errorMessage,
  inspectDestination,
  listOrganizations,
  loadSourceLivestockBoard,
  moveCards,
  type TrelloApi,
  type TrelloOrganization,
} from './trello-service.js';

class PromptCancelledError extends Error {}

export async function runCli(api: TrelloApi = createTrelloApi()): Promise<number> {
  prompts.intro('Archive old Livestock cards');

  try {
    const organizations = await withSpinner(
      'Connecting to Trello and loading organizations',
      'Connected to Trello',
      () => listOrganizations(api),
    );
    if (organizations.length < 2) {
      throw new Error('At least two Trello organizations are required to move cards.');
    }

    const sourceOrganization = await chooseOrganization(
      organizations,
      'Which organization should cards be moved from?',
    );
    const source = await withSpinner(
      `Loading ${sourceOrganization.displayName} / Livestock`,
      `Loaded ${sourceOrganization.displayName} / Livestock`,
      () => loadSourceLivestockBoard(api, sourceOrganization),
    );

    const validation: Record<CardListName, CardValidationResult> = {
      Treatments: validateCards('Treatments', source.cards.Treatments),
      Dead: validateCards('Dead', source.cards.Dead),
    };
    reportValidation(validation);

    const listName = await chooseSourceList(validation);
    if (!listName) {
      const hasMalformedCards = CARD_LIST_NAMES.some(
        name => validation[name].errors.length > 0,
      );
      prompts.outro(
        hasMalformedCards
          ? 'Fix the malformed cards before moving from their lists.'
          : 'There are no open cards to move.',
      );
      return hasMalformedCards ? 1 : 0;
    }

    const cutoffInput = unwrapPrompt(await prompts.date({
      message: `Move ${listName} cards dated before which cutoff?`,
      format: 'YMD',
      initialValue: new Date(new Date().getFullYear(), 0, 1),
    }));
    const cutoff = calendarDateFromDate(cutoffInput);
    const cardsToMove = cardsOlderThan(validation[listName].valid, cutoff);
    if (cardsToMove.length === 0) {
      prompts.outro(`No ${listName} cards are older than ${cutoff.iso}; nothing was changed.`);
      return 0;
    }

    const destinationOrganizations = organizations.filter(
      organization => organization.id !== sourceOrganization.id,
    );
    const destinationOrganization = await chooseOrganization(
      destinationOrganizations,
      `Which organization should receive the ${listName} cards?`,
    );
    const destinationPlan = await withSpinner(
      `Checking ${destinationOrganization.displayName} / Livestock`,
      `Checked ${destinationOrganization.displayName} / Livestock`,
      () => inspectDestination(api, destinationOrganization, listName),
    );

    const oldest = cardsToMove[0]!;
    const newest = cardsToMove[cardsToMove.length - 1]!;
    prompts.note([
      `Source: ${sourceOrganization.displayName} / Livestock / ${listName}`,
      `Destination: ${destinationOrganization.displayName} / Livestock / ${listName}`,
      `Cutoff: card-title dates strictly before ${cutoff.iso}`,
      `Cards: ${cardsToMove.length} (${oldest.date.iso} through ${newest.date.iso})`,
      `Destination setup: ${describeDestinationChanges(destinationPlan)}`,
      'Cards already moved before an interruption will remain in the destination.',
    ].join('\n'), 'Review this move');

    const confirmed = unwrapPrompt(await prompts.confirm({
      message: `Move ${cardsToMove.length} ${listName} card${cardsToMove.length === 1 ? '' : 's'}?`,
      initialValue: false,
    }));
    if (!confirmed) {
      prompts.cancel('Move cancelled; nothing was changed.');
      return 0;
    }

    const destination = await withSpinner(
      'Preparing the destination board and list',
      'Destination is ready',
      () => ensureDestination(api, destinationOrganization, listName),
    );

    const progress = prompts.progress({ max: cardsToMove.length, style: 'heavy' });
    progress.start(`Moving ${listName} cards`);
    const result = await moveCards(api, cardsToMove, destination, {
      shouldStop: () => progress.isCancelled,
      onRetry: (card, attempt, retryDelayMs) => {
        progress.message(
          `Retrying ${card.card.name} (attempt ${attempt}) in ${retryDelayMs / 1_000}s`,
        );
      },
      onProgress: current => {
        progress.advance(
          1,
          `${current.moved ? 'Moved' : 'Failed'} ${current.attempted}/${current.total}: `
          + current.card.card.name,
        );
      },
    });

    if (result.cancelled) {
      if (!progress.isCancelled) progress.cancel('Move interrupted');
    } else if (result.failed.length > 0) {
      progress.error('Move completed with failures');
    } else {
      progress.stop(`Moved all ${result.moved.length} cards`);
    }

    for (const failure of result.failed) {
      prompts.log.error(
        `${failure.card.card.name} (${failure.card.card.id}): ${errorMessage(failure.error)}`,
      );
    }

    if (result.cancelled || result.failed.length > 0) {
      prompts.note([
        `Moved: ${result.moved.length}`,
        `Failed: ${result.failed.length}`,
        `Not attempted: ${result.remaining.length}`,
        'Run the utility again after resolving any errors; moving a card is idempotent.',
      ].join('\n'), 'Partial move summary');
      if (result.cancelled) {
        prompts.cancel('Move interrupted. Cards already moved were not rolled back.');
        return 130;
      }
      prompts.outro('Some cards could not be moved.');
      return 1;
    }

    prompts.outro(
      `Moved ${result.moved.length} ${listName} card${result.moved.length === 1 ? '' : 's'} `
      + `to ${destinationOrganization.displayName}.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      prompts.cancel('Move cancelled; nothing was changed.');
      return 0;
    }

    prompts.log.error(errorMessage(error));
    prompts.outro('Stopped because of an error.');
    return 1;
  }
}

async function chooseOrganization(
  organizations: TrelloOrganization[],
  message: string,
): Promise<TrelloOrganization> {
  const organizationId = unwrapPrompt(await prompts.autocomplete({
    message,
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

function reportValidation(
  validation: Record<CardListName, CardValidationResult>,
): void {
  for (const listName of CARD_LIST_NAMES) {
    const result = validation[listName];
    if (result.errors.length === 0) {
      prompts.log.success(
        `${listName}: ${result.valid.length} open card${result.valid.length === 1 ? '' : 's'} valid`,
      );
      continue;
    }

    prompts.log.error(
      `${listName}: ${result.errors.length} malformed card${result.errors.length === 1 ? '' : 's'} `
      + '(this list cannot be moved)',
    );
    for (const error of result.errors) {
      prompts.log.error(
        `"${error.card.name}" (${error.card.id})\n${error.message}`,
      );
    }
  }
}

async function chooseSourceList(
  validation: Record<CardListName, CardValidationResult>,
): Promise<CardListName | undefined> {
  const available = CARD_LIST_NAMES.filter(listName => {
    const result = validation[listName];
    return result.errors.length === 0 && result.valid.length > 0;
  });
  if (available.length === 0) return undefined;

  return unwrapPrompt(await prompts.select<CardListName>({
    message: 'Which list should be archived?',
    options: [
      sourceListOption('Treatments', validation.Treatments),
      sourceListOption('Dead', validation.Dead),
    ],
  }));
}

function sourceListOption<T extends CardListName>(
  listName: T,
  result: CardValidationResult,
): {
  value: T;
  label: string;
  hint: string | undefined;
  disabled: boolean;
} {
  const hint = result.errors.length > 0
    ? `${result.errors.length} malformed card${result.errors.length === 1 ? '' : 's'}`
    : result.valid.length === 0
      ? 'No open cards'
      : undefined;
  return {
    value: listName,
    label: `${listName} (${result.valid.length} valid open card`
      + `${result.valid.length === 1 ? '' : 's'})`,
    hint,
    disabled: hint !== undefined,
  };
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
