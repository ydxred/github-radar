// Local extension APIs. Only public GitHub requests leave the browser by default.
const RadarExtension=(()=>{
 const PERIODS=['daily','weekly','monthly'];
 const LANGUAGES=['','python','typescript','javascript','go','rust','java','c++','c','c#','swift','kotlin','php','ruby','shell','jupyter-notebook','html','css'];
 const MAX=3000,FLAGS_MAX=20000,CACHE_TTL=30*60*1000,LEASE_MS=90000;
 const clone=value=>structuredClone(value),lower=value=>value.toLowerCase();
 const fail=(message,status=400)=>Object.assign(new Error(message),{status});
 function object(value,label='数据'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.prototype.toString.call(value)!=='[object Object]'||Object.keys(value).some(key=>['__proto__','prototype','constructor'].includes(key)))throw fail(`${label}格式无效`);
  return value;
 }
 function id(value){if(typeof value!=='string'||value.length>=220||!/^[\w.-]+\/[\w.-]+$/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw fail('项目名称无效');return value;}
 function date(value,fallback=null){if(value==null||value==='')return fallback;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw fail('日期格式无效');return new Date(value).toISOString();}
 function text(value,max,label){if(typeof value!=='string'||value.length>max)throw fail(`${label}过长或格式无效`);return value;}
 function number(value){if(value==null)return null;if(!Number.isSafeInteger(value)||value<0)throw fail('项目数字必须是非负整数');return value;}
 function repo(value){object(value,'项目');const name=id(value.id),[owner,shortName]=name.split('/');return {id:name,owner,name:shortName,url:`https://github.com/${name}`,description:text(value.description??'',10000,'简介'),language:text(value.language??'未标注',80,'语言'),languageColor:/^#[a-f\d]{3,8}$/i.test(value.languageColor||'')?value.languageColor:'#94a3b8',stars:number(value.stars),forks:number(value.forks),periodStars:number(value.periodStars),rank:number(value.rank)??0};}
 function entry(value,now){object(value,'记录');if(!PERIODS.includes(value.period))throw fail('周期无效');return {repo:repo(value.repo),period:value.period,fetchedAt:date(value.fetchedAt),savedAt:date(value.savedAt,now),viewedAt:date(value.viewedAt,now)};}
 function preferences(value){
  object(value,'偏好');const output={},enums={theme:['light','dark'],layout:['grid','list'],period:PERIODS,sort:['rank','stars','growth','recent','periodStars'],topic:['all','ai','dev','data','finance','learn','other']};
  for(const [key,val] of Object.entries(value)){
   if(Object.hasOwn(enums,key)){if(!enums[key].includes(val))throw fail(`${key} 偏好无效`);output[key]=val;}
   else if(key==='language'){if(typeof val!=='string'||val.length>60||!/^[\w+#.-]*$/.test(val))throw fail('语言偏好无效');output[key]=val;}
   else if(key==='newOnly'){if(typeof val!=='boolean')throw fail('新发现偏好无效');output[key]=val;}
   else throw fail(`不支持的偏好：${key}`);
  }return output;
 }
 function list(value,max,label){if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)throw fail(`${label}最多支持 ${max} 条`);return value;}
 function normalizeImport(payload,now,{checkSize=true}={}){
  object(payload,'备份');let bytes;try{bytes=new TextEncoder().encode(JSON.stringify(payload)).length;}catch{throw fail('备份格式无效');}if(checkSize&&bytes>8*1024*1024)throw fail('备份不能超过 8 MB');
  if(Object.hasOwn(payload,'app')&&(payload.app!=='github-top'||![1,2].includes(payload.version)))throw fail('请选择开源雷达导出的备份');
  const favorites=list(payload.favorites,MAX,'收藏').map(value=>entry(value,now)),history=list(payload.history,100,'历史').map(value=>entry(value,now)),notes={};
  if(payload.notes!==undefined){object(payload.notes,'笔记');if(Object.keys(payload.notes).length>MAX)throw fail('笔记超过 3000 条');for(const [name,value] of Object.entries(payload.notes))notes[id(name)]=text(value,3000,'笔记');}
  for(const value of payload.favorites||[])if(Object.hasOwn(value,'note')){const note=text(value.note,3000,'笔记');if(!notes[value.repo.id])notes[value.repo.id]=note;}
  return {favorites,history,notes,preferences:payload.preferences===undefined?{}:preferences(payload.preferences),readIds:list(payload.readIds,FLAGS_MAX,'已读').map(id),hiddenIds:list(payload.hiddenIds,FLAGS_MAX,'隐藏').map(id),lastVisitAt:date(payload.lastVisitAt)};
 }
 function settings(input){
  object(input,'设置');if(Object.keys(input).some(key=>!['collector','localModel'].includes(key)))throw fail('设置格式无效');
  const c=input.collector,m=input.localModel;object(c,'采集设置');object(m,'解读设置');
  if(typeof c.enabled!=='boolean'||![60,120,240,720,1440].includes(c.intervalMinutes)||!Array.isArray(c.languages)||!c.languages.length||c.languages.length>8||c.languages.some(value=>!LANGUAGES.includes(value))||!Array.isArray(c.periods)||!c.periods.length||c.periods.some(value=>!PERIODS.includes(value))||typeof c.watchReleases!=='boolean'||typeof m.enabled!=='boolean'||m.provider!==undefined&&!['codex','local'].includes(m.provider))throw fail('请选择有效的采集周期与语言');
  return {collector:{enabled:c.enabled,intervalMinutes:c.intervalMinutes,languages:[...new Set(c.languages)],periods:[...new Set(c.periods)],watchReleases:c.watchReleases},localModel:{enabled:m.enabled,provider:m.provider||'codex'}};
 }
 const findEntry=(values,name)=>values.findIndex(value=>lower(value.repo.id)===lower(name));
 const noteKey=(notes,name)=>Object.keys(notes).find(key=>lower(key)===lower(name))||name;
 function flag(library,key,name,on){name=id(name);library[key]=library[key].filter(value=>lower(value)!==lower(name));if(on)library[key].push(name);if(new Set([...library.readIds,...library.hiddenIds].map(lower)).size>FLAGS_MAX)throw fail('阅读标记超过上限');}
 function portable(library,now){return {app:'github-top',version:2,exportedAt:now,...library,favorites:library.favorites.map(item=>({...item,note:library.notes[noteKey(library.notes,item.repo.id)]||''}))};}
 function bounded(library){
  if(library.favorites.length>MAX||Object.keys(library.notes).length>MAX)throw fail('收藏或笔记超过 3000 条，这次更改未保存');
  // Match the UI's downloadable, two-space-indented JSON byte for byte.
  const bytes=new TextEncoder().encode(JSON.stringify(portable(library,'2000-01-01T00:00:00.000Z'),null,2)).length;
  if(bytes>8*1024*1024)throw fail(`资料总量超过 8 MB（合并后导出约 ${(bytes/1024/1024).toFixed(1)} MB），这次更改未保存。请先导出资料并减少不需要的收藏或笔记。`);
 }
 function history(library,value){library.history=library.history.filter(item=>lower(item.repo.id)!==lower(value.repo.id));library.history.unshift(value);library.history.sort((a,b)=>b.viewedAt.localeCompare(a.viewedAt));library.history=library.history.slice(0,100);}
 function backup(state,now,kind='manual'){
  if(kind==='auto'){const found=state.backups.find(value=>value.kind==='auto'&&value.createdAt.slice(0,10)===now.slice(0,10));if(found)return backupInfo(found);}
  const payload=clone(state.library),value={name:`radar-${kind}-${now.replace(/[:.]/g,'-')}-${crypto.randomUUID()}.json`,kind,createdAt:now,size:new TextEncoder().encode(JSON.stringify(payload)).length,scope:'library',payload};
  state.backups.unshift(value);state.backups=state.backups.slice(0,14);return backupInfo(value);
 }
 const backupInfo=({payload,...value})=>value;
 function snapshot(state,result,now){
  object(result,'榜单');if(!PERIODS.includes(result.period)||!LANGUAGES.includes(result.language)||!Array.isArray(result.data)||result.data.length>100)throw fail('榜单格式无效');
  const fetchedAt=date(result.fetchedAt);if(!fetchedAt)throw fail('榜单缺少真实采集时间');
  const source=result.source;if(typeof source!=='string'||source.length>500||!/^https:\/\/github\.com\/trending(?:[/?]|$)/.test(source))throw fail('榜单来源无效');
  const rows=result.data.map(repo),discoveries=new Map(state.discoveries.map(value=>[lower(value.repo.id),value]));
  for(const value of rows){
   const key=lower(value.id),old=discoveries.get(key);
   if(!old||fetchedAt>=old.fetchedAt)discoveries.set(key,{repo:value,period:result.period,language:result.language,fetchedAt,source,firstSeenAt:old?.firstSeenAt||now,lastSeenAt:old&&old.lastSeenAt>fetchedAt?old.lastSeenAt:fetchedAt});
   const record={repoId:value.id,period:result.period,language:result.language,fetchedAt,source,stars:value.stars,forks:value.forks,periodStars:value.periodStars,rank:value.rank};
   if(!state.snapshots.some(item=>lower(item.repoId)===key&&item.period===record.period&&item.language===record.language&&item.fetchedAt===fetchedAt))state.snapshots.push(record);
  }
  state.discoveries=[...discoveries.values()].sort((a,b)=>b.lastSeenAt.localeCompare(a.lastSeenAt)||a.repo.id.localeCompare(b.repo.id)).slice(0,MAX);
  const kept=new Set(state.discoveries.map(value=>lower(value.repo.id))),counts=new Map();
  state.snapshots.sort((a,b)=>b.fetchedAt.localeCompare(a.fetchedAt));
  state.snapshots=state.snapshots.filter(value=>{if(!kept.has(lower(value.repoId)))return false;const key=`${lower(value.repoId)}:${value.period}`,count=(counts.get(key)||0)+1;counts.set(key,count);return count<=100;}).slice(0,30000);
  return {...result,data:rows,period:result.period,language:result.language,fetchedAt,source};
 }
 function create({store=RadarStore,github,localAI,now=()=>Date.now(),owner=crypto.randomUUID(),timers=globalThis}={}){
  const network=()=>github||(typeof RadarGitHub!=='undefined'?RadarGitHub:null);
  const ai=()=>localAI||(typeof RadarLocalAI!=='undefined'?RadarLocalAI:null);
  const timestamp=()=>new Date(now()).toISOString();
  const wait=ms=>new Promise(resolve=>timers.setTimeout(resolve,ms));
  let timer=null,firstTimer=null,heartbeat=null,pending=null,stopped=false,lastFailure=null;
  const inFlight=new Map();
  function api(){const value=network();if(!value)throw fail('GitHub 连接模块未就绪，请重新加载扩展',503);return value;}
  function cleanRate(input){
   const value={configured:false,available:null,remaining:null,limit:null,resetAt:null,nextRetryAt:null,webRetryAt:null,checkedAt:null,lastError:null,...input,configured:false};
   if(value.resetAt&&Date.parse(value.resetAt)<=now()){value.remaining=null;value.resetAt=null;}
   if(value.nextRetryAt&&Date.parse(value.nextRetryAt)<=now()){value.nextRetryAt=null;value.available=null;value.lastError=null;if(value.remaining===0)value.remaining=null;}
   if(value.webRetryAt&&Date.parse(value.webRetryAt)<=now())value.webRetryAt=null;
   return value;
  }
  function mergeRate(saved,incoming){
   const a=cleanRate(saved),b=cleanRate(incoming),at=Date.parse(a.checkedAt)||0,bt=Date.parse(b.checkedAt)||0;
   const value={...(bt>at||!at?b:a)};
   if((at===bt||a.resetAt&&a.resetAt===b.resetAt)&&a.remaining!==null&&b.remaining!==null)value.remaining=Math.min(a.remaining,b.remaining);
   const later=(x,y)=>[x,y].filter(time=>time&&Date.parse(time)>now()).sort((left,right)=>Date.parse(right)-Date.parse(left))[0]||null;
   value.nextRetryAt=later(a.nextRetryAt,b.nextRetryAt);value.webRetryAt=later(a.webRetryAt,b.webRetryAt);
   if(value.nextRetryAt){value.available=false;value.lastError=b.nextRetryAt===value.nextRetryAt?b.lastError:a.lastError;}
   return value;
  }
  const rateStatus=async()=>mergeRate((await store.read()).connection,api().rateStatus());
  async function networkCall(method,...args){
   const shared=await rateStatus(),retry=method==='trending'?shared.webRetryAt:shared.nextRetryAt;
   if(retry&&Date.parse(retry)>now()){
    if(method==='checkConnection')return shared;
    throw fail(method==='trending'?'GitHub 榜单访问暂时受限，已在所有标签页暂停请求，请稍后重试':'GitHub API 额度暂时受限，已在所有标签页暂停请求，请在重试时间后再试',429);
   }
   let result,error;try{result=await api()[method](...args);}catch(problem){error=problem;}
   const latest=api().rateStatus();
   await store.update(state=>{state.connection=mergeRate(state.connection,latest);});
   if(error)throw error;return result;
  }
  const library=()=>store.read().then(state=>state.library);
  const modelStatus=async()=>ai()?.status?await ai().status():{enabled:false,provider:'codex',connected:false,installed:false,state:'disconnected',message:'本机 Codex 可选，未连接'};
  async function mutate(action){
   object(action,'操作');return store.update(state=>{
    const l=state.library,time=timestamp(),type=action.type;
    if(['favorite','favorite:toggle','favorite:set'].includes(type)){
     const name=id(action.repo?.id||action.id),index=findEntry(l.favorites,name),on=action.value??action.saved??index<0;if(typeof on!=='boolean')throw fail('收藏状态无效');
     if(!on){if(index>=0)l.favorites.splice(index,1);}
     else{const value=entry({...action,savedAt:index>=0?l.favorites[index].savedAt:time},time);if(index>=0)l.favorites[index]=value;else l.favorites.unshift(value);}
    }else if(['note','note:set'].includes(type)){const name=noteKey(l.notes,id(action.id)),value=text(action.text??action.note,3000,'笔记');if(value)l.notes[name]=value;else delete l.notes[name];}
    else if(['history','history:view'].includes(type)){const value=entry({...action,viewedAt:time},time);history(l,value);flag(l,'readIds',value.repo.id,true);}
    else if(['preferences','preferences:merge'].includes(type))l.preferences={...l.preferences,...preferences(action.preferences??action.patch)};
    else if(['read','unread','hide','unhide'].includes(type))flag(l,['read','unread'].includes(type)?'readIds':'hiddenIds',action.id,['read','hide'].includes(type));
    else if(type==='markVisit')l.lastVisitAt=date(action.at,time);
    else throw fail('不支持的保存操作');
    l.revision++;bounded(l);backup(state,time,'auto');return l;
   });
  }
  async function importLibrary(payload,migrationId){
   const clean=normalizeImport(payload,timestamp());if(migrationId!==undefined)text(migrationId,120,'迁移标识');
   return store.update(state=>{
    const l=state.library;if(migrationId!==undefined&&state.migrations.includes(migrationId))return l;
    for(const value of clean.favorites)if(findEntry(l.favorites,value.repo.id)<0)l.favorites.push(value);
    for(const [name,note]of Object.entries(clean.notes)){const key=noteKey(l.notes,name);if(note&&!l.notes[key])l.notes[key]=note;}
    for(const value of clean.history){const index=findEntry(l.history,value.repo.id);if(index<0||l.history[index].viewedAt<value.viewedAt)history(l,value);}
    l.preferences={...clean.preferences,...l.preferences};for(const name of clean.readIds)flag(l,'readIds',name,true);for(const name of clean.hiddenIds)flag(l,'hiddenIds',name,true);
    if(!l.lastVisitAt)l.lastVisitAt=clean.lastVisitAt;l.favorites.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));l.revision++;bounded(l);
    if(migrationId!==undefined){if(state.migrations.length>=10000)throw fail('迁移标记达到上限，请使用普通导入');state.migrations.push(migrationId);}
    backup(state,timestamp(),'auto');return l;
   });
  }
  async function trending(period='daily',language='',refresh=false){
   if(!PERIODS.includes(period)||!LANGUAGES.includes(language))throw fail('榜单筛选无效');
   const key=`${period}:${language}`,leaseKey=`board:${key}`;
   if(inFlight.has(key))return inFlight.get(key);
   const task=(async()=>{
    let old;
    const deadline=now()+LEASE_MS+5000;
    while(true){
     const decision=await store.update(state=>{
      const cached=state.cache.boards[key];old=cached;
      if(cached&&now()-Date.parse(cached.fetchedAt)<(refresh?60000:CACHE_TTL))return {cached};
      const lease=state.leases[leaseKey];if(lease&&lease.until>now())return {busy:true,cached};
      state.leases[leaseKey]={owner,until:now()+LEASE_MS};return {claimed:true};
     });
     if(decision.cached&&(!decision.busy||!refresh))return {...decision.cached,cached:true,stale:decision.busy||Boolean(decision.cached.stale),...(decision.busy?{warning:'其他标签页正在更新，先显示上次缓存'}:{})};
     if(decision.claimed)break;
     if(now()>=deadline)throw fail('另一标签页正在刷新榜单，请稍后再试',409);
     await wait(150);
    }
    let result;
    try{result=await networkCall('trending',period,language,{refresh});}
    catch(error){await store.update(state=>{if(state.leases[leaseKey]?.owner===owner)delete state.leases[leaseKey];});if(old&&error.name!=='QuotaExceededError')return {...old,cached:true,stale:true,warning:error.message||'网络异常，显示上次成功数据'};throw error;}
    try{return await store.update(state=>{
      if(state.leases[leaseKey]?.owner!==owner)throw fail('刷新任务已由其他标签页接管，请重试',409);
      const clean=snapshot(state,{...result,period,language},timestamp());state.cache.boards[key]=clean;delete state.leases[leaseKey];return clean;
     });
    }catch(error){await store.update(state=>{if(state.leases[leaseKey]?.owner===owner)delete state.leases[leaseKey];}).catch(()=>{});throw error;}
   })();
   inFlight.set(key,task);try{return await task;}finally{inFlight.delete(key);}
  }
  async function detail(name){
   id(name);const key=lower(name),old=(await store.read()).cache.repos[key];if(old&&now()-Date.parse(old.fetchedAt)<CACHE_TTL)return {...old,cached:true};
   let result;try{result=await networkCall('detail',name);}catch(error){if(old&&error.name!=='QuotaExceededError')return {...old,cached:true,stale:true,warning:error.message};throw error;}
   return store.update(state=>{state.cache.repos[key]=result;const keys=Object.keys(state.cache.repos).sort((a,b)=>Date.parse(state.cache.repos[b].fetchedAt)-Date.parse(state.cache.repos[a].fetchedAt));for(const remove of keys.slice(300))delete state.cache.repos[remove];return result;});
  }
  function collection(state){const lease=state.leases.collector,running=Boolean(lease&&lease.until>now());return {...state.collection,running,mode:'newtab-open',nextRunAt:state.settings.collector.enabled?state.collection.nextRunAt:null,error:lastFailure||state.collection.error,...(state.collection.running&&!running?{error:'上次标签页已关闭或采集已中断，下次打开时继续'}:{})};}
  async function collectionUpdate(fn){return store.update(state=>{if(state.leases.collector?.owner!==owner||state.leases.collector.until<=now())throw fail('采集任务已移交或停止',409);state.leases.collector.until=now()+LEASE_MS;return fn(state);});}
  async function favoriteChecks(){
   const first=await store.read(),favorites=first.library.favorites;if(!favorites.length)return;
   const start=first.collection.favoriteCursor%favorites.length;
   for(let i=0;i<Math.min(favorites.length,10);i++){
    if(stopped)break;const state=await store.read();if(state.leases.collector?.owner!==owner)break;
    const value=favorites[(start+i)%favorites.length],old=state.collection.favoriteUpdates.find(item=>lower(item.id)===lower(value.repo.id));
    await collectionUpdate(document=>{document.collection.favoriteCursor=(start+i+1)%favorites.length;});
    if(old&&now()-Date.parse(old.checkedAt)<6*60*60*1000)continue;
    const rate=await rateStatus();if(rate.nextRetryAt&&Date.parse(rate.nextRetryAt)>now()||rate.remaining!==null&&rate.remaining<3){await collectionUpdate(document=>{document.collection.watchWarning='GitHub 免费接口额度不足，收藏动态将在额度恢复后继续检查';});break;}
    try{
     const info=await detail(value.repo.id),versions=await networkCall('release',value.repo.id);if(info.stale||versions.stale)throw new Error(info.warning||versions.warning||'收藏资料暂时无法更新');
     const latest=versions.data[0]||null;
     await collectionUpdate(document=>{
      const updates=document.collection.favoriteUpdates.filter(item=>lower(item.id)!==lower(value.repo.id));
      updates.push({id:value.repo.id,latest,archived:info.data.archived,checkedAt:timestamp(),newRelease:!!old&&!!latest&&old.latest?.id!==latest.id,archiveChanged:!!old&&old.archived!==info.data.archived,baseline:!old});
      const ids=new Set(document.library.favorites.map(item=>lower(item.repo.id)));document.collection.favoriteUpdates=updates.filter(item=>ids.has(lower(item.id)));document.collection.watchCheckedAt=timestamp();
     });
    }catch(error){await collectionUpdate(document=>{document.collection.watchWarning=error.message;});}
   }
  }
  async function runCollection({favoritesOnly=false}={}){
   if(pending)return {started:false,status:collection(await store.read())};stopped=false;
   const claim=await store.update(state=>{
    if(!favoritesOnly&&!state.settings.collector.enabled)throw fail('采集已暂停，可在设置中开启',409);
    if(state.leases.collector?.until>now())return {started:false,status:collection(state)};
    state.leases.collector={owner,until:now()+LEASE_MS};Object.assign(state.collection,{running:true,lastStartedAt:timestamp(),error:null,watchWarning:null});
    if(!favoritesOnly)state.collection.boards=[];return {started:true,status:collection(state),config:clone(state.settings.collector)};
   });
   if(!claim.started)return claim;lastFailure=null;
   heartbeat=timers.setInterval(()=>{collectionUpdate(()=>undefined).catch(()=>{});},15000);
   pending=(async()=>{
    try{
     if(!favoritesOnly)outer:for(const period of claim.config.periods)for(const language of claim.config.languages){
      const current=await store.read();if(stopped||!current.settings.collector.enabled||current.leases.collector?.owner!==owner)break outer;
      try{const result=await trending(period,language);await collectionUpdate(state=>{state.collection.boards.push({period,language,fetchedAt:result.fetchedAt,count:result.data.length,stale:!!result.stale,error:result.warning||null});if(!result.stale)state.collection.lastSuccessAt=timestamp();});}
      catch(error){await collectionUpdate(state=>{state.collection.boards.push({period,language,count:null,stale:true,error:error.message});});}
      if(!stopped)await wait(350);
     }
     const current=await store.read();if(!stopped&&(favoritesOnly||current.settings.collector.enabled&&current.settings.collector.watchReleases))await favoriteChecks();
     if(!stopped)await collectionUpdate(state=>backup(state,timestamp(),'auto'));
    }catch(error){lastFailure=error.message;}
    finally{
     timers.clearInterval(heartbeat);heartbeat=null;
     try{await store.update(state=>{if(state.leases.collector?.owner!==owner)return;delete state.leases.collector;Object.assign(state.collection,{running:false,lastFinishedAt:timestamp(),nextRunAt:state.settings.collector.enabled?new Date(now()+state.settings.collector.intervalMinutes*60000).toISOString():null,error:lastFailure||(stopped?'标签页采集已停止':null)});});}catch(error){lastFailure=error.message;}
     pending=null;
    }
   })();
   return {started:true,status:claim.status};
  }
  async function tick(){try{const state=await store.read();if(!stopped&&state.settings.collector.enabled&&!pending&&(!state.collection.nextRunAt||Date.parse(state.collection.nextRunAt)<=now()))await runCollection();}catch(error){lastFailure=error.message;}}
  async function start(){
   if(timer!==null)return;stopped=false;
   await store.update(state=>backup(state,timestamp(),'auto'));
   if(stopped||timer!==null)return;
   timer=timers.setInterval(tick,30000);firstTimer=timers.setTimeout(tick,4000);
  }
  async function stop(){stopped=true;timers.clearInterval(timer);timers.clearInterval(heartbeat);timers.clearTimeout(firstTimer);timer=null;heartbeat=null;firstTimer=null;await store.update(state=>{if(state.leases.collector?.owner===owner){delete state.leases.collector;state.collection.running=false;state.collection.error='采集随标签页关闭而停止';state.collection.nextRunAt=timestamp();}});}
  async function request(path,{method='GET',data}={}){
   if(typeof path!=='string'||!path.startsWith('/api/')||path.startsWith('//'))throw fail('扩展接口地址无效');
   const url=new URL(path,'https://radar.invalid'),route=url.pathname;
   if(method==='GET'){
    if(route==='/api/health')return {ok:true,app:'github-top',version:'2.0.0',browserOnly:true};
    if(route==='/api/library')return library();
    if(route==='/api/library/export')return portable(await library(),timestamp());
    if(route==='/api/settings'){const value=(await store.read()).settings,model=await modelStatus();return {...value,localModel:{enabled:!!model.enabled,provider:model.provider||'codex'}};}
    if(route==='/api/status'){const state=await store.read();return {connection:mergeRate(state.connection,api().rateStatus()),collection:collection(state),model:await modelStatus(),backups:state.backups.map(backupInfo),storage:'indexeddb',browserOnly:true};}
    if(route==='/api/discoveries'){const since=date(url.searchParams.get('since'));return (await store.read()).discoveries.filter(value=>!since||value.firstSeenAt>since).sort((a,b)=>b.firstSeenAt.localeCompare(a.firstSeenAt)||a.repo.id.localeCompare(b.repo.id));}
    if(route==='/api/timeline'){const name=id(url.searchParams.get('name')),period=url.searchParams.get('period');if(period&&!PERIODS.includes(period))throw fail('周期无效');return (await store.read()).snapshots.filter(value=>lower(value.repoId)===lower(name)&&(!period||period===value.period)).sort((a,b)=>a.fetchedAt.localeCompare(b.fetchedAt));}
    if(route==='/api/backups')return (await store.read()).backups.map(backupInfo);
    if(route==='/api/trending')return trending(url.searchParams.get('period')||'daily',url.searchParams.get('language')||'',url.searchParams.get('refresh')==='1');
    if(route==='/api/repo')return detail(url.searchParams.get('name'));
   }else if(method==='POST'){
    object(data??={},'请求');
    if(route==='/api/library/mutate')return mutate(data);
    if(route==='/api/library/import')return importLibrary(data.payload,data.migrationId);
    if(route==='/api/settings'){
     const value=settings(data),model=await modelStatus();if(value.localModel.enabled&&!model.connected)throw fail('请先在扩展设置中连接可选的本机 Codex',409);
     return store.update(state=>{if(JSON.stringify(state.settings.collector)!==JSON.stringify(value.collector))state.collection.nextRunAt=value.collector.enabled?timestamp():null;state.settings=value;return value;});
    }
    if(route==='/api/connection/check')return networkCall('checkConnection');
    if(route==='/api/collection/run')return runCollection();
    if(route==='/api/favorites/check')return runCollection({favoritesOnly:true});
    if(route==='/api/backups/create')return store.update(state=>backup(state,timestamp()));
    if(route==='/api/backups/restore')return store.update(state=>{const selected=state.backups.find(value=>value.name===data.name);if(!selected)throw fail('备份不存在');const clean=normalizeImport(selected.payload,timestamp(),{checkSize:false}),before=backup(state,timestamp(),'before-restore');state.library={...clean,revision:state.library.revision+1};return {library:state.library,backup:before};});
    if(route==='/api/summary'){if(!ai()?.summarize)throw fail('中文解读是可选功能，请先连接本机 Codex',409);return ai().summarize(data);}
    if(route==='/api/token'||route==='/api/token/clear')throw fail('独立扩展使用 GitHub 公开接口，不保存账号或 Token',409);
   }
   throw fail('扩展不支持这个操作',404);
  }
  return Object.freeze({request,start,stop,runCollection,whenIdle:async()=>{if(pending)await pending;},readme:name=>networkCall('readme',id(name))});
 }
 return Object.freeze({...create(),create});
})();
