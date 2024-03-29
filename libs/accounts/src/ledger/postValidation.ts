// These functions can be run AFTER the ledger validates.  They are the sort of things that
// shouldn't invalidate the ledger, but are "todos" that should be taken care of sometime.
import moment, { type Moment } from 'moment';
import type { AccountTx } from './types.js';
import ajvLib from 'ajv';
import type { JSONSchema8 } from 'jsonschema8';
//import debug from 'debug';
import { isSameDayOrAfter } from '../util.js';
//const trace = debug('af/accounts#ledger/postValidation:trace'); 
export { type JSONSchema8 };
//const numberpat = '-?[0-9]+(\.[0-9]+)?';
const datepat = '[0-9]{4}-[0-9]{2}-[0-9]{2}';
const outidpat = `${datepat}_[A-Z0-9]`;
const incomingidpat = '[A-Z0-9]:[A-Z]{3}[0-9]{2}-[0-9]';

export type CategoryNoteSchema = {
  ignoreInventoryAccounts?: boolean,
  schema: JSONSchema8 
};

export const categorySchemas: { [category: string]: CategoryNoteSchema } = {
  // Any category name is the "startsWith" first, then any exclude's from that
  // come after sales-grain. i.e. sales-grain!sales-grain-trucking will exclude sales-grain-trucking
  // from sales-grain.  Just keep putting more !<exclude> to exclude multiple things.
  'sales-grain!sales-grain-trucking': {  // exclude sales-grain-trucking
    ignoreInventoryAccounts: true,
    schema: {
      type: 'object', 
      properties: { 
        bushels: { type: 'number' },
      },
      required: [ 'bushels' ],
    },
  },
  'fuel!fuel-motoroil!fuel-oil!fuel-grease': {
    schema: {
      type: 'object',
      properties: { 
        gallons: { type: 'number' },
      },
      required: [ 'gallons' ],
    },
  },
  'sales-cattle!sales-cattle-advance!sales-cattle-refund': {
    ignoreInventoryAccounts: true,
    schema: {
      oneOf: [ // could have one outid or multiple outid's
        {
          type: 'object',
          properties: {
            head: { type: 'number' },
            loads: { type: 'number' },
            weight: { type: 'number' },
            inventorydate: { type: 'string', pattern: datepat },
            outid: { type: 'string', pattern: outidpat },
          },
          required: ['head', 'loads', 'weight', 'outid'],
        },
        {
          type: 'object',
          properties: {
            head: { type: 'number' },
            loads: { type: 'number' },
            weight: { type: 'number' },
            inventorydate: { type: 'string', pattern: datepat },
            outids: { 
              type: 'array', 
              items: { type: 'string', pattern: outidpat },
            },
          },
          required: ['head', 'loads', 'weight', 'outids'],
        },
      ],
    },
  },
  'cattle-purchase-cattle!cattle-purchase-cattle-fifoadj': {
    ignoreInventoryAccounts: true,
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            head: { type: 'number' },
            loads: { type: 'number' },
            weight: { type: 'number' }, // BKTKY:AUG20-1
            inventorydate: { type: 'string', pattern: datepat },
            incomingid: { type: 'string', pattern: incomingidpat },
          },
          required: [ 'head', 'loads', 'weight', 'incomingid' ],
        },
        {
          type: 'object',
          properties: {
            head: { type: 'number' },
            loads: { type: 'number' },
            weight: { type: 'number' }, // BKTKY:AUG20-1
            inventorydate: { type: 'string', pattern: datepat },
            incomingids: { 
              type: 'array',
              items: { type: 'string', pattern: incomingidpat },
            },
          },
          required: [ 'head', 'loads', 'weight', 'incomingids' ],
        },
      ],
    },
  },
  'bedding-straw': {
    ignoreInventoryAccounts: true,
    schema: {
      type: 'object',
      properties: {
        bales: { type: 'number' }
      },
      required: [ 'bales' ],
    },
  },
  'crop-seed-corn': {
    ignoreInventoryAccounts: true,
    schema: {
      type: 'object',
      properties: {
        bags: { type: 'number' },
      },
      required: [ 'bags' ],
    },
  },
  'crop-seed-beans!crop-seed-beans-treatment': {
    schema: {
      type: 'object',
      properties: {
        units: { type: 'number' },
      },
      required: [ 'units'],
    },
  },
};

export function validateNoteSchemaForCategory(
  { account, catname, startDate, schema, exactCatnameMatch }:
  { account: { lines: AccountTx[] }, 
    catname: string, 
    schema: CategoryNoteSchema,
    startDate: string | Moment, 
    exactCatnameMatch?: true,
  }
): { line: AccountTx, error: string }[] | null {

  if (typeof startDate === 'string') {
    startDate = moment(startDate, 'YYYY-MM-DD');
  }
  let exclude: string[] = [];
  if (catname.match(/!/)) {
    const parts = catname.split('!');
    catname = parts[0]!;
    exclude = parts.slice(1); // everything after ! is an exclude on the startsWith
  }
 
  const ajv = new ajvLib();
  const validate = ajv.compile(schema.schema);
  const errs: { line: AccountTx, error: string }[] = [];
  for (const l of account.lines) {
    // Notes have different requirements on inventory accounts than they do on cash accounts:
    if (schema.ignoreInventoryAccounts && l.acct.settings.accounttype === 'inventory') continue;

    if (l.date.isBefore(startDate)) continue;
    // If not exact, then treat catname as a prefix:
    if (exactCatnameMatch) {
      if (l.category !== catname) continue;
    } else {
      if (!l.category.startsWith(catname)) continue;
      else { // it DOES start with this, now see if we need to exclude:
        if (exclude.find(e => e === l.category)) continue;
      }
    }
    // Do some pre-work to get clearer error messages for common mistakes:
    if ((schema.schema as any).properties) {
      const required = (schema.schema as any).required || [];
      if (typeof l.note !== 'object') {
        errs.push({ line: l, error: `Note has no fields, but these are required: ${required.join(', ')}` });
        continue;
      }
      const localerrors: { line: AccountTx, error: string }[] = [];
      for (const r of required) {
        if (!(r in l.note)) {
          localerrors.push({ line: l, error: `Note is missing required field ${r}` });
        }
      }
      if (localerrors.length > 0) {
        errs.push(...localerrors);
        continue;
      }
    }
    // Otherwise, validate the note against the schema
    if (validate(l.note)) continue;
    // If it fails, track the errors:
    const err = ajv.errorsText(validate.errors, { separator: '\n' });
    if (err) errs.push({ line: l, error: err });
  }
  if (errs.length < 1) return null;
  return errs;
}

export function validateNotesAllSchemas(
  {account, schemas, startDate }:
  { account: { lines: AccountTx[] }, 
    startDate: string | Moment, 
    schemas?: { [catname: string]: CategoryNoteSchema } 
  }
): {[catname: string]: {line: AccountTx, error: string}[] | null } {
  if (!schemas) schemas = categorySchemas;
  // Fancy way of getting res to be what we can reasonably return from this function:
  const res: Awaited<ReturnType<typeof validateNotesAllSchemas>> = {};
  for (const [catname, schema] of Object.entries(schemas)) {
    res[catname] = validateNoteSchemaForCategory({account, catname, schema, startDate});
  }
  return res;
}

export function validateNoOneLevelCategories(
  {account, startDate, exclude=['medicine', 'charity', 'START']}:
  { account: { lines: AccountTx[] },
    startDate: string | Moment,
    exclude?: string[],
  }
): { line: AccountTx, error: string}[] | null {
  const errs: { line: AccountTx, error: string}[] = [];
  if (typeof startDate === 'string') {
    startDate = moment(startDate, 'YYYY-MM-DD');
  }
  const lines = account.lines.filter(l => isSameDayOrAfter(l.date, (startDate as Moment)));
  for (const l of lines) {
    if (!l.category.match('-')) { // no dashes means top-level
      // Is this category on the exclude list?
      if (!exclude.find(ex => ex === l.category)) {
        let error = `Line has a top-level category (${l.category}) that is not on the list of allowable top-level categories (${exclude?.join(', ')}).`;
        if (l.category === 'miscellaneous') {
          error += '  Did you mean miscellaneous-activity?';
        }
        errs.push({ line: l, error });
      }
    }
  }
  return errs.length > 0 ? errs : null;
}
