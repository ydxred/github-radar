import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const temporary = await mkdtemp(resolve(tmpdir(),'github-radar-test-'));
process.env.GITHUB_TOP_DATA=temporary;
const {parseTrending,number,isRepo,trending,detail}=await import('../server/github.mjs');
const html=await readFile(new URL('./fixtures/trending-weekly.html',import.meta.url),'utf8');

test('real GitHub HTML produces exact metrics and preserves absent descriptions',()=>{
 const repos=parseTrending(html);
 assert.equal(repos.length,3);
 assert.equal(repos[0].id,'anthropics/financial-services');
 assert.equal(repos[0].stars,37735);
 assert.equal(repos[0].forks,5452);
 assert.equal(repos[0].periodStars,2633);
 assert.equal(repos[0].description,'');
 assert.equal(repos[0].language,'Python');
 assert.deepEqual(repos.map(r=>r.rank),[1,2,3]);
});
test('missing or malformed required metrics never become invented zeroes',()=>{
 assert.equal(number('0'),0);assert.equal(number('1,234 stars this week'),1234);
 assert.equal(number(''),null);assert.equal(number('unexpected'),null);
 assert.throws(()=>parseTrending(html.replaceAll('/stargazers','/new-stars')),/数字字段/);
 assert.throws(()=>parseTrending(html.replaceAll('float-sm-right','new-growth')),/数字字段/);
 assert.throws(()=>parseTrending('<html>Too many requests</html>'),/暂时不可用/);
 assert.deepEqual(parseTrending("<html>There aren't any trending repositories.</html>"),[]);
});
test('repository validation excludes path traversal and injected URLs',()=>{
 for(const id of ['a/b','owner-name/repo.js','owner/repo_name'])assert.equal(isRepo(id),true);
 for(const id of ['../b','a/..','a/b/c','https://example.com','a%2fb/c','a/b?x=1',null])assert.equal(isRepo(id),false);
});
test('cached success survives upstream failure, restart reads, and concurrent refreshes',async t=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;let now=originalNow(),calls=0,fail=false;
 Date.now=()=>now;
 globalThis.fetch=async()=>{calls++;if(fail)throw new Error('模拟网络中断');return new Response(html,{status:200});};
 t.after(async()=>{globalThis.fetch=originalFetch;Date.now=originalNow;await rm(temporary,{recursive:true,force:true});});
 const [a,b]=await Promise.all([trending('weekly',''),trending('weekly','')]);
 assert.equal(calls,1);assert.equal(a.data.length,3);assert.equal(a.fetchedAt,b.fetchedAt);
 const path=resolve(temporary,'trending-weekly-all.json'),disk=await readFile(path,'utf8');
 await trending('weekly','',true);assert.equal(calls,1);
 now+=65000;fail=true;
 const stale=await trending('weekly','',true);
 assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,a.fetchedAt);assert.match(stale.warning,/网络中断/);
 assert.equal(await readFile(path,'utf8'),disk);
 const again=await trending('weekly','');assert.equal(again.stale,true);assert.equal(calls,2);
 now+=31*60*1000;
 const freshModule=await import(`../server/github.mjs?restart=${now}`);
 const restored=await freshModule.trending('weekly','');assert.equal(restored.data.length,3);assert.equal(restored.stale,true);assert.equal(restored.fetchedAt,a.fetchedAt);
 fail=false;now+=65000;const recovered=await trending('weekly','',true);assert.equal(recovered.stale,false);
 await assert.rejects(()=>trending('yearly',''),/无效/);
 await assert.rejects(()=>detail('../secret'),/无效/);
});
