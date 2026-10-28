import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [mode, dir] = process.argv.slice(2);
const repo = process.env.FROZEN_CHECKOUT;
const { compare } = await import(pathToFileURL(join(repo,"spike/s2/check1/deviations.mjs")));
const { rowsFromRendered } = await import(pathToFileURL(join(repo,"spike/s2/harness/cards-completeness.mjs")));
const wantHead="78c86e9e7dcb066d5f9dd995529eddd3da1bd05d";
const chosen = new Map([
 ['normal []',new Set(['x','&','U'])],
 [`normal ${JSON.stringify(['g','U'])}`,new Set(['U'])],
 [`normal ${JSON.stringify(['"','+'])}`,new Set(['<C-d>'])],
 [`normal ${JSON.stringify(['"','_'])}`,new Set(['U'])],
 [`normal ${JSON.stringify(['<C-w>'])}`,new Set(['l'])],
]);
const read=(p)=>JSON.parse(readFileSync(p,'utf8'));
if(mode==='prepare') {
 mkdirSync(dir,{recursive:true});
 for(const set of ['defaults','extensions']) {
  const full=read(join(dir,'..','check2','input',`correctness-${set}.json`));
  const cards=full.filter(c=>chosen.has(c.id)).map(c=>({...c,rows:c.rows.filter(r=>chosen.get(c.id).has(r.key))}));
  assert.equal(cards.length,5);
  assert.equal(cards.reduce((n,c)=>n+c.rows.length,0),7);
  writeFileSync(join(dir,`input-${set}.json`),JSON.stringify(cards,null,1)+'\n');
 }
} else {
 const conditions=[];
 for(const version of ['1.141.0','1.134.0']) for(const set of ['defaults','extensions']) {
  const inputFile=join(dir,`input-${set}.json`),cards=read(inputFile);
  const raw=readFileSync(join(dir,`${set}-${version}.jsonl`),'utf8');
  const records=raw.trim().split('\n').map(JSON.parse);
  const [meta]=records, trials=records.filter(r=>r.type==='trial');
  assert.equal(records.length,9);assert.equal(meta.type,'meta');assert.equal(records.at(-1).type,'end');
  assert.equal(meta.version,version);assert.equal(meta.set,set);assert.equal(meta.trials,1);
  assert.equal(meta.build.head,wantHead);assert.equal(meta.build.id,'ea063e8764d97ec5');assert.deepEqual(meta.build.dirty,[]);
  assert.deepEqual(meta.renderPreparation,{panelBeforeVisible:false,panelAfterVisible:false});
  assert.equal(meta.inputSha256,createHash('sha256').update(readFileSync(inputFile)).digest('hex'));
  const measured=rowsFromRendered(meta.rendered,cards,set);
  const expected=measured.flatMap(c=>c.rows.map(r=>[JSON.stringify([c.id,r.key,0]),r]));
  assert.deepEqual(trials.map(t=>JSON.stringify([t.card,t.key,t.trial])).sort(),expected.map(([k])=>k).sort());
  const byKey=new Map(expected);
  for(const t of trials) {
   assert.equal(t.ok,true);assert.deepEqual(t.diff,[]);
   assert.equal(compare(byKey.get(JSON.stringify([t.card,t.key,0])).expect,t),'match');
   for(const field of ['beforeRegisters','afterRegisters']) if(t[field]?.[':']) assert.ok(Array.isArray(t[field][':'].lines));
  }
  conditions.push({version,set,trials:trials.length,sha256:createHash('sha256').update(raw).digest('hex')});
 }
 console.log(JSON.stringify({verdict:'pass',head:wantHead,build:'ea063e8764d97ec5',trials:28,conditions},null,2));
}
