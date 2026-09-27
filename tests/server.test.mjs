import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import {createHash} from 'node:crypto';
import {extensionOriginFromManifest,readExtensionOrigin,trustedExtensionOrigin} from '../server/extension-origin.mjs';

const initialSettings = () => ({
  collector: { enabled: false, intervalMinutes: 120, languages: ['', 'python'], periods: ['daily', 'weekly'], watchReleases: false },
  localModel: { enabled: false, provider: 'local' },
});
const repo = (id = 'demo/radar') => ({ id, description: '公开项目测试资料', language: 'JavaScript', stars: 123, forks: 4, periodStars: 12, rank: 1 });
const entry = (id = 'demo/radar') => ({ repo: repo(id), period: 'weekly', fetchedAt: '2026-09-27T08:00:00.000Z' });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-http-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const outboundFile = join(directory, 'unexpected-outbound.txt');
  const preload = join(directory, 'block-network.mjs');
  await writeFile(join(directory, 'settings.json'), JSON.stringify(initialSettings()));
  // The child is the HTTP service. Its fetch must never contact GitHub or a real model.
  await writeFile(preload, `import {appendFileSync} from 'node:fs';\nglobalThis.fetch = async url => { appendFileSync(process.env.GITHUB_TOP_TEST_OUTBOUND, String(url) + '\\n'); throw new Error('Integration test blocked an unexpected outbound request'); };\n`);
  let server, output = '';
  async function start() {
    server = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server/index.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PORT: String(port), GITHUB_TOP_DATA: directory, GITHUB_TOP_DISABLE_COLLECTOR: '1', GITHUB_TOP_AI_HOME: join(directory, 'empty-model-directory'), GITHUB_TOP_TEST_OUTBOUND: outboundFile, GITHUB_TOP_CODEX_BIN: join(directory, 'no-codex-installed') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', data => { output += data; });
    server.stdout.on('data', data => { output += data; });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`HTTP test service failed to start: ${output}`)), 8000);
      const done = () => { clearTimeout(timeout); server.off('error', failed); server.off('exit', exited); server.stdout.off('data', ready); };
      const failed = error => { done(); reject(error); };
      const exited = code => failed(new Error(`HTTP test service exited ${code}: ${output}`));
      const ready = data => { if (String(data).includes(base)) { done(); resolve(); } };
      server.once('error', failed); server.once('exit', exited); server.stdout.on('data', ready);
    });
  }
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited;
  }
  t.after(async () => {
    await stop();
    const requests = await readFile(outboundFile, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
    await rm(directory, { recursive: true, force: true });
    assert.equal(requests, '', `The HTTP tests must not contact upstream services: ${requests}`);
  });
  await start();
  const request = async (path, options = {}) => {
    const response = await fetch(base + path, options);
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  };
  const post = (path, value, extra = {}) => request(path, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', 'X-Radar-Request': 'local-ui', ...extra },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  });
  const raw = (path, host = `127.0.0.1:${port}`, headers = {}) => new Promise((resolve, reject) => {
    const socket = net.createConnection(port, '127.0.0.1'); let data = '';
    const additional = Object.entries(headers).map(([name,value]) => `${name}: ${value}\r\n`).join('');
    socket.on('connect', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\n${additional}Connection: close\r\n\r\n`));
    socket.on('data', chunk => data += chunk); socket.on('end', () => resolve(data)); socket.on('error', reject);
  });
  return { directory, base, request, post, raw, logs: () => output, restart: async () => { await stop(); await start(); } };
}

test('HTTP service rejects hostile hosts, malformed routes, unsupported methods and private files', async t => {
  const app = await fixture(t);
  assert.match(await app.raw('//['), /^HTTP\/1.1 400/);
  assert.match(await app.raw('/api/health', 'attacker.example'), /^HTTP\/1.1 403/);
  assert.equal((await app.request('/api/health')).data.version, '2.1.0');
  assert.equal((await app.request('/api/health', { method: 'POST' })).status, 405);
  assert.equal((await app.request('/api/library', { method: 'PUT' })).status, 405);
  for (const path of ['/package.json', '/data/radar.sqlite', '/data/.github-token', '/.github-token', '/server/settings.mjs', '/api/backups/../../data/radar.sqlite']) assert.equal((await app.request(path)).status, 404, path);
  assert.equal((await app.request('/api/trending?period=yearly')).status, 400);
  assert.equal((await app.request('/api/repo?name=../secrets')).status, 400);
  assert.equal((await app.request('/api/timeline?name=../secrets')).status, 400);
  assert.equal((await app.request('/api/discoveries?since=invalid-date')).status, 400);
  const page = await app.request('/');
  assert.equal(page.status, 200); assert.match(page.text, /开源雷达/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const head = await app.request('/', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.text, '');
});

test('extension trust derives the packaged Chrome ID and fails closed for absent or malformed manifests', async t => {
  const manifest=JSON.parse(await readFile(new URL('../browser-extension/manifest.json',import.meta.url),'utf8'));
  const bytes=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16);
  const id=Array.from(bytes).map(byte=>String.fromCharCode(97+(byte>>4),97+(byte&15))).join('');
  assert.equal(trustedExtensionOrigin,`chrome-extension://${id}`);
  assert.equal(id,'lieckapkglcjhgobepankajcapoaikpc');
  assert.equal(extensionOriginFromManifest(manifest),trustedExtensionOrigin);
  for(const invalid of [null,{}, {...manifest,manifest_version:2},{...manifest,key:''},{...manifest,key:'abc!'},{...manifest,key:'abcd'},{...manifest,key:manifest.key+'\n'},{...manifest,key:'A'.repeat(20000)}])assert.equal(extensionOriginFromManifest(invalid),null);
  const directory=await mkdtemp(join(tmpdir(),'radar-manifest-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const file=join(directory,'manifest.json');
  assert.equal(readExtensionOrigin(file),null);
  await writeFile(file,'{broken');assert.equal(readExtensionOrigin(file),null);
  await writeFile(file,JSON.stringify({...manifest,key:'invalid'}));assert.equal(readExtensionOrigin(file),null);
  await writeFile(file,JSON.stringify(manifest));assert.equal(readExtensionOrigin(file),trustedExtensionOrigin);
  await writeFile(file,' '.repeat(65537));assert.equal(readExtensionOrigin(file),null);
});

test('only the packaged extension can read and write cross-origin API data without relaxing host or write checks', async t => {
  const app=await fixture(t);
  assert.ok(trustedExtensionOrigin);
  const headers={Origin:trustedExtensionOrigin,'Sec-Fetch-Site':'cross-site'};
  const read=await app.request('/api/library',{headers});
  assert.equal(read.status,200);
  assert.equal(read.headers.get('access-control-allow-origin'),trustedExtensionOrigin);
  assert.match(read.headers.get('vary'),/Origin/);
  assert.equal(read.headers.get('access-control-allow-credentials'),null);
  const saved=await app.post('/api/library/mutate',{type:'note',id:'demo/extension',text:'新标签页保存的笔记'},headers);
  assert.equal(saved.status,200);assert.equal(saved.data.notes['demo/extension'],'新标签页保存的笔记');
  assert.equal(saved.headers.get('access-control-allow-origin'),trustedExtensionOrigin);
  assert.equal((await app.post('/api/library/mutate',{type:'note',id:'demo/extension',text:'invalid'},{...headers,'X-Radar-Request':''})).status,403);
  assert.equal((await app.post('/api/library/mutate',{},{...headers,'Content-Type':'text/plain'})).status,415);
  assert.match(await app.raw('/api/library','attacker.example',{Origin:trustedExtensionOrigin}),/^HTTP\/1.1 403/);
  for(const path of ['/','/data/radar.sqlite','/api/not-a-route'])assert.equal((await app.request(path,{headers})).headers.get('access-control-allow-origin'),null);
  for(const Origin of ['https://attacker.example','chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',trustedExtensionOrigin+'/',trustedExtensionOrigin+'.evil','null']){
    for(const path of ['/api/library','/api/settings','/api/library/export']){
      const denied=await app.request(path,{headers:{Origin}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
    }
    assert.equal((await app.post('/api/library/mutate',{type:'note',id:'demo/extension',text:'invalid'},{Origin})).status,403);
  }
  assert.equal((await app.request('/api/library',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const local=await app.request('/api/library',{headers:{Origin:app.base}});
  assert.equal(local.status,200);assert.equal(local.headers.get('access-control-allow-origin'),null);
  assert.equal(local.data.notes['demo/extension'],'新标签页保存的笔记');
});

test('extension preflights allow only known API paths, supported methods and required headers', async t => {
  const app=await fixture(t);
  const headers={Origin:trustedExtensionOrigin,'Sec-Fetch-Site':'cross-site','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type, X-Radar-Request'};
  const preflight=(path='/api/library/mutate',extra={})=>app.request(path,{method:'OPTIONS',headers:{...headers,...extra}});
  const allowed=await preflight();
  assert.equal(allowed.status,204);assert.equal(allowed.text,'');
  assert.equal(allowed.headers.get('access-control-allow-origin'),trustedExtensionOrigin);
  assert.equal(allowed.headers.get('access-control-allow-methods'),'POST');
  assert.equal(allowed.headers.get('access-control-allow-headers'),'content-type, x-radar-request');
  assert.equal(allowed.headers.get('access-control-allow-credentials'),null);
  assert.match(allowed.headers.get('vary'),/Origin/);
  const get=await preflight('/api/library',{'Access-Control-Request-Method':'GET'});
  assert.equal(get.status,204);assert.equal(get.headers.get('access-control-allow-methods'),'GET');
  for(const [path,extra,status] of [
    ['/api/library/mutate',{Origin:'https://attacker.example'},403],
    ['/api/library/mutate',{Origin:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},403],
    ['/api/library/mutate',{'Access-Control-Request-Headers':'Authorization'},403],
    ['/api/library/mutate',{'Access-Control-Request-Headers':'Content-Type, X-Radar-Request, X-Untrusted'},403],
    ['/api/library/mutate',{'Access-Control-Request-Method':'DELETE'},405],
    ['/api/health',{},405],
    ['/api/does-not-exist',{},404],
    ['/data/radar.sqlite',{},405],
  ]){
    const denied=await preflight(path,extra);assert.equal(denied.status,status);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  }
  assert.equal((await app.request('/api/library',{method:'OPTIONS'})).status,403);
});

test('writes require local UI headers, same origin, JSON objects and bounded request bodies', async t => {
  const app = await fixture(t);
  const mutation = { type: 'note', id: 'demo/security', text: 'must not be saved' };
  assert.equal((await app.post('/api/library/mutate', mutation, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await app.post('/api/library/mutate', mutation, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await app.post('/api/library/mutate', mutation, { 'X-Radar-Request': '' })).status, 403);
  assert.equal((await app.post('/api/library/mutate', mutation, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await app.post('/api/library/mutate', '{broken')).status, 400);
  assert.equal((await app.post('/api/library/mutate', '[]')).status, 400);
  assert.equal((await app.post('/api/library/mutate', 'null')).status, 400);
  assert.equal((await app.post('/api/library/mutate', { ...mutation, text: 'x'.repeat(8 * 1024 * 1024) })).status, 413);
  const library = (await app.request('/api/library')).data;
  assert.deepEqual(library.notes, {}); assert.equal(library.revision, 0);
  assert.equal((await app.post('/api/library/mutate', mutation)).status, 200);
  assert.equal((await app.request('/api/library')).data.notes['demo/security'], mutation.text);
});

test('library persists favorites, notes and reading state across service restarts and exports portable data', async t => {
  const app = await fixture(t);
  assert.deepEqual((await app.request('/api/library')).data.favorites, []);
  assert.equal((await app.post('/api/library/mutate', { type: 'favorite', ...entry(), value: true })).status, 200);
  assert.equal((await app.post('/api/library/mutate', { type: 'note', id: 'demo/radar', text: '以后用来整理项目' })).status, 200);
  await app.post('/api/library/mutate', { type: 'history', ...entry() });
  await app.post('/api/library/mutate', { type: 'hide', id: 'demo/ignored' });
  await app.post('/api/library/mutate', { type: 'preferences', preferences: { theme: 'dark', layout: 'list' } });
  const before = (await app.request('/api/library')).data;
  await app.restart();
  const after = (await app.request('/api/library')).data;
  assert.deepEqual(after, before);
  assert.equal(after.favorites[0].repo.id, 'demo/radar'); assert.equal(after.history[0].period, 'weekly');
  assert.ok(after.readIds.includes('demo/radar')); assert.ok(after.hiddenIds.includes('demo/ignored'));
  const exported = await app.request('/api/library/export');
  assert.equal(exported.data.app, 'github-top'); assert.equal(exported.data.version, 2);
  assert.equal(exported.data.notes['demo/radar'], '以后用来整理项目');
  assert.equal(exported.data.favorites[0].note, '以后用来整理项目');
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  await app.post('/api/library/mutate', { type: 'favorite', id: 'demo/radar', value: false });
  assert.equal((await app.request('/api/library')).data.notes['demo/radar'], '以后用来整理项目');
});

test('legacy and versioned imports merge safely, migration is idempotent and invalid import rolls back', async t => {
  const app = await fixture(t);
  await app.post('/api/library/mutate', { type: 'note', id: 'demo/radar', text: '现有笔记优先' });
  const payload = { favorites: [entry()], notes: { 'demo/radar': '旧浏览器笔记' }, preferences: { theme: 'dark' }, history: [entry()] };
  const imported = await app.post('/api/library/import', { payload, migrationId: 'browser-test-1' });
  assert.equal(imported.status, 200); assert.equal(imported.data.favorites.length, 1);
  assert.equal(imported.data.notes['demo/radar'], '现有笔记优先');
  await app.post('/api/library/mutate', { type: 'favorite', id: 'demo/radar', value: false });
  const beforeRepeat = (await app.request('/api/library')).data;
  assert.deepEqual((await app.post('/api/library/import', { payload, migrationId: 'browser-test-1' })).data, beforeRepeat);
  const file = { app: 'github-top', version: 1, favorites: [{ ...entry('demo/imported'), note: '便携文件笔记' }] };
  assert.equal((await app.post('/api/library/import', { payload: file })).status, 200);
  assert.equal((await app.request('/api/library')).data.notes['demo/imported'], '便携文件笔记');
  const beforeInvalid = (await app.request('/api/library')).data;
  assert.equal((await app.post('/api/library/import', { payload: { favorites: [entry('demo/should-rollback'), entry('../invalid')] } })).status, 400);
  assert.equal((await app.post('/api/library/import', { payload: { app: 'wrong-app', version: 2 } })).status, 400);
  assert.deepEqual((await app.request('/api/library')).data, beforeInvalid);
});

test('backup and restore round-trip library data and retain the state before restore', async t => {
  const app = await fixture(t);
  await app.post('/api/library/mutate', { type: 'favorite', ...entry(), value: true });
  await app.post('/api/library/mutate', { type: 'note', id: 'demo/radar', text: '备份里的笔记' });
  const backup = await app.post('/api/backups/create', {});
  assert.equal(backup.status, 200); assert.equal(backup.data.kind, 'manual');
  const listed = (await app.request('/api/backups')).data;
  assert.ok(listed.some(value => value.name === backup.data.name));
  assert.equal((await stat(join(app.directory, 'backups', backup.data.name))).mode & 0o777, 0o600);
  await app.post('/api/library/mutate', { type: 'note', id: 'demo/radar', text: '备份后的笔记' });
  await app.post('/api/library/mutate', { type: 'favorite', id: 'demo/radar', value: false });
  const altered = (await app.request('/api/library')).data;
  assert.equal((await app.post('/api/backups/restore', { name: '../../radar.sqlite' })).status, 400);
  assert.deepEqual((await app.request('/api/library')).data, altered);
  const restored = await app.post('/api/backups/restore', { name: backup.data.name });
  assert.equal(restored.status, 200); assert.equal(restored.data.library.notes['demo/radar'], '备份里的笔记');
  assert.equal(restored.data.library.favorites.length, 1); assert.equal(restored.data.backup.kind, 'before-restore');
  const reversed = await app.post('/api/backups/restore', { name: restored.data.backup.name });
  assert.equal(reversed.status, 200); assert.equal(reversed.data.library.notes['demo/radar'], '备份后的笔记');
  assert.equal(reversed.data.library.favorites.length, 0);
});

test('settings validate unsupported values, persist chosen settings and expose honest idle status', async t => {
  const app = await fixture(t);
  assert.deepEqual((await app.request('/api/settings')).data, initialSettings());
  for (const bad of [
    { ...initialSettings(), token: 'not-allowed' },
    { ...initialSettings(), collector: { ...initialSettings().collector, intervalMinutes: 1 } },
    { ...initialSettings(), collector: { ...initialSettings().collector, languages: ['malicious-language'] } },
    { ...initialSettings(), collector: { ...initialSettings().collector, periods: ['yearly'] } },
    { ...initialSettings(), localModel: { enabled: 'yes' } },
    { ...initialSettings(), localModel: { enabled: true, provider: 'remote-unknown' } },
  ]) assert.equal((await app.post('/api/settings', bad)).status, 400);
  assert.deepEqual((await app.request('/api/settings')).data, initialSettings());
  const wanted = { ...initialSettings(), collector: { ...initialSettings().collector, intervalMinutes: 240, languages: ['python', 'python'], periods: ['monthly'] } };
  const saved = await app.post('/api/settings', wanted);
  assert.equal(saved.status, 200); assert.deepEqual(saved.data.collector.languages, ['python']);
  await app.restart();
  assert.deepEqual((await app.request('/api/settings')).data, saved.data);
  const status = (await app.request('/api/status')).data;
  assert.equal(status.connection.configured, false); assert.equal(status.connection.remaining, null);
  assert.equal(status.collection.running, false); assert.equal(status.collection.nextRunAt, null);
  assert.equal(status.model.enabled, false); assert.equal(status.model.installed, false); assert.equal(status.model.running, false);
  assert.equal((await app.post('/api/summary', { id: '../bad' })).status, 400);
  assert.equal((await app.post('/api/summary', { id: 'demo/not-collected' })).status, 404);
});

test('token is private on disk and absent from API responses, portable exports, backups and logs', async t => {
  const app = await fixture(t);
  const token = 'github_pat_http_test_secret_123456789';
  assert.equal((await app.post('/api/token', { token: 'bad\nvalue' })).status, 400);
  const saved = await app.post('/api/token', { token });
  assert.equal(saved.status, 200); assert.equal(saved.data.configured, true); assert.equal(saved.text.includes(token), false);
  assert.equal((await stat(join(app.directory, '.github-token'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(app.directory, '.github-token'), 'utf8'), token);
  await app.post('/api/library/mutate', { type: 'note', id: 'demo/token-test', text: '公开的测试笔记' });
  const backup = await app.post('/api/backups/create', {});
  assert.equal(backup.status, 200);
  for (const path of ['/api/status', '/api/settings', '/api/library', '/api/library/export', '/api/backups']) {
    const response = await app.request(path); assert.equal(response.status, 200); assert.equal(response.text.includes(token), false, path);
  }
  for (const name of await readdir(join(app.directory, 'backups'))) assert.equal((await readFile(join(app.directory, 'backups', name))).includes(Buffer.from(token)), false);
  await app.restart();
  assert.equal((await app.request('/api/status')).data.connection.configured, true);
  const cleared = await app.post('/api/token/clear', {});
  assert.equal(cleared.status, 200); assert.equal(cleared.data.configured, false);
  await assert.rejects(stat(join(app.directory, '.github-token')), { code: 'ENOENT' });
  assert.equal(app.logs().includes(token), false);
});


test('summary mode changes are explicit and stale pages cannot silently trigger a different provider', async t => {
  const app=await fixture(t);
  await app.post('/api/library/mutate',{type:'favorite',...entry(),value:true});
  assert.equal((await app.post('/api/summary',{id:'demo/radar',provider:'codex'})).status,409);
  const settings={...initialSettings(),localModel:{enabled:true,provider:'local'}};
  assert.equal((await app.post('/api/settings',settings)).status,200);
  const mismatch=await app.post('/api/summary',{id:'demo/radar',provider:'codex'});
  assert.equal(mismatch.status,409);assert.match(mismatch.data.error,/方式已在其他页面修改/);
  const changed=await app.post('/api/settings',{...settings,localModel:{enabled:true,provider:'codex'}});
  assert.equal(changed.data.localModel.provider,'codex');
  assert.equal((await app.post('/api/summary',{id:'demo/radar',provider:'local'})).status,409);
  await app.restart();
  assert.equal((await app.request('/api/settings')).data.localModel.provider,'codex');
});

test('optional standalone Codex endpoints reject other origins and private payloads before fetching README',async t=>{
 const app=await fixture(t),headers={Origin:trustedExtensionOrigin,'Content-Type':'application/json','X-Radar-Request':'local-ui'};
 assert.ok((await app.request('/api/health')).data.features.includes('extension-summary'));
 assert.equal((await app.request('/api/extension/model')).status,403);
 const status=await app.request('/api/extension/model',{headers:{Origin:trustedExtensionOrigin}});
 assert.equal(status.status,200);assert.equal(status.data.provider,'codex');assert.equal(status.data.enabled,false);
 assert.equal((await app.post('/api/extension/summary',{id:'demo/radar',provider:'codex'})).status,403);
 for(const data of [{id:'../secret',provider:'codex'},{id:'demo/radar',provider:'codex',notes:'private'},{id:'demo/radar',provider:'local'}]){
  assert.equal((await app.request('/api/extension/summary',{method:'POST',headers,body:JSON.stringify(data)})).status,400);
 }
 assert.equal((await app.request('/api/extension/summary',{method:'POST',headers,body:JSON.stringify({id:'demo/radar',provider:'codex'})})).status,409);
});
