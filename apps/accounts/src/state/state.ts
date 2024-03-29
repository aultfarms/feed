import { observable, autorun } from 'mobx';
import type { ledger, ten99, inventory } from '@aultfarms/accounts';
import { stepResult, selectedAccountAcct, selectedAccountVAcct } from './actions';
import debug from 'debug';
import moment from 'moment';

const warn = debug('accounts#state:warn');
const info = debug('accounts#state:info');

// year-indexed balance sheets and profit/loss statements (tax & mkt)
export type IndexedStatements<T> = {
  [year: string]: {
    tax: T,
    mkt: T,
  }
};

export type Config = {
  accountsLocation: {
    place: 'google' | 'dir',
    path: string,
  },
  saveLocation: {
    place: 'google' | 'dir',
    path: string,
  },
  ten99Location: {
    place: 'google' | 'dir',
    path: string,
  }
  validations: {
    retroActiveStartDate: string,
  },
};

export type ActivityMessage = {
  msg: string,
  type: 'good' | 'bad',
};

// things that are too big to fit in the state without crashing browser
export type BigData = { rev: number };

export type State = {
  page: 'activity' | 'ledger' | 'balance' | 'profit' | 'chart' | 'ten99' | 'inventory',
  modal: 'none' | 'config',
  config: Config,
  activityLog: ActivityMessage[],
  errors: string[],
  stepResult: BigData,
  selectedAccount: {
    name: string | 'All',
    line: number | null,
    type: 'tax' | 'mkt',
    category: string | 'All',
    categoryExact: boolean,
    year: string | number,
    acct: BigData,
    vacct: BigData,
    scroll: number,
  },
  balancesheets: BigData,
  borrowingBase: BigData,
  profitlosses: BigData,
  balance: {
    type: 'mkt' | 'tax',
    level: number,
    msg: string,
    scroll: number,
  },
  profitloss: {
    type: 'mkt' | 'tax',
    level: number,
    msg: string,
    expandYear: string,
    scroll: number,
  },
  ten99: {
    year: string,
    result: ten99.Ten99Result | null,
    settings: ten99.Ten99Settings | null,
    msg: string,
  },
  inventory: {
    today: string, // YYYY-MM-DD
    missing: inventory.MissingTxResult[] | null,
    changes: ledger.LivestockInventoryAccountTx[] | null,
    state: 'start' | 'running' | 'done' | 'error',
    errors: string[] | null,
  },
};



// Figure out the config: load from localStorage, but have default
export const defaultConfig: Config = {
  accountsLocation: {
    place: 'google',
    path: '/Ault Farms Shared/LiveData/Accounts'
  },
  saveLocation: {
    place: 'google',
    path: '/Ault Farms Shared/LiveData/BalanceProfitLoss'
  },
  ten99Location: {
    place: 'google',
    path: '/Ault Farms Shared/LiveData/1099s'
  },
  validations: {
    retroActiveStartDate: '2020-01-01',
  },
};
let config = defaultConfig;

try {
  const localConfig = JSON.parse(localStorage.getItem('accounts-config') || '');
  if (localConfig && localConfig.accountsLocation && localConfig.saveLocation && localConfig.ten99Location) {
    config = localConfig;
  }
} catch (e) {
  warn('Could not parse localStorage["accounts-config"]');
  // JSON parse failed
}
// This either writes the default config, or just writes the same localConfig back.
// There is an autorun the updates localStorage as config changes in the state.
localStorage.setItem('accounts-config', JSON.stringify(config));

export const state = observable<State>({
  page: 'activity',
  modal: 'none',
  config: config,
  activityLog: [],
  errors: [],
  stepResult: { rev: 0 },
  selectedAccount: {
    name: '',
    line: null,
    type: 'mkt',
    category: 'All',
    categoryExact: false,
    year: '',
    acct: { rev: 0 },
    vacct: { rev: 0 },
    scroll: 0,
  },
  balancesheets: { rev: 0 },
  borrowingBase: { rev: 0 },
  profitlosses: { rev: 0 },
  balance: {
    type: 'mkt',
    level: 4,
    msg: '',
    scroll: 0,
  },
  profitloss: {
    type: 'mkt',
    level: 4,
    msg: '',
    expandYear: '',
    scroll: 0,
  },
  ten99: {
    year: moment().year().toString(),
    result: null,
    settings: null,
    msg: '',
  },
  inventory: {
    state: 'start',
    today: moment().format('YYYY-MM-DD'),
    missing: null,
    changes: null,
    errors: null,
  },
});

// Every time the state.config changes, save it to localStorage:
autorun(() => {
  localStorage.setItem('accounts-config', JSON.stringify(state.config));
});

// Keep state.selectedAccount in sync with state.selectedAccountName: you set the name,
// this will find the account and set it.
autorun(() => {
  info('autorunning account determiner from account name');
  if (!state.selectedAccount.name) {
    selectedAccountAcct(null);
    selectedAccountVAcct(null);
    return;
  }
  const sr = stepResult();
  // access state.stepResult so that we are properly autorun when it changes
  if (!sr || state.stepResult.rev < 0) {
    selectedAccountAcct(null);
    selectedAccountVAcct(null);
    return;
  }

  const name = state.selectedAccount.name;
  let acct: ledger.Account | null | undefined = null;
  let vacct: ledger.ValidatedRawSheetAccount | null | undefined = null;
  const compositeToAcct = (cacct: ledger.CompositeAccount, name: 'All') => ({
    name,
    filename: 'none',
    id: 'none',
    header: [],
    settings: { accounttype: ('cash' as ledger.AccountSettings['accounttype']) },
    lines: cacct.lines,
  });

  if (sr.final) {
    if (name === 'All') {
      acct = compositeToAcct(sr.final[state.selectedAccount.type], name);
    } else {
      acct = sr.final[state.selectedAccount.type].accts.find(a => a.name === name);
    }
    if (!acct) {
      warn('stepResult has a final, but could not find selectedAccount ', name, ' in ',state.selectedAccount.type);
      selectedAccountAcct(null);
      selectedAccountVAcct(null);
      return;
    }
    selectedAccountAcct(acct);
    return;
  }
  if (sr.accts) {
    acct = sr.accts.filter(a => {
      switch(state.selectedAccount.type) {
        case 'mkt': return a.settings.mktonly;
        case 'tax': return a.settings.taxonly;
      }
    }).find(a => a.name === name);
    if (!acct) {
      warn('stepResult has accts, but could not find selectedAccount', name, ' in type ', state.selectedAccount.type);
      selectedAccountAcct(null);
      selectedAccountVAcct(null);
      return;
    }
    selectedAccountAcct(acct);
    return;
  }
  if (sr.vaccts) {
    vacct = sr.vaccts.find(a => a.name === name);
    if (!vacct) {
      warn('stepResult has vaccts, but could not find selectedAccount', name);
      selectedAccountAcct(null);
      selectedAccountVAcct(null);
    }
    selectedAccountVAcct(vacct);
    return;
  }
  selectedAccountAcct(null);
  selectedAccountVAcct(null);
  return;
});

/*
autorun(() => {
  if (state.stepResult?.done && state.stepResult?.final) {
    state.ledger = state.stepResult.final;
  }
});*/
