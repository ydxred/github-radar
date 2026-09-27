import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';

const storageSource=await readFile(new URL('../extension/storage.js',import.meta.url),'utf8');
const apiSource=await readFile(new URL('../extension/api.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const row=(id='demo/radar')=>({id,description:'一个公开项目',language:'Python',stars:20,forks:2,periodStars:3,rank:1});
const item=(id='demo/radar')=>({repo:row(id),period:'weekly',fetchedAt:'2026-09-28T00:00:00.000Z'});
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};

function harness(t,{network:overrides={}}={}){
 const indexedDB=new IDBFactory(),context=vm.createContext({indexedDB,structuredClone,crypto:webcrypto,URL,TextEncoder,Date,console,setTimeout,clearTimeout,setInterval,clearInterval});
 vm.runInContext(storageSource,context);vm.runInContext(apiSource,context);
 const storeFactory=vm.runInContext('RadarStore',context),apiFactory=vm.runInContext('RadarExtension',context);
 const name=`test-${randomUUID()}`,store=storeFactory.create({indexedDB,name}),otherStore=storeFactory.create({indexedDB,name});
 const clock={value:Date.parse('2026-09-28T00:00:00.000Z')},calls=[],intervals=new Map(),timeouts=[];
 const timers={setTimeout(fn,ms){timeouts.push({fn,ms});return setTimeout(fn,Math.min(ms,2));},clearTimeout,setInterval(fn,ms){const token=randomUUID();intervals.set(token,{fn,ms});return token;},clearInterval(token){intervals.delete(token);}};
 const github={
  async trending(period,language,{refresh}={}){calls.push({kind:'trending',period,language,refresh});return {data:[row(`demo/${language||'all'}-${period}`.replaceAll('+','p'))],period,language,source:`https://github.com/trending/${encodeURIComponent(language)}?since=${period}`,fetchedAt:new Date(clock.value).toISOString(),stale:false,cached:false};},
  async detail(id){calls.push({kind:'detail',id});return {data:{...row(id),archived:false,topics:[],license:'MIT',updatedAt:new Date(clock.value).toISOString()},fetchedAt:new Date(clock.value).toISOString(),stale:false,cached:false};},
  async release(id){calls.push({kind:'release',id});return {data:[{id:1,name:'v1',url:`https://github.com/${id}/releases/tag/v1`,tagName:'v1',publishedAt:new Date(clock.value).toISOString()}],fetchedAt:new Date(clock.value).toISOString(),stale:false,cached:false};},
  rateStatus(){return {configured:false,available:null,remaining:60,limit:60,resetAt:null,nextRetryAt:null,checkedAt:null,lastError:null};},
  async checkConnection(){calls.push({kind:'connection'});return this.rateStatus();},
  async readme(id){calls.push({kind:'readme',id});return {content:'public README',sourceUrl:`https://github.com/${id}`,sourceVersion:'abc'};},
  ...overrides,
 };
 const api=apiFactory.create({store,github,now:()=>clock.value,owner:'tab-one',timers});
 const other=apiFactory.create({store:otherStore,github,now:()=>clock.value,owner:'tab-two',timers});
 const post=(path,data)=>api.request(path,{method:'POST',data});
 t.after(async()=>{await api.stop();await other.stop();await api.whenIdle();await other.whenIdle();store.close();otherStore.close();});
 return {api,other,store,otherStore,clock,calls,github,timers,intervals,timeouts,post,context,storeFactory,apiFactory,indexedDB,name};
}

test('IndexedDB root state persists and concurrent tabs never lose read-modify-write changes',async t=>{
 const h=harness(t);const first=await h.store.read();assert.equal(first.schemaVersion,1);assert.equal(first.settings.localModel.enabled,false);
 await Promise.all(Array.from({length:80},(_,index)=>(index%2?h.store:h.otherStore).update(state=>{state.counter=(state.counter||0)+1;return state.counter;})));
 assert.equal((await h.store.read()).counter,80);
 await assert.rejects(h.store.update(async state=>{state.counter=0;}),/不能等待网络或异步/);
 assert.equal((await h.store.read()).counter,80);
 h.store.close();assert.equal((await h.store.read()).counter,80);
 const db=await new Promise((resolve,reject)=>{const request=h.indexedDB.open(h.name,1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 assert.deepEqual([...db.objectStoreNames],['state']);db.close();
});

test('quota errors reject after rollback and never claim a successful favorite or note save',async t=>{
 const h=harness(t);await h.post('/api/library/mutate',{type:'note',id:'demo/notes',text:'原笔记'});
 const before=plain(await h.api.request('/api/library')),original=IDBObjectStore.prototype.put;
 try{
  IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError');};
  await assert.rejects(h.post('/api/library/mutate',{type:'note',id:'demo/notes',text:'没有保存'}),error=>error.name==='QuotaExceededError'&&/未保存/.test(error.message));
 }finally{IDBObjectStore.prototype.put=original;}
 assert.deepEqual(plain(await h.other.request('/api/library')),before);
});

test('browser library operations retain notes, bound history and merge preferences transactionally',async t=>{
 const h=harness(t);
 await h.post('/api/library/mutate',{type:'favorite',...item(),value:true});
 await h.post('/api/library/mutate',{type:'note',id:'demo/radar',text:'私人笔记只留浏览器'});
 await Promise.all(Array.from({length:110},(_,index)=>h.post('/api/library/mutate',{type:'history',...item(`demo/repo${index}`)})));
 await h.post('/api/library/mutate',{type:'preferences',preferences:{theme:'dark',layout:'list'}});
 await h.post('/api/library/mutate',{type:'hide',id:'demo/radar'});
 await h.post('/api/library/mutate',{type:'favorite',id:'demo/radar',value:false});
 const library=await h.api.request('/api/library');
 assert.equal(library.history.length,100);assert.equal(library.history[0].repo.id,'demo/repo109');assert.equal(library.notes['demo/radar'],'私人笔记只留浏览器');assert.equal(library.favorites.length,0);
 assert.equal(library.readIds.length,110);assert.ok(library.hiddenIds.includes('demo/radar'));assert.equal(library.preferences.theme,'dark');
 await h.post('/api/library/mutate',{type:'unhide',id:'demo/radar'});assert.equal((await h.api.request('/api/library')).hiddenIds.length,0);
 assert.equal(h.calls.length,0,'Private writes must not make network requests');
});

test('imports validate the entire payload, merge without replacing existing notes and are idempotent',async t=>{
 const h=harness(t);await h.post('/api/library/mutate',{type:'note',id:'demo/radar',text:'当前笔记'});
 const payload={app:'github-top',version:2,favorites:[{...item(),note:'旧笔记'}],notes:{'demo/new':'导入笔记'},preferences:{theme:'dark'},readIds:['demo/radar']};
 const first=await h.post('/api/library/import',{payload,migrationId:'old-browser'});
 assert.equal(first.notes['demo/radar'],'当前笔记');assert.equal(first.notes['demo/new'],'导入笔记');assert.equal(first.favorites.length,1);
 assert.deepEqual(plain(await h.post('/api/library/import',{payload,migrationId:'old-browser'})),plain(first));
 const invalids=[{app:'other',version:2},{favorites:[item('demo/valid'),item('../escape')]},{notes:{'demo/radar':'x'.repeat(3001)}},JSON.parse('{"__proto__": {"polluted": true}}'),{preferences:{unknown:true}},{readIds:['invalid']},{favorites:[{...item(),repo:{...row(),stars:-1}}]}];
 for(const invalid of invalids){await assert.rejects(h.post('/api/library/import',{payload:invalid}));assert.deepEqual(plain(await h.api.request('/api/library')),plain(first));}
 const exported=await h.api.request('/api/library/export');assert.equal(exported.app,'github-top');assert.equal(exported.version,2);assert.equal(exported.favorites[0].note,'当前笔记');
 await assert.rejects(h.post('/api/library/import',{payload:{favorites:[],notes:{'demo/big':'x'.repeat(9*1024*1024)}}}),/8 MB/);
});

test('multiple valid small imports cannot accumulate a library too large to export and reimport',async t=>{
 const h=harness(t),notes=batch=>Object.fromEntries(Array.from({length:500},(_,index)=>[`batch${batch}/repo${index}`,'中'.repeat(3000)]));
 const first=await h.post('/api/library/import',{payload:{notes:notes(1)}});
 await assert.rejects(h.post('/api/library/import',{payload:{notes:notes(2)}}),/资料总量超过 8 MB.*未保存/);
 assert.equal((await h.api.request('/api/library')).revision,first.revision);assert.equal(Object.keys((await h.api.request('/api/library')).notes).length,500);
 const exported=await h.api.request('/api/library/export');assert.ok(new TextEncoder().encode(JSON.stringify(exported,null,2)).length<=8*1024*1024);
 const restored=await h.post('/api/library/import',{payload:exported});assert.equal(Object.keys(restored.notes).length,500);
 const backup=await h.post('/api/backups/create',{});assert.equal((await h.post('/api/backups/restore',{name:backup.name})).library.notes['batch1/repo1'],'中'.repeat(3000));
});

test('the 8 MB budget includes the actual UI pretty-printed export overhead near the boundary',async t=>{
 const h=harness(t),note='中'.repeat(3000),notes=Object.fromEntries(Array.from({length:930},(_,index)=>[`demo/r${index}`,note]));
 assert.ok(new TextEncoder().encode(JSON.stringify({notes})).length<8*1024*1024,'The external input itself is below the limit');
 const before=plain(await h.api.request('/api/library'));
 await assert.rejects(h.post('/api/library/import',{payload:{notes}}),/资料总量超过 8 MB.*未保存/);
 assert.deepEqual(plain(await h.api.request('/api/library')),before,'Oversize formatted exports must roll back the entire merge');
 delete notes['demo/r929'];await h.post('/api/library/import',{payload:{notes}});
 const exported=await h.api.request('/api/library/export'),downloaded=JSON.stringify(exported,null,2);
 assert.ok(new TextEncoder().encode(downloaded).length<=8*1024*1024);
 assert.equal(Object.keys((await h.post('/api/library/import',{payload:JSON.parse(downloaded)})).notes).length,929,'An accepted near-limit library must survive the exact downloadable format');
});

test('backup restore preserves a recovery copy and does not restore settings, caches or credentials',async t=>{
 const h=harness(t);await h.post('/api/library/mutate',{type:'note',id:'demo/radar',text:'备份状态'});
 const created=await h.post('/api/backups/create',{});assert.equal(created.scope,'library');assert.ok(created.size>0);assert.equal(created.payload,undefined);
 await h.post('/api/library/mutate',{type:'note',id:'demo/radar',text:'恢复前状态'});
 const settings=await h.api.request('/api/settings');settings.collector.enabled=false;await h.post('/api/settings',settings);
 await h.store.update(state=>{state.cache.boards.marker={keep:true};});
 const restored=await h.post('/api/backups/restore',{name:created.name});assert.equal(restored.library.notes['demo/radar'],'备份状态');assert.equal(restored.backup.kind,'before-restore');
 assert.equal((await h.api.request('/api/settings')).collector.enabled,false);assert.equal((await h.store.read()).cache.boards.marker.keep,true);
 const reversed=await h.post('/api/backups/restore',{name:restored.backup.name});assert.equal(reversed.library.notes['demo/radar'],'恢复前状态');
 for(let index=0;index<20;index++){h.clock.value++;await h.post('/api/backups/create',{});}
 assert.equal((await h.api.request('/api/backups')).length,14);
 await assert.rejects(h.post('/api/backups/restore',{name:'../../no-backup'}),/不存在/);
});

test('trending persists truthful discovery timestamps, deduplicates snapshots and uses stale fallback',async t=>{
 const h=harness(t),first=await h.api.request('/api/trending?period=weekly&language=python');
 assert.equal(h.calls.length,1);assert.equal(first.period,'weekly');
 const discoveries=await h.api.request('/api/discoveries');assert.equal(discoveries.length,1);assert.equal(discoveries[0].firstSeenAt,new Date(h.clock.value).toISOString());
 const timeline=await h.api.request('/api/timeline?name=demo/python-weekly&period=weekly');assert.equal(timeline.length,1);assert.equal(timeline[0].periodStars,3);
 const cached=await h.api.request('/api/trending?period=weekly&language=python&refresh=1');assert.equal(cached.cached,true);assert.equal(h.calls.length,1);
 h.clock.value+=31*60000;h.github.trending=async()=>{throw new Error('网络不可用');};
 const stale=await h.api.request('/api/trending?period=weekly&language=python');assert.equal(stale.stale,true);assert.equal(stale.fetchedAt,first.fetchedAt);assert.match(stale.warning,/网络不可用/);
 assert.equal((await h.api.request('/api/timeline?name=demo/python-weekly')).length,1);
 assert.equal((await h.api.request('/api/discoveries?since=2026-09-28T00%3A01%3A00Z')).length,0);
 await assert.rejects(h.api.request('/api/trending?period=yearly'));await assert.rejects(h.api.request('/api/discoveries?since=bad-date'));await assert.rejects(h.api.request('/api/timeline?name=../secrets'));
});

test('cross-tab board leases avoid duplicate network fetches and recover after an abandoned lease expires',async t=>{
 const h=harness(t),network=deferred();let requests=0;
 h.github.trending=async(period,language)=>{requests++;await network.promise;return {data:[row()],period,language,fetchedAt:new Date(h.clock.value).toISOString(),source:'https://github.com/trending',stale:false};};
 const first=h.api.request('/api/trending?period=daily'),second=h.other.request('/api/trending?period=daily');
 await new Promise(resolve=>setTimeout(resolve,15));assert.equal(requests,1);network.resolve();
 const results=await Promise.all([first,second]);assert.equal(results[0].data.length,1);assert.equal(results[1].data.length,1);assert.equal(requests,1);
 h.clock.value+=31*60000;await h.store.update(state=>{state.leases['board:daily:']={owner:'closed-tab',until:h.clock.value-1};});
 await h.other.request('/api/trending?period=daily');assert.equal(requests,2);
});

test('API Retry-After persists across tabs and reloads without blocking public trending HTML',async t=>{
 const h=harness(t);let rate={configured:false,remaining:0,limit:60,resetAt:new Date(h.clock.value+3600000).toISOString(),nextRetryAt:new Date(h.clock.value+3600000).toISOString(),checkedAt:new Date(h.clock.value).toISOString(),lastError:'等待重置'};
 h.github.rateStatus=()=>rate;h.github.detail=async()=>{throw Object.assign(new Error('等待重置'),{status:429});};
 // Persist a real failed request's rate state; this tab was initially unaware of the limit.
 let firstStatus=true;const limitedRate=h.github.rateStatus;h.github.rateStatus=()=>firstStatus?(firstStatus=false,{configured:false,remaining:null,nextRetryAt:null,checkedAt:null}):limitedRate();
 await assert.rejects(h.api.request('/api/repo?name=demo/limited'),/等待重置/);
 let otherRequests=0;const freshNetwork={...h.github,rateStatus:()=>({configured:false,remaining:null,nextRetryAt:null,checkedAt:null}),detail:async()=>{otherRequests++;return {data:{archived:false},fetchedAt:new Date(h.clock.value).toISOString()};}};
 const reloaded=h.apiFactory.create({store:h.otherStore,github:freshNetwork,now:()=>h.clock.value,owner:'fresh-tab',timers:h.timers});
 assert.equal((await reloaded.request('/api/status')).connection.nextRetryAt,rate.nextRetryAt);
 await assert.rejects(reloaded.request('/api/repo?name=demo/another'),/所有标签页暂停/);assert.equal(otherRequests,0);
 assert.equal((await reloaded.request('/api/trending?period=daily')).data.length,1,'API quota does not block public HTML');
 assert.equal((await reloaded.request('/api/status')).connection.nextRetryAt,rate.nextRetryAt,'An empty new tab rate state must not overwrite a persisted backoff');
 h.clock.value+=3600001;await reloaded.request('/api/repo?name=demo/another');assert.equal(otherRequests,1);
 assert.equal((await reloaded.request('/api/status')).connection.nextRetryAt,null);
});

test('HTML Retry-After persists separately and low nonzero API quota expires at its reset time',async t=>{
 const h=harness(t);await h.store.update(state=>{state.connection={configured:false,remaining:1,limit:60,resetAt:new Date(h.clock.value+60000).toISOString(),checkedAt:new Date(h.clock.value).toISOString(),nextRetryAt:null,webRetryAt:new Date(h.clock.value+3600000).toISOString()};});
 await assert.rejects(h.other.request('/api/trending?period=weekly'),/所有标签页暂停/);assert.equal(h.calls.length,0);
 await h.other.request('/api/repo?name=demo/allowed');assert.equal(h.calls.at(-1).kind,'detail');
 h.clock.value+=61000;const status=await h.api.request('/api/status');assert.equal(status.connection.remaining,null);assert.equal(status.connection.resetAt,null);assert.ok(status.connection.webRetryAt);
 await h.post('/api/library/mutate',{type:'favorite',...item(),value:true});await h.post('/api/favorites/check',{});await h.api.whenIdle();
 assert.equal((await h.api.request('/api/status')).collection.favoriteUpdates.length,1,'Expired low quota no longer permanently pauses favorite checks');
});

test('snapshots are bounded to 100 per project and period without inventing missing historical points',async t=>{
 const h=harness(t);h.github.trending=async(period,language)=>({data:[row()],period,language,fetchedAt:new Date(h.clock.value).toISOString(),source:'https://github.com/trending',stale:false});
 for(let index=0;index<105;index++){h.clock.value+=61000;await h.api.request('/api/trending?period=daily&refresh=1');}
 const timeline=await h.api.request('/api/timeline?name=demo/radar&period=daily');assert.equal(timeline.length,100);assert.ok(timeline[0].fetchedAt<timeline.at(-1).fetchedAt);
 assert.equal((await h.api.request('/api/discoveries')).length,1);
});

test('discoveries retain at most 3000 recent projects and new observation time is distinct from old source time',async t=>{
 const h=harness(t);await h.store.update(state=>{state.discoveries=Array.from({length:3000},(_,index)=>({...item(`old/repo${index}`),fetchedAt:'2026-01-01T00:00:00.000Z',firstSeenAt:'2026-01-01T00:00:00.000Z',lastSeenAt:'2026-01-01T00:00:00.000Z',language:'',source:'https://github.com/trending'}));});
 h.github.trending=async(period,language)=>({data:[row('new/observed')],period,language,source:'https://github.com/trending',fetchedAt:'2026-09-27T00:00:00.000Z',stale:false});
 await h.api.request('/api/trending');const discoveries=await h.api.request('/api/discoveries');assert.equal(discoveries.length,3000);
 const added=discoveries.find(value=>value.repo.id==='new/observed');assert.equal(added.firstSeenAt,'2026-09-28T00:00:00.000Z');assert.equal(added.fetchedAt,'2026-09-27T00:00:00.000Z');
});

test('collection is progressive, respects pause and has one lease across tabs',async t=>{
 const h=harness(t),gate=deferred();let called=0;
 const original=h.github.trending;h.github.trending=async(...args)=>{called++;if(called===1)await gate.promise;return original(...args);};
 const first=await h.api.runCollection();assert.equal(first.started,true);
 const second=await h.other.runCollection();assert.equal(second.started,false);
 const status=await h.other.request('/api/status');assert.equal(status.collection.running,true);assert.equal(status.collection.mode,'newtab-open');
 const settings=await h.api.request('/api/settings');settings.collector.enabled=false;await h.post('/api/settings',settings);
 gate.resolve();await h.api.whenIdle();assert.equal(called,1);assert.equal((await h.api.request('/api/discoveries')).length,1);
 const end=await h.api.request('/api/status');assert.equal(end.collection.running,false);assert.equal(end.collection.nextRunAt,null);
 await assert.rejects(h.api.runCollection(),/采集已暂停/);
});

test('first-use collection covers daily and weekly language boards and finishes without localhost or a model',async t=>{
 const h=harness(t);await h.api.start();assert.equal(h.calls.length,0,'Startup initializes storage and schedules collection without immediately requesting a network');await new Promise(resolve=>setTimeout(resolve,15));await h.api.whenIdle();
 const calls=h.calls.filter(value=>value.kind==='trending');assert.equal(calls.length,16);assert.deepEqual([...new Set(calls.map(value=>value.period))].sort(),['daily','weekly']);
 assert.ok(calls.some(value=>value.language==='go'));assert.ok(calls.some(value=>value.language==='rust'));assert.ok(calls.some(value=>value.language==='c++'));
 const status=await h.api.request('/api/status');assert.equal(status.browserOnly,true);assert.equal(status.storage,'indexeddb');assert.equal(status.model.connected,false);assert.equal(status.collection.boards.length,16);assert.equal(status.collection.running,false);assert.ok(status.collection.nextRunAt);
 assert.equal((await h.api.request('/api/discoveries')).length,16);assert.ok(status.backups.some(value=>value.kind==='auto'));
});

test('start returns a promise, initializes a daily backup without network, and stop cancels scheduled collection',async t=>{
 const h=harness(t),starting=h.api.start();assert.equal(typeof starting.then,'function');await starting;
 assert.equal(h.calls.length,0);assert.equal(h.intervals.size,1);assert.equal((await h.api.request('/api/backups')).length,1);
 await h.api.start();assert.equal(h.intervals.size,1,'Repeated startup must not duplicate the scheduler');
 await h.api.stop();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(h.calls.length,0);assert.equal(h.intervals.size,0);
 assert.equal((await h.api.request('/api/health')).version,'2.0.0');
});

test('collection failures are visible and stale or failed boards never report fabricated success',async t=>{
 const h=harness(t,{network:{trending:async()=>{throw new Error('GitHub 暂时不可用');}}});
 await h.api.runCollection();await h.api.whenIdle();const status=await h.api.request('/api/status');
 assert.equal(status.collection.boards.length,16);assert.equal(status.collection.lastSuccessAt,null);assert.ok(status.collection.boards.every(value=>value.count===null&&value.error==='GitHub 暂时不可用'));
 assert.equal((await h.api.request('/api/discoveries')).length,0);
});

test('favorite release checks use public GitHub data, preserve baseline and stop at low quota',async t=>{
 const h=harness(t);await h.post('/api/library/mutate',{type:'favorite',...item(),value:true});
 await h.post('/api/favorites/check',{});await h.api.whenIdle();let status=await h.api.request('/api/status');
 assert.equal(status.collection.favoriteUpdates[0].baseline,true);assert.equal(status.collection.favoriteUpdates[0].latest.tagName,'v1');
 h.clock.value+=7*60*60*1000;h.github.release=async()=>({data:[{id:2,tagName:'v2',url:'https://github.com/demo/radar/releases/tag/v2'}],stale:false});
 await h.post('/api/favorites/check',{});await h.api.whenIdle();status=await h.api.request('/api/status');assert.equal(status.collection.favoriteUpdates[0].newRelease,true);
 h.clock.value+=7*60*60*1000;h.github.rateStatus=()=>({configured:false,remaining:1,nextRetryAt:null});
 await h.post('/api/favorites/check',{});await h.api.whenIdle();assert.match((await h.api.request('/api/status')).collection.watchWarning,/额度不足/);
});

test('unsupported tokens and unconnected model generation reject honestly; explicit bridge delegation stays optional',async t=>{
 const h=harness(t);await assert.rejects(h.post('/api/token',{token:'must-not-be-stored'}),/不保存账号或 Token/);
 await assert.rejects(h.post('/api/summary',{id:'demo/radar'}),/请先连接本机 Codex/);
 const settings=await h.api.request('/api/settings');settings.localModel.enabled=true;await assert.rejects(h.post('/api/settings',settings),/请先/);
 assert.equal(h.calls.length,0);
 let summaries=0;const ai={status:async()=>({enabled:true,connected:true,provider:'codex'}),summarize:async data=>{summaries++;return {purpose:data.id};}};
 const connected=h.apiFactory.create({store:h.store,github:h.github,localAI:ai,now:()=>h.clock.value,owner:'model-test',timers:h.timers});
 assert.equal((await connected.request('/api/settings')).localModel.enabled,true);assert.equal(summaries,0);
 assert.equal((await connected.request('/api/summary',{method:'POST',data:{id:'demo/radar'}})).purpose,'demo/radar');assert.equal(summaries,1);
 assert.equal(h.calls.length,0);
});
