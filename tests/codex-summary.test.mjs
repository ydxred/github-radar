import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm, readdir, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, delimiter, resolve } from 'node:path';
import { createCodexSummarizer, codexEnvironment, normalizeCodexSummary } from '../server/codex-summary.mjs';

const sample = { purpose: '这是帮助整理本地 Markdown 笔记的桌面软件，适合把零散的想法集中保存和查找。', audience: '可能适合学生和研究人员。', gettingStarted: '从项目的发布页面下载桌面安装包。', requirements: 'README 未说明', caveats: 'README 未说明' };
const source = { readme: '# Notes\nA local Markdown note-taking app for students. Download a desktop installer from Releases.', sourceUrl: 'https://github.com/example/notes/blob/main/README.md', sourceVersion: 'one' };

function mockRuntime(options = {}) {
  const calls = [], kills = [];
  let execCount = 0, active = 0, peak = 0;
  const spawn = (binary, args, settings) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.pid = 999999999;
    let input = '', ended = false;
    const record = { binary, args, settings, child, input: null };
    calls.push(record);
    const isStatus = args[0] === 'login';
    const finish = code => { if (ended) return; ended = true; if (!isStatus) active--; child.emit('close', code); };
    child.kill = signal => { kills.push(signal); queueMicrotask(() => finish(-1)); return true; };
    child.stdin = new Writable({
      write(chunk, _encoding, callback) { input += String(chunk); callback(); },
      final(callback) {
        record.input = input; callback();
        setTimeout(async () => {
          if (ended) return;
          if (isStatus) {
            if (options.missing) { child.emit('error', Object.assign(new Error('private path and authentication details'), { code: 'ENOENT' })); return; }
            child.stderr.write(options.auth === 'apikey' ? 'Logged in using an API key - sk-private-sentinel' : options.auth === 'none' ? 'Not logged in' : 'Logged in using ChatGPT');
            finish(options.auth === 'none' ? 1 : 0); return;
          }
          execCount++; active++; peak = Math.max(peak, active);
          if (options.hang) return;
          if (options.toolEvent) {
            child.stdout.write('{"type":"item.started","item":{"ty');
            child.stdout.write('pe":"command_execution"}}\n'); return;
          }
          if (options.noisy) { child.stderr.write('private-sentinel'.repeat(30000)); return; }
          if (options.fail) { child.stderr.write('API key sk-private-sentinel failed, account private@example.test'); finish(1); return; }
          try {
            const file = args[args.indexOf('--output-last-message') + 1];
            const content = options.output ? options.output() : JSON.stringify(sample);
            await writeFile(file, content);
            child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":100}}\n');
            finish(0);
          } catch (cause) { child.emit('error', cause); }
        }, options.delayMs || 2);
      },
    });
    return child;
  };
  return { spawn, calls, kills, execCount: () => execCount, peak: () => peak };
}

async function setup(t, runtimeOptions = {}, serviceOptions = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'github-radar-codex-test-'));
  const runtime = mockRuntime(runtimeOptions);
  const service = createCodexSummarizer({ dataDir: directory, binary: '/mock/codex', spawn: runtime.spawn, ...serviceOptions });
  t.after(async () => { service.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, runtime, service };
}

test('Codex status only checks CLI ChatGPT login, caches safely and never runs inference', async t => {
  const f = await setup(t);
  const [a, b] = await Promise.all([f.service.status(), f.service.status()]);
  assert.equal(a.authenticated, true); assert.equal(a.provider, 'codex'); assert.equal(a.localOnly, false);
  assert.equal(a.model, 'Codex（默认模型）'); assert.equal(b.authenticated, true);
  await f.service.status();
  assert.equal(f.runtime.calls.length, 1); assert.equal(f.runtime.execCount(), 0);
  assert.deepEqual(f.runtime.calls[0].args, ['login', 'status']);
  assert.equal(f.runtime.calls[0].input, '');
  assert.doesNotMatch(JSON.stringify(a), /private|ChatGPT.*token|sk-/i);
});

test('Codex environment preserves account locations and proxy route while stripping API and GitHub credentials', () => {
  const input = { HOME: '/existing-home', CODEX_HOME: '/existing-codex', PATH: '/usr/bin', HTTPS_PROXY: 'http://127.0.0.1:9999',
    NO_PROXY: 'localhost', SSL_CERT_FILE: '/ca.pem', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', GITHUB_TOKEN: 'secret',
    ANTHROPIC_API_KEY: 'secret', CODEX_CONFIG: 'unexpected', NODE_OPTIONS: '--require private.js' };
  const env = codexEnvironment(input);
  assert.equal(env.HOME, input.HOME); assert.equal(env.CODEX_HOME, input.CODEX_HOME);
  assert.equal(env.PATH.split(delimiter)[0], dirname(process.execPath));
  assert.equal(env.HTTPS_PROXY, input.HTTPS_PROXY); assert.equal(env.SSL_CERT_FILE, input.SSL_CERT_FILE);
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'CODEX_CONFIG', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
});

test('API-key login and missing binary cannot trigger a potentially billable Codex request', async t => {
  const api = await setup(t, { auth: 'apikey' });
  const status = await api.service.status();
  assert.equal(status.authenticated, false); assert.equal(status.installed, true);
  await assert.rejects(api.service.summarize('example/notes', source), /ChatGPT/);
  assert.equal(api.runtime.execCount(), 0); assert.doesNotMatch(JSON.stringify(await api.service.status()), /sk-private/);
  const missing = await setup(t, { missing: true });
  assert.equal((await missing.service.status()).installed, false);
  await assert.rejects(missing.service.summarize('example/notes', source), /未找到/);
  assert.equal(missing.runtime.execCount(), 0);
});

test('Codex uses stdin, schema and isolated directory; successful summaries cache and deduplicate', async t => {
  const f = await setup(t, { delayMs: 10 });
  const [a, b] = await Promise.all([f.service.summarize('example/notes', source), f.service.summarize('example/notes', source)]);
  assert.deepEqual(a, b); assert.equal(a.cached, false); assert.equal(a.localOnly, false); assert.equal(a.provider, 'codex');
  assert.match(a.sourceHash, /^[a-f0-9]{64}$/); assert.equal(f.runtime.execCount(), 1);
  const run = f.runtime.calls.find(call => call.args.includes('exec'));
  assert.equal(run.settings.shell, false); assert.equal(run.settings.detached, true);
  assert.notEqual(run.settings.cwd, process.cwd());
  assert.deepEqual(run.args.slice(0, 3), ['-a', 'never', 'exec']);
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--output-schema', '--output-last-message']) assert.ok(run.args.includes(flag), flag);
  assert.equal(run.args[run.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(run.args.at(-1), '-'); assert.equal(run.args.includes('--model'), false);
  assert.ok(run.args.includes('forced_login_method="chatgpt"'));
  assert.ok(run.args.includes('features.shell_tool=false')); assert.ok(run.args.includes('project_doc_max_bytes=0'));
  assert.ok(run.args.includes('skills.include_instructions=false')); assert.ok(run.args.includes('features.plugins=false'));
  assert.ok(run.args.includes('--strict-config')); assert.ok(run.args.includes('include_environment_context=false'));
  const boundary = run.args.find(value => value.startsWith('developer_instructions='));
  assert.match(boundary, /不得调用任何工具/); assert.match(boundary, /AGENTS/); assert.doesNotMatch(boundary, /example\/notes/);
  assert.match(run.input, /不可信/); assert.match(run.input, /不执行命令/); assert.match(run.input, /"project":"example\/notes"/);
  assert.equal(run.args.some(value => value.includes(source.readme)), false);
  await assert.rejects(access(run.settings.cwd));
  const cached = await f.service.summarize('example/notes', source);
  assert.equal(cached.cached, true); assert.equal(f.runtime.execCount(), 1);
  const restarted = createCodexSummarizer({ dataDir: f.directory, spawn() { throw new Error('cached result must not check auth or run inference'); } });
  t.after(() => restarted.close());
  assert.equal((await restarted.summarize('example/notes', source)).cached, true);
  await f.service.summarize('example/notes', { ...source, sourceVersion: 'two' });
  assert.equal(f.runtime.execCount(), 2);
});

test('different projects are rejected while one runs; no hidden queue consumes later quota', async t => {
  const f = await setup(t, { delayMs: 25 });
  const first = f.service.summarize('example/notes', source);
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(f.service.summarize('example/other', { ...source, sourceUrl: 'https://github.com/example/other/blob/main/README.md' }), cause => cause.status === 429);
  await first;
  assert.equal(f.runtime.execCount(), 1); assert.equal(f.runtime.peak(), 1);
});

test('input sources, output language and field lengths are validated; malformed output is never cached', async t => {
  let malformed = true;
  const f = await setup(t, { output: () => malformed ? '{broken' : JSON.stringify(sample) });
  await assert.rejects(f.service.summarize('../secret', source), /无效/);
  await assert.rejects(f.service.summarize('example/notes', { ...source, sourceUrl: 'https://github.com/other/notes/blob/main/README.md' }), /来源/);
  await assert.rejects(f.service.summarize('example/notes', { ...source, readme: '' }), /不足/);
  assert.equal(f.runtime.calls.length, 0);
  assert.throws(() => normalizeCodexSummary({ ...sample, purpose: 'English only' }), /中文/);
  assert.throws(() => normalizeCodexSummary({ ...sample, purpose: '文'.repeat(301) }), /过长/);
  await assert.rejects(f.service.summarize('example/notes', source), /格式/);
  assert.deepEqual(await readdir(f.directory), []);
  malformed = false;
  assert.equal((await f.service.summarize('example/notes', source)).purpose, sample.purpose);
});

test('README is limited to 24000 characters and truncation is explicit within the field limit', async t => {
  const f = await setup(t);
  const readme = 'a'.repeat(23990) + 'ABCDEFGHIJ' + 'SHOULD_NOT_REACH_MODEL';
  const result = await f.service.summarize('example/notes', { ...source, readme });
  const input = f.runtime.calls.find(call => call.args.includes('exec')).input;
  assert.match(input, /ABCDEFGHIJ/); assert.doesNotMatch(input, /SHOULD_NOT_REACH_MODEL/);
  assert.match(result.caveats, /24,000/); assert.ok(Array.from(result.caveats).length <= 300);
});

test('timeouts terminate the spawned process and do not return raw CLI diagnostics', async t => {
  const f = await setup(t, { hang: true }, { timeoutMs: 40 });
  await assert.rejects(f.service.summarize('example/notes', source), cause => cause.status === 504 && /超时/.test(cause.message));
  assert.ok(f.runtime.kills.includes('SIGTERM'));
  assert.deepEqual(await readdir(f.directory), []);
  assert.equal((await f.service.status()).busy, false);
  const failure = await setup(t, { fail: true });
  await assert.rejects(failure.service.summarize('example/notes', source), cause => !/private|sk-/.test(cause.message));
  assert.doesNotMatch(JSON.stringify(await failure.service.status()), /private|sk-/);
});

test('stop, pause, tool attempts and excessive CLI output terminate work without saving results', async t => {
  for (const operation of ['pause', 'close', 'tool', 'noisy']) {
    const f = await setup(t, { hang: ['pause', 'close'].includes(operation), toolEvent: operation === 'tool', noisy: operation === 'noisy' });
    const task = f.service.summarize('example/notes', source);
    const rejection = assert.rejects(task, /暂停|停止|过多/);
    if (operation === 'pause' || operation === 'close') {
      while (!f.runtime.execCount()) await new Promise(resolve => setTimeout(resolve, 2));
      if (operation === 'pause') f.service.setEnabled(false); else f.service.close();
    }
    await rejection;
    assert.ok(f.runtime.kills.includes('SIGTERM'));
    assert.deepEqual(await readdir(f.directory), []);
  }
});

test('corrupt persistent cache is regenerated and cache permissions are private', async t => {
  const f = await setup(t);
  await f.service.summarize('example/notes', source);
  const dir = resolve(f.directory, 'codex-summaries'), file = resolve(dir, (await readdir(dir))[0]);
  await writeFile(file, '{broken');
  assert.equal((await f.service.summarize('example/notes', source)).cached, false);
  assert.equal(f.runtime.execCount(), 2);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).provider, 'codex');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
});

test('explicit binary override wins over automatic sibling detection and failed status never calls exec', async t => {
  const original = process.env.GITHUB_TOP_CODEX_BIN;
  process.env.GITHUB_TOP_CODEX_BIN = '/explicitly-missing/codex';
  const runtime = mockRuntime({ missing: true });
  const service = createCodexSummarizer({ spawn: runtime.spawn });
  t.after(() => { service.close(); if (original === undefined) delete process.env.GITHUB_TOP_CODEX_BIN; else process.env.GITHUB_TOP_CODEX_BIN = original; });
  assert.equal((await service.status()).installed, false);
  assert.equal(runtime.calls[0].binary, '/explicitly-missing/codex');
  assert.equal(runtime.execCount(), 0);
});
