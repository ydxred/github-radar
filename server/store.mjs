import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, readdirSync, lstatSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const PERIODS = ['daily', 'weekly', 'monthly'];
const LIMIT = 3000;
const FLAGS_LIMIT = 20000;
const BACKUP_PATTERN = /^radar-(auto|manual|before-restore)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[a-f0-9]{8}\.sqlite$/;
const TABLES = ['meta', 'favorites', 'notes', 'history', 'flags', 'migrations', 'discoveries', 'snapshots', 'snapshot_repos'];
const fail = message => Object.assign(new Error(message), { status: 400 });
const own = (object, key) => Object.hasOwn(object, key);
function object(value, label = '数据') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail(`${label}格式无效`);
  if (Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw fail(`${label}含无效字段`);
  return value;
}
function repoId(value) {
  if (typeof value !== 'string' || value.length >= 220 || !/^[\w.-]+\/[\w.-]+$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw fail('项目名称无效');
  return value;
}
function date(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw fail('日期格式无效');
  return new Date(value).toISOString();
}
function text(value, length, label) {
  if (typeof value !== 'string' || value.length > length) throw fail(`${label}过长或格式无效`);
  return value;
}
function number(value, label) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw fail(`${label}必须是非负整数`);
  return value;
}
function repo(value) {
  object(value, '项目');
  const id = repoId(value.id);
  const [owner, name] = id.split('/');
  return { id, owner, name, url: `https://github.com/${id}`, description: text(value.description ?? '', 10000, '简介'), language: text(value.language ?? '未标注', 80, '语言'), languageColor: /^#[a-f\d]{3,8}$/i.test(value.languageColor || '') ? value.languageColor : '#94a3b8', stars: number(value.stars, 'Star'), forks: number(value.forks, 'Fork'), periodStars: number(value.periodStars, '新增 Star'), rank: number(value.rank, '排名') ?? 0 };
}
function entry(value, now) {
  object(value, '记录');
  if (!PERIODS.includes(value.period)) throw fail('周期无效');
  return { repo: repo(value.repo), period: value.period, fetchedAt: date(value.fetchedAt), savedAt: date(value.savedAt, now), viewedAt: date(value.viewedAt, now) };
}
function preferences(value) {
  object(value, '偏好');
  const output = {};
  const enums = { theme: ['light', 'dark'], layout: ['grid', 'list'], period: PERIODS, sort: ['rank', 'stars', 'growth', 'recent', 'periodStars'], topic: ['all', 'ai', 'dev', 'data', 'learn', 'other'] };
  for (const [key, val] of Object.entries(value)) {
    if (own(enums, key)) { if (!enums[key].includes(val)) throw fail(`${key} 偏好无效`); output[key] = val; }
    else if (key === 'language') { if (typeof val !== 'string' || val.length > 60 || !/^[\w+#.-]*$/.test(val)) throw fail('语言偏好无效'); output[key] = val; }
    else if (key === 'newOnly') { if (typeof val !== 'boolean') throw fail('新发现偏好无效'); output[key] = val; }
    else throw fail(`不支持的偏好：${key}`);
  }
  return output;
}
function normalizeImport(payload, now) {
  object(payload, '备份');
  if (own(payload, 'app') && (payload.app !== 'github-top' || ![1, 2].includes(payload.version))) throw fail('请选择开源雷达导出的备份');
  const items = (value, max, label) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) throw fail(`${label}最多支持 ${max} 条`); return value; };
  const favorites = items(payload.favorites, LIMIT, '收藏').map(value => entry(value, now));
  const history = items(payload.history, 100, '浏览记录').map(value => entry(value, now));
  const notes = {};
  if (payload.notes !== undefined) {
    object(payload.notes, '笔记');
    if (Object.keys(payload.notes).length > LIMIT) throw fail(`最多支持 ${LIMIT} 条笔记`);
    for (const [id, value] of Object.entries(payload.notes)) notes[repoId(id)] = text(value, 3000, '笔记');
  }
  for (const value of payload.favorites || []) if (own(value, 'note')) {
    const importedNote = text(value.note, 3000, '笔记');
    if (!notes[value.repo.id]) notes[value.repo.id] = importedNote;
  }
  return { favorites, history, notes, preferences: payload.preferences === undefined ? {} : preferences(payload.preferences), readIds: items(payload.readIds, FLAGS_LIMIT, '已读').map(repoId), hiddenIds: items(payload.hiddenIds, FLAGS_LIMIT, '忽略').map(repoId), lastVisitAt: date(payload.lastVisitAt) };
}

/** A separate factory keeps tests and portable data directories independent. */
export function createStore({ directory = process.env.GITHUB_TOP_DATA || 'data', now = () => new Date().toISOString() } = {}) {
  const dataDirectory = resolve(directory);
  const backupDirectory = join(dataDirectory, 'backups');
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700); chmodSync(backupDirectory, 0o700);
  const filename = join(dataDirectory, 'radar.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (currentVersion > 1) { db.close(); throw new Error('本机数据库版本较新，请更新开源雷达后再打开'); }
  if (currentVersion < 1) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta VALUES ('revision','0'), ('preferences','{}'), ('lastVisitAt','null');
    CREATE TABLE favorites (id TEXT PRIMARY KEY COLLATE NOCASE, entry TEXT NOT NULL, saved_at TEXT NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY COLLATE NOCASE, text TEXT NOT NULL);
    CREATE TABLE history (id TEXT PRIMARY KEY COLLATE NOCASE, entry TEXT NOT NULL, viewed_at TEXT NOT NULL);
    CREATE TABLE flags (id TEXT PRIMARY KEY COLLATE NOCASE, is_read INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE migrations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE discoveries (id TEXT PRIMARY KEY COLLATE NOCASE, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, entry TEXT NOT NULL);
    CREATE TABLE snapshots (id INTEGER PRIMARY KEY, period TEXT NOT NULL, language TEXT NOT NULL, fetched_at TEXT NOT NULL, source TEXT NOT NULL, UNIQUE(period,language,fetched_at));
    CREATE TABLE snapshot_repos (snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE, repo_id TEXT NOT NULL COLLATE NOCASE, repo TEXT NOT NULL, PRIMARY KEY(snapshot_id,repo_id));
    CREATE INDEX snapshot_repo_time ON snapshot_repos(repo_id,snapshot_id);
    PRAGMA user_version=1;
    COMMIT;`);
  function secureFiles() { for (const suffix of ['', '-wal', '-shm']) if (existsSync(filename + suffix)) chmodSync(filename + suffix, 0o600); }
  secureFiles();
  const readMeta = key => JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value ?? 'null');
  const writeMeta = (key, value) => db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  const clock = () => date(now());
  function transaction(fn, revision = false) {
    db.exec('BEGIN IMMEDIATE');
    let result;
    try { result = fn(); if (revision) writeMeta('revision', (readMeta('revision') || 0) + 1); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    secureFiles(); return result;
  }
  function getLibrary() {
    return { revision: readMeta('revision') || 0, favorites: db.prepare('SELECT entry FROM favorites ORDER BY saved_at DESC, rowid DESC').all().map(row => JSON.parse(row.entry)), notes: Object.fromEntries(db.prepare('SELECT id,text FROM notes').all().map(row => [row.id, row.text])), history: db.prepare('SELECT entry FROM history ORDER BY viewed_at DESC, rowid DESC LIMIT 100').all().map(row => JSON.parse(row.entry)), preferences: readMeta('preferences') || {}, readIds: db.prepare('SELECT id FROM flags WHERE is_read=1').all().map(row => row.id), hiddenIds: db.prepare('SELECT id FROM flags WHERE is_hidden=1').all().map(row => row.id), lastVisitAt: readMeta('lastVisitAt') };
  }
  function boundedCount(table, maximum) { if (db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n > maximum) throw fail(`记录超过上限 ${maximum}，这次更改未保存`); }
  function flag(id, column, value) {
    repoId(id);
    db.prepare(`INSERT INTO flags(id,${column}) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET ${column}=excluded.${column}`).run(id, value ? 1 : 0);
    db.prepare('DELETE FROM flags WHERE is_read=0 AND is_hidden=0').run();
    boundedCount('flags', FLAGS_LIMIT);
  }
  function saveHistory(value) {
    db.prepare('INSERT INTO history VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET entry=excluded.entry,viewed_at=excluded.viewed_at').run(value.repo.id, JSON.stringify(value), value.viewedAt);
    db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY viewed_at DESC,rowid DESC LIMIT 100)').run();
  }
  function mutateLibrary(action) {
    object(action, '操作');
    const type = action.type;
    transaction(() => {
      if (['favorite', 'favorite:toggle', 'favorite:set'].includes(type)) {
        const id = repoId(action.repo?.id || action.id);
        const found = db.prepare('SELECT id,saved_at FROM favorites WHERE id=?').get(id);
        const value = action.value ?? action.saved ?? !found;
        if (typeof value !== 'boolean') throw fail('收藏状态无效');
        if (!value) db.prepare('DELETE FROM favorites WHERE id=?').run(id);
        else {
          const value = entry({ ...action, savedAt: found?.saved_at || clock() }, clock());
          db.prepare('INSERT INTO favorites VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET entry=excluded.entry').run(id, JSON.stringify(value), value.savedAt);
          boundedCount('favorites', LIMIT);
        }
      } else if (['note', 'note:set'].includes(type)) {
        const id = repoId(action.id); const value = text(action.text ?? action.note, 3000, '笔记');
        if (!value) db.prepare('DELETE FROM notes WHERE id=?').run(id);
        else { db.prepare('INSERT INTO notes VALUES (?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text').run(id, value); boundedCount('notes', LIMIT); }
      } else if (['history', 'history:view'].includes(type)) {
        const value = entry({ ...action, viewedAt: clock() }, clock()); saveHistory(value); flag(value.repo.id, 'is_read', true);
      } else if (['preferences', 'preferences:merge'].includes(type)) {
        writeMeta('preferences', { ...readMeta('preferences'), ...preferences(action.preferences ?? action.patch) });
      } else if (['read', 'unread', 'hide', 'unhide'].includes(type)) flag(action.id, ['read', 'unread'].includes(type) ? 'is_read' : 'is_hidden', ['read', 'hide'].includes(type));
      else if (type === 'markVisit') writeMeta('lastVisitAt', date(action.at, clock()));
      else throw fail('不支持的保存操作');
    }, true);
    autoBackup(); return getLibrary();
  }
  function importLibrary(payload, migrationId) {
    if (migrationId !== undefined) text(migrationId, 120, '迁移标识');
    const clean = normalizeImport(payload, clock());
    transaction(() => {
      if (migrationId !== undefined && db.prepare('SELECT id FROM migrations WHERE id=?').get(migrationId)) return;
      for (const value of clean.favorites) db.prepare('INSERT OR IGNORE INTO favorites VALUES (?,?,?)').run(value.repo.id, JSON.stringify(value), value.savedAt);
      for (const [id, note] of Object.entries(clean.notes)) if (note) db.prepare('INSERT OR IGNORE INTO notes VALUES (?,?)').run(id, note);
      for (const value of clean.history) {
        const existing = db.prepare('SELECT viewed_at FROM history WHERE id=?').get(value.repo.id);
        if (!existing || value.viewedAt > existing.viewed_at) saveHistory(value);
      }
      writeMeta('preferences', { ...clean.preferences, ...readMeta('preferences') });
      for (const id of clean.readIds) flag(id, 'is_read', true);
      for (const id of clean.hiddenIds) flag(id, 'is_hidden', true);
      if (!readMeta('lastVisitAt') && clean.lastVisitAt) writeMeta('lastVisitAt', clean.lastVisitAt);
      boundedCount('favorites', LIMIT); boundedCount('notes', LIMIT);
      if (migrationId !== undefined) db.prepare('INSERT INTO migrations VALUES (?,?)').run(migrationId, clock());
      writeMeta('revision', (readMeta('revision') || 0) + 1);
    });
    autoBackup(); return getLibrary();
  }
  function exportLibrary() { const library = getLibrary(); return { app: 'github-top', version: 2, exportedAt: clock(), ...library, favorites: library.favorites.map(item => ({ ...item, note: library.notes[item.repo.id] || '' })) }; }
  function recordSnapshot(result) {
    object(result, '榜单');
    if (!PERIODS.includes(result.period) || typeof result.language !== 'string' || !/^[\w+#.-]{0,60}$/.test(result.language) || !Array.isArray(result.data) || result.data.length > 100) throw fail('榜单快照格式无效');
    const fetchedAt = date(result.fetchedAt); if (!fetchedAt) throw fail('快照缺少真实采集时间');
    const source = result.source || `https://github.com/trending?since=${result.period}`;
    if (typeof source !== 'string' || !/^https:\/\/github\.com\/trending(?:[/?]|$)/.test(source) || source.length > 500) throw fail('榜单来源无效');
    const rows = result.data.map(repo);
    // Local discovery time is when this installation first records a project.
    // Cached data may be older; its real fetchedAt remains separate in the timeline.
    const observedAt = clock();
    let added = false;
    transaction(() => {
      const change = db.prepare('INSERT OR IGNORE INTO snapshots(period,language,fetched_at,source) VALUES (?,?,?,?)').run(result.period, result.language, fetchedAt, source);
      if (!change.changes) return;
      added = true;
      for (const item of rows) {
        db.prepare('INSERT INTO snapshot_repos VALUES (?,?,?)').run(change.lastInsertRowid, item.id, JSON.stringify(item));
        const value = JSON.stringify({ repo: item, period: result.period, language: result.language, fetchedAt, source });
        db.prepare(`INSERT INTO discoveries VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=max(last_seen_at,excluded.last_seen_at),entry=CASE WHEN excluded.last_seen_at>=last_seen_at THEN excluded.entry ELSE entry END`).run(item.id, observedAt, fetchedAt, value);
      }
    });
    autoBackup(); return { recorded: added, count: rows.length, fetchedAt };
  }
  function getDiscoveries(since) {
    const timestamp = date(since);
    return db.prepare(`SELECT * FROM discoveries ${timestamp ? 'WHERE first_seen_at>?' : ''} ORDER BY first_seen_at DESC,id LIMIT 20000`).all(...(timestamp ? [timestamp] : [])).map(row => ({ ...JSON.parse(row.entry), firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at }));
  }
  function getRepoTimeline(id, period) {
    repoId(id); if (period !== undefined && !PERIODS.includes(period)) throw fail('周期无效');
    return db.prepare(`SELECT s.*,sr.repo FROM snapshots s JOIN snapshot_repos sr ON s.id=sr.snapshot_id WHERE sr.repo_id=? ${period ? 'AND s.period=?' : ''} ORDER BY s.fetched_at ASC,s.id ASC LIMIT 20000`).all(...(period ? [id, period] : [id])).map(row => { const value = JSON.parse(row.repo); return { repoId: value.id, period: row.period, language: row.language, fetchedAt: row.fetched_at, source: row.source, stars: value.stars, forks: value.forks, periodStars: value.periodStars, rank: value.rank }; });
  }
  function listBackups() {
    return readdirSync(backupDirectory).filter(name => BACKUP_PATTERN.test(name)).flatMap(name => {
      const stat = lstatSync(join(backupDirectory, name));
      if (!stat.isFile() || stat.isSymbolicLink()) return [];
      const [, kind, timestamp] = name.match(BACKUP_PATTERN);
      return [{ name, kind, createdAt: timestamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'), size: stat.size }];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }
  function createBackup(options = {}) {
    object(options, '备份选项');
    const kind = options.kind || 'manual';
    if (!['auto', 'manual', 'before-restore'].includes(kind)) throw fail('备份类型无效');
    const timestamp = clock();
    if (kind === 'auto') {
      const existing = listBackups().find(item => item.kind === kind && item.createdAt.slice(0, 10) === timestamp.slice(0, 10));
      if (existing) return existing;
    }
    const name = `radar-${kind}-${timestamp.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.sqlite`;
    const target = join(backupDirectory, name); const temporary = target + '.tmp';
    try {
      db.prepare('VACUUM INTO ?').run(temporary);
      chmodSync(temporary, 0o600);
      const check = new DatabaseSync(temporary, { readOnly: true });
      try { if (Object.values(check.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw new Error('备份完整性验证失败'); } finally { check.close(); }
      renameSync(temporary, target);
      for (const obsolete of listBackups().filter(item => item.kind === kind).slice(14)) unlinkSync(join(backupDirectory, obsolete.name));
      return listBackups().find(item => item.name === name);
    } catch (error) { if (existsSync(temporary)) unlinkSync(temporary); throw error; }
  }
  function autoBackup() {
    // A backup failure must not make a committed save appear to have failed.
    try { createBackup({ kind: 'auto' }); } catch (error) { console.warn(`开源雷达自动备份失败：${error.message}`); }
  }
  function restoreBackup(name) {
    if (typeof name !== 'string' || !BACKUP_PATTERN.test(name)) throw fail('备份文件名无效');
    const path = join(backupDirectory, name);
    if (!existsSync(path)) throw fail('备份不存在');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100 * 1024 * 1024) throw fail('备份文件无效或过大');
    const source = new DatabaseSync(path, { readOnly: true });
    let contents;
    try {
      if (source.prepare('PRAGMA user_version').get().user_version !== 1 || Object.values(source.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw fail('备份版本或完整性校验失败');
      const schema = source.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
      if (schema.some(row => ['trigger', 'view'].includes(row.type)) || schema.filter(row => row.type === 'table').map(row => row.name).sort().join() !== [...TABLES].sort().join()) throw fail('备份数据库结构无效');
      contents = {};
      for (const table of TABLES) {
        const expected = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name).join();
        const actual = source.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name).join();
        if (actual !== expected) throw fail('备份字段结构不匹配');
        const count = source.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
        const max = ['favorites', 'notes'].includes(table) ? LIMIT : table === 'history' ? 100 : table === 'meta' ? 10 : 200000;
        if (count > max) throw fail('备份记录数异常');
        contents[table] = source.prepare(`SELECT * FROM ${table}`).all();
      }
      const meta = Object.fromEntries(contents.meta.map(row => [row.key, JSON.parse(row.value)]));
      normalizeImport({ favorites: contents.favorites.map(row => JSON.parse(row.entry)), notes: Object.fromEntries(contents.notes.map(row => [row.id, row.text])), history: contents.history.map(row => JSON.parse(row.entry)), preferences: meta.preferences, lastVisitAt: meta.lastVisitAt, readIds: contents.flags.filter(row => row.is_read).map(row => row.id), hiddenIds: contents.flags.filter(row => row.is_hidden).map(row => row.id) }, clock());
      if (!Number.isSafeInteger(meta.revision) || meta.revision < 0 || Object.keys(meta).some(key => !['revision', 'preferences', 'lastVisitAt'].includes(key))) throw fail('备份元数据无效');
      for (const row of contents.favorites) { if (repoId(row.id).toLowerCase() !== JSON.parse(row.entry).repo.id.toLowerCase()) throw fail('收藏记录不一致'); date(row.saved_at); }
      for (const row of contents.history) { if (repoId(row.id).toLowerCase() !== JSON.parse(row.entry).repo.id.toLowerCase()) throw fail('浏览记录不一致'); date(row.viewed_at); }
      for (const row of contents.flags) if (![0, 1].includes(row.is_read) || ![0, 1].includes(row.is_hidden)) throw fail('备份阅读状态无效');
      for (const row of contents.migrations) { text(row.id, 120, '迁移标识'); date(row.created_at); }
      for (const row of contents.discoveries) { repoId(row.id); const value = JSON.parse(row.entry); repo(value.repo); if (row.id.toLowerCase() !== value.repo.id.toLowerCase()) throw fail('发现记录不一致'); if (!PERIODS.includes(value.period)) throw fail('快照周期无效'); date(value.fetchedAt); date(row.first_seen_at); date(row.last_seen_at); }
      for (const row of contents.snapshots) if (!PERIODS.includes(row.period) || !date(row.fetched_at) || typeof row.language !== 'string' || row.language.length > 60 || !/^https:\/\/github\.com\/trending(?:[/?]|$)/.test(row.source)) throw fail('快照数据无效');
      for (const row of contents.snapshot_repos) { repoId(row.repo_id); const value = repo(JSON.parse(row.repo)); if (row.repo_id.toLowerCase() !== value.id.toLowerCase()) throw fail('快照项目不一致'); }
      if (source.prepare('PRAGMA foreign_key_check').all().length) throw fail('备份关系不完整');
    } catch (error) { throw error.status ? error : fail('备份验证失败，当前数据未修改'); } finally { source.close(); }
    const backup = createBackup({ kind: 'before-restore' });
    const revision = readMeta('revision');
    transaction(() => {
      for (const table of [...TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
      for (const table of TABLES) for (const row of contents[table]) {
        const columns = Object.keys(row);
        // Identifiers come from the validated fixed database schema, never a request.
        const expected = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
        if (columns.join() !== expected.join()) throw fail('备份字段结构不匹配');
        db.prepare(`INSERT INTO ${table} VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(key => row[key]));
      }
      writeMeta('revision', revision + 1);
    });
    return { library: getLibrary(), backup };
  }
  return { getLibrary, mutateLibrary, importLibrary, exportLibrary, recordSnapshot, getDiscoveries, getRepoTimeline, listBackups, createBackup, restoreBackup, close: () => db.close() };
}

let defaultStore;
const current = () => defaultStore ||= createStore();
export const getLibrary = (...args) => current().getLibrary(...args);
export const mutateLibrary = (...args) => current().mutateLibrary(...args);
export const importLibrary = (...args) => current().importLibrary(...args);
export const exportLibrary = (...args) => current().exportLibrary(...args);
export const recordSnapshot = (...args) => current().recordSnapshot(...args);
export const getDiscoveries = (...args) => current().getDiscoveries(...args);
export const getRepoTimeline = (...args) => current().getRepoTimeline(...args);
export const listBackups = (...args) => current().listBackups(...args);
export const createBackup = (...args) => current().createBackup(...args);
export const restoreBackup = (...args) => current().restoreBackup(...args);
