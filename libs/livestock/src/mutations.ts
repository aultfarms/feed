import type { TrelloCard } from '@aultfarms/trello';
import type { client } from '@aultfarms/trello';
import {
  parseDeadCard,
  parseIncomingCard,
  parseTagColorsCard,
  parseTreatmentCard,
  parseTreatmentTypesCard,
  serializeDeadRecord,
  serializeTreatmentRecord,
} from './records.js';
import type {
  LivestockRecords,
  ParseResult,
  Tag,
  TreatmentRecord,
  DeadRecord,
  IncomingRecord,
  TagColors,
  TreatmentType,
} from './types.js';
import { findDuplicateDeath, sameTag } from './util.js';
import type { DuplicateDeath } from './util.js';
import type { LivestockCardSource, RecordParseOptions } from './records.js';

export type RecordKind = 'incoming' | 'treatment' | 'dead';
export type ConfigKind = 'tagColors' | 'treatmentTypes';
export type LivestockRecord = IncomingRecord | TreatmentRecord | DeadRecord;
export type LivestockConfigRecord = TagColors | TreatmentType[];
export type MutationStatus = 'created' | 'updated' | 'unchanged' | 'duplicate';

export type MutationResult<T extends LivestockRecord> = {
  status: MutationStatus;
  record: T;
  duplicate?: DuplicateDeath;
};

export type TreatmentUpsertInput = {
  date: string;
  treatment: string;
  tag: Tag;
  idList?: string;
};

export type DeathUpsertInput = {
  date: string;
  tag: Tag;
  note?: string | false;
  idList?: string;
  duplicateWindowDays?: number;
};

export type CardNameRepairInput = {
  kind: RecordKind;
  card: LivestockCardSource;
  newName: string;
  options?: RecordParseOptions;
};

export type CardNameRepairValidation = {
  changed: boolean;
  valid: boolean;
  result: ParseResult<LivestockRecord>;
};

export type ConfigCardDescriptionRepairInput = {
  kind: ConfigKind;
  card: LivestockCardSource;
  newDescription: string;
};

export type ConfigCardDescriptionRepairValidation = {
  changed: boolean;
  valid: boolean;
  result: ParseResult<LivestockConfigRecord>;
};

function parseByKind(
  kind: RecordKind,
  card: LivestockCardSource,
  options: RecordParseOptions = {},
): ParseResult<LivestockRecord> {
  if (kind === 'incoming') return parseIncomingCard(card, options);
  if (kind === 'treatment') return parseTreatmentCard(card, options);
  return parseDeadCard(card, options);
}

function parseConfigByKind(
  kind: ConfigKind,
  card: LivestockCardSource,
): ParseResult<LivestockConfigRecord> {
  return kind === 'tagColors'
    ? parseTagColorsCard(card)
    : parseTreatmentTypesCard(card);
}

function firstCard(
  response: Awaited<ReturnType<client.Client['get']>>,
): TrelloCard & { shortUrl?: string; url?: string } {
  const candidate = Array.isArray(response) ? response[0] : undefined;
  if (
    !candidate
    || !('name' in candidate)
    || !('idList' in candidate)
    || !('dateLastActivity' in candidate)
  ) {
    throw new Error('Trello did not return the refreshed card');
  }
  return candidate as TrelloCard & { shortUrl?: string; url?: string };
}

function parseOrThrow<T extends LivestockRecord>(
  result: ParseResult<T>,
  operation: string,
): T {
  if (result.ok) return result.record;
  throw new Error(`${operation} produced an invalid card: ${result.issues.map(current => current.message).join('; ')}`);
}

function recordParseOptions(records: LivestockRecords): RecordParseOptions {
  return {
    tagColors: records.tagcolors,
    treatmentTypes: records.treatmentTypes,
  };
}

export function validateCardNameRepair(input: CardNameRepairInput): CardNameRepairValidation {
  const changed = input.newName !== input.card.name;
  const candidate = { ...input.card, name: input.newName };
  const result = parseByKind(input.kind, candidate, input.options);
  return { changed, valid: changed && result.ok, result };
}

export function validateConfigCardDescriptionRepair(
  input: ConfigCardDescriptionRepairInput,
): ConfigCardDescriptionRepairValidation {
  const changed = input.newDescription !== (input.card.desc || '');
  const candidate = { ...input.card, desc: input.newDescription };
  const result = parseConfigByKind(input.kind, candidate);
  return { changed, valid: changed && result.ok, result };
}

export async function refetchRecord(
  trello: client.Client,
  kind: RecordKind,
  cardId: string,
  options: RecordParseOptions = {},
): Promise<LivestockRecord> {
  const response = await trello.get(`/cards/${cardId}`, {
    fields: 'id,name,desc,idBoard,idList,pos,closed,labels,dateLastActivity,shortUrl,url',
  });
  const card = firstCard(response);
  const result = parseByKind(kind, card, options);
  return parseOrThrow(result, 'Refetch');
}

export async function resolveTrelloCardUrl(
  trello: client.Client,
  cardId: string,
): Promise<string> {
  const response = await trello.get(`/cards/${cardId}`, {
    fields: 'id,name,desc,idBoard,idList,pos,closed,labels,dateLastActivity,shortUrl,url',
  });
  const card = firstCard(response);
  const url = card.shortUrl || card.url;
  if (!url) throw new Error('Trello did not return a URL for the card');
  return url;
}

export async function repairCardName(
  trello: client.Client,
  input: CardNameRepairInput,
): Promise<LivestockRecord> {
  const validation = validateCardNameRepair(input);
  if (!validation.changed) throw new Error('Card name repair must change the card name');
  if (!validation.result.ok) {
    throw new Error(`Card name repair is invalid: ${validation.result.issues.map(current => current.message).join('; ')}`);
  }
  const response = await trello.put(`/cards/${input.card.id}`, { name: input.newName });
  const refreshed = firstCard(response);
  return parseOrThrow(parseByKind(input.kind, refreshed, input.options), 'Card name repair');
}

export async function repairConfigCardDescription(
  trello: client.Client,
  input: ConfigCardDescriptionRepairInput,
): Promise<LivestockConfigRecord> {
  const validation = validateConfigCardDescriptionRepair(input);
  if (!validation.changed) throw new Error('Config repair must change the card description');
  if (!validation.result.ok) {
    throw new Error(`Config repair is invalid: ${validation.result.issues.map(current => current.message).join('; ')}`);
  }
  const response = await trello.put(`/cards/${input.card.id}`, { desc: input.newDescription });
  const refreshed = firstCard(response);
  const result = parseConfigByKind(input.kind, refreshed);
  if (!result.ok) {
    throw new Error(`Config repair produced an invalid card: ${result.issues.map(current => current.message).join('; ')}`);
  }
  return result.record;
}

export async function upsertTreatment(
  trello: client.Client,
  records: LivestockRecords,
  input: TreatmentUpsertInput,
): Promise<MutationResult<TreatmentRecord>> {
  const existing = records.treatments.records.find(record => (
    record.date === input.date && record.treatment === input.treatment
  ));
  if (existing?.tags.some(tag => sameTag(tag, input.tag))) {
    return { status: 'unchanged', record: existing };
  }
  const idList = existing?.idList || input.idList || records.listIds?.treatments;
  if (!idList) throw new Error('Treatments list ID is required to save a treatment');
  const tags = [...(existing?.tags || []), input.tag];
  const candidateName = serializeTreatmentRecord({
    date: input.date,
    treatment: input.treatment,
    tags,
  });
  const candidate: LivestockCardSource = {
    id: existing?.id || 'new-treatment',
    idList,
    name: candidateName,
    dateLastActivity: existing?.dateLastActivity || '',
  };
  parseOrThrow(
    parseTreatmentCard(candidate, recordParseOptions(records)),
    'Treatment upsert validation',
  );
  const response = existing
    ? await trello.put(`/cards/${existing.id}`, { name: candidateName, idList })
    : await trello.post('/cards', { name: candidateName, idList, pos: 'bottom', desc: '' });
  const refreshed = firstCard(response);
  const record = parseOrThrow(
    parseTreatmentCard(refreshed, recordParseOptions(records)),
    'Treatment upsert',
  );
  return { status: existing ? 'updated' : 'created', record };
}

export async function upsertDeath(
  trello: client.Client,
  records: LivestockRecords,
  input: DeathUpsertInput,
): Promise<MutationResult<DeadRecord>> {
  const duplicate = findDuplicateDeath(records.dead.records, input.tag, input.date, {
    windowDays: input.duplicateWindowDays,
  });
  if (duplicate) {
    if (duplicate.record.date === input.date) {
      return { status: 'unchanged', record: duplicate.record, duplicate };
    }
    return { status: 'duplicate', record: duplicate.record, duplicate };
  }
  const existing = records.dead.records.find(record => record.date === input.date);
  const idList = existing?.idList || input.idList || records.listIds?.dead;
  if (!idList) throw new Error('Dead list ID is required to save a death');
  const tags = [...(existing?.tags || []), input.tag];
  const note = existing?.note || input.note || false;
  const candidateName = serializeDeadRecord({ date: input.date, tags, note });
  const candidate: LivestockCardSource = {
    id: existing?.id || 'new-death',
    idList,
    name: candidateName,
    dateLastActivity: existing?.dateLastActivity || '',
  };
  parseOrThrow(parseDeadCard(candidate, recordParseOptions(records)), 'Death upsert validation');
  const response = existing
    ? await trello.put(`/cards/${existing.id}`, { name: candidateName, idList })
    : await trello.post('/cards', { name: candidateName, idList, pos: 'bottom', desc: '' });
  const refreshed = firstCard(response);
  const record = parseOrThrow(
    parseDeadCard(refreshed, recordParseOptions(records)),
    'Death upsert',
  );
  return { status: existing ? 'updated' : 'created', record };
}
