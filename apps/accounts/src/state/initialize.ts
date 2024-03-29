import moment from 'moment';
import { state, IndexedStatements } from './state';
import { activity, errors, stepResult, balancesheets, profitlosses, selectedAccountName, ten99Settings } from './actions';
import debug from 'debug';
import { util, ledger as ledger, err, balance, profitloss, google } from '@aultfarms/accounts';
import chalk from 'chalk';

const { green, magenta } = chalk;

const info= debug("accounts#initialize:info");
const warn = debug("accounts#initialize:warn");

async function breakExecution() {
  await new Promise(resolve => setTimeout(resolve, 1)); // break up the execution to allow UI updates
}

export const initialize = async () => {

  if (state.config.accountsLocation.place !== 'google') {
    activity('ERROR: any place other that google is not currently supported');
    return;
  }
  activity('Using accounts from '+green(state.config.accountsLocation.path)+' in Google');

  // Read the accounts:
  let rawaccts = null;
  try {
    rawaccts = await google.readAccountsFromGoogle({ 
      accountsdir: state.config.accountsLocation.path, 
      status: activity
    });
  } catch(e) {
    warn('Could not readAccountsFromGoogle.  Error was: ', e);
    activity('Error: Could not read accounts from google', 'bad');
    return;
  }

  // Process them into a ledger:
  let step;
  try {
    for await (step of ledger.loadInSteps({ rawaccts, status: activity })) {
      if (step && step.errors) {
        activity('ERROR ON STEP: '+step.step, 'bad');
        break;
      }
      await breakExecution();
    }
    if (!step) {
      activity('ERROR: no step!', 'bad');
      return;
    }
    stepResult(step);
    if (step.errors && step.errors.length > 0) {
      activity(step.errors, 'bad');
      errors(step.errors);
      return;
    }
    if (!step.done) {
      activity('Did not finish loading', 'bad');
      return;
    }
    if (!step.final) {
      activity('Finished loading, but had no accounts!');
      return;
    }
    activity('Finished loading ledger');
  } catch (e: any) {
    warn('Could not process accounts into ledger, error = ', e);
    if (typeof e.msgs === 'function') {
      activity(e.msgs(), 'bad');
      errors(e.msgs());
      
    } else if (typeof e.message === 'string') {
      activity(e.message, 'bad');
    }
    activity('Error: could not process accounts into ledger', 'bad');
    return;
  }

  const final = step?.final;
  if (!final) {
    warn('WARNING: steps all finished, but final is still falsey....');
    activity('ERROR: all ledger loading steps finished, but had no resulting accounts!');
    return;
  }
  activity('Finished putting ledger into the state');

  /*
  // Create balance sheets and P&L for every year from 2020 forward
  let bss: IndexedStatements<balance.AnnualBalanceSheet> = {}; 
  let pls: IndexedStatements<profitloss.ProfitLoss> = {};
  try {
    const now = (new Date()).getFullYear();
    activity('******** balance sheet and profit loss ********');
    for (let year=2020; year <= now; year++) {
      activity(`Creating balance sheet for year ${year}`);
      await breakExecution();
      bss[year] = {
        tax: await balance.annualBalanceSheet({ year, type: 'tax', ledger: final }),
        mkt: await balance.annualBalanceSheet({ year, type: 'mkt', ledger: final }),
      };
      activity(`Creating profit/loss statement for year ${year}`);
      pls[year] = {
        tax: profitloss.profitLoss({ year, type: 'tax', ledger: final }),
        mkt: profitloss.profitLoss({ year, type: 'mkt', ledger: final }),
      };
    }

    activity('Registering balance sheets...');
    await breakExecution();
    balancesheets(bss);

    activity('Registering profit/loss statements...');
    await breakExecution();
    profitlosses(pls);

    activity('Successfully created balance sheet and profit/loss statements');
    await breakExecution();

  } catch(e: any) {
    warn('Could not create balance sheets and P&L statements, error = ', e);
    if (typeof e.msgs === 'function') {
      activity(e.msgs(), 'bad');
      errors(e.msgs());
      
    } else if (typeof e.message === 'string') {
      activity(e.message, 'bad');
    }
    activity('Error: could not load accounts', 'bad');
    return;
  }
  */

  const startDate = '2020-12-31';
  const printcats = Object.keys(ledger.categorySchemas).map(k => k.split('!')[0]).join(', ');
  activity(magenta('************** postValidation: checking for common errors *******************'));
  activity(`Checking that all notes have required structure for these categories since ${startDate}: ${printcats}`);
  breakExecution();
  await breakExecution();
  for (const type of ([ 'tax', 'mkt' ] as ('tax' | 'mkt')[]) ) {
    try {
      const results = ledger.validateNotesAllSchemas({account: final[type], startDate });
      for (const [_catname, caterrors] of Object.entries(results)) {
        if (caterrors) {
          for (const e of caterrors) {
            const le = new err.LineError({ line: e.line, msg: `${type}: Line had category ${e.line.category}, but note failed validation with this error: ${e.error} `});
            activity(le.msgs(),'bad');
            errors(le.msgs());
          }
        }
      }
    } catch(e: any) {
      activity(`ERROR: could not validate notes, error was: ${e.toString()}`, 'bad');
      errors(e.toString());
    }
  }

  activity(`Checking for any transactions labeled with top-level categories that should have been more specific since ${startDate}`);
  await breakExecution();
  let failed = false;
  for (const type of ([ 'tax', 'mkt' ] as ('tax' | 'mkt')[]) ) {
    try {
      const errs = ledger.validateNoOneLevelCategories({account: final[type], startDate });
      if (!errs) continue;
      for (const {line, error} of errs) {
        const le = new err.LineError({ line, msg: error });
        activity(le.msgs(),'bad');
        errors(le.msgs());
        failed = true;
      }
    } catch(e: any) {
      failed = true;
      activity(`ERROR: could not validate notes, error was: ${e.toString()}`, 'bad');
      errors(e.toString());
    }
  }
  if (failed) return; // do not continue on to load 1099 stuff from Google if things failed.

  activity(magenta('**************      1099\'s     *****************'));
  await breakExecution();
  try {
    activity(`Loading 1099Settings from Google as ${state.config.ten99Location.path}`);
    await breakExecution();
    ten99Settings(await google.read1099SettingsFromGoogle({ status: activity, settingsdir: state.config.ten99Location.path }));
    activity(`Successfully loaded 1099Settings from Google at ${state.config.ten99Location.path}`);
  } catch(e: any) {
    activity(`FAIL: could not load 1099Settings from Google at ${state.config.ten99Location.path}`, 'bad');
    errors(e.toString());
  }

  activity(magenta('***************   DONE!    *********************'));

};

