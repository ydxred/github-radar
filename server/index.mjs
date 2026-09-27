import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname} from 'node:path';
import {trending,detail,isRepo,readme,getConnectionStatus,saveToken,clearToken} from './github.mjs';
import {getLibrary,mutateLibrary,importLibrary,exportLibrary,recordSnapshot,getDiscoveries,getRepoTimeline,listBackups,createBackup,restoreBackup} from './store.mjs';
import {getSettings,saveSettings} from './settings.mjs';
import {configureSummary,summaryStatus,summarize,closeSummary,setSummaryEnabled} from './summary.mjs';
import {createCodexSummarizer} from './codex-summary.mjs';
import {collectionStatus,runCollection,startCollector,stopCollector,collectionSettingsChanged} from './collector.mjs';
import {trustedExtensionOrigin} from './extension-origin.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../public');
const port=Number(process.env.PORT||4317);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const files=new Set(['/','/index.html','/app.js','/style.css','/icon.svg']);
const postRoutes=new Set(['/api/library/mutate','/api/library/import','/api/settings','/api/token','/api/token/clear','/api/connection/check','/api/collection/run','/api/favorites/check','/api/summary','/api/extension/summary','/api/backups/create','/api/backups/restore']);
const getRoutes=new Set(['/api/health','/api/library','/api/library/export','/api/discoveries','/api/timeline','/api/settings','/api/status','/api/backups','/api/trending','/api/repo','/api/extension/model']);
const extensionHeaders=new Set(['content-type','x-radar-request']);
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('请求格式必须为 JSON'),{status:415});
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Object.assign(new Error('数据超过 8 MB 限制'),{status:413});chunks.push(chunk);}
 try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw Object.assign(new Error('JSON 格式无效'),{status:400});}
}
const summaryOptions={dataDir:resolve(process.env.GITHUB_TOP_DATA||'data'),enabled:getSettings().localModel.enabled};
configureSummary({...summaryOptions,enabled:summaryOptions.enabled&&getSettings().localModel.provider==='local'});
const codexSummary=createCodexSummarizer({...summaryOptions,enabled:summaryOptions.enabled&&getSettings().localModel.provider==='codex'});
const selectedSummaryStatus=async()=>{const provider=getSettings().localModel.provider;return {...await (provider==='codex'?codexSummary.status():summaryStatus()),provider};};
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'");
 if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,403,{error:'仅允许从本机打开'});
 let url;
 try{
  try{url=new URL(req.url,`http://127.0.0.1:${port}`);}catch{return json(res,400,{error:'请求地址无效'});}
  const expected=`http://${req.headers.host}`;
  const fromExtension=Boolean(trustedExtensionOrigin&&req.headers.origin===trustedExtensionOrigin);
  const knownApi=getRoutes.has(url.pathname)||postRoutes.has(url.pathname);
  if(url.pathname.startsWith('/api/')){
   if(!fromExtension&&(req.headers.origin&&req.headers.origin!==expected||req.headers['sec-fetch-site']==='cross-site'))return json(res,403,{error:'请求必须来自本机看板或已安装的开源雷达扩展'});
   if(req.method==='OPTIONS'){
    if(!fromExtension)return json(res,403,{error:'不允许此来源的跨域请求'});
    if(!knownApi)return json(res,404,{error:'接口不存在'});
    const method=req.headers['access-control-request-method'];
    if(!((method==='GET'||method==='HEAD')&&getRoutes.has(url.pathname)||method==='POST'&&postRoutes.has(url.pathname)))return json(res,405,{error:'请求方式不支持'});
    const requested=req.headers['access-control-request-headers'];
    const headers=typeof requested==='string'?requested.split(',').map(value=>value.trim().toLowerCase()):[];
    if(headers.some(value=>!extensionHeaders.has(value)))return json(res,403,{error:'请求头不支持'});
    res.setHeader('Access-Control-Allow-Origin',trustedExtensionOrigin);
    res.setHeader('Vary','Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    res.setHeader('Access-Control-Allow-Methods',method);
    if(headers.length)res.setHeader('Access-Control-Allow-Headers',[...new Set(headers)].join(', '));
    res.setHeader('Access-Control-Max-Age','600');
    res.writeHead(204);return res.end();
   }
   if(fromExtension&&knownApi){res.setHeader('Access-Control-Allow-Origin',trustedExtensionOrigin);res.setHeader('Vary','Origin');}
  }
  if(req.method==='POST'){
   if(!postRoutes.has(url.pathname))return json(res,405,{error:'请求方式不支持'});
   if(!fromExtension&&(req.headers.origin&&req.headers.origin!==expected||req.headers['sec-fetch-site']==='cross-site')||req.headers['x-radar-request']!=='local-ui')return json(res,403,{error:'写入请求必须来自本机看板或开源雷达扩展'});
   const data=await body(req);
   if(url.pathname==='/api/library/mutate')return json(res,200,await mutateLibrary(data));
   if(url.pathname==='/api/library/import')return json(res,200,await importLibrary(data.payload,data.migrationId));
   if(url.pathname==='/api/settings'){const settings=saveSettings(data);setSummaryEnabled(settings.localModel.enabled&&settings.localModel.provider==='local');codexSummary.setEnabled(settings.localModel.enabled&&settings.localModel.provider==='codex');await collectionSettingsChanged();return json(res,200,settings);}
   if(url.pathname==='/api/token')return json(res,200,await saveToken(data.token));
   if(url.pathname==='/api/token/clear')return json(res,200,await clearToken());
   if(url.pathname==='/api/connection/check')return json(res,200,await getConnectionStatus({refresh:true}));
   if(url.pathname==='/api/collection/run')return json(res,202,runCollection());
   if(url.pathname==='/api/favorites/check')return json(res,202,runCollection({favoritesOnly:true}));
   if(url.pathname==='/api/backups/create')return json(res,200,await createBackup());
   if(url.pathname==='/api/backups/restore')return json(res,200,await restoreBackup(data.name));
   if(url.pathname==='/api/extension/summary'){
    if(!fromExtension)return json(res,403,{error:'此接口只接受开源雷达扩展的请求'});
    if(Object.keys(data).some(key=>!['id','provider','refresh'].includes(key))||!isRepo(data.id)||data.provider!=='codex'||data.refresh!==undefined&&typeof data.refresh!=='boolean')return json(res,400,{error:'请只提交有效的公开项目名称'});
    const settings=getSettings();
    if(!settings.localModel.enabled||settings.localModel.provider!=='codex')return json(res,409,{error:'请先在本机网页设置中启用 Codex 解读'});
    const status=await codexSummary.status();if(!status.installed||!status.authenticated)return json(res,409,{error:status.message||'本机 Codex 尚未就绪'});
    const document=await readme(data.id);
    const result=await codexSummary.summarize(data.id,{readme:document.content,sourceUrl:document.sourceUrl,sourceVersion:document.sourceVersion,refresh:data.refresh===true});
    return json(res,200,{...result,provider:'codex',localOnly:false});
   }
   if(url.pathname==='/api/summary'){
    if(!isRepo(data.id))return json(res,400,{error:'项目名称无效'});
    const entries=getDiscoveries(),library=getLibrary();
    const repo=entries.find(e=>e.repo.id===data.id)?.repo||library.favorites.find(e=>e.repo.id===data.id)?.repo||library.history.find(e=>e.repo.id===data.id)?.repo;
    if(!repo)return json(res,404,{error:'请先在看板中打开这个项目'});
    const provider=getSettings().localModel.provider;if(!getSettings().localModel.enabled)return json(res,409,{error:'中文速读已暂停，可在设置中开启'});
    if(data.provider&&data.provider!==provider)return json(res,409,{error:'速读方式已在其他页面修改，请刷新后再试'});
    const document=await readme(data.id);
    const result=await (provider==='codex'?codexSummary.summarize(repo.id,{readme:document.content,sourceUrl:document.sourceUrl,sourceVersion:document.sourceVersion,refresh:data.refresh===true}):summarize(repo.id,{readme:document.content,sourceUrl:document.sourceUrl,sourceVersion:document.sourceVersion,refresh:data.refresh===true}));
    return json(res,200,{...result,provider,localOnly:provider==='local'});
   }
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'请求方式不支持'});
  if(url.pathname==='/api/health')return json(res,200,{ok:true,app:'github-top',version:'2.1.0',features:['extension-summary']});
  if(url.pathname==='/api/extension/model'){
   if(!fromExtension)return json(res,403,{error:'此接口只接受开源雷达扩展的请求'});
   return json(res,200,{...await codexSummary.status(),enabled:getSettings().localModel.enabled&&getSettings().localModel.provider==='codex',provider:'codex'});
  }
  if(url.pathname==='/api/library')return json(res,200,getLibrary());
  if(url.pathname==='/api/library/export')return json(res,200,exportLibrary());
  if(url.pathname==='/api/discoveries')return json(res,200,getDiscoveries(url.searchParams.get('since')||undefined));
  if(url.pathname==='/api/timeline')return json(res,200,getRepoTimeline(url.searchParams.get('name'),url.searchParams.get('period')||undefined));
  if(url.pathname==='/api/settings')return json(res,200,getSettings());
  if(url.pathname==='/api/status')return json(res,200,{connection:await getConnectionStatus(),collection:collectionStatus(),model:await selectedSummaryStatus(),backups:listBackups()});
  if(url.pathname==='/api/backups')return json(res,200,listBackups());
  if(url.pathname==='/api/trending'){const result=await trending(url.searchParams.get('period')||'daily',url.searchParams.get('language')||'',url.searchParams.get('refresh')==='1');recordSnapshot(result);return json(res,200,result);}
  if(url.pathname==='/api/repo')return json(res,200,await detail(url.searchParams.get('name')));
  if(!files.has(url.pathname))return json(res,404,{error:'页面不存在'});
  const file=resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1)),data=await readFile(file);
  res.writeHead(200,{'Content-Type':MIME[extname(file)],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(error){const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:502;console.error(new Date().toISOString(),url?.pathname,error.code||error.name);json(res,status,{error:error.message||'暂时无法完成，请稍后重试'});}
});
server.requestTimeout=35000;
server.listen(port,'127.0.0.1',()=>{console.log(`开源雷达 http://127.0.0.1:${port}`);startCollector();});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
const shutdown=()=>{stopCollector();closeSummary();codexSummary.close();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
