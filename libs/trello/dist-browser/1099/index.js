import moment from 'moment';
import momentrange from 'moment-range';
import { isStart, moneyEquals } from '../ledger/util.js';
import { MultiError } from '../err.js';
import { stringify } from '../stringify.js';
import rfdc from 'rfdc';
export { ten99ToWorkbook } from './exporter.js';
export { moneyEquals }; // mainly for tests
const deepclone = rfdc({ proto: true });
// Have to jump through some hoops to get TS and node both happy w/ moment-range:
const { extendMoment } = momentrange;
const { range } = extendMoment({ ...moment, default: moment });
// You can pass this to array.filter and get only unique strings/numbers back
function uniqueFilter(value, index, self) {
    return self.indexOf(value) === index;
}
export function profitLoss({ ledger, type, year }) {
    const lines = (type === 'tax') ? ledger.tax.lines : ledger.mkt.lines;
    // figure out all included years from transactions
    const years = lines.map(l => l.date.year()).filter(uniqueFilter);
    // Keep only the requested year, or default this year:
    if (!year)
        year = moment().year();
    if (!years.find(y => y === year)) {
        throw new MultiError({ msg: `ERROR: requested year ${year} for type ${type} does not exist in list of years from transactions (${stringify(years)})` });
    }
    // Produce one sheet per quarter:
    const ranges = [
        {
            year,
            name: 'End ' + year + 'Q4',
            yearend: true,
            timerange: range(moment(year + '-01-01 00:00:00'), moment(year + '-12-31 23:59:59')),
        },
        {
            year,
            name: 'End ' + year + 'Q3',
            timerange: range(moment(year + '-01-01 00:00:00'), moment(year + '-09-30 23:59:59')),
        },
        {
            year,
            name: 'End ' + year + 'Q2',
            timerange: range(moment(year + '-01-01 00:00:00'), moment(year + '-06-30 23:59:59')),
        },
        {
            year,
            name: 'End ' + year + 'Q1',
            timerange: range(moment(year + '-01-01 00:00:00'), moment(year + '-03-31 23:59:59')),
        },
    ];
    const timeranges = [];
    for (const r of ranges) {
        const tlines = deepclone(lines.filter(t => !isStart(t) &&
            t.date &&
            t.date.isValid() &&
            r.timerange.contains(t.date)));
        const startlines = deepclone(lines.filter(t => isStart(t) &&
            t.date &&
            t.date.isValid() &&
            r.timerange.contains(t.date)));
        timeranges.push({
            ...r,
            // Save the tx lines in the time range itself
            lines: tlines,
            startlines,
            categories: categorize({ lines: tlines }),
        });
    }
    ;
    // Returns promise
    return {
        year,
        type,
        lines,
        timeranges,
        categories: timeranges.find(tr => tr.yearend).categories,
    };
}
;
//# sourceMappingURL=index.js.map