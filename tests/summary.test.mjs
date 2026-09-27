import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createSummarizer, normalizeSummary } from '../server/summary.mjs';

const result = { purpose: '本机运行的开源笔记工具。', audience: '需要整理笔记的人。', gettingStarted: '下载桌面安装包。', requirements: 'README 未说明', caveats: 'README 未说明' };
const input = { readme: '# Notes\nA local note-taking application. Download the desktop app from Releases. No API key required.', sourceUrl: 'https://github.com/test/notes/blob/main/README.md', sourceVersion: 'abc' };
async function fixture(t, options = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'github-top-summary-'));
  let calls = 0;
  const service = createSummarizer({ cacheDir: dir, autoStart: false, fetch: async (url, options) => {
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    calls++;
    return options?.body ? Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }) : new Response('', { status: 400 });
  }, ...options });
  t.after(async () => { service.close(); await rm(dir, { recursive: true, force: true }); });
  return { service, dir, calls: () => calls };
}

test('summary persists locally, concurrent identical requests deduplicate, source changes regenerate', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.service.summarize('test/notes', input), f.service.summarize('test/notes', input)]);
  assert.equal(f.calls(), 1); assert.deepEqual(a, b); assert.equal(a.cached, false);
  assert.match(a.sourceHash, /^[a-f0-9]{64}$/); assert.equal(a.sourceVersion, 'abc');
  assert.equal((await f.service.summarize('test/notes', input)).cached, true);
  assert.equal(f.calls(), 1);
  await f.service.summarize('test/notes', { ...input, readme: input.readme + '\nAdded offline sync.' });
  assert.equal(f.calls(), 2);
  const restarted = createSummarizer({ cacheDir: f.dir, autoStart: false, fetch: () => { throw Error('network must not be used for cache'); } });
  t.after(() => restarted.close());
  assert.equal((await restarted.summarize('test/notes', input)).cached, true);
});

test('invalid models and nonlocal endpoints cannot become successful summaries', async t => {
  assert.throws(() => createSummarizer({ endpoint: 'https://cloud.example.com' }), /本机/);
  assert.throws(() => createSummarizer({ endpoint: 'http://127.0.0.1.evil.test:4318' }), /本机/);
  assert.throws(() => normalizeSummary({ ...result, purpose: 'This is not Chinese' }), /中文/);
  assert.throws(() => normalizeSummary({ ...result, audience: ['无效'] }), /格式/);
  const f = await fixture(t);
  await assert.rejects(f.service.summarize('../etc', input), /无效/);
  await assert.rejects(f.service.summarize('test/notes', { ...input, readme: '' }), /不足/);
  await assert.rejects(f.service.summarize('test/notes', { ...input, sourceUrl: 'https://github.com/other/notes/blob/main/README.md' }), /来源/);
  assert.equal(f.calls(), 0);
});

test('malformed output and runtime failures are honest, are not cached, and allow retry', async t => {
  let broken = true;
  const f = await fixture(t, { fetch: async url => url.pathname === '/health'
    ? Response.json({ status: 'ok' })
    : Response.json({ choices: [{ message: { content: broken ? '{broken' : JSON.stringify(result) } }] }) });
  await assert.rejects(f.service.summarize('test/notes', input), /格式/);
  assert.deepEqual(await readdir(f.dir), []);
  assert.match((await f.service.status()).lastError, /格式/);
  broken = false;
  assert.equal((await f.service.summarize('test/notes', input)).purpose, result.purpose);
  assert.equal((await f.service.status()).lastError, null);
});

test('runtime calls serialize, include untrusted-source boundary, and disable tools', async t => {
  let active = 0, peak = 0;
  const f = await fixture(t, { fetch: async (url, options) => {
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    active++; peak = Math.max(peak, active);
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content, /不可信/);
    assert.equal(body.tools, undefined);
    assert.equal(body.response_format.json_schema.strict, true);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  }});
  await Promise.all([f.service.summarize('test/notes', input), f.service.summarize('test/notes', { ...input, sourceVersion: 'def' })]);
  assert.equal(peak, 1);
  f.service.setEnabled(false);
  await assert.rejects(f.service.summarize('test/notes', input), /暂停/);
});

test('corrupt cached data is regenerated and incomplete README disclosure is preserved', async t => {
  const f = await fixture(t);
  await f.service.summarize('test/notes', input);
  await writeFile(resolve(f.dir, (await readdir(f.dir))[0]), '{broken');
  assert.equal((await f.service.summarize('test/notes', input)).cached, false);
  assert.equal(f.calls(), 2);
  const long = await f.service.summarize('test/notes', { ...input, readme: input.readme.repeat(150) });
  assert.match(long.caveats, /节选/);
});

test('requirements must carry a verbatim README evidence span; missing text is not no requirements', async t => {
  let evidence = '', statement = '无需 API 密钥。';
  const f = await fixture(t, { fetch: async url => url.pathname === '/health'
    ? Response.json({ status: 'ok' })
    : Response.json({ choices: [{ message: { content: JSON.stringify({ ...result, requirements: statement, requirementEvidence: evidence }) } }] }) });
  assert.equal((await f.service.summarize('test/notes', input)).requirements, 'README 未说明');
  evidence = 'No API key required.';
  assert.equal((await f.service.summarize('test/notes', { ...input, refresh: true })).requirements, statement);
  evidence = 'No GPU is required at all.';
  assert.equal((await f.service.summarize('test/notes', { ...input, refresh: true })).requirements, 'README 未说明');
  statement = '无'; evidence = 'No API key required.';
  assert.equal((await f.service.summarize('test/notes', { ...input, refresh: true })).requirements, 'README 未说明');
});
