import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { load } from 'cheerio';

const source = await readFile(new URL('../extension/github-client.js', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./fixtures/trending-weekly.html', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const timestamp = Date.parse('2026-09-27T08:00:00Z');
const detailData = { full_name: 'demo/radar', description: 'A useful project', stargazers_count: 1234, forks_count: 80, open_issues_count: 3, language: 'Python', license: { spdx_id: 'MIT' }, pushed_at: '2026-09-26T08:00:00Z', created_at: '2024-01-01T00:00:00Z', topics: ['tool', 'python'], archived: false, homepage: 'https://example.org/', html_url: 'https://github.com/demo/radar', default_branch: 'main' };
const jsonResponse = (data, headers = {}, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

// The double implements only the detached DOM operations used by the client.
// Cheerio never executes scripts or loads external resources.
class DOMParserDouble {
  parseFromString(html, type) {
    assert.equal(type, 'text/html');
    const $ = load(html);
    function wrap(node) {
      if (!node) return null;
      return { get textContent() { return $(node).text(); }, getAttribute: name => $(node).attr(name) ?? null, querySelector: selector => wrap($(node).find(selector).first()[0]), querySelectorAll: selector => $(node).find(selector).toArray().map(wrap), remove: () => $(node).remove() };
    }
    return { body: wrap($('body')[0]), querySelectorAll: selector => $(selector).toArray().map(wrap) };
  }
}
function harness(responder, options = {}) {
  const calls = [];
  const context = vm.createContext({ URL, Uint8Array, TextDecoder, AbortController, setTimeout, clearTimeout, atob, Date, DOMParser: DOMParserDouble, fetch: async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length); } });
  vm.runInContext(source, context, { filename: 'extension/github-client.js' });
  context.options = { now: () => timestamp, ...options };
  const client = vm.runInContext('RadarGitHub.create(options)', context);
  return { client, calls, context };
}
const matchesError = (status, code) => error => error.status === status && (!code || error.code === code);

test('trending parses the real fixture, preserves source period, and requests anonymously without redirects', async () => {
  const { client, calls } = harness(() => new Response(fixture, { headers: { 'content-type': 'text/html' } }));
  const result = await client.trending('weekly', 'python', { refresh: true });
  assert.equal(result.source, 'https://github.com/trending/python?since=weekly');
  assert.equal(result.period, 'weekly'); assert.equal(result.language, 'python');
  assert.equal(result.fetchedAt, '2026-09-27T08:00:00.000Z');
  assert.equal(result.stale, false); assert.equal(result.cached, false);
  assert.ok(result.data.length > 0);
  assert.equal(result.data[0].rank, 1);
  assert.ok(Number.isSafeInteger(result.data[0].periodStars));
  const { init } = calls[0];
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.method, 'GET');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.ok(!Object.keys(init.headers).some(name => /authorization|cookie|token/i.test(name)));
  assert.equal(calls.length, 1);
});

test('inert parsing neutralizes resource URLs, never inserts raw HTML, and only recognizes actual empty-board text', () => {
  let parsedHtml;
  class InspectParser extends DOMParserDouble { parseFromString(html, type) { parsedHtml = html; return super.parseFromString(html, type); } }
  const { client } = harness(() => { throw new Error('No network expected'); }, { DOMParser: InspectParser });
  const rows = client.parseTrending(fixture + '<iframe src="https://evil.invalid/a"></iframe><img src="https://evil.invalid/b">');
  assert.ok(rows.length);
  assert.ok(!/(?:\s|<)(?:src|href)\s*=/i.test(parsedHtml));
  assert.match(parsedHtml, /data-radar-src="https:\/\/evil.invalid/);
  assert.deepEqual(copy(client.parseTrending('<main>No trending repositories</main>')), []);
  assert.deepEqual(copy(client.parseTrending('<main>There aren’t any trending repositories for this language</main>')), []);
  assert.throws(() => client.parseTrending('<h1>Sign in</h1><script>"No trending repositories"</script>'), /页面暂时不可用/);
  assert.throws(() => client.parseTrending('<!-- No trending repositories --> <main>Rate limited</main>'), /页面暂时不可用/);
  assert.throws(() => client.parseTrending('<h1>GitHub login required</h1>'), /页面暂时不可用/);
});

test('numeric parser rejects malformed grouping, shorthand, overflow and missing metric rather than inventing counts', () => {
  const { client } = harness(() => { throw new Error('No network expected'); });
  assert.equal(client.number('1,234 stars this week'), 1234);
  assert.equal(client.number('0 stars today'), 0);
  for (const value of ['', '1,,234', '12,34', '1.2k', '-5', '9007199254740992', '3 apples']) assert.equal(client.number(value), null, value);
  const missingMetric = fixture.replace(/float-sm-right/g, 'missing-growth');
  assert.throws(() => client.parseTrending(missingMetric), /数字字段/);
});

test('invalid input is rejected before networking and detail returns only normalized public metadata', async () => {
  const { client, calls } = harness(() => jsonResponse({ ...detailData, homepage: 'javascript:alert(1)', html_url: 'https://evil.invalid/', topics: ['ok', { private: 'invalid' }] }));
  for (const id of ['../repo', 'owner/..', 'owner/repo?token=secret', 'http://127.0.0.1/x']) await assert.rejects(client.detail(id), matchesError(400));
  await assert.rejects(client.trending('all-time', ''), matchesError(400));
  await assert.rejects(client.trending('weekly', '../../localhost'), matchesError(400));
  assert.equal(calls.length, 0);
  const result = await client.detail('demo/radar');
  assert.equal(calls[0].url, 'https://api.github.com/repos/demo/radar');
  assert.equal(calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(result.data.url, 'https://github.com/demo/radar');
  assert.equal(result.data.homepage, null);
  assert.deepEqual(copy(result.data.topics), ['ok']);
  assert.equal(result.data.stars, 1234); assert.equal(result.data.archived, false);
  assert.deepEqual(copy(client.rateStatus()), { configured: false, available: true, remaining: null, limit: null, resetAt: null, nextRetryAt: null, checkedAt: '2026-09-27T08:00:00.000Z', lastError: null, webRetryAt: null });
});

test('README decodes UTF-8 as plain text, truncates safely at 24k and refuses external source URLs', async () => {
  const content = 'a'.repeat(23999) + '😀' + '中文内容<script>alert(1)</script>';
  const { client, calls } = harness(() => jsonResponse({ encoding: 'base64', content: Buffer.from(content).toString('base64'), sha: 'a'.repeat(40), html_url: 'https://evil.invalid/readme' }));
  const result = await client.readme('demo/radar');
  assert.equal(calls[0].url, 'https://api.github.com/repos/demo/radar/readme');
  assert.equal(result.content.length, 23999);
  assert.equal(result.content.includes('\uFFFD'), false);
  assert.equal(result.originalLength, content.length); assert.equal(result.truncated, true);
  assert.match(result.truncationNotice, /24,000/);
  assert.equal(result.sourceUrl, 'https://github.com/demo/radar/#readme');
  assert.equal(result.sourceVersion, 'a'.repeat(40));
  const short = harness(() => jsonResponse({ encoding: 'base64', content: Buffer.from('# 中文说明\n<script>alert(1)</script>').toString('base64'), sha: 'b'.repeat(40), html_url: 'https://github.com/demo/radar/blob/main/README.md' }));
  const plain = await short.client.readme('demo/radar');
  assert.equal(plain.content, '# 中文说明\n<script>alert(1)</script>');
  assert.equal(plain.truncated, false);
  assert.equal(plain.sourceUrl, 'https://github.com/demo/radar/blob/main/README.md');
});

test('invalid README base64, non-UTF8 data and unexpected JSON shapes are rejected', async () => {
  for (const data of [null, { encoding: 'utf-8', content: 'text', sha: 'a'.repeat(40) }, { encoding: 'base64', content: '!!!=', sha: 'a'.repeat(40) }, { encoding: 'base64', content: '/w==', sha: 'a'.repeat(40) }]) {
    const { client } = harness(() => jsonResponse(data));
    await assert.rejects(client.readme('demo/radar'), /README/);
  }
  await assert.rejects(harness(() => new Response('<html>Not JSON</html>')).client.detail('demo/radar'), /资料格式/);
  await assert.rejects(harness(() => jsonResponse({})).client.detail('demo/radar'), /详情格式/);
});

test('release query is bounded and excludes draft/prerelease records with safe fallback links', async () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, draft: index === 0, prerelease: index === 1, tag_name: `v${10 - index}`, name: `Release ${index}`, html_url: index === 2 ? 'https://evil.invalid/' : `https://github.com/demo/radar/releases/tag/v${10 - index}`, published_at: '2026-09-27T08:00:00Z' }));
  const { client, calls } = harness(() => jsonResponse(entries));
  const result = await client.release('demo/radar');
  assert.equal(calls[0].url, 'https://api.github.com/repos/demo/radar/releases?per_page=10');
  assert.equal(result.data.length, 5);
  assert.equal(result.data[0].id, 3);
  assert.equal(result.data[0].url, 'https://github.com/demo/radar/releases');
  assert.ok(result.data.every(item => !item.prerelease && !item.draft));
  const empty = await harness(() => jsonResponse([])).client.release('demo/radar');
  assert.deepEqual(copy(empty.data), []);
  await assert.rejects(harness(() => jsonResponse({ message: 'Bad shape' })).client.release('demo/radar'), /发布记录格式/);
});

test('primary exhaustion blocks API until reset without blocking public trending or retrying automatically', async () => {
  let clock = timestamp;
  const reset = timestamp / 1000 + 3600;
  const { client, calls } = harness(url => url.startsWith('https://github.com/') ? new Response(fixture) : jsonResponse({ message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': String(reset) }, 403), { now: () => clock });
  await assert.rejects(client.detail('demo/radar'), matchesError(429, 'RATE_LIMIT'));
  assert.equal(client.rateStatus().remaining, 0);
  assert.equal(client.rateStatus().nextRetryAt, new Date(reset * 1000).toISOString());
  await assert.rejects(client.readme('demo/radar'), matchesError(429));
  assert.equal((await client.checkConnection()).available, false);
  assert.equal(calls.length, 1);
  await client.trending('weekly', '');
  assert.equal(calls.length, 2);
  clock = reset * 1000 + 1;
  assert.equal(client.rateStatus().nextRetryAt, null);
  assert.equal(client.rateStatus().remaining, null);
  await assert.rejects(client.detail('demo/radar'));
  assert.equal(calls.length, 3);
});

test('secondary retry-after backoff handles seconds and HTTP dates while ordinary 403 does not create a quota pause', async () => {
  for (const header of ['180', new Date(timestamp + 180000).toUTCString()]) {
    const { client, calls } = harness(() => jsonResponse({ message: 'secondary rate limit' }, { 'retry-after': header, 'x-ratelimit-remaining': '30' }, 403));
    await assert.rejects(client.detail('demo/radar'), matchesError(429));
    assert.equal(client.rateStatus().nextRetryAt, new Date(timestamp + 180000).toISOString());
    await assert.rejects(client.detail('demo/radar'), matchesError(429));
    assert.equal(calls.length, 1);
  }
  const denied = harness(() => jsonResponse({ message: 'Repository access denied' }, {}, 403));
  await assert.rejects(denied.client.detail('demo/radar'), matchesError(403));
  assert.equal(denied.client.rateStatus().nextRetryAt, null);
});

test('zero remaining on a successful response pauses follow-up API calls even without a future reset timestamp', async () => {
  for (const reset of [undefined, String(timestamp / 1000 - 60)]) {
    const { client, calls } = harness(() => jsonResponse(detailData, { 'x-ratelimit-remaining': '0', ...(reset ? { 'x-ratelimit-reset': reset } : {}) }));
    assert.equal((await client.detail('demo/radar')).data.id, 'demo/radar');
    assert.equal(client.rateStatus().available, false);
    assert.equal(client.rateStatus().nextRetryAt, new Date(timestamp + 60000).toISOString());
    await assert.rejects(client.readme('demo/radar'), matchesError(429));
    assert.equal(calls.length, 1);
  }
});

test('low but nonzero quota expires at reset without probing the network or blocking later requests', async () => {
  for (const remaining of [1, 2]) {
    let clock = timestamp;
    const { client, calls } = harness(() => jsonResponse(detailData, { 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-limit': '60', 'x-ratelimit-reset': String(timestamp / 1000 + 60) }), { now: () => clock });
    await client.detail('demo/radar');
    assert.equal(client.rateStatus().remaining, remaining);
    clock += 60000;
    const expired = client.rateStatus();
    assert.equal(expired.remaining, null); assert.equal(expired.resetAt, null); assert.equal(expired.limit, 60);
    assert.equal(expired.nextRetryAt, null); assert.equal(calls.length, 1, 'Reading status never probes the network');
    await client.detail('demo/radar');
    assert.equal(calls.length, 2);
  }
});

test('quota reset does not erase a later secondary backoff, and public-page backoff is exposed independently', async () => {
  let clock = timestamp;
  const { client, calls } = harness(url => url.startsWith('https://github.com/')
    ? new Response('Please try later', { status: 429, headers: { 'retry-after': '300' } })
    : jsonResponse({ message: 'secondary rate limit' }, { 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': String(timestamp / 1000 + 60), 'retry-after': '180' }, 403), { now: () => clock });
  await assert.rejects(client.detail('demo/radar'), matchesError(429));
  await assert.rejects(client.trending('daily', ''), matchesError(429));
  clock += 60000;
  const status = client.rateStatus();
  assert.equal(status.remaining, null); assert.equal(status.resetAt, null);
  assert.equal(status.nextRetryAt, new Date(timestamp + 180000).toISOString());
  assert.equal(status.webRetryAt, new Date(timestamp + 300000).toISOString());
  await assert.rejects(client.detail('demo/radar'), matchesError(429));
  await assert.rejects(client.trending('daily', ''), matchesError(429, 'WEB_RATE_LIMIT'));
  assert.equal(calls.length, 2);
  clock = timestamp + 180000;
  assert.equal(client.rateStatus().nextRetryAt, null);
  assert.equal(client.rateStatus().webRetryAt, new Date(timestamp + 300000).toISOString());
  clock = timestamp + 300000;
  assert.equal(client.rateStatus().webRetryAt, null);
  assert.equal(calls.length, 2);
});

test('connection check is explicit, coalesces concurrent calls, and response headers outrank conflicting JSON quota', async () => {
  const { client, calls } = harness(() => jsonResponse({ resources: { core: { remaining: 59, limit: 60, reset: timestamp / 1000 + 3600 } } }, { 'x-ratelimit-remaining': '7', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': String(timestamp / 1000 + 1800) }));
  assert.equal(client.rateStatus().checkedAt, null); assert.equal(calls.length, 0);
  const [a, b] = await Promise.all([client.checkConnection(), client.checkConnection()]);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.github.com/rate_limit');
  assert.equal(a.configured, false); assert.equal(a.remaining, 7); assert.equal(b.remaining, 7);
  assert.equal(a.resetAt, new Date(timestamp + 1800000).toISOString());
});

test('byte limits reject oversized streamed and declared responses and redirects never get followed', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(harness(() => new Response(stream)).client.detail('demo/radar'), matchesError(413, 'BODY_TOO_LARGE'));
  assert.equal(cancelled, true);
  await assert.rejects(harness(() => new Response('small', { headers: { 'content-length': '999999999' } })).client.detail('demo/radar'), matchesError(413));
  const redirect = harness(() => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
  await assert.rejects(redirect.client.detail('demo/radar'), matchesError(502, 'REDIRECT_BLOCKED'));
  assert.equal(redirect.calls.length, 1);
  assert.equal(redirect.calls[0].init.redirect, 'error');
});

test('timeout covers the response body, aborts the request and never reports a successful connection', async () => {
  let seenSignal, cancelled = false;
  const { client, calls } = harness((url, init) => { seenSignal = init.signal; return new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } })); }, { timeoutMs: 15 });
  await assert.rejects(client.detail('demo/radar'), matchesError(504, 'TIMEOUT'));
  assert.equal(seenSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(client.rateStatus().available, false);
  assert.equal(calls.length, 1);
  assert.match(client.rateStatus().lastError, /超时/);
});
