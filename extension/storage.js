// One document and one transaction for every read-modify-write keeps tabs in sync.
const RadarStore=(()=>{
 const clone=value=>structuredClone(value);
 const initial=()=>({schemaVersion:1,library:{revision:0,favorites:[],notes:{},history:[],preferences:{},readIds:[],hiddenIds:[],lastVisitAt:null},settings:{collector:{enabled:true,intervalMinutes:120,languages:['','python','typescript','javascript','go','rust','java','c++'],periods:['daily','weekly'],watchReleases:true},localModel:{enabled:false,provider:'codex'}},discoveries:[],snapshots:[],cache:{boards:{},repos:{}},connection:null,collection:{running:false,lastStartedAt:null,lastFinishedAt:null,lastSuccessAt:null,nextRunAt:null,boards:[],favoriteUpdates:[],favoriteCursor:0,watchCheckedAt:null,watchWarning:null,error:null},leases:{},backups:[],migrations:[]});
 function readableError(error){
  if(error?.name==='QuotaExceededError')return Object.assign(new Error('浏览器存储空间不足，这次更改未保存。请先导出资料并清理不需要的浏览器数据。'),{name:'QuotaExceededError',status:507});
  return error||new Error('浏览器资料暂时无法保存，请重试');
 }
 function create({indexedDB=globalThis.indexedDB,name='github-radar-extension-v1'}={}){
  let connection=null,opening=null;
  function open(){
   if(connection)return Promise.resolve(connection);
   if(opening)return opening;
   opening=new Promise((resolve,reject)=>{
    if(!indexedDB){reject(new Error('当前浏览器不支持资料存储，请使用新版 Chrome 普通窗口'));return;}
    let request;try{request=indexedDB.open(name,1);}catch(error){reject(readableError(error));return;}
    let blocked=false;
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('state'))request.result.createObjectStore('state');};
    request.onblocked=()=>{blocked=true;reject(new Error('资料库正在升级，请关闭其他开源雷达标签页后重试'));};
    request.onerror=()=>reject(readableError(request.error));
    request.onsuccess=()=>{
     if(blocked){request.result.close();return;}
     connection=request.result;
     connection.onversionchange=()=>{connection?.close();connection=null;opening=null;};
     resolve(connection);
    };
   }).catch(error=>{opening=null;throw error;});
   return opening;
  }
  async function transaction(mode,fn){
   const db=await open();
   return new Promise((resolve,reject)=>{
    let tx,result,failure;
    try{tx=db.transaction('state',mode);}catch(error){reject(readableError(error));return;}
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(readableError(failure||tx.error));
    tx.onerror=()=>{}; // Abort is the single rejection path; never report an uncommitted write.
    const bucket=tx.objectStore('state'),request=bucket.get('main');
    request.onsuccess=()=>{
     try{
      const document=request.result||initial();
      if(document.schemaVersion!==1)throw new Error('资料库版本较新，请更新开源雷达扩展');
      const value=fn(document);
      if(value&&typeof value.then==='function')throw new Error('资料事务中不能等待网络或异步任务');
      result=clone(value);
      if(mode==='readwrite')bucket.put(document,'main');
     }catch(error){failure=error;tx.abort();}
    };
   });
  }
  return {read:()=>transaction('readonly',value=>value),update:fn=>transaction('readwrite',fn),close(){connection?.close();connection=null;opening=null;}};
 }
 return Object.freeze({...create(),create});
})();
