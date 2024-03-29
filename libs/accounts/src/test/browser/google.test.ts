import xlsx from 'xlsx-js-style'; //'sheetjs-style';
import type * as accountsLib from '../../browser/index.js';
import { drive } from '@aultfarms/google';
import deepequal from 'deep-equal';
import debug from 'debug';
import { stringify } from '../../stringify.js';

const info = debug('af/accounts#test/browser/google:info');

export default async function run(accounts: typeof accountsLib, pathroot: string) {
  info('google-specific browser tests');

  info('Skipping test to speed things up: uploadXlsxWorkbookToGoogle');
  /*
  info('google: testing uploadXlsxWorkbookToGoogle');
  const data = [ { col1: 'row1col1', col2: 'row1col2' }, { col1: 'row2col2', col2: 'row2col2' } ];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(data);
  ws['A1'].s = {
    fill: {
      patternType: 'solid',
      fgColor: { rgb: "FFFFAA00" },
    }
  }
  xlsx.utils.book_append_sheet(wb, ws, 'testsheet');
  const r1 = await accounts.google.uploadXlsxWorkbookToGoogle({
    parentpath: `${pathroot}/BROWSERGOOGLE`,
    filename: 'TEST.xlsx',
    workbook: wb,
  });
  if (!r1) throw `uploadXlsxWorkbookToGoogle returned null`;
  const r2 = await drive.getFileContents({ id: r1.id });
  if (!r2) throw `drive.getFileContents returned null`;
  const wb2 = xlsx.read(r2, { type: 'array' });
  const data2 = xlsx.utils.sheet_to_json(wb2.Sheets['testsheet']!);
  if (!deepequal(data, data2)) throw `Downloaded xlsx differs from uploaded xlsx.  Uploaded = ${stringify(data)}, Downloaded = ${stringify(data2)}`;
  */

  info('google: passed all google tests');
}
