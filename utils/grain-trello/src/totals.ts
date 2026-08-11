import type {
  GrainBoard,
  GrainRecord,
  GrainSellerList,
} from '@aultfarms/trucking';

export type ParsedGrainDate = {
  iso: string;
  month: string;
  ordinal: number;
};

export type MonthlyTotal = {
  month: string;
  deliveries: number;
  bushels: number;
};

export type CropTotal = {
  crop: string;
  monthly: MonthlyTotal[];
  deliveries: number;
  bushels: number;
};

export type ListTotal = {
  idList: string;
  name: string;
  crops: CropTotal[];
  deliveries: number;
};

export type GrainTotalsReport = {
  lists: ListTotal[];
  totalDeliveries: number;
};

export type GrainTotalsResult = {
  report: GrainTotalsReport | undefined;
  errors: string[];
};

type MutableCropTotal = {
  crop: string;
  monthly: Map<string, MonthlyTotal>;
  deliveries: number;
  bushels: number;
};

export function parseGrainDate(value: string): ParsedGrainDate | undefined {
  const match = value.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return undefined;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return undefined;

  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return {
    iso: `${String(year).padStart(4, '0')}-${paddedMonth}-${paddedDay}`,
    month: `${String(year).padStart(4, '0')}-${paddedMonth}`,
    ordinal: (year * 10_000) + (month * 100) + day,
  };
}

export function buildGrainTotals(board: GrainBoard): GrainTotalsResult {
  const errors = board.errors.map(error => `Grain parser: ${error}`);
  const lists = board.sellerLists.map(list => buildListTotal(list, errors));

  if (errors.length > 0) {
    return {
      report: undefined,
      errors,
    };
  }

  return {
    report: {
      lists,
      totalDeliveries: lists.reduce((total, list) => total + list.deliveries, 0),
    },
    errors: [],
  };
}

function buildListTotal(list: GrainSellerList, errors: string[]): ListTotal {
  const crops = new Map<string, MutableCropTotal>();
  let deliveries = 0;

  for (const record of list.records) {
    const date = parseGrainDate(record.date);
    const recordErrors = validateRecord(record, date);
    if (recordErrors.length > 0) {
      errors.push(`${recordDescription(record, list.name)}: ${recordErrors.join('; ')}.`);
      continue;
    }

    const cropName = record.crop.trim();
    let crop = crops.get(cropName);
    if (!crop) {
      crop = {
        crop: cropName,
        monthly: new Map(),
        deliveries: 0,
        bushels: 0,
      };
      crops.set(cropName, crop);
    }

    const monthKey = date!.month;
    let monthly = crop.monthly.get(monthKey);
    if (!monthly) {
      monthly = {
        month: monthKey,
        deliveries: 0,
        bushels: 0,
      };
      crop.monthly.set(monthKey, monthly);
    }

    monthly.deliveries += 1;
    monthly.bushels += record.bushels;
    crop.deliveries += 1;
    crop.bushels += record.bushels;
    deliveries += 1;
  }

  return {
    idList: list.idList,
    name: list.name,
    crops: Array.from(crops.values())
      .sort((left, right) => left.crop.localeCompare(right.crop))
      .map(crop => ({
        crop: crop.crop,
        monthly: Array.from(crop.monthly.values())
          .sort((left, right) => left.month.localeCompare(right.month)),
        deliveries: crop.deliveries,
        bushels: crop.bushels,
      })),
    deliveries,
  };
}

function validateRecord(
  record: GrainRecord,
  date: ParsedGrainDate | undefined,
): string[] {
  const errors: string[] = [];

  if (!date) errors.push(`date "${record.date}" is not a real calendar date`);
  if (!Number.isFinite(record.bushels) || record.bushels <= 0) {
    errors.push(`bushels must be a finite positive number, received ${String(record.bushels)}`);
  }

  for (const [ field, value ] of [
    [ 'crop', record.crop ],
    [ 'destination', record.dest ],
    [ 'ticket', record.ticket ],
    [ 'driver', record.driver ],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${field} is missing`);
    }
  }

  return errors;
}

function recordDescription(record: GrainRecord, listName: string): string {
  if (record.cardName) return `Card "${record.cardName}" in list "${listName}"`;
  if (record.id) return `Card ${record.id} in list "${listName}"`;
  return `Record dated "${record.date}" in list "${listName}"`;
}
