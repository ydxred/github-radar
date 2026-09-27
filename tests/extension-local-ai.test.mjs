import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../extension/local-ai.js',import.meta.url),'utf8');
function harness({allowed=true,fail=false}={}){
 const values=new Map(),calls=[],permissionCalls=[];let granted=false;
 const context=vm.createContext({AbortSignal,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},chrome:{permissions:{request(options){permissionCalls.push({request:options});granted=allowed;return Promise.resolve(allowed);},async contains(){return granted;},async remove(options){permissionCalls.push({remove:options});granted=false;return true;}}},fetch:async(url,options)=>{
  calls.push({url,options});if(fail)throw new TypeError('offline');
  const data=url.endsWith('/health')?{ok:true,app:'github-top',features:['extension-summary']}:url.endsWith('/model')?{enabled:true,installed:true,authenticated:true}:{purpose:'来自公开 README 的说明',provider:'codex'};
  return {ok:true,json:async()=>data};
 }});vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);
 return {run,calls,values,permissionCalls};
}
test('Codex is completely optional: status never probes local service and denied permission never fetches',async()=>{
 const h=harness({allowed:false});assert.equal((await h.run('RadarLocalAI.status()')).connected,false);assert.equal(h.calls.length,0);
 const pending=h.run('RadarLocalAI.connect()');assert.equal(h.permissionCalls.length,1,'Permission must be requested synchronously within the click');
 assert.equal((await pending).connected,false);assert.equal(h.calls.length,0);
 await assert.rejects(h.run("RadarLocalAI.summarize({id:'demo/repo'})"),/先在设置中连接/);assert.equal(h.calls.length,0);
});
test('explicit connection probes identity and Codex readiness; generating transmits only a public repo id',async()=>{
 const h=harness();assert.equal((await h.run('RadarLocalAI.connect()')).connected,true);
 assert.deepEqual(h.calls.map(c=>c.url),['http://127.0.0.1:4317/api/health','http://127.0.0.1:4317/api/extension/model']);
 await h.run('RadarLocalAI.status()');assert.equal(h.calls.length,2);
 await h.run("RadarLocalAI.summarize({id:'demo/repo',provider:'codex',notes:'private',token:'secret'})");
 const call=h.calls.at(-1);assert.deepEqual(JSON.parse(call.options.body),{id:'demo/repo',provider:'codex',refresh:false});
 assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');
 const count=h.calls.length;
 await assert.rejects(h.run("RadarLocalAI.summarize({id:'../bad',provider:'codex'})"),/名称无效/);assert.equal(h.calls.length,count);
 assert.equal((await h.run('RadarLocalAI.disconnect()')).connected,false);
 assert.equal(h.permissionCalls.at(-1).remove.origins[0],'http://127.0.0.1:4317/*');
 assert.equal((await h.run('RadarLocalAI.status()')).connected,false);
});
test('offline companion does not persist an apparently successful connection',async()=>{
 const h=harness({fail:true}),result=await h.run('RadarLocalAI.connect()');
 assert.equal(result.connected,false);assert.match(result.message,/独立看板/);assert.equal(h.values.size,0);
 assert.equal((await h.run('RadarLocalAI.status()')).enabled,false);
});
