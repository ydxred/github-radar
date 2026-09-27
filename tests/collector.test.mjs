import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
// Each collector and its imported modules own singleton state. A fresh process isolates
// that state as well as SQLite, API cache, quota, settings, clock and fetch mocks.
async function scenario(t, action) {
  const directory = await mkdtemp(join(tmpdir(), 'radar-collector-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = `
    import assert from 'node:assert/strict';
    import {readFile, writeFile, stat} from 'node:fs/promises';
    import {resolve} from 'node:path';
    import {DatabaseSync} from 'node:sqlite';
    const dataDir = process.env.GITHUB_TOP_DATA;
    const NativeDate = Date;
    let now = NativeDate.parse('2026-09-27T08:00:00.000Z');
    globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    globalThis.fetch = async url => { throw new Error('Unexpected upstream request: ' + url); };
    const html = await readFile('tests/fixtures/trending-weekly.html', 'utf8');
    const collector = await import('./server/collector.mjs');
    const store = await import('./server/store.mjs');
    const settings = await import('./server/settings.mjs');
    const github = await import('./server/github.mjs');
    const json = (value, headers = {}) => new Response(JSON.stringify(value), {status: 200, headers});
    const favorite = id => ({repo: {id, description: 'A useful tool', language: 'JavaScript', stars: 123, forks: 4, periodStars: 12, rank: 1}, period: 'weekly'});
    const advance = milliseconds => { now += milliseconds; };
    const setCollector = patch => { const current = settings.getSettings(); return settings.saveSettings({...current, collector: {...current.collector, ...patch}}); };
    async function waitUntil(predicate) {
      const deadline = NativeDate.now() + 5000;
      while (NativeDate.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
      throw new Error('Timed out waiting for collector: ' + JSON.stringify(collector.collectionStatus()));
    }
    async function finished(startedAt) {
      await waitUntil(async () => {
        const state = collector.collectionStatus();
        if (state.running || state.lastStartedAt !== startedAt || !state.lastFinishedAt) return false;
        try { return JSON.stringify(JSON.parse(await readFile(resolve(dataDir, 'collection-status.json'), 'utf8'))) === JSON.stringify(state); }
        catch { return false; }
      });
      return collector.collectionStatus();
    }
    async function run(options) {
      advance(1000);
      const result = collector.runCollection(options);
      assert.equal(result.started, true);
      return finished(result.status.lastStartedAt);
    }
    function counts() {
      const db = new DatabaseSync(resolve(dataDir, 'radar.sqlite'), {readOnly: true});
      try { return {snapshots: db.prepare('SELECT count(*) AS n FROM snapshots').get().n, rows: db.prepare('SELECT count(*) AS n FROM snapshot_repos').get().n}; }
      finally { db.close(); }
    }
    await (${action.toString()})();
    collector.stopCollector();
  `;
  try {
    await execute(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, GITHUB_TOP_DATA: directory, GITHUB_TOP_DISABLE_COLLECTOR: '1', GITHUB_TOP_AI_HOME: join(directory, 'unused-model-home') },
      timeout: 15000, maxBuffer: 1024 * 1024,
    });
  } catch (error) { throw new Error(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`); }
}

test('default collection fetches sixteen varied-language boards and caches/deduplicates observations without inventing history', async t => {
  await scenario(t, async () => {
    const calls = [];
    globalThis.fetch = async url => { calls.push(url); assert.ok(url.startsWith('https://github.com/trending')); return new Response(html); };
    const first = await run();
    assert.equal(calls.length, 16); assert.equal(new Set(calls).size, 16);
    const languages = ['', 'python', 'typescript', 'javascript', 'go', 'rust', 'java', 'c++'];
    assert.deepEqual(new Set(first.boards.map(row => `${row.period}:${row.language}`)), new Set(['daily', 'weekly'].flatMap(period => languages.map(language => `${period}:${language}`))));
    assert.ok(first.boards.every(row => row.count === 3 && row.stale === false));
    assert.equal(store.getDiscoveries().length, 3);
    assert.deepEqual(counts(), { snapshots: 16, rows: 48 });
    assert.ok(first.lastSuccessAt); assert.equal(first.error, null);
    assert.equal(Date.parse(first.nextRunAt) - Date.now(), 120 * 60000);
    const discoveries = store.getDiscoveries();
    const second = await run();
    assert.equal(calls.length, 16); assert.deepEqual(counts(), { snapshots: 16, rows: 48 });
    assert.deepEqual(store.getDiscoveries(), discoveries);
    assert.deepEqual(second.boards.map(value => value.fetchedAt), first.boards.map(value => value.fetchedAt));
    assert.equal(store.listBackups().filter(value => value.kind === 'auto').length, 1);
  });
});

test('upstream failures preserve previous snapshots and discovery data, marking cached boards stale', async t => {
  await scenario(t, async () => {
    let failed = false, calls = 0;
    globalThis.fetch = async () => { calls++; if (failed) throw new Error('模拟网络中断'); return new Response(html); };
    const success = await run();
    const discoveries = store.getDiscoveries(), history = store.getRepoTimeline('anthropics/financial-services');
    failed = true; advance(31 * 60000);
    const stale = await run();
    assert.equal(calls, 32); assert.ok(stale.boards.every(value => value.stale && /网络中断/.test(value.error)));
    assert.deepEqual(stale.boards.map(value => value.fetchedAt), success.boards.map(value => value.fetchedAt));
    assert.equal(stale.lastSuccessAt, success.lastSuccessAt);
    assert.deepEqual(store.getDiscoveries(), discoveries); assert.deepEqual(store.getRepoTimeline('anthropics/financial-services'), history);
    assert.deepEqual(counts(), { snapshots: 16, rows: 48 });
    await run(); assert.equal(calls, 32, 'repeated failed boards respect cached failure backoff');
    setCollector({ periods: ['daily'], languages: ['c'] });
    const noCache = await run();
    assert.equal(noCache.boards.length, 1); assert.equal(noCache.boards[0].count, null); assert.equal(noCache.boards[0].stale, true);
    assert.deepEqual(store.getDiscoveries(), discoveries); assert.deepEqual(counts(), { snapshots: 16, rows: 48 });
  });
});

test('saved narrow collection settings survive reload and are not expanded by broader defaults', async t => {
  await scenario(t, async () => {
    const saved = setCollector({ periods: ['monthly'], languages: ['rust'], intervalMinutes: 240, watchReleases: false });
    const reloaded = await import('./server/settings.mjs?reload=custom-settings');
    assert.deepEqual(reloaded.getSettings(), saved);
    const calls = [];
    globalThis.fetch = async url => { calls.push(url); return new Response(html); };
    const result = await run();
    assert.equal(calls.length, 1);
    assert.deepEqual(result.boards.map(({period, language}) => ({period, language})), [{period: 'monthly', language: 'rust'}]);
    assert.equal(Date.parse(result.nextRunAt) - Date.now(), 240 * 60000);
    assert.deepEqual(settings.getSettings(), saved);
  });
});

test('concurrent run requests coalesce, settings persistence cannot collide, and restart restores completed state', async t => {
  await scenario(t, async () => {
    setCollector({ periods: ['daily'], languages: ['python'], watchReleases: false });
    let release, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    globalThis.fetch = async () => { calls++; await gate; return new Response(html); };
    const first = collector.runCollection();
    assert.equal(first.started, true); assert.equal(first.status.running, true);
    assert.equal(collector.runCollection().started, false);
    assert.equal(collector.runCollection({ favoritesOnly: true }).started, false);
    const changing = Promise.all([collector.collectionSettingsChanged(), collector.collectionSettingsChanged()]);
    await waitUntil(() => calls === 1); release();
    await changing;
    const complete = await finished(first.status.lastStartedAt);
    assert.equal(calls, 1); assert.equal(complete.running, false); assert.equal(complete.error, null);
    assert.equal((await stat(resolve(dataDir, 'collection-status.json'))).mode & 0o777, 0o600);
    await assert.rejects(stat(resolve(dataDir, 'collection-status.json.tmp')), { code: 'ENOENT' });
    const restarted = await import('./server/collector.mjs?restart=completed-test');
    assert.deepEqual(restarted.collectionStatus(), complete);
    await writeFile(resolve(dataDir, 'collection-status.json'), JSON.stringify({ ...complete, running: true }));
    const interrupted = await import('./server/collector.mjs?restart=interrupted-test');
    assert.equal(interrupted.collectionStatus().running, false);
    assert.deepEqual(interrupted.collectionStatus().boards, complete.boards);
  });
});

test('favorite checks rotate in batches of ten and first observations establish a baseline before reporting changes', async t => {
  await scenario(t, async () => {
    store.importLibrary({ favorites: Array.from({ length: 12 }, (_, i) => favorite(`demo/p${i}`)) });
    const order = store.getLibrary().favorites.map(value => value.repo.id);
    let calls = 0, version = 1;
    globalThis.fetch = async url => {
      calls++;
      const parsed = new URL(url), id = parsed.pathname.split('/').slice(2, 4).join('/');
      assert.equal(parsed.origin, 'https://api.github.com');
      const headers = { 'x-ratelimit-remaining': String(1000 - calls), 'x-ratelimit-limit': '5000' };
      if (parsed.pathname.endsWith('/releases')) return json([{ id: version, tag_name: `v${version}`, draft: false, prerelease: false, html_url: `https://github.com/${id}/releases/tag/v${version}`, published_at: new Date().toISOString() }], headers);
      return json({ full_name: id, html_url: `https://github.com/${id}`, archived: version > 1 }, headers);
    };
    const first = await run({ favoritesOnly: true });
    assert.equal(calls, 20); assert.equal(first.favoriteUpdates.length, 10); assert.equal(first.favoriteCursor, 10);
    assert.deepEqual(first.favoriteUpdates.map(value => value.id), order.slice(0, 10));
    assert.ok(first.favoriteUpdates.every(value => value.baseline && !value.newRelease && !value.archiveChanged));
    const second = await run({ favoritesOnly: true });
    assert.equal(calls, 24); assert.equal(second.favoriteUpdates.length, 12);
    assert.ok(second.favoriteUpdates.every(value => value.baseline && !value.newRelease));
    await run({ favoritesOnly: true }); assert.equal(calls, 24, 'recently checked favorites do not consume API quota');
    version = 2; advance(6 * 60 * 60000 + 1);
    const changed = await run({ favoritesOnly: true });
    assert.equal(calls, 44);
    assert.equal(changed.favoriteUpdates.filter(value => value.newRelease && value.archiveChanged && !value.baseline).length, 10);
    assert.ok(changed.favoriteUpdates.filter(value => value.newRelease).every(value => value.latest.tagName === 'v2'));
    store.mutateLibrary({ type: 'favorite', id: order[0], value: false });
    const removed = await run({ favoritesOnly: true });
    assert.ok(removed.favoriteUpdates.every(value => value.id !== order[0]));
  });
});

test('insufficient API quota stops favorite checks before requests and again between repositories', async t => {
  await scenario(t, async () => {
    store.importLibrary({ favorites: [favorite('demo/one'), favorite('demo/two'), favorite('demo/three')] });
    let calls = 0;
    globalThis.fetch = async url => {
      calls++;
      const parsed = new URL(url);
      if (parsed.pathname === '/rate_limit') return json({ resources: { core: { remaining: 3, limit: 60, reset: Math.floor(Date.now() / 1000) + 3600 } } });
      const id = parsed.pathname.split('/').slice(2, 4).join('/');
      if (parsed.pathname.endsWith('/releases')) return json([], { 'x-ratelimit-remaining': '3' });
      return json({ full_name: id, archived: false }, { 'x-ratelimit-remaining': '4' });
    };
    await github.getConnectionStatus({ refresh: true });
    const limited = await run({ favoritesOnly: true });
    assert.equal(calls, 1); assert.deepEqual(limited.favoriteUpdates, []); assert.match(limited.watchWarning, /额度不足/);
    await github.clearToken();
    const partial = await run({ favoritesOnly: true });
    assert.equal(calls, 3); assert.equal(partial.favoriteUpdates.length, 1); assert.match(partial.watchWarning, /额度不足/);
    assert.equal(partial.favoriteUpdates[0].latest, null); assert.equal(partial.favoriteUpdates[0].baseline, true); assert.equal(partial.favoriteUpdates[0].newRelease, false);
    await run({ favoritesOnly: true }); assert.equal(calls, 3);
  });
});

test('paused board collection keeps local history, and favorite watching can be disabled independently', async t => {
  await scenario(t, async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(html); };
    await run(); const before = store.getDiscoveries();
    setCollector({ enabled: false, watchReleases: false });
    await collector.collectionSettingsChanged();
    const paused = await run();
    assert.equal(calls, 16); assert.equal(paused.error, '采集已暂停'); assert.equal(paused.nextRunAt, null);
    assert.deepEqual(store.getDiscoveries(), before);
    store.importLibrary({ favorites: [favorite('demo/no-fetch')] });
    const favoritesDisabled = await run({ favoritesOnly: true });
    assert.equal(calls, 16); assert.deepEqual(favoritesDisabled.favoriteUpdates, []);
    assert.equal(favoritesDisabled.nextRunAt, null);
  });
});
