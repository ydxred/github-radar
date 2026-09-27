import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {trending,detail,releases,getConnectionStatus} from './github.mjs';
import {getLibrary,recordSnapshot,createBackup} from './store.mjs';
import {getSettings} from './settings.mjs';
const dir=resolve(process.env.GITHUB_TOP_DATA||'data'),file=resolve(dir,'collection-status.json');
let state={running:false,lastStartedAt:null,lastFinishedAt:null,lastSuccessAt:null,nextRunAt:null,boards:[],favoriteUpdates:[],favoriteCursor:0,watchCheckedAt:null,error:null};
let timer,firstTimer,pending=null,persistQueue=Promise.resolve();
try{const disk=JSON.parse(await readFile(file,'utf8'));state={...state,...disk,running:false};}catch{}
function persist(){const snapshot=JSON.stringify(state);const job=persistQueue.then(async()=>{await mkdir(dir,{recursive:true,mode:0o700});await writeFile(file+'.tmp',snapshot,{mode:0o600});await rename(file+'.tmp',file);});persistQueue=job.catch(()=>{});return job;}
export function collectionStatus(){return structuredClone(state);}
async function favoriteChecks(){
 const settings=getSettings();if(!settings.collector.watchReleases)return;
 const favorites=getLibrary().favorites;
 const ids=new Set(favorites.map(e=>e.repo.id));state.favoriteUpdates=state.favoriteUpdates.filter(e=>ids.has(e.id));
 if(!favorites.length)return;
 const oldUpdates=new Map(state.favoriteUpdates.map(e=>[e.id,e]));
 const start=state.favoriteCursor%favorites.length;
 for(let i=0;i<Math.min(favorites.length,10);i++){
  const index=(start+i)%favorites.length,entry=favorites[index],old=oldUpdates.get(entry.repo.id);
  state.favoriteCursor=(index+1)%favorites.length;
  if(old&&Date.now()-Date.parse(old.checkedAt)<6*60*60*1000)continue;
  const rate=await getConnectionStatus();if(rate.nextRetryAt&&Date.parse(rate.nextRetryAt)>Date.now()||rate.remaining!==null&&rate.remaining<4){state.watchWarning='GitHub 额度不足，收藏更新将在额度恢复后继续检查';break;}
  try{
   const [info,versions]=[await detail(entry.repo.id),await releases(entry.repo.id)];
   if(info.stale||versions.stale){state.watchWarning=info.warning||versions.warning||'暂时无法更新收藏资料';continue;}
   const latest=versions.data[0]||null;
   oldUpdates.set(entry.repo.id,{id:entry.repo.id,latest,archived:info.data.archived,checkedAt:new Date().toISOString(),newRelease:!!old&&!!latest&&old.latest?.id!==latest.id,archiveChanged:!!old&&old.archived!==info.data.archived,baseline:!old});
  }catch(error){state.watchWarning=error.message;}
 }
 state.favoriteUpdates=[...oldUpdates.values()];state.watchCheckedAt=new Date().toISOString();
}
export function runCollection({favoritesOnly=false}={}){
 if(pending)return {started:false,status:collectionStatus()};
 const config=getSettings().collector;
 state.running=true;state.error=null;state.watchWarning=null;state.lastStartedAt=new Date().toISOString();
 pending=(async()=>{
  try{
   if(!favoritesOnly){
    const boards=[];
    for(const period of config.periods)for(const language of config.languages){
     if(!getSettings().collector.enabled){state.error='采集已暂停';break;}
     try{const result=await trending(period,language);recordSnapshot(result);boards.push({period,language,fetchedAt:result.fetchedAt,count:result.data.length,stale:result.stale,error:result.warning||null});if(!result.stale)state.lastSuccessAt=new Date().toISOString();}
     catch(error){boards.push({period,language,count:null,error:error.message,stale:true});}
    }
    state.boards=boards;
   }
   await favoriteChecks();
   createBackup({kind:'auto'});
  }catch(error){state.error=error.message;}
  finally{state.running=false;state.lastFinishedAt=new Date().toISOString();state.nextRunAt=getSettings().collector.enabled?new Date(Date.now()+getSettings().collector.intervalMinutes*60000).toISOString():null;try{await persist();}catch(error){state.error='采集状态保存失败：'+error.message;}pending=null;}
 })();
 return {started:true,status:collectionStatus()};
}
export function startCollector(){
 if(process.env.GITHUB_TOP_DISABLE_COLLECTOR==='1')return;
 const tick=()=>{const config=getSettings().collector;if(config.enabled&&!pending&&(!state.nextRunAt||Date.parse(state.nextRunAt)<=Date.now()))runCollection();};
 timer=setInterval(tick,60000);timer.unref();firstTimer=setTimeout(tick,4000);firstTimer.unref();
}
export function stopCollector(){clearInterval(timer);clearTimeout(firstTimer);}
export async function collectionSettingsChanged(){state.nextRunAt=getSettings().collector.enabled?new Date().toISOString():null;await persist();}
