/* Standalone extension network client. No localhost, cookies, credentials, or stored tokens. */
const RadarGitHub = (() => {
  'use strict';
  const LANGUAGES = ['', 'python', 'javascript', 'typescript', 'go', 'rust', 'java', 'c++', 'c', 'c#', 'swift', 'kotlin', 'php', 'ruby', 'shell', 'jupyter-notebook', 'html', 'css'];
  const PERIODS = ['daily', 'weekly', 'monthly'];
  const API = 'https://api.github.com';
  const WEB = 'https://github.com';
  const README_CHARS = 24000;
  const fail = (message, status = 502, code = 'GITHUB_RESPONSE') => Object.assign(new Error(message), { status, code });
  const isRepo = value => typeof value === 'string' && value.length < 220 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..');
  const validId = value => { if (!isRepo(value)) throw fail('项目名称无效', 400, 'INVALID_REPO'); return value; };
  const cleanText = (value, length = 3000) => typeof value === 'string' ? value.slice(0, length) : '';
  function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
  function number(value) {
    const match = String(value || '').trim().match(/^((?:\d{1,3}(?:,\d{3})+|\d+))(?:\s+stars? (?:today|this week|this month))?$/);
    return match ? count(Number(match[1].replace(/,/g, ''))) : null;
  }
  function safeUrl(value, fallback = null) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : fallback; } catch { return fallback; }
  }
  function repoUrl(value, id, fallback) {
    const url = safeUrl(value);
    if (!url) return fallback;
    const parsed = new URL(url), path = `/${id.toLowerCase()}`;
    return parsed.origin === WEB && (parsed.pathname.toLowerCase() === path || parsed.pathname.toLowerCase().startsWith(path + '/')) ? parsed.href : fallback;
  }
  function create({ fetch: fetcher = globalThis.fetch?.bind(globalThis), DOMParser: Parser = globalThis.DOMParser, now = () => Date.now(), timeoutMs = 18000 } = {}) {
    if (typeof fetcher !== 'function') throw new Error('浏览器暂不支持网络请求');
    const connection = { configured: false, available: null, remaining: null, limit: null, resetAt: null, nextRetryAt: null, checkedAt: null, lastError: null };
    let webpageRetryAt = 0, checking = null;
    const time = () => Number(now());
    const stamp = () => new Date(time()).toISOString();
    const toDate = milliseconds => Number.isFinite(milliseconds) && Number.isFinite(new Date(milliseconds).getTime()) ? new Date(milliseconds).toISOString() : null;
    function expireBackoff() {
      if (connection.resetAt && Date.parse(connection.resetAt) <= time()) {
        // A past quota window says nothing about the current remaining balance.
        // Invalidate it locally; the next explicit request will learn fresh headers.
        connection.remaining = null; connection.resetAt = null;
      }
      if (connection.nextRetryAt && Date.parse(connection.nextRetryAt) <= time()) {
        connection.nextRetryAt = null; connection.available = null; connection.lastError = null;
        if (connection.remaining === 0) connection.remaining = null;
      }
    }
    function rateStatus() { expireBackoff(); return { ...connection, webRetryAt: webpageRetryAt > time() ? toDate(webpageRetryAt) : null }; }
    function headerNumber(response, name) {
      const value = response.headers.get(name);
      return value !== null && /^\d+$/.test(value) ? count(Number(value)) : null;
    }
    function pauseExhaustedQuota() {
      if (connection.remaining !== 0) return;
      const reset = Date.parse(connection.resetAt || '');
      connection.nextRetryAt = toDate(Number.isFinite(reset) && reset > time() ? reset : time() + 60000);
      connection.available = false;
      connection.lastError = 'GitHub API 额度已用完，请等待重置';
    }
    function recordHeaders(response) {
      const remaining = headerNumber(response, 'x-ratelimit-remaining'), limit = headerNumber(response, 'x-ratelimit-limit'), reset = headerNumber(response, 'x-ratelimit-reset');
      if (remaining !== null) connection.remaining = remaining;
      if (limit !== null) connection.limit = limit;
      if (reset !== null) connection.resetAt = toDate(reset * 1000);
      connection.checkedAt = stamp();
      if (remaining === 0) pauseExhaustedQuota();
    }
    function retryAt(response, isApi) {
      const retry = response.headers.get('retry-after');
      const retryTime = /^\d+(?:\.\d+)?$/.test(retry || '') ? time() + Number(retry) * 1000 : Date.parse(retry || '');
      const reset = isApi && connection.remaining === 0 ? Date.parse(connection.resetAt || '') : 0;
      const when = Math.max(time() + 60000, Number.isFinite(retryTime) ? retryTime : 0, Number.isFinite(reset) ? reset : 0);
      return toDate(when) || toDate(time() + 60000);
    }
    async function boundedText(response, maximum, signal, truncate = false) {
      const declared = headerNumber(response, 'content-length');
      if (!truncate && declared !== null && declared > maximum) { await response.body?.cancel().catch(() => {}); throw fail('GitHub 返回的资料过大，请直接查看项目原页', 413, 'BODY_TOO_LARGE'); }
      if (!response.body?.getReader) throw fail('GitHub 没有返回可读取的资料');
      const reader = response.body.getReader(), chunks = []; let length = 0;
      const cancelOnAbort = () => { reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancelOnAbort, { once: true });
      try {
        for (;;) {
          if (signal.aborted) throw fail('GitHub 请求超时，请稍后重试', 504, 'TIMEOUT');
          const { done, value } = await reader.read();
          if (done) break;
          if (length + value.byteLength > maximum) {
            if (!truncate) throw fail('GitHub 返回的资料过大，请直接查看项目原页', 413, 'BODY_TOO_LARGE');
            chunks.push(value.subarray(0, maximum - length)); length = maximum; await reader.cancel(); break;
          }
          chunks.push(value); length += value.byteLength;
        }
        if (signal.aborted) throw fail('GitHub 请求超时，请稍后重试', 504, 'TIMEOUT');
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return new TextDecoder('utf-8', { fatal: !truncate }).decode(bytes);
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { signal.removeEventListener('abort', cancelOnAbort); reader.releaseLock(); }
    }
    async function request(url, { maximum = 1024 * 1024, accept = 'application/vnd.github+json' } = {}) {
      const parsed = new URL(url), isApi = parsed.origin === API;
      if (![API, WEB].includes(parsed.origin) || parsed.username || parsed.password) throw fail('不支持的数据来源', 400);
      expireBackoff();
      if (isApi && connection.nextRetryAt) throw fail('GitHub API 额度暂时受限，请在重试时间之后再试', 429, 'RATE_LIMIT');
      if (!isApi && webpageRetryAt > time()) throw fail('GitHub 榜单访问暂时受限，请稍后重试', 429, 'WEB_RATE_LIMIT');
      const controller = new AbortController(); let timer;
      const headers = { Accept: accept };
      if (isApi) headers['X-GitHub-Api-Version'] = '2022-11-28';
      const operation = (async () => {
        const response = await fetcher(parsed.href, { method: 'GET', headers, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (controller.signal.aborted) throw fail('GitHub 请求超时，请稍后重试', 504, 'TIMEOUT');
        if (isApi) recordHeaders(response);
        if (response.redirected || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
          await response.body?.cancel().catch(() => {}); throw fail('GitHub 返回了跳转，已停止请求，请直接查看项目原页', 502, 'REDIRECT_BLOCKED');
        }
        if (!response.ok) {
          const body = await boundedText(response, 8000, controller.signal, true);
          const limited = response.status === 429 || response.status === 403 && (response.headers.get('retry-after') !== null || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit|secondary rate|abuse detection/i.test(body));
          let message;
          if (limited) {
            const retry = retryAt(response, isApi);
            if (isApi) { connection.nextRetryAt = retry; connection.available = false; }
            else webpageRetryAt = Date.parse(retry);
            message = isApi ? 'GitHub API 额度暂时受限，已暂停请求，请稍后重试' : 'GitHub 榜单访问暂时受限，请稍后重试';
          } else if (response.status === 404) message = '这个项目或资料暂时无法访问';
          else if ([401, 403].includes(response.status)) message = 'GitHub 暂时不允许匿名访问这项资料，请查看公开项目原页';
          else message = `GitHub 暂时没有响应（${response.status}）`;
          throw fail(message, limited ? 429 : response.status, limited ? 'RATE_LIMIT' : 'GITHUB_HTTP');
        }
        const body = await boundedText(response, maximum, controller.signal);
        if (isApi) { connection.available = !connection.nextRetryAt; connection.lastError = connection.nextRetryAt ? 'GitHub API 额度已用完，请等待重置' : null; }
        return { text: body, response };
      })();
      try {
        return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('GitHub 请求超时，请稍后重试', 504, 'TIMEOUT')); }, timeoutMs); })]);
      } catch (cause) {
        const error = cause?.status ? cause : fail(controller.signal.aborted ? 'GitHub 请求超时，请稍后重试' : 'GitHub 网络连接失败或返回了跳转，请稍后重试', controller.signal.aborted ? 504 : 503, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
        if (isApi) { connection.available = false; connection.lastError = error.message; connection.checkedAt = stamp(); }
        throw error;
      } finally { clearTimeout(timer); }
    }
    async function json(url, maximum) {
      const result = await request(url, { maximum });
      try { return { data: JSON.parse(result.text), response: result.response }; }
      catch { connection.available = false; connection.lastError = 'GitHub 返回的资料格式暂时无法读取'; throw fail(connection.lastError); }
    }
    function parseTrending(html) {
      if (typeof Parser !== 'function') throw fail('浏览器暂不支持榜单解析');
      // Parse into an inert detached document. Neutralize resource attributes first so
      // even images/frames cannot initiate requests while the document is inspected.
      const inert = html.replace(/\b(src|srcset|href)\s*=/gi, 'data-radar-$1=');
      const document = new Parser().parseFromString(inert, 'text/html');
      const repos = [], ids = new Set();
      for (const row of document.querySelectorAll('article.Box-row')) {
        if (repos.length >= 100) throw fail('GitHub 榜单项目数量异常');
        const id = row.querySelector('h2 a')?.getAttribute('data-radar-href')?.replace(/^\//, '');
        if (!isRepo(id) || ids.has(id.toLowerCase())) throw fail('GitHub 榜单项目格式发生变化');
        ids.add(id.toLowerCase());
        const links = Array.from(row.querySelectorAll('a'));
        const metric = suffix => links.filter(link => link.getAttribute('data-radar-href') === `/${id}/${suffix}`).map(link => link.textContent).join('');
        const stars = number(metric('stargazers')), forks = number(metric('forks')), periodStars = number(row.querySelector('span.float-sm-right')?.textContent);
        if ([stars, forks, periodStars].some(value => value === null)) throw fail('GitHub 榜单数字字段暂时无法解析');
        const [owner, name] = id.split('/');
        const color = row.querySelector('.repo-language-color')?.getAttribute('style')?.match(/background-color:\s*(#[a-f\d]{3,8})(?:\s*;|\s*$)/i)?.[1] || '#94a3b8';
        const contributors = Array.from(row.querySelectorAll('img.avatar')).flatMap(image => {
          const avatar = safeUrl(image.getAttribute('data-radar-src'));
          return avatar && new URL(avatar).origin === 'https://avatars.githubusercontent.com' ? [{ name: cleanText(image.getAttribute('alt')?.replace(/^@/, ''), 100), avatar }] : [];
        }).slice(0, 5);
        repos.push({ id, owner, name, url: `${WEB}/${id}`, rank: repos.length + 1, description: cleanText(row.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim()), language: cleanText(row.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim(), 80) || '未标注', languageColor: color, stars, forks, periodStars, contributors });
      }
      if (!repos.length) {
        for (const node of document.querySelectorAll('script, style, template')) node.remove();
        const visibleText = document.body?.textContent || '';
        if (!/There aren[’']t any trending repositories|No trending repositories/i.test(visibleText)) throw fail('GitHub 页面暂时不可用或格式发生变化');
      }
      return repos;
    }
    async function trending(period, language = '', { refresh = false } = {}) {
      if (!PERIODS.includes(period) || !LANGUAGES.includes(language) || typeof refresh !== 'boolean') throw fail('筛选条件无效', 400);
      const source = `${WEB}/trending${language ? '/' + encodeURIComponent(language) : ''}?since=${period}`;
      const result = await request(source, { maximum: 3 * 1024 * 1024, accept: 'text/html' });
      return { data: parseTrending(result.text), source, fetchedAt: stamp(), stale: false, cached: false, period, language };
    }
    async function detail(id) {
      validId(id);
      const { data: value } = await json(`${API}/repos/${id}`, 1024 * 1024);
      if (!value || !isRepo(value.full_name) || ![value.stargazers_count, value.forks_count, value.open_issues_count].every(value => count(value) !== null) || typeof value.archived !== 'boolean') throw fail('GitHub 项目详情格式暂时无法读取');
      const data = { id: value.full_name, description: cleanText(value.description) || null, stars: value.stargazers_count, forks: value.forks_count, openIssues: value.open_issues_count, language: cleanText(value.language, 80) || null, license: cleanText(value.license?.spdx_id, 100) || '未注明', updatedAt: cleanText(value.pushed_at, 40) || null, createdAt: cleanText(value.created_at, 40) || null, topics: Array.isArray(value.topics) ? value.topics.filter(topic => typeof topic === 'string').slice(0, 30).map(topic => topic.slice(0, 100)) : [], archived: value.archived, homepage: safeUrl(value.homepage), url: `${WEB}/${value.full_name}`, defaultBranch: cleanText(value.default_branch, 250) };
      return { data, fetchedAt: stamp(), stale: false, cached: false };
    }
    async function readme(id) {
      validId(id);
      const { data: value } = await json(`${API}/repos/${id}/readme`, 2 * 1024 * 1024);
      if (!value || value.encoding !== 'base64' || typeof value.content !== 'string' || !/^[a-f\d]{40,64}$/i.test(value.sha || '')) throw fail('GitHub 暂未提供可读取的 README 内容');
      const encoded = value.content.replace(/[\r\n\t ]/g, '');
      if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw fail('GitHub README 编码暂时无法读取');
      let decoded;
      try { const binary = atob(encoded), bytes = Uint8Array.from(binary, character => character.charCodeAt(0)); decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw fail('GitHub README 编码暂时无法读取'); }
      let end = Math.min(README_CHARS, decoded.length);
      if (end < decoded.length && /[\uD800-\uDBFF]/.test(decoded[end - 1])) end--;
      const truncated = end < decoded.length;
      return { content: decoded.slice(0, end), sourceUrl: repoUrl(value.html_url, id, `${WEB}/${id}/#readme`), sourceVersion: value.sha, truncated, originalLength: decoded.length, ...(truncated ? { truncationNotice: '本次仅读取 README 前 24,000 字符，未读取完整文档。' } : {}), fetchedAt: stamp(), stale: false, cached: false };
    }
    async function release(id) {
      validId(id);
      const { data: values } = await json(`${API}/repos/${id}/releases?per_page=10`, 2 * 1024 * 1024);
      if (!Array.isArray(values) || values.length > 10 || values.some(value => !value || typeof value !== 'object' || count(value.id) === null || typeof value.draft !== 'boolean' || typeof value.prerelease !== 'boolean')) throw fail('GitHub 发布记录格式暂时无法读取');
      const data = values.filter(value => !value.draft && !value.prerelease).slice(0, 5).map(value => ({ id: value.id, tagName: cleanText(value.tag_name, 200), name: cleanText(value.name || value.tag_name, 300), url: repoUrl(value.html_url, id, `${WEB}/${id}/releases`), publishedAt: cleanText(value.published_at, 40) || null, prerelease: false, draft: false }));
      return { data, fetchedAt: stamp(), stale: false, cached: false };
    }
    async function checkConnection() {
      expireBackoff(); if (connection.nextRetryAt) return rateStatus();
      if (!checking) checking = (async () => {
        try {
          const { data, response } = await json(`${API}/rate_limit`, 64000);
          const core = data?.resources?.core || data?.rate;
          if (!core || [core.remaining, core.limit, core.reset].some(value => count(value) === null)) throw fail('GitHub 额度资料暂时无法读取');
          if (headerNumber(response, 'x-ratelimit-remaining') === null) connection.remaining = core.remaining;
          if (headerNumber(response, 'x-ratelimit-limit') === null) connection.limit = core.limit;
          if (headerNumber(response, 'x-ratelimit-reset') === null) connection.resetAt = toDate(core.reset * 1000);
          pauseExhaustedQuota();
        } catch (error) { connection.available = false; connection.lastError = error.message; connection.checkedAt = stamp(); }
        finally { checking = null; }
        return rateStatus();
      })();
      return checking;
    }
    return Object.freeze({ trending, detail, readme, release, rateStatus, checkConnection, parseTrending, isRepo, number });
  }
  return Object.freeze({ ...create(), create });
})();
