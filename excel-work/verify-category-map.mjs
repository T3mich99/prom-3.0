import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const products = wb.worksheets.getItem('Export Products Sheet');
const groups = wb.worksheets.getItem('Export Groups Sheet');
const rows = products.getRange('A2:AA101').values;
const gr = groups.getRange('A2:F264').values;
const byExternal = new Map();
for (const r of gr) { if (r[3] != null && String(r[3]).trim()) byExternal.set(String(r[3]), {number:r[0], ru:r[1], ua:r[2], parent:r[4], parentExternal:r[5]}); }
const out = rows.map((r)=>{const id=String(r[26]??'');return {code:String(r[0]??''),externalId:id,existing:byExternal.get(id)||null};});
console.log(JSON.stringify({rows:out.length,missing:out.filter(x=>!x.existing),mapped:out.filter(x=>x.existing).length,examples:out.slice(0,10)},null,2));
