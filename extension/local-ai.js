// Optional companion. Reading status never probes localhost or invokes a model.
const RadarLocalAI=(()=>{
 const origin='http://127.0.0.1:4317',origins=[origin+'/*'];
 const disabled=message=>({connected:false,available:false,authenticated:false,enabled:false,provider:'codex',state:'disconnected',message:message||'可选功能：连接本机服务后使用自己的 Codex，榜单与收藏不受影响'});
 function create({permissions=globalThis.chrome?.permissions,storage=globalThis.localStorage,fetch:fetcher=globalThis.fetch}={}){
  const key='radar:optional-codex';let epoch=0;
  const read=()=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
  const write=value=>storage.setItem(key,JSON.stringify(value));
  async function status(){
   const saved=read();if(!saved?.connected||!permissions)return disabled();
   if(!await permissions.contains({origins}))return disabled('本机连接权限已撤销，浏览和收藏仍可使用');
   return {...saved,message:'已允许连接本机 Codex；仅在点击生成时访问服务，服务可用性以本次请求为准'};
  }
  async function call(path,{body,timeout=5000}={}){
   let response;
   try{response=await fetcher(origin+path,{method:body?'POST':'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:body?{'Content-Type':'application/json','X-Radar-Request':'local-ui'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});}
   catch(error){throw new Error(error.name==='TimeoutError'?'本机 Codex 等待超时，请稍后重试':'暂时无法连接本机开源雷达服务。请先启动配套服务；独立看板仍可正常使用。');}
   let data;try{data=await response.json();}catch{throw new Error('本机服务响应不兼容，请更新配套服务');}
   if(!response.ok)throw new Error(data.error||'本机服务暂时无法完成请求');
   return data;
  }
  // Must be called directly from a click, before any await, for the permission gesture.
  function connect(){
   if(!permissions)return Promise.resolve(disabled('请在安装后的 Chrome 扩展中连接可选服务'));
   const token=++epoch,granted=permissions.request({origins});
   return (async()=>{
    if(!await granted)return disabled('你没有允许访问本机服务，独立看板仍可正常使用');
    if(token!==epoch)return disabled();
    try{
     const health=await call('/api/health');
     if(health.app!=='github-top'||health.ok!==true||!health.features?.includes('extension-summary'))throw new Error('请更新本机开源雷达配套服务，以启用独立扩展的 Codex 解读');
     const model=await call('/api/extension/model');
     if(!model.enabled||!model.installed||!model.authenticated)throw new Error(model.message||'请在本机服务中启用 Codex，并使用 ChatGPT 登录');
     const result={connected:true,available:true,authenticated:true,enabled:true,provider:'codex',state:'connected',message:'本机 Codex 已连接，生成时使用你自己的 Codex 额度'};
     if(token===epoch)write(result);else return disabled();
     return result;
    }catch(error){if(token===epoch)storage.removeItem(key);return disabled(error.message);}
   })();
  }
  async function disconnect(){++epoch;storage.removeItem(key);if(permissions)await permissions.remove({origins});return disabled('已断开本机 Codex，并撤销访问本机服务的权限');}
  async function summarize(data){
   if(!(await status()).connected)throw new Error('请先在设置中连接本机 Codex（可选）');
   if(!data||typeof data.id!=='string'||data.id.length>219||!/^[\w.-]+\/[\w.-]+$/.test(data.id)||data.id.split('/').some(p=>p==='.'||p==='..'))throw new Error('项目名称无效');
   if(data.provider&&data.provider!=='codex')throw new Error('独立扩展的可选解读目前使用本机 Codex');
   // Only a public repository identifier leaves the extension, never notes or library.
   return call('/api/extension/summary',{body:{id:data.id,provider:'codex',refresh:data.refresh===true},timeout:260000});
  }
  return {status,connect,disconnect,summarize};
 }
 return {...create(),create};
})();
