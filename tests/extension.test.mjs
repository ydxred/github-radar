import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {load} from 'cheerio';
import {extensionOriginFromManifest} from '../server/extension-origin.mjs';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('standalone package has local executable assets and only required public origins plus optional localhost',async()=>{
 const manifest=JSON.parse(await read('browser-extension/manifest.json'));
 assert.deepEqual(manifest,JSON.parse(await read('extension/manifest.json')));
 assert.equal(manifest.version,'2.0.0');
 assert.equal(extensionOriginFromManifest(manifest),'chrome-extension://lieckapkglcjhgobepankajcapoaikpc');
 assert.deepEqual(manifest.host_permissions,['https://github.com/*','https://api.github.com/*']);
 assert.deepEqual(manifest.optional_host_permissions,['http://127.0.0.1:4317/*']);
 for(const key of ['permissions','content_scripts','externally_connectable','web_accessible_resources'])assert.equal(manifest[key],undefined,key);
 assert.match(manifest.content_security_policy.extension_pages,/script-src 'self';/);
 const html=await read('browser-extension/newtab.html'),$=load(html);
 const scripts=['storage.js','github-client.js','local-ai.js','api.js','app.js','bridge.js'];
 assert.deepEqual($('script').map((_,node)=>$(node).attr('src')).get(),scripts);
 assert.equal($('script:not([src])').length,0);assert.equal($('[onclick],[onload],[onerror]').length,0);
 assert.equal($('#connection-panel').length,0,'No companion-service overlay can block the standalone UI');
 assert.match(html,/金融与量化/);assert.match(html,/关闭后暂停/);assert.match(html,/隐私说明/);
 for(const node of $('script[src],link[href],img[src]').toArray()){
  const path=$(node).attr('src')||$(node).attr('href');assert.ok(!path.startsWith('/')&&!path.includes('://'),path);
  await readFile(new URL(`browser-extension/${path}`,root));
 }
 for(const file of ['app.js','style.css','icon.svg'])assert.equal(await read(`browser-extension/${file}`),await read(`public/${file}`));
 for(const file of [...scripts.filter(f=>f!=='app.js'),'privacy.html'])assert.equal(await read(`browser-extension/${file}`),await read(`extension/${file}`));
 const entries=(await readdir(new URL('browser-extension/',root))).sort();
 assert.deepEqual(entries,[...scripts,'style.css','icon.svg','icons','manifest.json','newtab.html','privacy.html'].sort());
});

test('bundled privacy text discloses local retention, optional cloud inference and no private-note upload',async()=>{
 const text=load(await read('browser-extension/privacy.html'))('body').text();
 for(const pattern of [/IndexedDB/,/卸载扩展/,/导出/,/默认不连接/,/OpenAI/,/私人笔记/,/不接收你的登录凭证/,/不接入广告/])assert.match(text,pattern);
});
