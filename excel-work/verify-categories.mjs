import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const products = wb.worksheets.getItem('Export Products Sheet');
const groups = wb.worksheets.getItem('Export Groups Sheet');
const productRows = products.getRange('A2:AA101').values;
const groupRows = groups.getRange('A2:B264').values;
const groupMap = new Map(groupRows.map((r) => [String(r[0] ?? ''), String(r[1] ?? '')]));
const rows = productRows.map((r) => ({code:String(r[0]??''), id:String(r[17]??''), name:String(r[18]??''), aa:String(r[26]??'')}));
console.log(JSON.stringify({
  productRows: rows.length,
  missingId: rows.filter((r)=>!r.id).map((r)=>r.code),
  missingName: rows.filter((r)=>!r.name).map((r)=>r.code),
  missingInGroups: rows.filter((r)=>!groupMap.has(r.id)).map((r)=>({code:r.code,id:r.id,name:r.name})),
  mismatchedGroupName: rows.filter((r)=>groupMap.has(r.id) && groupMap.get(r.id) !== r.name).map((r)=>({code:r.code,id:r.id,productName:r.name,groupName:groupMap.get(r.id)})),
  aaMismatch: rows.filter((r)=>r.id !== r.aa).map((r)=>({code:r.code,id:r.id,aa:r.aa})),
}, null, 2));
