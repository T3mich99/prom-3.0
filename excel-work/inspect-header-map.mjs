import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(process.argv[2]));
const sh = wb.worksheets.getItem('Export Products Sheet');
const headers = sh.getRange('A1:DD1').values[0];
const row = sh.getRange('A2:DD2').values[0];
const letters = (n) => { let s=''; while(n>=0){s=String.fromCharCode(n%26+65)+s; n=Math.floor(n/26)-1;} return s; };
console.log(JSON.stringify(headers.map((h,i)=>({col:letters(i),header:h,value:row[i]})).filter(x=>x.header), null, 2));
