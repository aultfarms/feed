import moment from 'moment';
import momentrange from 'moment-range';
import { categorize, type CategoryTree, treeToCategoryNames, getCategory, amount, type AmountConfig, credit, debit } from './categorize.js';
import { isStart, moneyEquals } from '../ledger/util.js';
import type { FinalAccounts, AccountTx } from '../ledger/types.js';
//import { MultiError } from '../err.js';
//import { stringify } from '../stringify.js';
import debug from 'debug';
import type { StatusFunction } from '../ledger/types.js';

export { profitLossToWorkbook } from './exporter.js';

export { type CategoryTree, treeToCategoryNames, getCategory, amount, type AmountConfig, credit, debit }; // bump up to top level because it is useful
export { moneyEquals }; // mainly for tests

const info = debug('af/accounts#profit-loss:info');
// Have to jump through some hoops to get TS and node both happy w/ moment-range:
const { extendMoment } = momentrange;
const { range } = extendMoment({ ...moment, default: moment});

// You can pass this to array.filter and get only unique strings/numbers back
function uniqueFilter(value: any, index: number, self: any[]) {
  return self.indexOf(value) === index;
}

export type ProfitLossTimeRange = {
  year: number,
  name: string,
  yearend?: boolean,
  timerange: momentrange.DateRange,
  lines: AccountTx[],
  startlines: AccountTx[], // all the "isStart" lines that got excluded from lines for P&L, they represent starting balances
  categories: CategoryTree,
};

export type ProfitLoss = {
  year: number,
  type: 'tax' | 'mkt',
  lines: AccountTx[],  // note these have the start lines included, use the timeranges
  timeranges: ProfitLossTimeRange[],
  categories: CategoryTree, // the full annual categories for the year, same as the fourth quarter
};

export function profitLoss(
  { ledger, type, year, status }:
  { ledger: FinalAccounts, type: 'mkt' | 'tax', year?: number, status?: StatusFunction }
): ProfitLoss {
  if (!status) status = info;
  const lines = (type === 'tax') ? ledger.tax.lines : ledger.mkt.lines;

  // figure out all included years from transactions
  const years: number[] = lines.map(l => l.date.year()).filter(uniqueFilter);

  // Keep only the requested year, or default this year:
  if (!year) year = moment().year();
  if (!years.find(y => y===year)) {
//    throw new MultiError({ msg: `ERROR: requested year ${year} for type ${type} does not exist in list of years from transactions (${stringify(years)})` });
    status('WARNING: Requested year '+year+' for profit-loss does not have any transactions');
  }

  // Produce one sheet per quarter:
  const ranges = [
    { 
      year,
      name: 'End '+year+'Q4',
      yearend: true,
      timerange: range(moment(year+'-01-01 00:00:00'), moment(year+'-12-31 23:59:59')), 
    },
    { 
      year,
      name: 'End '+year+'Q3',
      timerange: range(moment(year+'-01-01 00:00:00'), moment(year+'-09-30 23:59:59')), 
    },
    { 
      year,
      name: 'End '+year+'Q2',
      timerange: range(moment(year+'-01-01 00:00:00'), moment(year+'-06-30 23:59:59')), 
    },
    { 
      year,
      name: 'End '+year+'Q1',
      timerange: range(moment(year+'-01-01 00:00:00'), moment(year+'-03-31 23:59:59')), 
    },
  ];

  const timeranges: ProfitLossTimeRange[] = [];
  for (const r of ranges) {
    const tlines = lines.filter(t => 
      !isStart(t) && 
      t.date && 
      t.date.isValid() && 
      r.timerange.contains(t.date)
    );
    const startlines = lines.filter(t => 
      isStart(t) && 
      t.date && 
      t.date.isValid() && 
      r.timerange.contains(t.date)
    );

    timeranges.push({
      ...r,
      // Save the tx lines in the time range itself
      lines: tlines,
      startlines,
      categories: categorize({ lines: tlines }),
    });
  };

  // Returns promise
  return {
    year,
    type,
    lines,
    timeranges,
    categories: timeranges.find(tr => tr.yearend)!.categories,
  };

};

