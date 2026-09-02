import { feed } from '@aultfarms/trucking';
import type { TrelloCard } from '@aultfarms/trello';

export const BOARD_NAME = 'Feed';
export const LIST_NAME = 'Feed Delivered';

export type CalendarDate = {
  iso: string;
  ordinal: number;
  year: number;
  month: number;
  day: number;
};

export type DatedCard = {
  card: TrelloCard;
  date: CalendarDate;
};

export type CardValidationError = {
  card: TrelloCard;
  message: string;
};

export type CardValidationResult = {
  valid: DatedCard[];
  errors: CardValidationError[];
};

export function parseCalendarDate(value: string): CalendarDate | undefined {
  const match = value.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return undefined;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return undefined;

  return {
    iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    ordinal: (year * 10_000) + (month * 100) + day,
    year,
    month,
    day,
  };
}

export function calendarDateFromDate(value: Date): CalendarDate {
  const parsed = parseCalendarDate(
    `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`,
  );
  if (!parsed) throw new Error(`Invalid calendar date: ${value.toString()}`);
  return parsed;
}

export function validateCards(cards: TrelloCard[]): CardValidationResult {
  const valid: DatedCard[] = [];
  const errors: CardValidationError[] = [];

  for (const card of cards) {
    const record = feed.feedDeliveredCardToRecord(card);

    if ('error' in record && record.error) {
      errors.push({ card, message: record.error });
      continue;
    }

    const date = parseCalendarDate(record.date);
    if (!date) {
      errors.push({
        card,
        message: `The card date "${record.date}" is not a real calendar date.`,
      });
      continue;
    }

    valid.push({ card, date });
  }

  return { valid, errors };
}

export function cardsOlderThan(cards: DatedCard[], cutoff: CalendarDate): DatedCard[] {
  return cards
    .filter(({ date }) => date.ordinal < cutoff.ordinal)
    .sort((left, right) => {
      const dateOrder = left.date.ordinal - right.date.ordinal;
      if (dateOrder !== 0) return dateOrder;
      return left.card.pos - right.card.pos;
    });
}
