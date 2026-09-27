import { load } from 'cheerio';
import { mkdir, readFile, writeFile, rename, chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const LANGUAGES = ['', 'python', 'javascript', 'typescript', 'go', 'rust', 'java', 'c++', 'c', 'c#', 'swift', 'kotlin', 'php', 'ruby', 'shell', 'jupyter-notebook', 'html', 'css'];
export const PERIODS = ['daily', 'weekly', 'monthly'];
const cacheDirectory = resolve(process.env.GITHUB_TOP_DATA || 'data');
const inFlight = new Map();
const cache = new Map();
const failures = new Map();
const TTL = 30 * 60 * 1000;
const tokenPath = resolve(cacheDirectory, '.github-token');
const connectionPath = resolve(cacheDirectory, '.github-connection.json');
let token = '';
let initialized;
let generation = 0;
let connection = { available: null, remaining: null, limit: null, resetAt: null, nextRetryAt: null, checkedAt: null, lastError: null };
let statusRequest;
let persistence = Promise.resolve();
const freshTime = () => new Date(Date.now()).toISOString();
const invalid = message => Object.assign(new Error(message), { status: 400 });
const digest = value => createHash('sha256').update(value).digest('hex');

async function initialize() {
  if (!initialized) initialized = (async () => {
    try { token = (await readFile(tokenPath, 'utf8')).trim(); await chmod(tokenPath, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取本机 GitHub Token 文件'); }
    try {
      const saved = JSON.parse(await readFile(connectionPath, 'utf8'));
      if (saved.configured === Boolean(token)) for (const key of Object.keys(connection)) {
        if (['remaining', 'limit'].includes(key)) connection[key] = Number.isSafeInteger(saved[key]) && saved[key] >= 0 ? saved[key] : null;
        else if (key === 'available') connection[key] = typeof saved[key] === 'boolean' ? saved[key] : null;
        else if (key === 'lastError') connection[key] = null;
        else connection[key] = typeof saved[key] === 'string' && Number.isFinite(Date.parse(saved[key])) ? saved[key] : null;
      }
    } catch {}
  })();
  return initialized;
}
function persistConnection() {
  const value = JSON.stringify({ ...connection, configured: Boolean(token), lastError: null });
  persistence = persistence.catch(() => {}).then(async () => {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(`${connectionPath}.tmp`, value, { mode: 0o600 });
    await rename(`${connectionPath}.tmp`, connectionPath);
  }).catch(() => {});
  return persistence;
}
function expireBackoff() {
  if (connection.nextRetryAt && Date.parse(connection.nextRetryAt) <= Date.now()) {
    connection.nextRetryAt = null;
    if (connection.remaining === 0) connection.remaining = null;
    connection.available = null;
    connection.lastError = null;
  }
}
function recordHeaders(response) {
  const numberHeader = name => { const value = response.headers.get(name); return value !== null && /^\d+$/.test(value) ? Number(value) : null; };
  const remaining = numberHeader('x-ratelimit-remaining'), limit = numberHeader('x-ratelimit-limit'), reset = numberHeader('x-ratelimit-reset');
  if (remaining !== null) connection.remaining = remaining;
  if (limit !== null) connection.limit = limit;
  if (reset !== null && Number.isFinite(new Date(reset * 1000).getTime())) connection.resetAt = new Date(reset * 1000).toISOString();
  connection.checkedAt = freshTime();
  if (remaining === 0 && connection.resetAt && Date.parse(connection.resetAt) > Date.now()) {
    connection.nextRetryAt = connection.resetAt;
    connection.available = false;
  }
}
function backoff(response) {
  const retry = response.headers.get('retry-after');
  const retryMs = /^\d+(?:\.\d+)?$/.test(retry || '') ? Date.now() + Number(retry) * 1000 : Date.parse(retry || '');
  const resetMs = connection.remaining === 0 ? Date.parse(connection.resetAt || '') : NaN;
  connection.nextRetryAt = new Date(Math.max(Date.now() + 60000, Number.isFinite(retryMs) ? retryMs : 0, Number.isFinite(resetMs) ? resetMs : 0)).toISOString();
  connection.available = false;
  connection.lastError = 'GitHub API 额度暂时受限，已暂停请求，稍后自动恢复';
}
async function boundedText(response, maxBytes, truncate = false) {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - length;
      if (value.byteLength > remaining) {
        if (!truncate) throw new Error('GitHub 返回的资料过大，请直接查看项目原页');
        chunks.push(value.subarray(0, remaining));
        await reader.cancel();
        break;
      }
      chunks.push(value); length += value.byteLength;
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
async function boundedJson(response, maxBytes) {
  const text = await boundedText(response, maxBytes);
  try { return JSON.parse(text); }
  catch { throw new Error('GitHub 返回的资料格式暂时无法读取'); }
}
export async function getConnectionStatus({ refresh = false } = {}) {
  await initialize(); expireBackoff();
  if (refresh && !connection.nextRetryAt && (!connection.checkedAt || Date.now() - Date.parse(connection.checkedAt) >= 60000)) {
    if (!statusRequest) statusRequest = (async () => {
      const currentGeneration = generation;
      try {
        const response = await upstream('https://api.github.com/rate_limit');
        const data = await boundedJson(response, 64000);
        const core = data.resources?.core || data.rate;
        if (core && generation === currentGeneration) {
          if (Number.isSafeInteger(core.remaining)) connection.remaining = Math.max(0, core.remaining);
          if (Number.isSafeInteger(core.limit)) connection.limit = Math.max(0, core.limit);
          if (Number.isSafeInteger(core.reset)) connection.resetAt = new Date(core.reset * 1000).toISOString();
          if (connection.remaining === 0 && Date.parse(connection.resetAt) > Date.now()) { connection.nextRetryAt = connection.resetAt; connection.available = false; }
        }
      } catch (error) { if (generation === currentGeneration) { connection.available = false; connection.lastError = error.message; connection.checkedAt = freshTime(); } }
      finally { await persistConnection(); statusRequest = null; }
    })();
    await statusRequest;
  }
  return { configured: Boolean(token), ...connection };
}
function resetConnection() {
  generation++;
  connection = { available: null, remaining: null, limit: null, resetAt: null, nextRetryAt: null, checkedAt: null, lastError: null };
  failures.clear();
}
export async function saveToken(value) {
  await initialize();
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{10,300}$/.test(value.trim())) throw invalid('Token 格式无效，请粘贴完整的 GitHub 个人访问令牌');
  await mkdir(cacheDirectory, { recursive: true });
  const temporary = `${tokenPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, value.trim(), { mode: 0o600, flag: 'wx' });
  await rename(temporary, tokenPath);
  token = value.trim(); resetConnection(); await persistConnection();
  return getConnectionStatus();
}
export async function clearToken() {
  await initialize(); await rm(tokenPath, { force: true });
  token = ''; resetConnection(); await persistConnection();
  return getConnectionStatus();
}
const validRepo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export function isRepo(value) { return typeof value === 'string' && validRepo.test(value) && !value.split('/').some(s => s === '.' || s === '..') && value.length < 220; }
export function number(text) {
  const match = String(text || '').trim().match(/^([\d,]+)(?:\s+stars? (?:today|this week|this month))?$/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}
export function parseTrending(html) {
  const $ = load(html);
  const repos = [];
  $('article.Box-row').each((_, el) => {
    const row = $(el);
    const name = row.find('h2 a').attr('href')?.replace(/^\//, '');
    if (!isRepo(name)) throw new Error('GitHub 榜单项目格式发生变化');
    const [owner, repo] = name.split('/');
    const languageNode = row.find('[itemprop="programmingLanguage"]');
    const color = row.find('.repo-language-color').attr('style')?.match(/background-color:\s*(#[a-f\d]{3,8})/i)?.[1] || '#94a3b8';
    const stars = number(row.find(`a[href="/${name}/stargazers"]`).text());
    const forks = number(row.find(`a[href="/${name}/forks"]`).text());
    const periodStars = number(row.find('span.float-sm-right').text());
    if ([stars, forks, periodStars].some(n => n === null)) throw new Error('GitHub 榜单数字字段暂时无法解析');
    repos.push({
      id: name, owner, name: repo, url: `https://github.com/${name}`, rank: repos.length + 1,
      description: row.find('p').first().text().replace(/\s+/g, ' ').trim(),
      language: languageNode.text().trim() || '未标注', languageColor: color,
      stars, forks, periodStars,
      contributors: row.find('img.avatar').map((__, img) => ({ name: $(img).attr('alt')?.replace(/^@/, '') || '', avatar: $(img).attr('src') || '' })).get().filter(c => c.avatar.startsWith('https://avatars.githubusercontent.com/')).slice(0, 5)
    });
  });
  if (!repos.length && !/There aren’t any trending repositories|There aren't any trending repositories|No trending repositories/i.test(html)) throw new Error('GitHub 页面暂时不可用或格式发生变化');
  return repos;
}
async function upstream(url, accept = 'application/vnd.github+json') {
  const origin = new URL(url).origin, isApi = origin === 'https://api.github.com';
  if (!['https://api.github.com', 'https://github.com'].includes(origin)) throw new Error('不支持的数据来源');
  if (isApi) {
    await initialize(); expireBackoff();
    if (connection.nextRetryAt) throw Object.assign(new Error('GitHub API 额度暂时受限，已暂停请求，稍后自动恢复'), { status: 429 });
  }
  const currentGeneration = generation;
  const headers = { 'User-Agent': 'GitHubTop-Local/2.0', Accept: accept };
  if (isApi) {
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  try {
    let response;
    for (let redirects = 0; redirects < 4; redirects++) {
      response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(18000) });
      if (isApi && generation === currentGeneration) recordHeaders(response);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('GitHub 返回了无效的跳转地址');
      const next = new URL(location, url);
      if (next.origin !== origin || next.username || next.password || redirects === 3) throw new Error('GitHub 返回了不受支持的跳转，已停止请求');
      url = next.href;
    }
    if (!response.ok) {
      const responseText = await boundedText(response, 8000, true);
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get('retry-after') !== null || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit|secondary rate|abuse detection/i.test(responseText)));
      let message;
      if (limited) {
        if (isApi && generation === currentGeneration) backoff(response);
        message = 'GitHub API 额度暂时受限，已暂停请求，稍后自动恢复';
      } else if (response.status === 401) message = 'GitHub Token 无效或已失效，请重新设置';
      else if (response.status === 403) message = 'GitHub 拒绝访问这项资料，请检查 Token 权限或项目是否公开';
      else if (response.status === 404) message = '这个项目或资料暂时无法访问';
      else message = `GitHub 暂时没有响应（${response.status}）`;
      if (isApi && generation === currentGeneration) {
        if (response.status !== 404) connection.available = false;
        connection.lastError = message;
      }
      throw Object.assign(new Error(message), { status: limited ? 429 : response.status, githubError: true });
    }
    if (isApi && generation === currentGeneration) {
      connection.available = !connection.nextRetryAt;
      connection.lastError = connection.nextRetryAt ? 'GitHub API 额度已用完，将在重置后自动恢复' : null;
    }
    return response;
  } catch (error) {
    if (isApi && !error.githubError && !/GitHub 返回了/.test(error.message)) {
      const safeError = new Error('GitHub 网络连接失败，请稍后重试');
      if (generation === currentGeneration) { connection.available = false; connection.lastError = safeError.message; connection.checkedAt = freshTime(); }
      throw safeError;
    }
    throw error;
  } finally { if (isApi && generation === currentGeneration) await persistConnection(); }
}
async function cached(key, ttl, refresh, producer) {
  if (!cache.has(key)) {
    try { const value = JSON.parse(await readFile(resolve(cacheDirectory, `${key}.json`), 'utf8')); if (value.fetchedAt && 'data' in value) cache.set(key, value); } catch {}
  }
  const old = cache.get(key);
  const age = old ? Date.now() - Date.parse(old.fetchedAt) : Infinity;
  if (old && age < (refresh ? 60000 : ttl)) {
    const failure = failures.get(key);
    return { ...old, stale: Boolean(failure), cached: true, ...(failure ? { warning: failure.message } : {}) };
  }
  if (failures.has(key) && Date.now() - failures.get(key).at < 60000) {
    if (old) return { ...old, stale: true, cached: true, warning: failures.get(key).message };
    throw new Error(failures.get(key).message);
  }
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = (async () => {
    try {
      const value = { data: await producer(), fetchedAt: new Date().toISOString() };
      await mkdir(cacheDirectory, { recursive: true });
      const path = resolve(cacheDirectory, `${key}.json`);
      await writeFile(`${path}.tmp`, JSON.stringify(value));
      await rename(`${path}.tmp`, path);
      cache.set(key, value); failures.delete(key);
      return { ...value, stale: false, cached: false };
    } catch (error) {
      failures.set(key, { at: Date.now(), message: error.message });
      if (old) return { ...old, stale: true, cached: true, warning: error.message };
      throw error;
    } finally { inFlight.delete(key); }
  })();
  inFlight.set(key, pending);
  return pending;
}
export async function trending(period, language, refresh = false) {
  if (!PERIODS.includes(period) || !LANGUAGES.includes(language)) throw Object.assign(new Error('筛选条件无效'), { status: 400 });
  const source = `https://github.com/trending${language ? '/' + encodeURIComponent(language) : ''}?since=${period}`;
  const result = await cached(`trending-${period}-${encodeURIComponent(language || 'all')}`, TTL, refresh, async () => parseTrending(await (await upstream(source, 'text/html')).text()));
  return { ...result, source, period, language };
}
export async function detail(repo) {
  if (!isRepo(repo)) throw Object.assign(new Error('项目名称无效'), { status: 400 });
  return cached(`repo-${createHash('sha256').update(repo.toLowerCase()).digest('hex')}`, 6 * 60 * 60 * 1000, false, async () => {
    const res = await upstream(`https://api.github.com/repos/${repo}`);
    const r = await boundedJson(res, 1024 * 1024);
    return { id: r.full_name, description: r.description, stars: r.stargazers_count, forks: r.forks_count, openIssues: r.open_issues_count, language: r.language, license: r.license?.spdx_id || '未注明', updatedAt: r.pushed_at, createdAt: r.created_at, topics: r.topics || [], archived: r.archived, homepage: /^https?:\/\//.test(r.homepage || '') ? r.homepage : null, url: r.html_url, defaultBranch: r.default_branch };
  });
}
export async function readme(repo) {
  if (!isRepo(repo)) throw invalid('项目名称无效');
  const result = await cached(`readme-${digest(repo.toLowerCase())}`, 12 * 60 * 60 * 1000, false, async () => {
    const response = await upstream(`https://api.github.com/repos/${repo}/readme`);
    const data = await boundedJson(response, 2 * 1024 * 1024);
    if (data.encoding !== 'base64' || typeof data.content !== 'string' || !/^[a-f\d]{40,64}$/i.test(data.sha || '')) throw new Error('GitHub 暂未提供可读取的 README 内容');
    const buffer = Buffer.from(data.content, 'base64');
    // Decode complete UTF-8 sequences only, preserving an explicit truncation signal.
    let end = Math.min(buffer.length, 32768);
    if (end < buffer.length) while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
    const sourceUrl = typeof data.html_url === 'string' && data.html_url.startsWith(`https://github.com/${repo}/`) ? data.html_url : `https://github.com/${repo}/#readme`;
    return { content: buffer.subarray(0, end).toString('utf8'), sourceUrl, sourceVersion: data.sha, truncated: end < buffer.length };
  });
  return { ...result.data, fetchedAt: result.fetchedAt, stale: result.stale, cached: result.cached, ...(result.warning ? { warning: result.warning } : {}) };
}
export async function releases(repo) {
  if (!isRepo(repo)) throw invalid('项目名称无效');
  return cached(`releases-${digest(repo.toLowerCase())}`, 6 * 60 * 60 * 1000, false, async () => {
    const response = await upstream(`https://api.github.com/repos/${repo}/releases?per_page=10`);
    const values = await boundedJson(response, 2 * 1024 * 1024);
    if (!Array.isArray(values)) throw new Error('GitHub 发布记录格式暂时无法读取');
    return values.filter(value => !value.draft && !value.prerelease).slice(0, 5).map(value => ({
      id: value.id, tagName: String(value.tag_name || '').slice(0, 200), name: String(value.name || value.tag_name || '').slice(0, 300),
      url: typeof value.html_url === 'string' && value.html_url.startsWith('https://github.com/') ? value.html_url : `https://github.com/${repo}/releases`,
      publishedAt: value.published_at || null, prerelease: false, draft: false,
    }));
  });
}
