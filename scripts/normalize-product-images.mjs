import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = process.argv[2];
async function walk(dir) { const out=[]; for (const e of await fs.readdir(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) out.push(...await walk(p)); else if(/\.png$/i.test(e.name)) out.push(p); } return out; }
const files=await walk(root); let changed=0;
for (const file of files) { const meta=await sharp(file).metadata(); if(meta.width===1280 && meta.height===1280) continue; const tmp=`${file}.tmp.png`; await sharp(file).resize(1280,1280,{fit:'fill'}).png().toFile(tmp); await fs.rename(tmp,file); changed++; }
console.log(JSON.stringify({files:files.length,changed}));
