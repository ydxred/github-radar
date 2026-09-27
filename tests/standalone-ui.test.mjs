import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const definitions=source.slice(0,source.indexOf("document.querySelectorAll('[data-icon]')"));
const clone=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settings=()=>({collector:{enabled:true,intervalMinutes:120,languages:['','python'],periods:['daily','weekly'],watchReleases:false},localModel:{enabled:false,provider:'codex'}});
const library=()=>({revision:0,favorites:[],history:[],notes:{},readIds:[],hiddenIds:[],preferences:{},lastVisitAt:null});
const status=()=>({collection:{running:false,boards:[],lastFinishedAt:null,nextRunAt:null,error:null,favoriteUpdates:[]},connection:{configured:false,remaining:42,limit:60,resetAt:'2026-09-27T12:00:00Z'},backups:[{name:'manual-example',createdAt:'2026-09-27T10:00:00Z',kind:'manual',size:1200}],model:{provider:'codex',enabled:false}});
function harness({ai={},handler}={}){
 const elements=new Map(),calls=[],aiCalls=[];let fetchCalls=0;
 function element(id){if(!elements.has(id))elements.set(id,{id,hidden:false,open:false,value:'',innerHTML:'',textContent:'',selectedIndex:0,classList:{toggle(){},contains(){return false}},setAttribute(key,value){this[key]=value;},querySelector:element,showModal(){this.open=true;},close(){this.open=false;},appendChild(){},remove(){},click(){}});return elements.get(id);}
 const document={getElementById:element,querySelector:element,querySelectorAll:()=>[],body:element('body'),createElement:element};
 const disconnected={connected:false,available:false,authenticated:false,enabled:false,provider:'codex',message:'尚未连接'};
 const context=vm.createContext({document,Date,console,Blob,AbortSignal,crypto:{randomUUID:()=> 'test-id'},navigator:{clipboard:{writeText:async()=>{}}},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},fetch:()=>{fetchCalls++;throw new Error('Standalone UI must not use fetch');},RadarExtension:{request:async(url,options)=>{calls.push({url,...options});if(handler){const result=await handler(url,options);if(result!==undefined)return result;}if(url==='/api/library'||url==='/api/library/mutate')return library();if(url==='/api/settings')return options.method==='POST'?options.data:settings();if(url==='/api/status')return status();if(url==='/api/discoveries'||url.startsWith('/api/timeline?'))return [];if(url.startsWith('/api/trending?'))return {data:[],fetchedAt:'2026-09-27T10:00:00Z',source:'https://github.com/trending'};if(url.startsWith('/api/repo?'))return {data:{stars:1,forks:1,topics:[],license:'MIT'},fetchedAt:'2026-09-27T10:00:00Z'};return {ok:true};}},RadarLocalAI:{status:async()=>{aiCalls.push('status');return disconnected;},connect:()=>{aiCalls.push('connect');return Promise.resolve({...disconnected,connected:true,available:true,authenticated:true,enabled:true,message:'Codex 可用'});},disconnect:async()=>{aiCalls.push('disconnect');return disconnected;},...ai}});
 vm.runInContext(definitions,context);const run=code=>vm.runInContext(code,context);
 context.initialSettings=settings();context.initialStatus=status();context.initialLibrary=library();run('state.settings=initialSettings;state.status=initialStatus;applyLibrary(initialLibrary);state.ready=true;');
 return {run,context,element,calls,aiCalls,get fetchCalls(){return fetchCalls;}};
}

test('standalone requests delegate method, data and timeout without falling back to a local server',async()=>{
 const h=harness();
 const value=await h.run("request('/api/example',{method:'POST',data:{id:'demo/tool'},timeout:1234})");
 assert.deepEqual(clone(value),{ok:true});assert.deepEqual(clone(h.calls),[{url:'/api/example',method:'POST',data:{id:'demo/tool'},timeout:1234}]);assert.equal(h.fetchCalls,0);
 const failed=harness({handler:()=>{throw new Error('浏览器存储暂时不可用');}});
 await assert.rejects(failed.run("request('/api/library')"),/浏览器存储暂时不可用/);assert.equal(failed.fetchCalls,0);
});

test('standalone bootstrap and unconnected summary work without connecting or invoking a model',async()=>{
 const h=harness();await h.run('bootstrap()');
 assert.equal(h.run('state.ready'),true);assert.equal(h.fetchCalls,0);assert.ok(!h.aiCalls.includes('connect'));
 assert.match(h.run('summaryButtonLabel()'),/连接本机 Codex（可选）/);
 await h.run("generateSummary({id:'demo/project'},1)");
 assert.equal(h.element('settings-dialog').open,true);assert.equal(h.calls.some(call=>call.url==='/api/summary'),false);assert.ok(!h.aiCalls.includes('connect'));
 assert.match(h.element('storage-status').textContent,/浏览器/);assert.doesNotMatch(h.element('storage-status').textContent,/每日自动备份/);
});

test('standalone settings describe browser lifetime and limited backups without token or offline-model configuration',()=>{
 const h=harness();h.run('renderSettings()');const html=h.element('settings-content').innerHTML;
 assert.match(html,/只有开源雷达新标签页打开时/);assert.match(html,/卸载扩展或清理扩展数据/);assert.match(html,/不包含收录库、榜单缓存或本机连接授权/);assert.match(html,/最近 14 份/);
 assert.match(html,/检查匿名额度/);assert.doesNotMatch(html,/id="github-token"|id="save-token"|id="summary-provider"|Qwen|网页关闭后仍可收集|每天自动保留/);
 h.run('configureStandaloneUI()');assert.match(h.element('.local-badge').textContent,/浏览器独立运行/);assert.match(h.element('#help-dialog .help-sections').innerHTML,/卸载扩展/);assert.match(h.element('#restore-dialog>p').textContent,/收录库、榜单缓存和本机连接授权不受影响/);
 h.run("state.view='favorites';render()");assert.match(h.element('page-subtitle').textContent,/卸载扩展或清理扩展数据会丢失/);assert.doesNotMatch(h.element('page-subtitle').textContent,/依然可以找回来/);
});

test('Codex connection starts synchronously inside the explicit click and updates status after completion',async()=>{
 const h=harness();h.run('renderSettings()');
 assert.deepEqual(h.aiCalls,[]);h.element('connect-local-ai').onclick();
 assert.deepEqual(h.aiCalls,['connect'],'permission-request bridge must run before leaving the click handler');
 await tick();await tick();assert.equal(h.run('state.localAI.connected'),true);assert.match(h.run('summaryButtonLabel()'),/用 Codex 解读/);
 assert.match(h.element('settings-content').innerHTML,/断开并撤销权限/);assert.equal(h.fetchCalls,0);
 await h.element('disconnect-local-ai').onclick();assert.equal(h.run('state.localAI.connected'),false);assert.match(h.run('summaryButtonLabel()'),/连接本机 Codex/);
});

test('denied optional permission leaves standalone features usable and never invokes summary',async()=>{
 const h=harness({ai:{connect:()=>Promise.resolve({connected:false,available:false,enabled:false,provider:'codex',message:'没有授予本机访问权限'})}});h.run('renderSettings()');h.element('connect-local-ai').onclick();await tick();await tick();
 assert.equal(h.run('state.localAI.connected'),false);assert.match(h.element('local-ai-message').textContent,/没有授予/);assert.equal(h.calls.some(call=>call.url==='/api/summary'),false);assert.equal(h.fetchCalls,0);
 await h.run("switchView('topics')");assert.equal(h.run('state.view'),'topics');
});

test('optional bridge status failures never prevent browser library startup',async()=>{
 const h=harness({ai:{status:async()=>{throw new Error('可选桥状态读取失败');}}});
 await h.run('bootstrap()');assert.equal(h.run('state.ready'),true);assert.equal(h.run('state.localAI.connected'),false);assert.match(h.run('state.localAI.message'),/独立使用/);assert.equal(h.fetchCalls,0);
});

test('connected summaries send only project id and provider through the extension API',async()=>{
 const h=harness({handler:url=>url==='/api/summary'?{provider:'codex',model:'Codex',purpose:'公开项目解读',sourceUrl:'https://github.com/demo/project#readme',generatedAt:'2026-09-27T10:00:00Z'}:undefined});
 h.run("state.localAI.connected=true;state.notes={'demo/project':'PRIVATE NOTE'};state.detailRequest=1");
 await h.run("generateSummary({id:'demo/project'},1)");
 const call=h.calls.find(call=>call.url==='/api/summary');assert.deepEqual(clone(call.data),{id:'demo/project',provider:'codex'});assert.equal(call.timeout,260000);assert.equal(h.fetchCalls,0);assert.match(h.element('summary-content').innerHTML,/本机 Codex · 联网解读/);
});
