// These functions can be run AFTER the ledger validates.  They are the sort of things that
// shouldn't invalidate the ledger, but are "todos" that should be taken care of sometime.
import moment from 'moment';
import ajvLib from 'ajv';
import debug from 'debug';
import { isSameDayOrAfter } from '../util.js';
const trace = debug('af/accounts#ledger/postValidation:trace');
//const numberpat = '-?[0-9]+(\.[0-9]+)?';
const datepat = '[0-9]{4}-[0-9]{2}-[0-9]{2}';
const outidpat = `${datepat}_[A-Z0-9]`;
const incomingidpat = '[A-Z0-9]:[A-Z]{3}[0-9]{2}-[0-9]';
export const categorySchemas = {
    // Any category name is the "startsWith" first, then any exclude's from that
    // come after sales-grain. i.e. sales-grain!sales-grain-trucking will exclude sales-grain-trucking
    // from sales-grain.  Just keep putting more !<exclude> to exclude multiple things.
    'sales-grain!sales-grain-trucking': {
        type: 'object',
        properties: {
            bushels: { type: 'number' },
        },
        required: ['bushels'],
    },
    'fuel!fuel-motoroil!fuel-oil!fuel-grease': {
        type: 'object',
        properties: {
            gallons: { type: 'number' },
        },
        required: ['gallons'],
    },
    'sales-cattle!sales-cattle-advance': {
        oneOf: [
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
    'cattle-purchase-cattle!cattle-purchase-cattle-fifoadj': {
        oneOf: [
            {
                type: 'object',
                properties: {
                    head: { type: 'number' },
                    loads: { type: 'number' },
                    weight: { type: 'number' },
                    inventorydate: { type: 'string', pattern: datepat },
                    incomingid: { type: 'string', pattern: incomingidpat },
                },
                required: ['head', 'loads', 'weight', 'incomingid'],
            },
            {
                type: 'object',
                properties: {
                    head: { type: 'number' },
                    loads: { type: 'number' },
                    weight: { type: 'number' },
                    inventorydate: { type: 'string', pattern: datepat },
                    incomingids: {
                        type: 'array',
                        items: { type: 'string', pattern: incomingidpat },
                    },
                },
                required: ['head', 'loads', 'weight', 'incomingids'],
            },
        ],
    },
    'crop-seed-corn': {
        type: 'object',
        properties: {
            bags: { type: 'number' },
        },
        required: ['bags'],
    },
    'crop-seed-beans!crop-seed-beans-treatment': {
        type: 'object',
        properties: {
            units: { type: 'number' },
        },
        required: ['units'],
    },
};
export function validateNoteSchemaForCatgory({ account, catname, startDate, schema, exactCatnameMatch }) {
    if (typeof startDate === 'string') {
        startDate = moment(startDate, 'YYYY-MM-DD');
    }
    let exclude = [];
    if (catname.match(/!/)) {
        const parts = catname.split('!');
        catname = parts[0];
        exclude = parts.slice(1); // everything after ! is an exclude on the startsWith
    }
    const ajv = new ajvLib();
    const validate = ajv.compile(schema);
    const errs = [];
    for (const l of account.lines) {
        if (l.date.isBefore(startDate))
            continue;
        // If not exact, then treat catname as a prefix:
        if (exactCatnameMatch) {
            if (l.category !== catname)
                continue;
        }
        else {
            if (!l.category.startsWith(catname))
                continue;
            else { // it DOES start with this, now see if we need to exclude:
                if (exclude.find(e => e === l.category))
                    continue;
            }
        }
        // Do some pre-work to get clearer error messages for common mistakes:
        if (schema.properties) {
            const required = schema.required || [];
            if (typeof l.note !== 'object') {
                errs.push({ line: l, error: `Note has no fields, but these are required: ${required.join(', ')}` });
                continue;
            }
            const localerrors = [];
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
        if (validate(l.note))
            continue;
        // If it fails, track the errors:
        const err = ajv.errorsText(validate.errors, { separator: '\n' });
        if (err)
            errs.push({ line: l, error: err });
    }
    if (errs.length < 1)
        return null;
    return errs;
}
export function validateNotesAllSchemas({ account, schemas, startDate }) {
    if (!schemas)
        schemas = categorySchemas;
    // Fancy way of getting res to be what we can reasonably return from this function:
    const res = {};
    for (const [catname, schema] of Object.entries(schemas)) {
        res[catname] = validateNoteSchemaForCatgory({ account, catname, schema, startDate });
    }
    return res;
}
export function validateNoOneLevelCategories({ account, startDate, exclude = ['medicine', 'charity', 'START'] }) {
    const errs = [];
    if (typeof startDate === 'string') {
        startDate = moment(startDate, 'YYYY-MM-DD');
    }
    const lines = account.lines.filter(l => isSameDayOrAfter(l.date, startDate));
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
//# sourceMappingURL=postValidation.js.map