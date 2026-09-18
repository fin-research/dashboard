// @ts-nocheck
import { parseDebtWorkbookData } from '../../../scripts/financing/lib/excel-import.mjs';
import { transformWorkbook } from '../../../scripts/financing/lib/debt-transform.mjs';
import { validateWorkbook } from './debt-import-json.ts';
self.addEventListener('message', event => {
  try {
    const transformed = validateWorkbook(transformWorkbook(parseDebtWorkbookData(event.data.workbookData,event.data.fileName)));
    self.postMessage({type:'complete',transformed});
  } catch(error) { self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)}); }
});
