import xlsx from 'xlsx-js-style'; //'sheetjs-style';
import debug from 'debug';
const info = debug('af/accounts#test/browser/spreadsheets:info');
export default async function run( /*accounts: typeof accountsLib*/) {
    info('spreadsheet-specific browser tests');
    info('spreadsheets: testing download xlsx file');
    const data = [{ col1: 'row1col1', col2: 'row1col2' }, { col1: 'row2col2', col2: 'row2col2' }];
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);
    ws['A1'].s = {
        fill: {
            patternType: 'solid',
            fgColor: { rgb: "FFFFAA00" },
        }
    };
    xlsx.utils.book_append_sheet(wb, ws, 'testsheet');
    xlsx.writeFile(wb, 'TESTWB.xlsx', { bookType: 'xlsx' });
    info('google: passed all google tests');
}
//# sourceMappingURL=spreadsheets.test.js.map