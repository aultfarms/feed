import { client } from './core';
import { createFile, ensurePath, idFromPath, getFileContents } from './drive';
import xlsx from 'xlsx-js-style';
import debug from 'debug';
import pReduce from 'p-reduce';
import { isMoment, Moment } from 'moment';

import type { sheets_v4 as Sheets } from '@googleapis/sheets';

const warn = debug('af/google#sheets:warn');
const info = debug('af/google#sheets:info');
//const trace = debug('af/google#sheets:trace');

export const XlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function sheets(): Promise<Sheets.Sheets> {
  // @ts-ignore
  return ((await client()).sheets as Sheets.Sheets);
}

export async function googleSheetToXlsxWorkbook({ id }: { id: string }): Promise<xlsx.WorkBook> {
  const arraybuffer = await getFileContents({ id, exportMimeType: XlsxMimeType });
  return xlsx.read(arraybuffer, { type: 'array' });
}

export function arrayToLetterRange(row:string|number,arr:any[]):string {
  const startletter = 'A';
  const end = arr.length-1;
  let endletter = String.fromCharCode(65+end);
  if (arr.length > 25) { // more than a single letter can represent
    const mostsig = String.fromCharCode(65+Math.trunc(end/26)); // integer division
    const leastsig = String.fromCharCode(65+(end%26)); // remainder
    endletter = mostsig+leastsig;
  }
  return startletter+row+':'+endletter+row;
}

export async function getAllRows(
  { id, worksheetName }
: { id: string, worksheetName: string }
): Promise<Sheets.Schema$ValueRange> {
  const res = await ((await sheets()).spreadsheets.values.get({ 
    spreadsheetId: id, 
    range: worksheetName+'!A:ZZ',
  }));
  // Not sure why result is not on the type
  // @ts-ignore
  return res.result;
}

// cols is just an array of your data, in order by the columns you want to
// put it at.  i.e. cols[0] will go in column A, cols[1] in B, etc. in your chosen row.
export async function putRow(
  {id,row,cols,worksheetName,rawVsUser }
: {id: string, row: string, cols: string[], worksheetName: string, rawVsUser?: 'USER_ENTERED' | 'RAW' }
) {
  if (!rawVsUser) rawVsUser = 'RAW'; // this is what putRow originally did
  //const range = worksheetName+'!'+arrayToLetterRange(row,cols);
  let params = {
    spreadsheetId: id,
    range: worksheetName+'!'+arrayToLetterRange(row,cols),
    includeValuesInResponse: true,
    valueInputOption: rawVsUser,
  };
  const data = {
    range: worksheetName+'!'+arrayToLetterRange(row,cols),
    majorDimension: 'ROWS',
    values: [ cols ],
  };
  const result = await ((await client()).sheets.spreadsheets.values.update(params, data));
  return result.result.updatedData?.values?.[0];
}

export type RowObject = {
  lineno: number,
  [key: string]: string | Moment | number,
};
export function rowObjectToArray({ row, header }: { row: RowObject, header: string[] }): (string | number)[] {
  const ret: (string | number)[] = [];
  for (const key of header) {
    const val = row[key];
    if (typeof val === 'number') {
      ret.push(val);
      continue;
    }
    if (!val) { // undefined or '' or null.  numeric 0 handled above
      ret.push('');
      continue;
    }
    if (isMoment(val)) {
      ret.push((val as Moment).format('YYYY-MM-DD'));
      continue;
    }
    ret.push(val);
  }
  return ret;
}



//------------------------------------------------------------
// batchInsert is tricky with the lineno's.  I settled on you give 
// this function lineno's as of the state of the sheet when you 
// call this function.  i.e. if you need to insert 3 rows above 
// lineno 5 (as final rows 5, 6, 7), then you'll give three row
// objects that all list the same lineno of 5, and they will end
// up as the first one line 5, the second line 6, and the third line 7,
// and the original line 5 will now be line 8.
//
// first new: lineno 5
// second new: lineno 5
// third new: lineno 5
//
// 4  orig4    ---> 4   orig4
// 5  orig5    +    5   first new
//             |    6   second new
//             |    7   third new
//             +--> 8   orig5
export async function batchUpsertRows(
  { id, worksheetName, rows, header, insertOrUpdate }: { 
    id: string,
    worksheetName: string,
    rows: RowObject[],
    header: string[],
    insertOrUpdate: 'INSERT' | 'UPDATE',
}): Promise<void> {
  if (rows.length < 1) {
    throw new Error('ERROR: must have at least one row to batchUpsert');
  }
  const sheetId = await worksheetIdFromName({ id, name: worksheetName });
    
  const request: gapi.client.sheets.BatchUpdateSpreadsheetRequest = {
    requests: [],
  };
  // Make sure rows are in increasing lineno order:
  rows.sort((a,b) => a.lineno - b.lineno);

  let lineno_offset = 0; // increment this for every line inserted
  for (const row of rows) {

    // Insert a blank line first if in insert mode:
    const lineno = row.lineno + lineno_offset;
    if (insertOrUpdate === 'INSERT') {
      const insertRowRequest: gapi.client.sheets.Request = {
        insertDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: lineno-1, // startIndex is inclusive and zero-based
            endIndex: lineno,     // endIndex is exclusive
          },
          inheritFromBefore: true,
        }
      };
      request.requests!.push(insertRowRequest);
      lineno_offset++; // note lineno will remain the same through the "update" part for this row
    }

    // Update the row at lineno to have new values:
    const rowvals = rowObjectToArray({row, header});
    const updateCellsRequest: gapi.client.sheets.Request = {
      updateCells: {
        rows: [ 
          {  // A single row is an object with a "values" key, and each "value" is just a userEnteredValue
            values: rowvals.map(v => ({ 
              userEnteredValue: ((typeof v === 'number' || v.match(/^[0-9]+$/))
                ? { numberValue: +(v) } 
                : v.match(/^=/)  // if it starts with an equal, it's a formula
                ? { formulaValue: v }
                : { stringValue: v }
              ),
            })) 
          } 
        ], // https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/sheets#RowData
        fields: 'userEnteredValue', // https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/cells#CellData
        start: { sheetId, rowIndex: lineno-1, columnIndex: 0 }, // these are zero-based, but lineno is 1-based
      }
    };
    request.requests!.push(updateCellsRequest);

  }
  await (await client()).sheets.spreadsheets.batchUpdate({ spreadsheetId: id }, request);
  return;
}

// Given a template row with formulas in it (i.e. balances, averages, etc.), paste those columns down to the end of data in the sheet.
// Generally useful after doing a batchUpsertRows.
export async function pasteFormulasFromTemplateRow(
  { templateLineno, startLineno, id, worksheetName }: 
  { templateLineno: number, startLineno: number, id: string, worksheetName: string }
): Promise<void> {
  const sheetId = await worksheetIdFromName({ id, name: worksheetName });
  const templateresult = await (await client()).sheets.spreadsheets.values.get({
    spreadsheetId: id,
    valueRenderOption: 'FORMULA',
    range: worksheetName+'!'+templateLineno+':'+templateLineno, // Sheet!1:1 -> all of row 1 in Sheet
    majorDimension: 'ROWS',
  });
  const templaterow = templateresult.result.values?.[0];
  if (!templaterow) {
    throw new Error('ERROR: could not retrieve template row from sheet');
  }
  
  // Figure out last line of data:
  const all_values = await sheetToJson({ id, worksheetName });
  if (!all_values) throw new Error('ERROR: could not retrieve all values in sheet to determine last line to paste');
  const endLineno = all_values.length + 1; // the +1 is for the header row

  // 1: find which columns in template to paste
  const request: gapi.client.sheets.BatchUpdateSpreadsheetRequest = { requests: [] };
  for (const [tindex, tval] of (templaterow as string[]).entries()) {
    if (typeof tval !== 'string') continue; // shouldn't ever happen
    if (tval === 'TEMPLATE') continue;
    if (!tval) continue; // empty string
    if (!tval.match(/^=/)) continue; // non-empty string, but not a formula
    const req: gapi.client.sheets.Request = {
      copyPaste: {
        pasteType: 'PASTE_FORMULA',
        pasteOrientation: 'NORMAL',
        source: {
          sheetId,
          startRowIndex: templateLineno - 1,
          startColumnIndex: tindex,
          endRowIndex: templateLineno, // end is exclusive
          endColumnIndex: tindex+1,    // end is exclusive
        },
        destination: {
          sheetId,
          startRowIndex: startLineno - 1,
          startColumnIndex: tindex,
          endRowIndex: endLineno, // this is 1-indexed and hence just past the end index, but this is exclusive so need 1 past the end
          endColumnIndex: tindex+1, // end is exclusive
        },
      },
    };
    request.requests!.push(req);
  }
  await (await client()).sheets.spreadsheets.batchUpdate({ spreadsheetId: id }, request);
}

export async function worksheetIdFromName({ id, name }: { id: string, name: string }) {
  const response = await (await client()).sheets.spreadsheets.get({ 
    spreadsheetId: id,
    ranges: [name+'!A1'],
  });
  const sheetId = response.result?.sheets![0]?.properties?.sheetId;
  if (!sheetId) {
    warn('FAIL: sheets.spreadsheets.get result = ', response);
    throw new Error('ERROR: failed to find sheetId for worksheetName '+name+', result.status  was'+response.status+': '+response.statusText);
  }
  return sheetId; 
}


export async function getSpreadsheet(
  {id=null,path=null}:
  {id?: string | null, path?: string | null}
): Promise<Sheets.Schema$Spreadsheet | null> {
  if (!id) {
    if (!path) {
      warn('getSpreadsheet: WARNING: you must pass either an id or a path, and you passed neight as truthy.');
      return null;
    }
    const id = (await idFromPath({path}))?.id;
    if (!id) {
      warn('getSpreadsheet: WARNING: unable to find an ID at given path: ',path);
      return null;
    }
  }
  const res = await ((await sheets()).spreadsheets.get({
    spreadsheetId: id || '',
    ranges: [],
    includeGridData: false,
  }));
  // I don't know why the type of spreadsheets.get doesn't have result on it
  // @ts-ignore
  return res?.result;
}

export type SheetJson = {
  [key: string]: any,
};
export async function sheetToJson(
  {id, worksheetName}:
  {id: string, worksheetName: string}
): Promise<SheetJson[] | null> {
  const allrows = await getAllRows({id, worksheetName});
  if (!allrows || !allrows.values || allrows.values.length < 1) return null;
  const header = allrows.values[0];
  if (!header) return null;
  return allrows.values.slice(1).map(row => {
    const ret: SheetJson = {};
    for (const [index,key] of header.entries()) {
      ret[key] = row[index]; // get the ith item from the row and place at ith key from header
    }
    return ret;
  });
}

export type SpreadsheetJson = {
  [sheetname: string]: SheetJson[] | null,
};
export async function spreadsheetToJson(
  { id }:
  { id: string }
  // each sheet will be at a key that is its sheetname, and it will be an array of objects
): Promise<SpreadsheetJson | null> {
  // Getting each individual sheet via Google Sheets exceeds our quota.  Grab the whole thing as an xlsx,
  // then do the sheet_to_json conversion here:
  const wb = await googleSheetToXlsxWorkbook({ id });
  return wb.SheetNames.reduce((acc,worksheetName) => {
    acc[worksheetName] = xlsx.utils.sheet_to_json(wb.Sheets[worksheetName]!, { raw: false });
    return acc;
  },{} as SpreadsheetJson);
}

export async function createSpreadsheet({
  parentid=null,
  parentpath=null,
  name,
  worksheetName=false
// either give a parentid
}: {
  parentid: string | null | false,
  parentpath?:null,
  name: string,
  worksheetName?: string | false,
// or give a parentpath
} | {
  parentid?:null,
  parentpath: string,
  name: string,
  worksheetName?: string
}): Promise<{ id: string } | null > {
  if (!parentid && parentpath) {
    const result = await ensurePath({path: parentpath});
    if (!result) {
      warn('WARNING: google.createSpreadsheet: Unable to ensurePath for parentpath = ', parentpath);
      throw new Error('Unable to ensure path for parentpath '+parentpath);
    }
    parentid = result?.id;
  }
  const fileresult = await createFile({
    parentid,
    name,
    mimeType: 'application/vnd.google-apps.spreadsheet'
  });
  if (!fileresult) return null;
  const id = fileresult.id;
  if (!worksheetName) return {id};
  // If we have a worksheetName, add a worksheet with that name
  await ((await client()).sheets.spreadsheets.batchUpdate(
    { spreadsheetId: id },
    { 
      requests: [ 
        { 
          addSheet: { 
            properties: { 
              title: worksheetName, 
              index: 0 
            } 
          } 
        } 
      ]
    }
  ));
  return {id};
}


