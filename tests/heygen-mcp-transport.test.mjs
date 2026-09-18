import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir=mkdtempSync(join(tmpdir(),'heyu-mcp-test-'))
await build({stdin:{contents:`export * from './src/main/services/heygenMcpTransport'; export {HeyGenClient} from './src/main/services/heygen';`,resolveDir:process.cwd()},outfile:join(dir,'test.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'mock-mcp',setup(b){b.onResolve({filter:/^\.\/heygenMcp\.js$/},()=>({path:'mcp',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const heygenMcp={callTool:()=>{throw Error("unexpected real call")},status:()=>({connected:true})}'}))}}]})
const {mcpTransport,decodeMcpResult,HeyGenClient}=await import(pathToFileURL(join(dir,'test.mjs')))
const response = data => ({content:[{type:'text',text:JSON.stringify({data})}]})
test('MCP-only upload, translation and status: no REST endpoint or API credential',async()=>{
  const originalFetch=globalThis.fetch; const calls=[]; const file=join(dir,'source.mp4');writeFileSync(file,'test video')
  globalThis.fetch=async(url,init)=>{
    assert.equal(new URL(url).hostname,'upload.s3.amazonaws.com')
    assert.equal(init.method,'PUT');assert.equal(init.headers['x-api-key'],undefined)
    const reader=init.body.getReader();while(!(await reader.read()).done){}
    return new Response('',{status:200})
  }
  const client=new HeyGenClient(mcpTransport(async(name,args)=>{
    calls.push({name,args})
    if(name==='create_asset_upload')return response({asset_id:'asset-1',upload_url:'https://upload.s3.amazonaws.com/test',upload_headers:{'x-amz-test':'signed'}})
    if(name==='complete_asset_upload')return response({asset_id:'asset-1'})
    if(name==='create_video_translation')return response({video_translation_ids:['translation-1']})
    if(name==='get_video_translation')return response({status:'completed',video_url:'https://resource.heygen.com/result.mp4'})
    throw Error(name)
  }))
  try{
    const asset=await client.uploadVideo(file,()=>{})
    const id=await client.createTranslation(asset,{mode:'precision',removeMusic:true,useStockVoice:true})
    const done=await client.waitForTranslation(id,()=>{})
    assert.equal(done.status,'completed')
    assert.deepEqual(calls.map(c=>c.name),['create_asset_upload','complete_asset_upload','create_video_translation','get_video_translation'])
    assert.equal(calls[0].args.sizeBytes,10)
    assert.deepEqual(calls[2].args.video,{type:'asset_id',asset_id:'asset-1'})
    assert.deepEqual(calls[2].args.outputLanguages,['English'])
    assert.equal(calls[2].args.disableMusicTrack,true)
    assert.deepEqual(calls[2].args.stockVoiceConfig,{use_stock_voice:true})
    assert.deepEqual(calls[3].args,{videoTranslationId:'translation-1'})
  }finally{globalThis.fetch=originalFetch;rmSync(dir,{recursive:true,force:true})}
})
test('MCP credit errors propagate without retries or REST fallback',async()=>{
  let count=0
  const client=new HeyGenClient(mcpTransport(async()=>{count++;return{isError:true,content:[{type:'text',text:'Insufficient credit'}]}}))
  await assert.rejects(client.createTranslation('asset',{mode:'speed',removeMusic:false,useStockVoice:false}),/Insufficient credit/)
  assert.equal(count,1)
})
test('aborted requests do not call MCP; malformed results do not count as success',async()=>{
  const ctrl=new AbortController();ctrl.abort()
  await assert.rejects(mcpTransport(async()=>{throw Error('should not call')})('/v3/video-translations',{method:'POST',signal:ctrl.signal}),{name:'AbortError'})
  assert.throws(()=>decodeMcpResult({content:[]}),/해석/)
  assert.deepEqual(decodeMcpResult({structuredContent:{data:{id:'123'}}}),{data:{id:'123'}})
})
