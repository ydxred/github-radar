// Development-only UI preview. Never bundled into the extension or used by its users.
// Browser installation is a separate manual acceptance step. This server does NOT install it.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
const base=new URL('../browser-extension/',import.meta.url),port=4329;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const allowed=new Set(['newtab.html','privacy.html','app.js','style.css','icon.svg','bridge.js','storage.js','github-client.js','local-ai.js','api.js','icons/16.png','icons/32.png','icons/48.png','icons/128.png']);
const prelude=`const previewNativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,options={})=>{const url=String(input);if(/^https:\\/\\/(github\\.com|api\\.github\\.com)\\//.test(url))return previewNativeFetch('/preview-proxy?url='+encodeURIComponent(url),{...options,credentials:'omit'});if(url.startsWith('http://127.0.0.1:4317'))throw new Error('Development preview never connects to companion service');return previewNativeFetch(input,options);};`;
createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end();}
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 try{
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(url.pathname==='/preview-proxy'){
   const target=new URL(url.searchParams.get('url'));
   if(target.username||target.password||!['https://github.com','https://api.github.com'].includes(target.origin)||target.origin==='https://github.com'&&!target.pathname.startsWith('/trending'))throw new Error('Unsupported preview source');
   const response=await fetch(target,{headers:{Accept:target.hostname==='api.github.com'?'application/vnd.github+json':'text/html','X-GitHub-Api-Version':'2022-11-28','User-Agent':'GitHub-Radar-Development-Preview'},redirect:'error',signal:AbortSignal.timeout(18000)});
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>3*1024*1024)throw new Error('Preview response too large');
   const headers={'Content-Type':response.headers.get('content-type')||'text/plain','Cache-Control':'no-store'};
   for(const key of ['x-ratelimit-remaining','x-ratelimit-limit','x-ratelimit-reset','retry-after'])if(response.headers.has(key))headers[key]=response.headers.get(key);
   res.writeHead(response.status,headers);res.end(bytes);return;
  }
  if(url.pathname==='/preview-network.js'){res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-store'});return res.end(prelude);}
  const file=url.pathname==='/'?'newtab.html':url.pathname.slice(1);if(!allowed.has(file)){res.writeHead(404);return res.end();}
  let bytes=await readFile(new URL(file,base));
  if(file==='newtab.html')bytes=Buffer.from(bytes.toString().replace('<head>','<head><script src="preview-network.js"></script>'));
  res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"});res.end(bytes);
 }catch(error){res.writeHead(502,{'Content-Type':'text/plain'});res.end('Development preview could not fetch the public source');console.error(error.message);}
}).listen(port,'127.0.0.1',()=>console.log(`Standalone UI development preview: http://127.0.0.1:${port}/newtab.html`));
