import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

let serial = 0;
async function setup(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'github-radar-auth-'));
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  const oldDirectory = process.env.GITHUB_TOP_DATA;
  process.env.GITHUB_TOP_DATA = directory;
  const module = await import(`../server/github.mjs?auth-test=${++serial}`);
  t.after(async () => {
    globalThis.fetch = originalFetch; Date.now = originalNow;
    if (oldDirectory === undefined) delete process.env.GITHUB_TOP_DATA;
    else process.env.GITHUB_TOP_DATA = oldDirectory;
    await rm(directory, { recursive: true, force: true });
  });
  return { module, directory };
}
const repoBody = name => ({ full_name: name, html_url: `https://github.com/${name}`, stargazers_count: 7, forks_count: 1, topics: [] });
const jsonResponse = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

// Every upstream request is replaced here; these tests never use GitHub quota.
test('token stays in a private local file, only API requests receive authorization', async t => {
  const { module: github, directory } = await setup(t);
  const secret = 'github_pat_example_local_secret_123456789';
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.Authorization, `Bearer ${secret}`);
      return jsonResponse(repoBody('test/token'), 200, { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4998', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) });
    }
    assert.equal(options.headers.Authorization, undefined);
    return new Response("<html>There aren't any trending repositories.</html>");
  };
  const saved = await github.saveToken(secret);
  assert.equal(saved.configured, true);
  assert.equal(saved.available, null);
  assert.equal(calls, 0);
  assert.equal((await stat(resolve(directory, '.github-token'))).mode & 0o777, 0o600);
  assert.equal(await readFile(resolve(directory, '.github-token'), 'utf8'), secret);
  await github.detail('test/token');
  await github.trending('daily', '');
  const status = await github.getConnectionStatus({ refresh: true });
  assert.equal(calls, 2, 'a recent API response supplies quota without an extra probe');
  assert.equal(status.available, true); assert.equal(status.remaining, 4998);
  assert.equal(JSON.stringify(status).includes(secret), false);
  for (const name of await readdir(directory)) if (name !== '.github-token') assert.equal((await readFile(resolve(directory, name), 'utf8')).includes(secret), false);
  const cleared = await github.clearToken();
  assert.equal(cleared.configured, false); assert.equal(cleared.remaining, null);
  await assert.rejects(stat(resolve(directory, '.github-token')), { code: 'ENOENT' });
  await assert.rejects(github.saveToken('bad token\ninjected'), /格式无效/);
});

test('cross-origin redirects stop before a second request can disclose a token', async t => {
  const { module: github } = await setup(t);
  await github.saveToken('ghp_example_private_token_123456789');
  let calls = 0;
  globalThis.fetch = async (_, options) => {
    calls++; assert.ok(options.headers.Authorization);
    return new Response(null, { status: 302, headers: { location: 'https://attacker.example/collect' } });
  };
  await assert.rejects(github.detail('test/redirect'), /跳转/);
  assert.equal(calls, 1);
});

test('API quota exhaustion backs off across endpoints and restarts until reset', async t => {
  const { module: github } = await setup(t);
  let now = Date.now(), calls = 0;
  Date.now = () => now;
  const reset = Math.floor(now / 1000) + 120;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return jsonResponse({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': String(reset) });
    return jsonResponse(repoBody('test/restored'), 200, { 'x-ratelimit-remaining': '59' });
  };
  await assert.rejects(github.detail('test/limited'), /额度暂时受限/);
  await assert.rejects(github.readme('test/another'), /额度暂时受限/);
  const status = await github.getConnectionStatus({ refresh: true });
  assert.equal(status.available, false); assert.equal(status.remaining, 0);
  assert.equal(status.nextRetryAt, new Date(reset * 1000).toISOString());
  const restarted = await import(`../server/github.mjs?auth-test=${++serial}`);
  await assert.rejects(restarted.releases('test/restart'), /额度暂时受限/);
  assert.equal(calls, 1);
  now = (reset + 1) * 1000;
  const restored = await restarted.detail('test/restored');
  assert.equal(restored.data.id, 'test/restored'); assert.equal(calls, 2);
  assert.equal((await restarted.getConnectionStatus()).nextRetryAt, null);
});

test('secondary limits honor Retry-After and permission errors do not suspend unrelated queries', async t => {
  const { module: github } = await setup(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return jsonResponse({ message: 'Resource not accessible by personal access token' }, 403, { 'x-ratelimit-remaining': '57' });
    if (calls === 2) return jsonResponse(repoBody('test/public'));
    return jsonResponse({ message: 'secondary rate limit' }, 429, { 'retry-after': '180', 'x-ratelimit-remaining': '55' });
  };
  await assert.rejects(github.detail('test/private'), /权限/);
  assert.equal((await github.getConnectionStatus()).nextRetryAt, null);
  await github.detail('test/public');
  await assert.rejects(github.detail('test/secondary'), /额度暂时受限/);
  assert.ok(Date.parse((await github.getConnectionStatus()).nextRetryAt) >= Date.now() + 175000);
  await assert.rejects(github.releases('test/no-retry'), /额度暂时受限/);
  assert.equal(calls, 3);
});

test('README is traceable, UTF-8 safe, capped at 32 KiB and cached', async t => {
  const { module: github } = await setup(t);
  let calls = 0;
  const sha = 'a'.repeat(40);
  globalThis.fetch = async url => {
    calls++; assert.equal(url, 'https://api.github.com/repos/test/readme/readme');
    return jsonResponse({ encoding: 'base64', content: Buffer.from('# README\n' + '中文正文'.repeat(10000)).toString('base64'), sha, html_url: 'https://github.com/test/readme/blob/main/README.md' });
  };
  const value = await github.readme('test/readme');
  assert.ok(Buffer.byteLength(value.content) <= 32768);
  assert.equal(value.content.includes('\ufffd'), false); assert.equal(value.truncated, true);
  assert.equal(value.sourceVersion, sha); assert.equal(value.sourceUrl, 'https://github.com/test/readme/blob/main/README.md');
  assert.ok(value.fetchedAt); assert.equal(value.cached, false);
  assert.equal((await github.readme('test/readme')).cached, true); assert.equal(calls, 1);
  await assert.rejects(github.readme('../secret'), /无效/);
});

test('release data contains only public stable releases; no release stays empty', async t => {
  const { module: github } = await setup(t);
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (url.includes('/test/empty/')) return jsonResponse([]);
    return jsonResponse([
      { id: 1, tag_name: 'v3-draft', draft: true, prerelease: false },
      { id: 2, tag_name: 'v2-rc', draft: false, prerelease: true },
      { id: 3, tag_name: 'v1.0', name: 'First release', draft: false, prerelease: false, published_at: '2026-09-01T00:00:00Z', html_url: 'https://github.com/test/release/releases/tag/v1.0' },
    ]);
  };
  const value = await github.releases('test/release');
  assert.equal(value.data.length, 1); assert.equal(value.data[0].tagName, 'v1.0');
  assert.equal(value.data[0].draft, false); assert.equal(value.data[0].prerelease, false);
  await github.releases('test/release'); assert.equal(calls, 1);
  assert.deepEqual((await github.releases('test/empty')).data, []);
});

test('transport errors never echo headers, tokens or unsafe upstream error bodies', async t => {
  const { module: github } = await setup(t);
  const secret = 'ghp_unprinted_secret_123456789';
  await github.saveToken(secret);
  globalThis.fetch = async () => { throw new Error(`Connection failed with Authorization: Bearer ${secret}`); };
  await assert.rejects(github.detail('test/failure'), error => error.message === 'GitHub 网络连接失败，请稍后重试');
  const status = await github.getConnectionStatus();
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(status.available, false);
  await github.clearToken();
  globalThis.fetch = async () => jsonResponse({ message: secret }, 401);
  const invalid = await github.getConnectionStatus({ refresh: true });
  assert.match(invalid.lastError, /Token 无效/);
  assert.equal(JSON.stringify(invalid).includes(secret), false);
});

test('connection checks coalesce and use server quota metadata without automatic probing', async t => {
  const { module: github } = await setup(t);
  let calls = 0;
  globalThis.fetch = async url => {
    calls++; assert.equal(url, 'https://api.github.com/rate_limit');
    return jsonResponse({ resources: { core: { limit: 60, remaining: 12, reset: Math.floor(Date.now() / 1000) + 1000 } } });
  };
  assert.equal((await github.getConnectionStatus()).remaining, null); assert.equal(calls, 0);
  const values = await Promise.all([github.getConnectionStatus({ refresh: true }), github.getConnectionStatus({ refresh: true })]);
  assert.equal(calls, 1); assert.equal(values[0].remaining, 12); assert.equal(values[1].limit, 60);
  await github.getConnectionStatus({ refresh: true }); assert.equal(calls, 1);
});

test('changing token while an older probe runs cannot publish the old account quota', async t => {
  const { module: github } = await setup(t);
  let respond;
  globalThis.fetch = async () => new Promise(resolve => { respond = resolve; });
  const oldProbe = github.getConnectionStatus({ refresh: true });
  while (!respond) await new Promise(resolve => setImmediate(resolve));
  await github.saveToken('ghp_replaced_local_token_123456789');
  respond(jsonResponse({ resources: { core: { limit: 60, remaining: 0, reset: Math.floor(Date.now() / 1000) + 1000 } } }));
  await oldProbe;
  const status = await github.getConnectionStatus();
  assert.equal(status.configured, true); assert.equal(status.remaining, null);
  assert.equal(status.nextRetryAt, null); assert.equal(status.available, null);
});

test('oversized and malformed README responses are rejected without echoing source text', async t => {
  const { module: github } = await setup(t);
  const secret = 'ghp_not_in_error_messages_123456789';
  await github.saveToken(secret);
  globalThis.fetch = async () => new Response(`${secret} invalid JSON`);
  await assert.rejects(github.readme('test/bad-json'), error => /格式/.test(error.message) && !error.message.includes(secret));
  globalThis.fetch = async () => new Response('a'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(github.readme('test/huge'), /资料过大/);
});
