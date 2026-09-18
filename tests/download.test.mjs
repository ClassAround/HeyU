import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'heyu-download-'))
buildSync({ entryPoints:['src/main/services/download.ts'], outfile:join(dir,'download.mjs'), bundle:true, platform:'node', format:'esm' })
const { downloadFile, validateMp4 } = await import(pathToFileURL(join(dir,'download.mjs')))
function atom(type, data=Buffer.alloc(0)) { const h=Buffer.alloc(8);h.writeUInt32BE(8+data.length);h.write(type,4);return Buffer.concat([h,data]) }
const good=Buffer.concat([atom('ftyp',Buffer.from('isom0000')),atom('moov'),atom('mdat',Buffer.from('123456789'))])
const dest=join(dir,'result.mp4')
const originalFetch=globalThis.fetch

test('download completion, integrity failures, and atomic replacement',async t=>{
 try {
  await t.test('valid download appears only after validation and matches every byte',async()=>{
   globalThis.fetch=async()=>new Response(good,{headers:{'content-type':'video/mp4','content-length':String(good.length)}})
   const progress=[];await downloadFile('https://example.test/file',dest,p=>progress.push(p))
   assert.deepEqual(readFileSync(dest),good);assert.equal(progress.at(-1),1)
   assert.ok(progress.slice(0,-1).every(p=>p<1));await validateMp4(dest)
  })
  await t.test('same-length corrupted MP4 does not overwrite the valid result',async()=>{
   const bad=Buffer.from(good);bad.writeUInt32BE(999999,16)
   globalThis.fetch=async()=>new Response(bad,{headers:{'content-length':String(bad.length)}})
   await assert.rejects(downloadFile('https://example.test/file',dest,()=>{}),/MP4/)
   assert.deepEqual(readFileSync(dest),good)
  })
  await t.test('HTML, incomplete range, and length mismatch are rejected',async()=>{
   for(const res of [new Response('<html/>',{headers:{'content-type':'text/html'}}),new Response(good,{status:206}),new Response(good,{headers:{'content-length':String(good.length+10)}})]){
    globalThis.fetch=async()=>res
    await assert.rejects(downloadFile('https://example.test/file',dest,()=>{}))
   }
   assert.deepEqual(readFileSync(dest),good)
  })
  await t.test('cancellation cleans up partial files and retains previous result',async()=>{
   const controller=new AbortController()
   globalThis.fetch=async()=>new Response(good)
   await assert.rejects(downloadFile('https://example.test/file',dest,()=>controller.abort(),controller.signal))
   assert.deepEqual(readFileSync(dest),good)
   assert.equal(readdirSync(dir).some(p=>p.endsWith('.part')),false)
  })
  await t.test('missing MP4 metadata is rejected',async()=>{
   const path=join(dir,'empty.mp4');writeFileSync(path,atom('mdat'))
   await assert.rejects(validateMp4(path),/MP4/)
  })
 }finally{globalThis.fetch=originalFetch;rmSync(dir,{recursive:true,force:true})}
})
