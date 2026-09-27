import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';

const makeRepo = (id = 'demo/radar', stars = 123) => ({ id, description: 'A useful tool', language: 'JavaScript', languageColor: '#f1e05a', stars, forks: 5, periodStars: 20, rank: 1 });
const makeEntry = (id = 'demo/radar', period = 'weekly', at = '2026-09-27T08:00:00.000Z') => ({ repo: makeRepo(id), period, fetchedAt: at, savedAt: at, viewedAt: at });
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'radar-store-'));
  let timestamp = '2026-09-27T08:00:00.000Z';
  const store = createStore({ directory, now: () => timestamp });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, directory, setTime: value => timestamp = value };
}

test('local library survives connections and independent browser mutations preserve each other', t => {
  const { store, directory } = fixture(t);
  const other = createStore({ directory });
  t.after(() => other.close());
  const initial = store.getLibrary();
  assert.deepEqual(initial, { revision: 0, favorites: [], notes: {}, history: [], preferences: {}, readIds: [], hiddenIds: [], lastVisitAt: null });
  store.mutateLibrary({ type: 'favorite', ...makeEntry(), value: true });
  other.mutateLibrary({ type: 'note', id: 'demo/radar', text: 'Keep the reason for trying it.' });
  store.mutateLibrary({ type: 'preferences', preferences: { theme: 'dark' } });
  other.mutateLibrary({ type: 'preferences', preferences: { layout: 'list' } });
  store.mutateLibrary({ type: 'hide', id: 'demo/noise' });
  assert.equal(other.getLibrary().favorites.length, 1);
  assert.equal(store.getLibrary().notes['demo/radar'], 'Keep the reason for trying it.');
  assert.deepEqual(store.getLibrary().preferences, { theme: 'dark', layout: 'list' });
  assert.equal(store.getLibrary().revision, 5);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'radar.sqlite')).mode & 0o777, 0o600);
});

test('favorite removal preserves notes; history records read state, original period, and only latest 100', t => {
  const { store, setTime } = fixture(t);
  store.mutateLibrary({ type: 'favorite', ...makeEntry(), value: true });
  store.mutateLibrary({ type: 'note', id: 'demo/radar', text: 'Private note' });
  store.mutateLibrary({ type: 'favorite', id: 'demo/radar', value: false });
  assert.equal(store.getLibrary().favorites.length, 0);
  assert.equal(store.getLibrary().notes['demo/radar'], 'Private note');
  for (let n = 0; n < 102; n++) {
    setTime(new Date(Date.parse('2026-09-27T08:00:00Z') + n * 1000).toISOString());
    store.mutateLibrary({ type: 'history', ...makeEntry(`demo/project-${n}`, 'monthly') });
  }
  const result = store.getLibrary();
  assert.equal(result.history.length, 100);
  assert.equal(result.history[0].repo.id, 'demo/project-101');
  assert.equal(result.history[0].period, 'monthly');
  assert.equal(result.history.some(item => item.repo.id === 'demo/project-0'), false);
  assert.ok(result.readIds.includes('demo/project-101'));
  store.mutateLibrary({ type: 'unread', id: 'demo/project-101' });
  assert.ok(!store.getLibrary().readIds.includes('demo/project-101'));
});

test('legacy and portable imports merge without replacing existing notes and migrate exactly once', t => {
  const { store } = fixture(t);
  store.mutateLibrary({ type: 'note', id: 'demo/radar', text: 'Existing note wins' });
  store.mutateLibrary({ type: 'preferences', preferences: { theme: 'dark' } });
  const result = store.importLibrary({ favorites: [makeEntry()], notes: { 'demo/radar': 'Old browser note' }, history: [makeEntry()], preferences: { theme: 'light', layout: 'list' } }, 'browser-1');
  assert.equal(result.favorites.length, 1);
  assert.deepEqual(result.preferences, { theme: 'dark', layout: 'list' });
  assert.equal(result.notes['demo/radar'], 'Existing note wins');
  store.mutateLibrary({ type: 'favorite', id: 'demo/radar', value: false });
  const before = store.getLibrary();
  store.importLibrary({ favorites: [makeEntry()] }, 'browser-1');
  assert.deepEqual(store.getLibrary(), before);
  store.importLibrary({ app: 'github-top', version: 1, favorites: [{ ...makeEntry('demo/imported'), note: 'From the portable file' }] });
  const exported = store.exportLibrary();
  assert.equal(exported.version, 2);
  assert.equal(exported.favorites[0].note, 'From the portable file');
  assert.equal(exported.notes['demo/radar'], 'Existing note wins');
});

test('invalid imports and over-limit transactions never partially modify the library', t => {
  const { store } = fixture(t);
  store.mutateLibrary({ type: 'note', id: 'demo/original', text: 'Original' });
  const before = store.getLibrary();
  assert.throws(() => store.importLibrary({ favorites: [makeEntry('demo/new'), { repo: { id: '../bad' }, period: 'weekly' }], notes: { 'demo/new': 'new' } }), /项目名称无效/);
  assert.deepEqual(store.getLibrary(), before);
  assert.throws(() => store.mutateLibrary({ type: 'note', id: 'demo/original', text: 'x'.repeat(3001) }), /笔记/);
  assert.throws(() => store.mutateLibrary({ type: 'preferences', preferences: JSON.parse('{"__proto__":{"polluted":true}}') }), /无效字段/);
  assert.throws(() => store.mutateLibrary({ type: 'preferences', preferences: { token: 'secret' } }), /不支持的偏好/);
  assert.deepEqual(store.getLibrary(), before);
  store.importLibrary({ favorites: Array.from({ length: 3000 }, (_, i) => makeEntry(`demo/p${i}`)) });
  const full = store.getLibrary();
  assert.throws(() => store.importLibrary({ favorites: [makeEntry('demo/overlimit')], notes: { 'demo/new-note': 'Must roll back' } }), /记录超过上限/);
  assert.deepEqual(store.getLibrary(), full);
  assert.equal({}.polluted, undefined);
});

test('snapshot deduplication retains real period boundaries and never replaces newer metadata with older cache', t => {
  const { store } = fixture(t);
  const result = { data: [makeRepo()], period: 'weekly', language: '', fetchedAt: '2026-09-26T09:00:00Z', source: 'https://github.com/trending?since=weekly' };
  assert.equal(store.recordSnapshot(result).recorded, true);
  assert.equal(store.recordSnapshot({ ...result, cached: true }).recorded, false);
  store.recordSnapshot({ ...result, fetchedAt: '2026-09-27T09:00:00Z', data: [makeRepo('demo/radar', 200)] });
  store.recordSnapshot({ ...result, fetchedAt: '2026-09-25T09:00:00Z', data: [makeRepo('demo/radar', 100)] });
  store.recordSnapshot({ ...result, period: 'monthly', source: 'https://github.com/trending?since=monthly', fetchedAt: '2026-09-27T09:00:00Z', data: [makeRepo('demo/radar', 200)] });
  const discovery = store.getDiscoveries()[0];
  assert.equal(discovery.firstSeenAt, '2026-09-27T08:00:00.000Z');
  assert.equal(discovery.repo.stars, 200);
  assert.equal(store.getDiscoveries('2026-09-26T00:00:00Z').length, 1);
  assert.equal(store.getDiscoveries('2026-09-27T08:00:00Z').length, 0);
  assert.equal(store.getRepoTimeline('demo/radar').length, 4);
  assert.equal(store.getRepoTimeline('demo/radar', 'weekly').length, 3);
  assert.deepEqual(store.getRepoTimeline('demo/radar', 'weekly').map(row => row.stars), [100, 123, 200]);
  assert.equal(store.getRepoTimeline('demo/radar', 'monthly')[0].period, 'monthly');
});

test('verified backup restores library and snapshot data and keeps a recovery copy of pre-restore state', t => {
  const { store, directory, setTime } = fixture(t);
  store.importLibrary({ favorites: [makeEntry()], notes: { 'demo/radar': 'Keep me' }, hiddenIds: ['demo/hidden'], readIds: ['demo/read'] });
  store.recordSnapshot({ data: [makeRepo()], period: 'weekly', language: '', fetchedAt: '2026-09-27T08:00:00Z' });
  const saved = store.createBackup();
  assert.equal(statSync(join(directory, 'backups', saved.name)).mode & 0o777, 0o600);
  store.mutateLibrary({ type: 'note', id: 'demo/radar', text: 'New note after backup' });
  store.mutateLibrary({ type: 'favorite', id: 'demo/radar', value: false });
  const previousRevision = store.getLibrary().revision;
  setTime('2026-09-27T09:00:00Z');
  const restored = store.restoreBackup(saved.name);
  assert.equal(restored.library.notes['demo/radar'], 'Keep me');
  assert.equal(restored.library.favorites.length, 1);
  assert.equal(restored.library.revision, previousRevision + 1);
  assert.deepEqual(restored.library.hiddenIds, ['demo/hidden']);
  assert.equal(store.getRepoTimeline('demo/radar').length, 1);
  assert.equal(restored.backup.kind, 'before-restore');
  store.restoreBackup(restored.backup.name);
  assert.equal(store.getLibrary().notes['demo/radar'], 'New note after backup');
  assert.equal(store.getLibrary().favorites.length, 0);
});

test('daily backups deduplicate, retain fourteen days, and invalid restore cannot affect current data', t => {
  const { store, directory, setTime } = fixture(t);
  for (let day = 1; day <= 17; day++) {
    setTime(`2026-09-${String(day).padStart(2, '0')}T08:00:00Z`);
    const backup = store.createBackup({ kind: 'auto' });
    assert.equal(store.createBackup({ kind: 'auto' }).name, backup.name);
  }
  const backups = store.listBackups();
  assert.equal(backups.length, 14);
  assert.equal(backups.at(-1).createdAt.slice(0, 10), '2026-09-04');
  store.mutateLibrary({ type: 'note', id: 'demo/keep', text: 'Must remain' });
  const before = store.getLibrary();
  assert.throws(() => store.restoreBackup('../../radar.sqlite'), /文件名无效/);
  const name = 'radar-manual-2026-09-18T08-00-00-000Z-deadbeef.sqlite';
  writeFileSync(join(directory, 'backups', name), 'not a sqlite database');
  assert.throws(() => store.restoreBackup(name));
  assert.deepEqual(store.getLibrary(), before);
});
