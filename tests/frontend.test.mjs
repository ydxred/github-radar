import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise actual UI functions with isolated DOM/storage/API doubles.
// No browser profile, network endpoint, or local database is accessed.
const sourcePath = process.env.GITHUB_TOP_APP || new URL('../public/app.js', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const boundary = "document.querySelectorAll('[data-icon]')";
assert.ok(source.includes(boundary), 'The UI bootstrap boundary must remain recognizable');
const definitions = source.slice(0, source.indexOf(boundary));
const clone = value => JSON.parse(JSON.stringify(value));
const makeEntry = (id, period = 'weekly', periodStars = 700, extra = {}) => ({
  repo: { id, owner: id.split('/')[0], name: id.split('/')[1], description: 'A useful project', language: 'Python', languageColor: '#3572A5', stars: 1000, forks: 10, periodStars, rank: 1 },
  period, fetchedAt: '2026-09-27T00:00:00Z', savedAt: '2026-09-27T01:00:00Z', ...extra
});
const library = extra => ({ revision: 0, favorites: [], notes: {}, history: [], preferences: {}, readIds: [], hiddenIds: [], lastVisitAt: null, ...extra });
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body) });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ initialLibrary = library(), storageValues = {}, handler, topicControls = [] } = {}) {
  const storage = new Map(Object.entries(storageValues).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  const elements = new Map(), requests = [], notices = [], downloads = [], timers = new Map();
  let timerId = 0, exportedBlob, responder = handler;
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    let content = '';
    const classes = new Set();
    const item = {
      id, hidden: false, open: false, value: '', selectedIndex: 0, innerHTML: '', dataset: {},
      get textContent() { return content; },
      set textContent(value) { content = String(value); if (id === 'toast') notices.push(content); },
      classList: { toggle(name, enabled) { if (enabled ?? !classes.has(name)) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
      setAttribute(name, value) { this[name] = value; }, querySelector(selector) { return element(`${id}:${selector}`); },
      showModal() { this.open = true; }, close() { this.open = false; }, appendChild() {}, remove() {},
      click() { downloads.push({ href: this.href, download: this.download }); }
    };
    elements.set(id, item); return item;
  }
  const topicButtons = topicControls.map(({ topic, global }, index) => { const button = element(`topic-${index}`); button.dataset.topic = topic; button.classList.toggle(global ? 'topic-nav' : 'topic-chip', true); return button; });
  const document = { getElementById: element, querySelector: element, querySelectorAll: selector => selector === '[data-topic]' ? topicButtons : [], createElement: tag => element(`created-${tag}-${elements.size}`), body: element('body') };
  const context = vm.createContext({
    document, console, Date, Blob, AbortSignal, crypto: { randomUUID: () => 'test-browser-migration-id' },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    URL: { createObjectURL(blob) { exportedBlob = blob; return 'blob:test-export'; }, revokeObjectURL() {} },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || 'GET', data: options.body ? JSON.parse(options.body) : undefined, headers: options.headers };
      requests.push(call);
      if (responder) { const response = await responder(call); if (response !== undefined) return response; }
      if (url === '/api/settings') return reply({ localModel: { enabled: true, provider: 'codex' } });
      if (url === '/api/library' || url === '/api/library/mutate') return reply(initialLibrary);
      if (url === '/api/discoveries' || url.startsWith('/api/timeline?')) return reply([]);
      if (url.startsWith('/api/trending?')) return reply({ data: [], fetchedAt: '2026-09-27T00:00:00Z', source: 'https://github.com/trending' });
      if (url.startsWith('/api/repo?')) return reply({ data: { stars: 1000, forks: 10, language: 'Python', license: 'MIT', updatedAt: '2026-09-27T00:00:00Z', createdAt: '2025-01-01T00:00:00Z', openIssues: 1, archived: false, topics: [], homepage: null }, fetchedAt: '2026-09-27T00:00:00Z', stale: false });
      throw new Error(`Unexpected test API request: ${url}`);
    }
  });
  vm.runInContext(definitions, context, { filename: String(sourcePath) });
  const run = code => vm.runInContext(code, context);
  const value = code => clone(run(code));
  context.testInitial = clone(initialLibrary);
  run('applyLibrary(testInitial);state.ready=true');
  return { context, run, value, element, storage, notices, downloads, requests, timers, topicButtons, setHandler: fn => responder = fn,
    async exported() { await run('exportFavorites()'); return JSON.parse(await exportedBlob.text()); }
  };
}

test('Chinese search finds descriptions, personal notes, and inferred Chinese categories without external calls', () => {
  const entries = [makeEntry('demo/search'), makeEntry('demo/private'), makeEntry('demo/agent')];
  entries[0].repo.description = '离线检索文档'; entries[2].repo.description = 'An AI agent toolkit';
  const h = harness({ initialLibrary: library({ favorites: entries, notes: { 'demo/private': '周末试试，个人知识库' } }) });
  h.run("state.view='favorites';state.search='离线'");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/search']);
  h.run("state.search='知识库'");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/private']);
  h.run("state.search='智能体'");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/agent']);
  h.run("state.search='DEMO/SEARCH'");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/search']);
  assert.deepEqual(h.requests, []);
});

test('growth sorting never compares mixed saved periods and remains available on one-period trending boards', () => {
  const entries = [makeEntry('demo/daily', 'daily', 100), makeEntry('demo/monthly', 'monthly', 500)];
  for (const view of ['favorites', 'history', 'discoveries']) {
    const h = harness({ initialLibrary: library({ favorites: entries, history: entries }) });
    h.context.entries = entries; h.context.testView = view;
    h.run("state.discoveries=entries;state.view=testView;state.sort='growth';render()");
    assert.equal(h.value('state.sort'), 'rank');
    assert.equal(h.element('sort-select:[value="growth"]').disabled, true);
    assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/daily', 'demo/monthly']);
    h.run("state.repos=collection();state.view='trending';state.sort='growth';render()");
    assert.equal(h.element('sort-select:[value="growth"]').disabled, false);
    assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/monthly', 'demo/daily']);
  }
});

test('new-discovery, read, and hidden filters use local observation time and exclude hidden projects from counts', () => {
  const entries = ['old', 'new', 'read', 'hidden'].map(name => makeEntry(`demo/${name}`));
  const h = harness({ initialLibrary: library({ readIds: ['demo/read'], hiddenIds: ['demo/hidden'] }) });
  h.context.entries = entries.map((entry, i) => ({ ...entry, firstSeenAt: i ? '2026-09-27T08:00:00Z' : '2026-09-26T08:00:00Z' }));
  h.run("state.discoveries=entries;state.previousVisitAt='2026-09-26T12:00:00Z';state.view='discoveries';render()");
  assert.equal(h.value("isNew('demo/old')"), false);
  assert.equal(h.value("isNew('demo/new')"), true);
  assert.equal(h.element('discoveries-count').textContent, '1');
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/old', 'demo/new', 'demo/read']);
  h.run("state.reading='unread'");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/old', 'demo/new']);
  h.run("state.reading='new'");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/new', 'demo/read']);
  h.run("state.reading='hidden';render()");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), ['demo/hidden']);
  assert.match(h.element('repo-grid').innerHTML, /恢复显示/);
});

test('favorite state changes only after confirmed save and the active weekly detail retains its snapshot after re-saving', async () => {
  const entry = makeEntry('demo/weekly');
  const pending = deferred();
  const h = harness({ initialLibrary: library(), handler: call => call.url === '/api/library/mutate' ? pending.promise : undefined });
  h.context.entry = entry;
  h.run("state.view='favorites';state.period='daily';state.activeRepo=entry.repo;state.activeEntry={period:entry.period,fetchedAt:entry.fetchedAt}");
  const saved = h.run('toggleSave(entry.repo)');
  await tick();
  assert.equal(h.value('state.favorites.length'), 0);
  assert.ok(!h.notices.some(message => message.includes('已保存')));
  const call = h.requests.find(call => call.url === '/api/library/mutate');
  assert.equal(call.data.period, 'weekly');
  assert.equal(call.data.fetchedAt, entry.fetchedAt);
  assert.equal(call.headers['X-Radar-Request'], 'local-ui');
  pending.resolve(reply(library({ revision: 1, favorites: [entry] })));
  await saved;
  assert.equal(h.value('state.favorites.length'), 1);
  assert.equal(h.value('state.favorites[0].repo.periodStars'), 700);
  assert.match(h.element('repo-grid').innerHTML, /本周新增/);
  assert.match(h.notices.at(-1), /已保存到本机/);
});

test('a monthly board save uses current metadata even if weekly browsing history exists; failed save keeps state', async () => {
  const entry = makeEntry('demo/same', 'monthly', 900);
  const h = harness({ initialLibrary: library({ history: [makeEntry('demo/same', 'weekly', 70)] }), handler: call => call.url === '/api/library/mutate' ? reply({ error: '磁盘暂时不可写' }, 503) : undefined });
  h.context.entry = entry;
  h.run("state.period='monthly';state.response={fetchedAt:'2026-09-27T03:00:00Z'};state.repos=[entry.repo]");
  await h.run('safeAction(()=>toggleSave(entry.repo))()');
  const action = h.requests[0].data;
  assert.equal(action.period, 'monthly'); assert.equal(action.fetchedAt, '2026-09-27T03:00:00Z'); assert.equal(action.repo.periodStars, 900);
  assert.equal(h.value('state.favorites.length'), 0);
  assert.match(h.notices.at(-1), /磁盘暂时不可写/);
  assert.ok(!h.notices.some(message => message.includes('已保存')));
});

test('failed note saves keep the draft and never claim persistence; retry commits before clearing the draft', async () => {
  let rejectSave = true;
  const initial = library({ notes: { 'demo/note': 'Original note' } });
  const h = harness({ initialLibrary: initial, handler: call => call.url === '/api/library/mutate' && call.data.type === 'note' ? rejectSave ? reply({ error: '暂时无法写入' }, 503) : reply(library({ revision: 1, notes: { 'demo/note': 'Draft note' } })) : undefined });
  h.context.entry = makeEntry('demo/note');
  await h.run('openDetail(entry.repo)'); await tick();
  h.element('repo-note').value = 'Draft note';
  h.element('repo-note').oninput({ target: h.element('repo-note') });
  await assert.rejects(h.run('flushNote()'), /暂时无法写入/);
  assert.equal(h.value("state.notes['demo/note']"), 'Original note');
  assert.deepEqual(h.value('pendingNote'), { id: 'demo/note', text: 'Draft note' });
  assert.match(h.element('note-status').textContent, /保存失败/);
  assert.equal(h.element('repo-note').value, 'Draft note');
  rejectSave = false;
  await h.run('flushNote()');
  assert.equal(h.value('pendingNote'), null);
  assert.equal(h.value("state.notes['demo/note']"), 'Draft note');
  assert.match(h.element('note-status').textContent, /已保存到本机数据库/);
});

test('a failed in-flight note request never replaces a newer pending draft', async () => {
  const pending = deferred();
  const h = harness({ handler: call => call.url === '/api/library/mutate' && call.data.type === 'note' ? pending.promise : undefined });
  h.context.entry = makeEntry('demo/note');
  await h.run('openDetail(entry.repo)'); await tick();
  h.element('repo-note').value = 'Older draft';
  h.element('repo-note').oninput({ target: h.element('repo-note') });
  const request = h.run('flushNote()');
  const rejected = assert.rejects(request, /写入失败/);
  await tick();
  h.element('repo-note').value = 'Newer draft';
  h.element('repo-note').oninput({ target: h.element('repo-note') });
  pending.resolve(reply({ error: '写入失败' }, 503));
  await rejected;
  assert.deepEqual(h.value('pendingNote'), { id: 'demo/note', text: 'Newer draft' });
  assert.equal(h.element('repo-note').value, 'Newer draft');
});

test('mutation queue recovers from a failed operation and applies the next successful server state', async () => {
  const h = harness({ handler: call => call.url === '/api/library/mutate' ? call.data.type === 'read' ? reply({ error: 'Read failed' }, 503) : reply(library({ revision: 1, hiddenIds: ['demo/hidden'] })) : undefined });
  const failed = h.run("mutate({type:'read',id:'demo/read'})");
  const rejection = assert.rejects(failed, /Read failed/);
  const next = h.run("mutate({type:'hide',id:'demo/hidden'})");
  await rejection; await next;
  assert.deepEqual(h.requests.map(call => call.data.type), ['read', 'hide']);
  assert.deepEqual(h.value('state.hiddenIds'), ['demo/hidden']);
  assert.deepEqual(h.value('state.readIds'), []);
  assert.equal(h.value('state.revision'), 1);
});

test('failed legacy migration leaves old browser data intact and never marks it migrated', async () => {
  const old = { favorites: [makeEntry('demo/legacy')], notes: { 'demo/legacy': 'Keep original' } };
  const h = harness({ storageValues: { 'radar:library': old }, handler: call => call.url === '/api/library/import' ? reply({ error: '数据库暂时忙' }, 503) : undefined });
  h.run('state.ready=false');
  const before = h.storage.get('radar:library');
  await h.run('bootstrap()');
  assert.equal(h.storage.get('radar:library'), before);
  assert.equal(h.storage.has('radar:migration-done'), false);
  assert.equal(h.value('state.ready'), false);
  assert.match(h.element('storage-status').textContent, /旧浏览器资料未删除/);
  assert.ok(!h.notices.some(message => message.includes('已合并')));
  assert.equal(h.requests.find(call => call.url === '/api/library/import').data.migrationId, 'test-browser-migration-id');
});

test('import failures leave current library unchanged and oversize files never reach the API', async () => {
  const initial = library({ favorites: [makeEntry('demo/existing')], notes: { 'demo/existing': 'Keep me' } });
  const h = harness({ initialLibrary: initial, handler: call => call.url === '/api/library/import' ? reply({ error: '备份项目格式无效' }, 400) : undefined });
  const text = JSON.stringify({ app: 'github-top', version: 2, favorites: [makeEntry('demo/imported')] });
  h.context.testFile = { size: text.length, text: async () => text };
  await assert.rejects(h.run('importFavorites(testFile)'), /备份项目格式无效/);
  assert.deepEqual(h.value('state.favorites'), initial.favorites);
  assert.deepEqual(h.value('state.notes'), initial.notes);
  assert.ok(!h.notices.some(message => message.includes('已合并')));
  h.context.testFile = { size: 8 * 1024 * 1024 + 1, text: async () => { throw new Error('Must not read oversized file'); } };
  const calls = h.requests.length;
  await assert.rejects(h.run('importFavorites(testFile)'), /8 MB/);
  assert.equal(h.requests.length, calls);
});

test('late summary responses do not overwrite a different project and generated text is escaped', async () => {
  const pending = deferred();
  const h = harness({ handler: call => call.url === '/api/summary' ? pending.promise : undefined });
  h.context.entry = makeEntry('demo/summary');
  h.run('state.detailRequest=1');
  const summary = h.run('generateSummary(entry.repo,1)');
  h.run('state.detailRequest=2');
  h.element('summary-content').innerHTML = 'Different project';
  pending.resolve(reply({ purpose: '<img src=x onerror=alert(1)>', model: 'local', sourceUrl: 'https://github.com/demo/summary#readme', generatedAt: '2026-09-27T08:00:00Z' }));
  await summary;
  assert.equal(h.element('summary-content').innerHTML, 'Different project');
  h.setHandler(call => call.url === '/api/summary' ? reply({ purpose: '<script>alert(1)</script>', model: 'local', sourceUrl: 'https://github.com/demo/summary#readme', generatedAt: '2026-09-27T08:00:00Z' }) : undefined);
  await h.run('generateSummary(entry.repo,2)');
  assert.match(h.element('summary-content').innerHTML, /&lt;script&gt;/);
  assert.ok(!h.element('summary-content').innerHTML.includes('<script>'));
  assert.equal(h.element('summary-button').disabled, false);
});

test('export waits for an in-flight note and then saves the newer draft before downloading server data', async () => {
  const first = deferred();
  const h = harness({ handler: call => {
    if (call.url === '/api/library/mutate' && call.data.type === 'note') {
      if (call.data.text === 'Older draft') return first.promise;
      return reply(library({ revision: 2, notes: { 'demo/export': 'Newer draft' } }));
    }
    if (call.url === '/api/library/export') return reply({ app: 'github-top', version: 2, notes: { 'demo/export': 'Newer draft' }, favorites: [] });
  } });
  h.context.entry = makeEntry('demo/export');
  await h.run('openDetail(entry.repo)'); await tick();
  h.element('repo-note').value = 'Older draft';
  h.element('repo-note').oninput({ target: h.element('repo-note') });
  const save = h.run('flushNote()');
  await tick();
  assert.equal(h.run('Boolean(noteInFlight)'), true);
  h.element('repo-note').value = 'Newer draft';
  h.element('repo-note').oninput({ target: h.element('repo-note') });
  const exported = h.exported();
  await tick();
  assert.equal(h.requests.filter(call => call.url === '/api/library/mutate' && call.data.type === 'note').length, 1);
  assert.equal(h.downloads.length, 0);
  first.resolve(reply(library({ revision: 1, notes: { 'demo/export': 'Older draft' } })));
  await save;
  const result = await exported;
  assert.equal(result.notes['demo/export'], 'Newer draft');
  assert.equal(h.run('noteInFlight'), null);
  assert.equal(h.value('pendingNote'), null);
  assert.equal(h.downloads.length, 1);
  const calls = h.requests.filter(call => call.data?.type === 'note' || call.url === '/api/library/export');
  assert.deepEqual(calls.map(call => call.data?.text || call.url), ['Older draft', 'Newer draft', '/api/library/export']);
});


test('summary request pins the displayed provider and Codex output is labeled as connected inference', async () => {
  const h = harness({handler:call=>call.url==='/api/summary'?reply({purpose:'中文项目介绍',model:'Codex（默认模型）',provider:'codex',localOnly:false,sourceUrl:'https://github.com/demo/project/blob/main/README.md',generatedAt:'2026-09-27T08:00:00Z'}):undefined});
  h.context.entry=makeEntry('demo/project');
  h.run("state.settings={localModel:{enabled:true,provider:'codex'}};state.activeRepo=entry.repo;state.detailRequest=1");
  await h.run('generateSummary(entry.repo,1)');
  assert.equal(h.requests.find(r=>r.url==='/api/summary').data.provider,'codex');
  assert.match(h.element('summary-content').innerHTML,/本机 Codex · 联网解读/);
  assert.match(h.run('summaryModeHint()'),/Codex 额度/);
  h.run("state.settings.localModel.provider='local'");
  assert.match(h.run('summaryModeHint()'),/离线推理/);
  assert.match(h.run('summaryButtonLabel()'),/离线/);
});

test('domain categories overlap by project purpose without swallowing learning or guessing from owners', () => {
  const h = harness();
  const cases = [
    ['bojieli/ai-agent-book', '《深入理解 AI Agent》全书正文', ['AI 与智能体', '学习资源']],
    ['rohitg00/ai-engineering-from-scratch', 'Learn it. Build it. Ship it for others.', ['AI 与智能体', '学习资源']],
    ['cline/cline', 'Autonomous coding agent as an SDK, IDE extension, or CLI assistant.', ['AI 与智能体', '开发工具']],
    ['PostHog/posthog', 'Developer tools: AI observability, analytics, and session replay.', ['AI 与智能体', '开发工具', '数据与分析']],
    ['pytorch/pytorch', 'Tensors and Dynamic neural networks in Python with strong GPU acceleration', ['AI 与智能体']],
    ['tensorflow/tensorflow', 'An Open Source Machine Learning Framework for Everyone', ['AI 与智能体', '开发工具']],
    ['llvm/llvm-project', 'Modular and reusable compiler and toolchain technologies.', ['开发工具']],
    ['cloudflare/quiche', 'The QUIC transport protocol and HTTP/3', ['开发工具']],
    ['openbao/openbao', 'Software solution to manage and distribute sensitive data including secrets, certificates, and keys.', ['开发工具']],
    ['example/security-audit', 'Security tool checks SQL injection', ['开发工具']],
    ['ai-dev/pleasant-garden', 'A model of a garden with data files.', ['开源探索']],
    ['demo/awesome-zhuiju-free', '免费追剧影视电影资源大全', ['开源探索']],
    ['demo/awesome-movie-courses', 'Tutorials and courses on making movies', ['学习资源']]
  ];
  for (const [id, description, expected] of cases) {
    h.context.example = { id, description };
    assert.deepEqual(h.value('categories(example).map(t=>t[0])'), expected, id);
  }
  assert.deepEqual(h.requests, []);
});

test('finance and quantitative projects get an independent domain while retaining AI and learning labels', () => {
  const h = harness();
  const cases = [
    { id: 'Mathieu2301/TradingView-API', description: 'Get real-time stocks from TradingView' },
    { id: 'Open-Dev-Society/OpenStock', description: 'An open-source alternative to expensive market platforms. Track real-time prices, set personalized alerts, and explore detailed company insights.' },
    { id: 'shy3130/tick-stock-panel', description: 'TSP自托管、零运维的 A 股「选股 + 监控 + 回测」量化工作台 | LLM能力驱使策略定制+个股分析+复盘' },
    { id: 'anthropics/financial-services', description: '' },
    { id: 'example/research', description: 'Algorithmic trading and backtesting framework for investment research' },
    { id: 'example/allocations', description: 'Portfolio optimization for asset allocation and investment analysis' },
    { id: 'example/markets', description: 'Historical stock market data and equities research' },
    { id: 'example/crypto-bot', description: 'Cryptocurrency trading strategies and arbitrage tools' },
    { id: 'example/cn-research', description: 'A股行情分析与金融量化研究工具' },
    { id: 'example/intro', description: 'AI tutorial for quantitative finance and backtesting' },
    { id: 'example/ledger', description: 'Open source research platform', topics: ['fintech'] }
  ];
  assert.ok(h.value('topicLabels').includes('金融与量化'));
  for (const repo of cases) {
    h.context.example = repo;
    assert.deepEqual(h.value("categories(example).filter(t=>t[0]==='金融与量化')"), [['金融与量化', 'finance']], repo.id);
  }
  h.context.example = cases[2];
  assert.ok(h.value('categories(example).map(t=>t[0])').includes('AI 与智能体'), 'AI-assisted stock tools remain discoverable in AI');
  assert.ok(h.value('categories(example).map(t=>t[0])').includes('数据与分析'), 'quantitative analysis can retain its data label');
  h.context.example = cases[9];
  const labels = h.value('categories(example).map(t=>t[0])');
  assert.ok(labels.includes('AI 与智能体'));
  assert.ok(labels.includes('学习资源'));
  assert.deepEqual(h.requests, []);
});

test('finance classification does not mistake model quantization, security, billing, or generic developer terms for finance', () => {
  const h = harness();
  const cases = [
    { id: 'NVIDIA/Model-Optimizer', description: 'Model optimization techniques like quantization, distillation, and pruning to optimize deep learning inference.' },
    { id: 'example/model-toolkit', description: '面向大模型的量化框架，包含模型量化策略、剪枝和推理加速。' },
    { id: 'example/crypto', description: 'A cryptography library for encryption, hashing, and signatures' },
    { id: 'example/rate-limiter', description: 'API rate limits and token bucket controls for servers' },
    { id: 'example/graphql-tools', description: 'GraphQL subscription options and futures support' },
    { id: 'example/payments', description: 'Usage billing and subscription management for SaaS APIs' },
    { id: 'example/storage', description: 'Cloud storage quotas and object data access' },
    { id: 'example/portfolio', description: 'A personal developer portfolio website template' },
    { id: 'finance-quant/friendly-garden', description: 'A colorful garden simulation' },
    { id: 'example/agents', description: 'Agentic plugin marketplace for Claude Code and Codex' }
  ];
  for (const repo of cases) {
    h.context.example = repo;
    assert.equal(h.value("categories(example).some(t=>t[0]==='金融与量化')"), false, repo.id);
  }
  assert.deepEqual(h.requests, []);
});

test('finance domain is selectable across saved boards and its count respects hidden projects and current-board scope', async () => {
  const equity = makeEntry('example/stock-research', 'monthly'); equity.repo.description = 'Stock market data for equities research';
  const financeAgent = makeEntry('example/trading-agent'); financeAgent.repo.description = 'AI agent for trading and backtesting';
  const hidden = makeEntry('example/financial-report'); hidden.repo.description = 'Financial analytics';
  const ordinary = makeEntry('example/editor'); ordinary.repo.description = 'A code editor';
  const h = harness({
    initialLibrary: library({ hiddenIds: [hidden.repo.id] }),
    topicControls: [{ topic: '金融与量化', global: true }, { topic: '金融与量化' }],
    handler: call => call.url === '/api/discoveries' ? reply([equity, financeAgent, hidden, ordinary]) : undefined
  });
  h.context.entries = [equity, financeAgent, hidden, ordinary];
  h.context.board = [ordinary.repo];
  h.run('state.discoveries=entries;state.repos=board;render()');
  assert.deepEqual(h.topicButtons.map(b => b.querySelector('[data-topic-count]').textContent), ['2', '0']);
  await h.run("selectTopic('金融与量化')");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), [], 'current-board chip does not pull in unrelated saved boards');
  assert.deepEqual(h.requests, []);
  await h.run("selectTopic('金融与量化',{global:true})");
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), [equity.repo.id, financeAgent.repo.id]);
  assert.deepEqual(h.topicButtons.map(b => b.querySelector('[data-topic-count]').textContent), ['2', '2']);
  assert.equal(h.element('breadcrumb-current').textContent, '领域发现 / 金融与量化');
  assert.match(h.element('repo-grid').innerHTML, /category-tag finance/);
  assert.doesNotMatch(h.element('repo-grid').innerHTML, /financial-report|repo-name[^>]*>editor/);
  assert.deepEqual(h.requests.map(r => r.url), ['/api/discoveries']);
});

test('sidebar domain discovery searches all saved boards and clears inherited narrow filters', async () => {
  const book = makeEntry('bojieli/ai-agent-book'); book.repo.description = 'AI agent book'; book.language = 'typescript';
  const compiler = makeEntry('llvm/llvm-project', 'monthly'); compiler.repo.description = 'A compiler toolchain'; compiler.language = 'c++';
  const h = harness({ handler: call => call.url === '/api/discoveries' ? reply([book, compiler]) : undefined });
  h.context.onlyBoard = makeEntry('demo/agent').repo;
  h.run("state.repos=[onlyBoard];state.language='python';state.search='no-such-term';state.reading='new';state.sort='growth';state.period='daily'");
  await h.run("selectTopic('学习资源',{global:true})");
  assert.equal(h.value('state.view'), 'topics');
  assert.deepEqual(h.value('[state.language,state.search,state.reading,state.sort]'), ['', '', 'all', 'rank']);
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), [book.repo.id]);
  assert.equal(h.value("findRepo('bojieli/ai-agent-book').id"), book.repo.id);
  assert.equal(h.value("entryFor(findRepo('bojieli/ai-agent-book')).period"), 'weekly');
  assert.deepEqual(h.requests.map(r => r.url), ['/api/discoveries']);
  assert.equal(h.element('breadcrumb-current').textContent, '领域发现 / 学习资源');
  assert.match(h.element('page-subtitle').textContent, /不同周期与语言榜.*2 个/);
  const markup = h.element('repo-grid').innerHTML;
  assert.match(markup, /AI 与智能体/); assert.match(markup, /学习资源/);
  assert.match(markup, /最近收录：本周榜 · TypeScript/);
  assert.doesNotMatch(markup, /card-rank">#01/);
  assert.match(h.element('filter-scope').textContent, /全部本机收录/);
  assert.match(h.element('source-link').innerHTML, /各期语言榜的本机收录/);
});

test('toolbar domain chips filter the current collection without broadening it or making requests', async () => {
  const ai = makeEntry('demo/agent').repo; ai.description = 'AI coding tool';
  const outside = makeEntry('demo/outside').repo; outside.description = 'Developer tools';
  const h = harness(); h.context.ai = ai; h.context.outside = outside;
  h.run("state.repos=[ai];state.discoveries=[{repo:outside}];state.search='agent';state.language='python'");
  await h.run("selectTopic('开发工具')");
  assert.equal(h.value('state.view'), 'trending');
  assert.equal(h.value('state.search'), 'agent'); assert.equal(h.value('state.language'), 'python');
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), [ai.id]);
  assert.deepEqual(h.requests, []);
  assert.match(h.element('filter-scope').textContent, /当前榜单/);
});

test('sidebar counts cover visible saved projects while toolbar counts honor current non-topic filters', () => {
  const book = makeEntry('demo/ai-book'); book.repo.description = 'AI learning book';
  const tool = makeEntry('demo/editor'); tool.repo.description = 'Developer editor';
  const hidden = makeEntry('demo/hidden-book'); hidden.repo.description = 'Learning book';
  const h = harness({ initialLibrary: library({ hiddenIds: [hidden.repo.id] }), topicControls: [
    { topic: '学习资源', global: true }, { topic: '开发工具', global: true },
    { topic: '学习资源' }, { topic: '开发工具' }, { topic: 'AI 与智能体' }, { topic: 'all' }
  ] });
  h.context.entries = [book, tool, hidden];
  h.run("state.discoveries=entries;state.view='topics';state.topic='AI 与智能体';state.search='book';render()");
  assert.deepEqual(h.topicButtons.map(b => b.querySelector('[data-topic-count]').textContent), ['1', '1', '1', '0', '1', '1']);
  assert.equal(h.topicButtons[0]['aria-pressed'], 'false');
  assert.match(h.topicButtons[0].title, /全部本机收录/);
  assert.match(h.topicButtons[2].title, /当前列表及其他筛选/);
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), [book.repo.id]);
  h.run("state.reading='hidden';state.search='';render()");
  assert.equal(h.topicButtons[0].querySelector('[data-topic-count]').textContent, '1', 'sidebar counts always exclude hidden projects');
  assert.equal(h.topicButtons[2].querySelector('[data-topic-count]').textContent, '1', 'toolbar can count the explicitly selected hidden view');
});

test('empty domain results explain the local collection boundary and preserve clear-filter recovery', async () => {
  const h = harness();
  await h.run("selectTopic('数据与分析',{global:true})");
  assert.match(h.element('repo-grid').innerHTML, /当前本机收录中还没有/);
  assert.match(h.element('repo-grid').innerHTML, /扩大关注语言后采集/);
  assert.match(h.element('repo-grid').innerHTML, /data-empty-action="clear"/);
  assert.equal(h.element('result-count').textContent, '0 个');
  assert.match(h.element('update-status').textContent, /各自榜单快照/);
  assert.equal(h.element('.period-tabs').hidden, true);
  assert.equal(h.element('sort-select:[value="growth"]').disabled, true);
});

test('an old trending response cannot overwrite domain discovery after a view change', async () => {
  const board = deferred();
  const entry = makeEntry('demo/learning-book'); entry.repo.description = 'Learning book';
  const h = harness({ handler: call => call.url.startsWith('/api/trending?') ? board.promise : call.url === '/api/discoveries' ? reply([entry]) : undefined });
  const pending = h.run('loadTrending()'); await tick();
  await h.run("selectTopic('学习资源',{global:true})");
  board.resolve(reply({ data: [makeEntry('demo/old-agent').repo], fetchedAt: '2026-01-01T00:00:00Z' }));
  await pending;
  assert.equal(h.value('state.view'), 'topics'); assert.equal(h.value('state.loading'), false);
  assert.equal(h.value('state.response'), null);
  assert.deepEqual(h.value('filteredRepos().map(r=>r.id)'), [entry.repo.id]);
  assert.match(h.element('repo-grid').innerHTML, /learning-book/);
  assert.doesNotMatch(h.element('repo-grid').innerHTML, /old-agent/);
  await h.run('loadTrending()');
  assert.equal(h.requests.filter(r => r.url.startsWith('/api/trending?')).length, 1, 'late startup/timer load must not leave the selected domain view');
});

test('domain details and favorites retain the original board period rather than the hidden current tab', async () => {
  const entry = makeEntry('demo/learning-book', 'weekly', 700); entry.repo.description = 'Learning book';
  const h = harness(); h.context.entry = entry;
  h.run("state.view='topics';state.period='daily';state.discoveries=[entry]");
  await h.run('openDetail(entry.repo)'); await tick();
  const history = h.requests.find(r => r.data?.type === 'history');
  assert.equal(history.data.period, 'weekly');
  assert.match(h.element('detail-content').innerHTML, /本周新增 · 榜单快照/);
  await h.run('toggleSave(entry.repo)');
  const favorite = h.requests.find(r => r.data?.type === 'favorite');
  assert.equal(favorite.data.period, 'weekly'); assert.equal(favorite.data.fetchedAt, entry.fetchedAt);
});


test('the newest discovery request wins even when an older response arrives last', async () => {
  const older = deferred(), newer = deferred(); let calls = 0;
  const oldEntry = makeEntry('demo/old-book'), newEntry = makeEntry('demo/new-tool');
  const h = harness({ handler: call => call.url === '/api/discoveries' ? (++calls === 1 ? older.promise : newer.promise) : undefined });
  const first = h.run("selectTopic('学习资源',{global:true})");
  const second = h.run("selectTopic('开发工具',{global:true})");
  newer.resolve(reply([newEntry])); await second;
  older.resolve(reply([oldEntry])); await first;
  assert.equal(h.value('state.topic'), '开发工具');
  assert.deepEqual(h.value('state.discoveries.map(e=>e.repo.id)'), [newEntry.repo.id]);
});

test('detail save keeps the displayed snapshot when a discovery refresh changes its board metadata', async () => {
  const displayed = makeEntry('demo/same-tool', 'daily', 7);
  const refreshed = makeEntry('demo/same-tool', 'weekly', 700);
  const h = harness(); h.context.displayed = displayed; h.context.refreshed = refreshed;
  h.run("state.view='topics';state.discoveries=[displayed]");
  await h.run('openDetail(displayed.repo)'); await tick();
  h.run('state.discoveries=[refreshed]');
  await h.element('detail-save').onclick();
  const action = h.requests.find(r => r.data?.type === 'favorite').data;
  assert.equal(action.repo.periodStars, 7);
  assert.equal(action.period, 'daily');
  assert.equal(action.fetchedAt, displayed.fetchedAt);
});
