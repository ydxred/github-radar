const standalone=typeof RadarExtension!=='undefined';
const storageCopy=(web,extension)=>standalone?extension:web;
const paths = {
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 3-2 3 2 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 2-3-2-3 3-3 3-1 1-3Z',
 flame:'M12 3c1 5-4 5-2 10 2-1 3-3 3-5 4 3 5 6 4 9a6 6 0 0 1-11-1c-1-4 2-6 3-8 0 3 1 3 1 3s3-3 2-8Z',
 bookmark:'M6 3h12v18l-6-4-6 4V3Z',clock:'M12 8v4l3 2|circle',sparkles:'m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z',code:'m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',chart:'M4 4v16h16M8 16v-5m5 5V7m5 9v-7',book:'M12 5v15M3 4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V4Z',help:'M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01|circle',moon:'M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z',sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5|sun',github:'M9 19c-4 1-4-2-6-2m12 5v-3.5c0-1 .1-1.5-.5-2 3-.3 6-1.5 6-6a5 5 0 0 0-1.3-3.5 5 5 0 0 0-.2-3.5s-1.2-.4-4 1.5a14 14 0 0 0-7 0C5.2 3.1 4 3.5 4 3.5A5 5 0 0 0 3.8 7 5 5 0 0 0 2.5 10.5c0 4.5 3 5.7 6 6-.6.5-.5 1-.5 2V22',radar:'M12 12 20 4M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5',search:'m16 16 4 4|search',refresh:'M20 7v5h-5M4 17v-5h5M6.3 6A7 7 0 0 1 20 12M4 12a7 7 0 0 0 13.7 6',grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',list:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',external:'M14 3h7v7m0-7L10 14M10 3H4v17h17v-6',arrow:'M4 12h16m-5-5 5 5-5 5',download:'M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6',upload:'M12 15V3m-4 4 4-4 4 4M4 15v6h16v-6',close:'m6 6 12 12M6 18 18 6',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',fork:'M6 3v5a6 6 0 0 0 6 6m6-11v5a6 6 0 0 1-6 6v7M4 3h4m8 0h4m-10 18h4',trend:'m3 17 6-6 4 4 8-10m-6 0h6v6',copy:'M9 8h11v13H9V8ZM5 16H3V3h12v2',check:'m5 12 4 4L19 6',heart:'M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'
};
function icon(name) { const [path, extra] = (paths[name] || paths.code).split('|'); return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/>${extra === 'circle' ? '<circle cx="12" cy="12" r="9"/>' : extra === 'sun' ? '<circle cx="12" cy="12" r="4"/>' : extra === 'search' ? '<circle cx="10.5" cy="10.5" r="6.5"/>' : ''}</svg>`; }
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(`radar:${key}`)) ?? fallback; } catch { return fallback; } }
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3200); }
function save(key, value) { try { localStorage.setItem(`radar:${key}`, JSON.stringify(value)); return true; } catch { toast('浏览器存储空间不足，这次更改未能保存；请先导出收藏。'); return false; } }
const validId = id => typeof id === 'string' && /^[\w.-]+\/[\w.-]+$/.test(id) && !id.split('/').some(p => p === '.' || p === '..') && id.length < 220;
function cleanRepo(repo) {
 if (!repo || !validId(repo.id)) return null;
 const [owner,name] = repo.id.split('/');
 return { id:repo.id,owner,name,url:`https://github.com/${repo.id}`,description:String(repo.description || '').slice(0,3000),language:String(repo.language || '未标注').slice(0,50),languageColor:/^#[a-f\d]{3,8}$/i.test(repo.languageColor) ? repo.languageColor : '#94a3b8',stars:Number.isFinite(repo.stars) && repo.stars>=0 ? repo.stars : null,forks:Number.isFinite(repo.forks) && repo.forks>=0 ? repo.forks : null,periodStars:Number.isFinite(repo.periodStars) && repo.periodStars>=0 ? repo.periodStars : null,rank:Number.isFinite(repo.rank) ? repo.rank : 0 };
}
function cleanEntries(items) {
 return Array.isArray(items) ? items.slice(0,3000).filter(e => e && cleanRepo(e.repo) && ['daily','weekly','monthly'].includes(e.period)).map(e => ({repo:cleanRepo(e.repo),period:e.period,fetchedAt:typeof e.fetchedAt==='string'?e.fetchedAt.slice(0,40):undefined,savedAt:typeof e.savedAt==='string'?e.savedAt.slice(0,40):undefined,viewedAt:typeof e.viewedAt==='string'?e.viewedAt.slice(0,40):undefined,note:typeof e.note==='string'?e.note.slice(0,3000):''})) : [];
}
const topicLabels=['AI 与智能体','开发工具','数据与分析','金融与量化','学习资源','开源探索'];
function categories(repo) {
 // Project owners and generic words such as "model" or "data" are not purpose labels.
 const name=String(repo.name||repo.id?.split('/')[1]||'').toLowerCase();
 const text=`${name} ${repo.description||''} ${(repo.topics||[]).join(' ')}`.toLowerCase(),tags=[];
 if (/\b(ai|llms?|agents?|agentic|gpt\w*|claude|codex|rag|diffusion|inference|mcp|pytorch|tensorflow)\b|machine learning|deep learning|neural networks?|language models?|foundation models?|voice cloning|智能|大模型/.test(text)) tags.push(['AI 与智能体','ai']);
 if (/\b(tools?|toolkits?|toolchains?|cli|code|coding|developers?|development|frameworks?|editors?|terminal|apis?|servers?|sdk|ide|compilers?|plugins?|libraries|devops|debugger|protocols?|http\/?3|kubernetes|docker|backend|frontend|fullstack|automation|security|secrets|certificates)\b|web apps?|github actions|software solution|开发|工具|编译|运维|安全/.test(text)) tags.push(['开发工具','dev']);
 if (/\b(databases?|analytics|visualization|trading|quant|finance|financial|stocks?|spreadsheets?|sql|nosql)\b|data (analysis|science|engineering|warehouse|pipeline|visualization)|time[- ]series|market (data|platforms)|relational tables|数据分析|数据可视化|数据库|数据科学|量化|选股|回测|金融/.test(text.replace(/sql injection/g,''))) tags.push(['数据与分析','data']);
 // Financial purpose must be explicit: model quantization, crypto primitives,
 // programming futures and personal portfolio websites are unrelated domains.
 let financeText=text.replace(/[_-]+/g,' ');
 const modelQuantization=/大模型|模型|神经网络|权重|激活值|\b(llms?|neural|inference|quantization|quantisation)\b/.test(financeText);
 if(modelQuantization)financeText=financeText.replace(/量化(?:策略|研究|平台|工作台|框架)/g,'');
 const financialPurpose=/\b(finance|financial|fintech|trading|traders?|backtests?|backtesting|arbitrage)\b|\bquant(?:itative)? (?:finance|trading|investment|research|strategies|strategy|backtesting)\b|\balgorithmic trading\b|\bstock (?:market|prices?|quotes?|analysis|screening|data)\b|\b(?:real time|live) stocks\b|\b(?:market data|market platforms|forex|equities)\b|\bportfolio (?:optimization|allocation|returns|risk)\b|\basset (?:allocation|pricing)\b|\b(?:investment|investing|options pricing|option pricing)\b|金融|财经|证券|股票|股市|选股|炒股|回测|期货|期权|外汇|(?:a\s*|美|港)股|量化(?:交易|投资|策略|研究|金融|平台|工作台|框架)/.test(financeText);
 if (financialPurpose) tags.push(['金融与量化','finance']);
 const learningText=text.replace(/(?:machine|deep|reinforcement) learning/g,'');
 const learningIntent=/\b(courses?|tutorials?|interviews?|learn|learning|guides?|roadmaps?|books?|education|educational|classroom|exercises?)\b|from[- ]scratch|教程|学习|面试|全书|教材|入门|课程/.test(learningText);
 const entertainment=/\b(movies?|television|iptv|anime)\b|影视|电影|追剧|动漫|电视|综艺/.test(text);
 if (learningIntent||(/\bawesome\b/.test(learningText)&&!entertainment)) tags.push(['学习资源','learn']);
 return tags.length?tags:[['开源探索','other']];
}
function category(repo){return categories(repo)[0];}
const compact = value => value == null ? '—' : value >= 1000000 ? (value/1000000).toFixed(1).replace(/\.0$/,'')+'m' : value>=1000 ? (value/1000).toFixed(1).replace(/\.0$/,'')+'k' : String(value);
const exact = value => value == null ? '暂无数据' : value.toLocaleString('zh-CN');
function dateTime(value) { const d=new Date(value);return Number.isNaN(d.getTime())?'时间未知':d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); }
function day(value) { const d=new Date(value);return Number.isNaN(d.getTime())?'未提供':d.toLocaleDateString('zh-CN'); }
const cachedPreferences=read('preferences',{});
const state={view:'trending',period:['daily','weekly','monthly'].includes(cachedPreferences.period)?cachedPreferences.period:'daily',language:cachedPreferences.language||'',topic:'all',search:'',sort:'rank',layout:cachedPreferences.layout==='list'?'list':'grid',theme:cachedPreferences.theme==='dark'?'dark':'light',reading:'all',repos:[],response:null,loading:false,error:null,ready:false,favorites:[],history:[],notes:{},readIds:[],hiddenIds:[],discoveries:[],previousVisitAt:null,revision:0,request:0,viewRequest:0,detailRequest:0,activeRepo:null,activeEntry:null,status:null,settings:null,localAI:{connected:false,available:false,authenticated:false,enabled:false,provider:'codex'}};
const periodLabels={daily:'本日',weekly:'本周',monthly:'本月'};
const titleLabels={daily:'今日热门',weekly:'本周热门',monthly:'本月热门'};
const languageLabels={'':'全部语言',python:'Python',typescript:'TypeScript',javascript:'JavaScript',go:'Go',rust:'Rust',java:'Java','c++':'C++',c:'C','c#':'C#',swift:'Swift',kotlin:'Kotlin',php:'PHP',ruby:'Ruby',shell:'Shell','jupyter-notebook':'Jupyter Notebook',html:'HTML',css:'CSS'};
async function request(url,{method='GET',data,timeout=25000}={}){
 if(standalone)return RadarExtension.request(url,{method,data,timeout});
 const endpoint=(typeof RADAR_API_BASE==='string'?RADAR_API_BASE:'')+url;
 let response;try{response=await fetch(endpoint,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Radar-Request':'local-ui'}:undefined,body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(timeout)});}catch(error){if(typeof RADAR_API_BASE==='string'&&error.name!=='TimeoutError')throw new Error('暂时连不上本机开源雷达，请双击桌面的「开源雷达 Web」启动服务，再重新连接。');throw error;}
 let body;try{body=await response.json();}catch{throw new Error('本机服务没有返回有效数据');}if(!response.ok)throw new Error(body.error||'暂时无法完成操作');return body;
}
const summaryProvider=()=>standalone?'codex':state.settings?.localModel?.provider||'codex';
const summaryButtonLabel=()=>standalone&&!state.localAI.connected?'连接本机 Codex（可选）':summaryProvider()==='codex'?'用 Codex 解读':'用离线模型速读';
const summaryModeHint=()=>standalone&&!state.localAI.connected?'浏览、收藏与笔记可以独立使用。中文解读可选连接这台电脑上的 Codex；只有你主动连接并生成时才会调用它，使用已有登录与 Codex 额度。':summaryProvider()==='codex'?'通过本机 Codex 调用云端模型，使用已有 ChatGPT 登录和 Codex 额度；只发送公开 README，不发送笔记。':'通过本机 Qwen 模型离线推理，不使用 Codex 额度；只参考公开 README。';
const post=(url,data={},timeout)=>request(url,{method:'POST',data,timeout});
function safeAction(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>toast(error.name==='TimeoutError'?'这次等待较久，请稍后重试。':error.message));}
function applyLibrary(library){
 state.revision=library.revision;state.favorites=library.favorites||[];state.history=library.history||[];state.notes=library.notes||{};state.readIds=library.readIds||[];state.hiddenIds=library.hiddenIds||[];
 $('storage-status').textContent=storageCopy('已存本机 · 每日自动备份','已存浏览器 · 记得导出备份');
}
let mutationQueue=Promise.resolve();
function mutate(action){const result=mutationQueue.then(()=>post('/api/library/mutate',action));mutationQueue=result.catch(()=>{});return result.then(library=>{applyLibrary(library);render();updateDetailSave();return library;});}
async function persistPreferences(){
 const preferences={period:state.period,language:state.language,layout:state.layout,theme:state.theme};
 save('preferences',preferences);if(state.ready)await mutate({type:'preferences',preferences});
}
function preferenceUI(){
 document.body.classList.toggle('dark',state.theme==='dark');$('theme-button').innerHTML=icon(state.theme==='dark'?'sun':'moon');$('theme-button').setAttribute('aria-label',state.theme==='dark'?'切换浅色模式':'切换深色模式');
 document.querySelectorAll('[data-period]').forEach(b=>{b.classList.toggle('selected',b.dataset.period===state.period);b.setAttribute('aria-pressed',String(b.dataset.period===state.period));});
 $('language-filter').value=state.language;if($('language-filter').selectedIndex<0){state.language='';$('language-filter').value='';}
 $('grid-button').classList.toggle('selected',state.layout==='grid');$('list-button').classList.toggle('selected',state.layout==='list');$('grid-button').setAttribute('aria-pressed',String(state.layout==='grid'));$('list-button').setAttribute('aria-pressed',String(state.layout==='list'));
 $('reading-filter').value=state.reading;$('sort-select').value=state.sort;
}
function isNew(id){const e=state.discoveries.find(e=>e.repo.id===id);return !!e&&(!state.previousVisitAt||Date.parse(e.firstSeenAt)>Date.parse(state.previousVisitAt));}
function collection(){return state.view==='trending'?state.repos:['discoveries','topics'].includes(state.view)?state.discoveries.map(e=>e.repo):state.view==='updates'?[]:(state[state.view]||[]).map(e=>e.repo);}
function entryFor(repo){return state.view==='trending'?null:(['discoveries','topics'].includes(state.view)?state.discoveries:state[state.view]||[]).find(e=>e.repo.id===repo.id);}
function filteredRepos({ignoreTopic=false}={}){
 let items=collection().filter(r=>{const hidden=state.hiddenIds.includes(r.id),tags=categories(r).map(t=>t[0]);return (state.reading==='hidden'?hidden:!hidden)&&(state.reading!=='unread'||!state.readIds.includes(r.id))&&(state.reading!=='new'||isNew(r.id))&&(!state.search||`${r.id} ${r.description} ${r.language} ${tags.join(' ')} ${state.notes[r.id]||''}`.toLowerCase().includes(state.search.toLowerCase()))&&(ignoreTopic||state.topic==='all'||tags.includes(state.topic));});
 if(state.view!=='trending'&&state.language)items=items.filter(r=>r.language.toLowerCase().replace(' ','-')===state.language);
 if(state.sort==='stars')items.sort((a,b)=>(b.stars||0)-(a.stars||0));if(state.sort==='growth'&&state.view==='trending')items.sort((a,b)=>(b.periodStars||0)-(a.periodStars||0));if(state.sort==='name')items.sort((a,b)=>a.id.localeCompare(b.id));return items;
}
function topicCounts(repos){const counts=Object.fromEntries(['all',...topicLabels].map(label=>[label,0]));for(const repo of repos){counts.all++;for(const [label] of categories(repo))counts[label]++;}return counts;}
function updateTopicCounts(){
 const globalCounts=topicCounts(state.discoveries.map(e=>e.repo).filter(r=>!state.hiddenIds.includes(r.id))),currentCounts=topicCounts(filteredRepos({ignoreTopic:true}));
 document.querySelectorAll('[data-topic]').forEach(button=>{const global=button.classList.contains('topic-nav'),count=(global?globalCounts:currentCounts)[button.dataset.topic]||0,badge=button.querySelector('[data-topic-count]');if(badge)badge.textContent=count;button.title=`${global?storageCopy('全部本机收录，排除已隐藏项目','全部浏览器收录，排除已隐藏项目'):'当前列表及其他筛选条件下'}：${count} 个项目；项目可以属于多个领域`;});
}
function snapshotSource(entry){if(!entry)return '';return `${periodLabels[entry.period]||'当期'}榜 · ${languageLabels[entry.language]||entry.language||'全部语言'} · ${dateTime(entry.fetchedAt)}`;}
function card(repo){
 const tags=categories(repo),entry=entryFor(repo),saved=state.favorites.some(e=>e.repo.id===repo.id),period=entry?.period||state.period,hidden=state.hiddenIds.includes(repo.id),seen=state.readIds.includes(repo.id);
 return `<article class="repo-card" data-repo="${escapeHTML(repo.id)}"><div class="card-header"><img class="owner-avatar" src="https://avatars.githubusercontent.com/${encodeURIComponent(repo.owner)}?s=80" alt="" loading="lazy" width="35" height="35"><div class="owner-info"><span class="owner-name">${escapeHTML(repo.owner)}</span><button class="repo-name" data-action="detail" title="查看 ${escapeHTML(repo.id)} 详情">${escapeHTML(repo.name)}</button></div><button class="bookmark-button ${saved?'saved':''}" data-action="save" aria-label="${saved?'取消收藏':'收藏'} ${escapeHTML(repo.id)}" aria-pressed="${saved}">${icon('bookmark')}</button></div><p class="card-description" title="${escapeHTML(repo.description)}">${escapeHTML(repo.description||'作者没有填写简介，可以打开详情生成中文速读。')}</p><div class="card-tags">${tags.map(([tag,cls])=>`<span class="category-tag ${cls}">${tag}</span>`).join('')}${isNew(repo.id)?'<span class="new-badge">新发现</span>':''}${seen?'<span class="read-badge">已读</span>':''}${state.notes[repo.id]?'<span class="category-tag">有笔记</span>':''}<span class="card-rank">${state.view==='trending'?'#'+String(repo.rank).padStart(2,'0'):storageCopy('本机记录','浏览器记录')}</span></div>${state.view==='topics'?`<p class="card-source">最近收录：${escapeHTML(snapshotSource(entry))}</p>`:''}<div class="card-metrics"><span title="${exact(repo.stars)} Stars">${icon('star')}<strong>${compact(repo.stars)}</strong></span><span title="${exact(repo.forks)} Forks">${icon('fork')}${compact(repo.forks)}</span><span class="language-label"><i class="language-dot" style="--lang-color:${escapeHTML(repo.languageColor)}"></i>${escapeHTML(repo.language)}</span></div><div class="card-footer"><span class="growth">${icon('trend')}<strong>${repo.periodStars==null?'—':'+'+exact(repo.periodStars)}</strong><small>${periodLabels[period]||'当期'}新增</small></span><div class="card-small-actions"><button class="hide-button" data-action="hide" title="${hidden?'重新显示项目':'在列表中隐藏，可以恢复'}">${hidden?'恢复显示':'隐藏'}</button><button class="detail-button" data-action="detail">速读 ${icon('arrow')}</button></div></div></article>`;
}
function empty(iconName,title,description,button,action){return `<div class="empty-state">${icon(iconName)}<h3>${title}</h3><p>${description}</p>${button?`<button class="primary-button" data-empty-action="${action}">${button}${icon('arrow')}</button>`:''}</div>`;}
function render(){
 const trending=state.view==='trending',topics=state.view==='topics',updates=state.view==='updates';
 const labels={trending:'热门趋势',topics:'领域发现',discoveries:'新发现',favorites:'我的收藏',history:'最近浏览',updates:'收藏动态'};
 $('sort-select').querySelector('[value="growth"]').disabled=!trending;
 $('sort-select').querySelector('[value="rank"]').textContent=trending?'榜单顺序':'记录顺序';if(!trending&&state.sort==='growth'){state.sort='rank';$('sort-select').value='rank';}
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false');});
 document.querySelectorAll('[data-topic]').forEach(b=>{b.classList.toggle(b.classList.contains('topic-nav')?'active':'selected',b.dataset.topic===state.topic&&(!b.classList.contains('topic-nav')||topics));b.setAttribute('aria-pressed',String(b.dataset.topic===state.topic&&(!b.classList.contains('topic-nav')||topics)));});
 updateTopicCounts();
 $('favorites-count').textContent=state.favorites.length;$('history-count').textContent=state.history.length;
 const newCount=state.discoveries.filter(e=>isNew(e.repo.id)&&!state.readIds.includes(e.repo.id)&&!state.hiddenIds.includes(e.repo.id)).length;
 $('discoveries-count').textContent=newCount;$('arrival-text').textContent=!state.ready?storageCopy('正在打开本机资料库…','正在打开浏览器资料库…'):!state.previousVisitAt?`开始积累灵感 · 已收录 ${state.discoveries.length} 个项目`:`上次之后，发现 ${newCount} 个未读项目`;
 $('breadcrumb-current').textContent=topics&&state.topic!=='all'?`领域发现 / ${state.topic}`:labels[state.view];
 const titles={trending:'好项目，值得被发现',topics:state.topic==='all'?'按领域，发现更多好项目':state.topic,discoveries:'新鲜灵感，接着看',favorites:'把灵感，留在手边',history:'走过的路，留下灵感',updates:'你关心的项目，有了新动静'};
 const subtitles={trending:'看见开源世界正在发生什么，找到下一个让你眼前一亮的项目。',topics:state.topic==='金融与量化'?'集中查看量化交易、策略回测、行情与金融数据项目；来自已收录的不同周期与语言榜。':`汇集已采集的不同周期与语言榜，共 ${state.discoveries.length} 个${storageCopy('本机','浏览器收录')}项目；一个项目可以属于多个领域。`,discoveries:storageCopy('本机首次收录的项目会标记为新发现；这里也保留已经下榜的项目。','浏览器首次收录的项目会标记为新发现；这里也保留已经下榜的项目。'),favorites:storageCopy('收藏、笔记留在本机数据库。清理浏览器后，依然可以找回来。','收藏和笔记保存在此浏览器的扩展中。卸载扩展或清理扩展数据会丢失，请定期导出。'),history:'最近看过的项目，随时回来接着探索。',updates:'跟进收藏项目的公开版本与归档状态，首次检查会建立基准。'};
 $('page-title').innerHTML=titles[state.view]+'<span class="title-dot">.</span>';$('page-subtitle').textContent=subtitles[state.view];
 $('brief').hidden=!trending;document.querySelector('.period-tabs').hidden=!trending;$('refresh-button').hidden=!trending;document.querySelector('.collection-toolbar').hidden=updates;$('collection-actions').hidden=state.view!=='favorites';$('repo-grid').hidden=updates;$('updates-panel').hidden=!updates;
 $('results-title').textContent=trending?titleLabels[state.period]:labels[state.view];$('filter-scope').textContent=topics?storageCopy('筛选全部本机收录 · 领域数量可以重叠','筛选全部浏览器收录 · 领域数量可以重叠'):trending?'筛选当前榜单 · 左侧领域发现可查看全部收录':'筛选当前列表 · 领域数量可以重叠';$('active-topic').textContent=state.topic==='all'?'':`/ ${state.topic}`;
 $('repo-grid').classList.toggle('list-view',state.layout==='list');$('repo-grid').setAttribute('aria-busy',String(state.loading&&trending));$('refresh-button').disabled=state.loading;$('refresh-button').classList.toggle('spinning',state.loading);
 const rows=filteredRepos();$('result-count').textContent=state.loading&&trending?'…':`${updates?state.favorites.length:rows.length} 个`;$('data-notice').hidden=true;
 if(!state.ready){$('repo-grid').innerHTML=empty('radar',storageCopy('正在打开本机资料库','正在打开浏览器资料库'),storageCopy('旧版收藏和笔记会自动合并，请稍等。','收藏与笔记保存在此浏览器的扩展中，请稍等。'));return;}
 if(updates){renderUpdates();return;}
 if(trending&&state.loading){$('repo-grid').innerHTML=Array.from({length:6},()=>'<article class="repo-card skeleton" aria-hidden="true"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></article>').join('');$('update-status').textContent='正在读取 GitHub 榜单…';}
 else if(trending&&state.error){$('repo-grid').innerHTML=empty('radar','暂时没连上 GitHub',escapeHTML(state.error),'再试一次','retry');$('update-status').textContent='连接暂时不可用';}
 else{
  $('repo-grid').innerHTML=rows.length?rows.map(card).join(''):empty(state.view==='favorites'?'bookmark':'search','暂时没有匹配的项目',state.view==='favorites'?'点击项目卡片上的书签，或者从备份导入收藏。':topics?storageCopy('当前本机收录中还没有符合这些条件的项目。可以清除筛选查看全部收录，或到设置扩大关注语言后采集。','当前浏览器收录中还没有符合条件的项目。可以清除筛选，或在设置里扩大关注范围后采集。'):'可以清除筛选，或稍后查看新的采集结果。','清除筛选','clear');
  $('update-status').textContent=trending&&state.response?`${state.response.stale?'缓存于':'更新于'} ${dateTime(state.response.fetchedAt)}`:topics?storageCopy('全部本机收录 · 数字为各自榜单快照','全部浏览器收录 · 数字为各自榜单快照'):storageCopy('本机数据库 · 收藏数字为保存时快照','浏览器本地保存 · 收藏数字为保存时快照');
  if(trending&&state.response?.stale){$('data-notice').hidden=false;$('data-notice').textContent=`${state.response.warning}。正在显示 ${dateTime(state.response.fetchedAt)} 的缓存。`;}
 }
 if(trending)updateBrief();$('source-link').href=trending?state.response?.source||'https://github.com/trending':'https://github.com/trending';$('source-link').innerHTML=(topics?storageCopy('GitHub 各期语言榜的本机收录','GitHub 各期语言榜的浏览器收录'):'GitHub Trending')+icon('external');
}
function updateBrief(){
 const top=state.repos[0];$('brief-title').innerHTML=state.loading?'正在发现新的好项目…':top?`<button data-featured="${escapeHTML(top.id)}">${escapeHTML(top.id)} ${icon('arrow')}</button>`:'保持好奇，下一次灵感就在路上';
 $('brief-description').textContent=state.loading?'读取真实榜单，稍等片刻就好。':top?`${periodLabels[state.period]}榜单首位 · ${top.description||'打开详情，读一份中文项目介绍。'}`:'可以稍后重试，或先看看已经收藏的项目。';
 $('stat-repos').textContent=state.repos.length||'—';$('stat-stars').textContent=state.repos.length?compact(state.repos.reduce((a,r)=>a+(r.periodStars||0),0)):'—';$('stat-languages').textContent=state.repos.length?new Set(state.repos.map(r=>r.language).filter(l=>l!=='未标注')).size:'—';$('stat-stars-label').textContent=`${periodLabels[state.period]}新增 Star`;
}
let discoveriesRequest=0;
async function loadDiscoveries(){const seq=++discoveriesRequest,entries=await request('/api/discoveries');if(seq===discoveriesRequest)state.discoveries=entries;}
async function loadTrending(refresh=false){
 if(state.view!=='trending')return;
 const seq=++state.request;state.loading=true;state.error=null;state.repos=[];state.response=null;render();
 try{const response=await request(`/api/trending?period=${state.period}&language=${encodeURIComponent(state.language)}${refresh?'&refresh=1':''}`);if(seq!==state.request)return;state.repos=response.data.map(cleanRepo).filter(Boolean);state.response=response;await loadDiscoveries();}
 catch(error){if(seq!==state.request)return;state.error=error.message;}
 finally{if(seq===state.request){state.loading=false;render();}}
}
async function switchView(view){
 if(!state.ready)return;const seq=++state.viewRequest;++state.request;state.loading=false;state.view=view;state.search='';state.topic='all';state.reading='all';$('search-input').value='';state.language='';preferenceUI();render();
 if(view==='trending')await loadTrending();else if(['discoveries','topics'].includes(view)){await loadDiscoveries();if(seq===state.viewRequest)render();}else if(view==='updates'){state.status=await request('/api/status');if(seq===state.viewRequest)renderUpdates();}
}
async function selectTopic(topic,{global=false}={}){
 if(!state.ready||!['all',...topicLabels].includes(topic))return;
 if(!global){state.topic=topic;render();return;}
 const seq=++state.viewRequest;++state.request;state.loading=false;state.error=null;state.view='topics';state.topic=topic;state.search='';state.language='';state.reading='all';state.sort='rank';$('search-input').value='';preferenceUI();render();
 try{await loadDiscoveries();if(seq===state.viewRequest)render();}catch(error){if(seq===state.viewRequest)toast(`暂时无法更新收录列表，仍可查看已加载项目：${error.message}`);}
}
function findRepo(id){return collection().find(r=>r.id===id)||state.repos.find(r=>r.id===id)||state.discoveries.find(e=>e.repo.id===id)?.repo||state.favorites.find(e=>e.repo.id===id)?.repo||state.history.find(e=>e.repo.id===id)?.repo;}
async function toggleSave(repo,sourceEntry){
 const exists=state.favorites.some(e=>e.repo.id===repo.id),entry=sourceEntry||entryFor(repo)||(state.activeRepo?.id===repo.id?state.activeEntry:null);
 await mutate({type:'favorite',repo,period:entry?.period||state.period,fetchedAt:entry?.fetchedAt||state.response?.fetchedAt,value:!exists});toast(exists?'已移出收藏，笔记仍保留':storageCopy('已保存到本机收藏','已保存到浏览器收藏'));
}
function updateDetailSave(){
 if(!state.activeRepo)return;const saved=state.favorites.some(e=>e.repo.id===state.activeRepo.id);if($('detail-save')){$('detail-save').innerHTML=icon(saved?'check':'bookmark')+(saved?'已收藏':'收藏项目');$('detail-save').setAttribute('aria-pressed',String(saved));}
 if($('detail-read'))$('detail-read').textContent=state.readIds.includes(state.activeRepo.id)?'标为未读':'标为已读';
}
let noteTimer,pendingNote=null,noteInFlight=null;
async function flushNote(){
 clearTimeout(noteTimer);while(noteInFlight)await noteInFlight;
 if(!pendingNote)return;const pending=pendingNote;pendingNote=null;
 noteInFlight=(async()=>{
  try{await mutate({type:'note',id:pending.id,text:pending.text});if(state.activeRepo?.id===pending.id&&$('repo-note')?.value===pending.text)$('note-status').textContent=storageCopy('已保存到本机数据库','已保存到浏览器资料库');}
  catch(error){if(!pendingNote)pendingNote=pending;if(state.activeRepo?.id===pending.id&&$('note-status')&&$('repo-note')?.value===pending.text)$('note-status').textContent='保存失败，笔记仍留在输入框，请重试';toast(error.message);throw error;}
 })();
 try{await noteInFlight;}finally{noteInFlight=null;}
}
async function openDetail(repo){
 await flushNote();const token=++state.detailRequest,entry=entryFor(repo),period=entry?.period||state.period,sourceEntry={period,fetchedAt:entry?.fetchedAt||state.response?.fetchedAt};state.activeRepo=repo;state.activeEntry=sourceEntry;
 $('detail-content').innerHTML=`<div class="detail-title"><img src="https://avatars.githubusercontent.com/${encodeURIComponent(repo.owner)}?s=120" alt="" width="52" height="52"><div><p>${escapeHTML(repo.owner)}</p><h2>${escapeHTML(repo.name)}</h2></div></div><p class="detail-description">${escapeHTML(repo.description||'作者尚未填写简介，可以根据 README 生成中文速读。')}</p><div class="detail-stats"><div><strong id="detail-stars">${compact(repo.stars)}</strong><span>累计 Star</span></div><div><strong id="detail-forks">${compact(repo.forks)}</strong><span>Fork</span></div><div><strong>${repo.periodStars==null?'—':'+'+exact(repo.periodStars)}</strong><span>${periodLabels[period]}新增 · 榜单快照</span></div></div><section class="summary-panel"><div class="summary-heading"><h3>${icon('sparkles')} 中文速读</h3><button class="soft-button" id="summary-button">${summaryButtonLabel()}</button></div><div id="summary-content" class="summary-content"><p class="local-model-note">${summaryModeHint()}</p></div></section><div id="detail-extra"><p class="detail-info">正在读取许可证、更新时间等信息…</p></div><div class="detail-actions"><a class="primary-button" href="https://github.com/${escapeHTML(repo.id)}" target="_blank" rel="noopener noreferrer">${icon('github')}打开 GitHub${icon('external')}</a><button class="soft-button" id="detail-save"></button><button class="soft-button" id="copy-button">${icon('copy')}复制克隆地址</button></div><div class="detail-reading"><button class="soft-button" id="detail-read">标为未读</button></div><label class="note-label" for="repo-note">我的小笔记<span>${storageCopy('自动保存到本机数据库','自动保存到浏览器资料库')}</span></label><textarea id="repo-note" class="note-input" maxlength="3000" placeholder="为什么收藏它？有什么值得试一试的地方…">${escapeHTML(state.notes[repo.id]||'')}</textarea><p class="detail-info" id="note-status">${storageCopy('私人笔记只存本机，不发送给 GitHub、Codex 或离线模型。','私人笔记只存此浏览器，不发送给 GitHub 或 Codex。请导出资料备份。')}</p><section class="timeline-panel"><h3>${storageCopy('本机','浏览器')}观测记录 · ${periodLabels[period]}榜</h3><div id="timeline-content" class="timeline-scroll">正在读取…</div></section>`;
 updateDetailSave();$('detail-save').onclick=safeAction(()=>toggleSave(repo,sourceEntry));$('detail-read').onclick=safeAction(()=>mutate({type:state.readIds.includes(repo.id)?'unread':'read',id:repo.id}));
 $('copy-button').onclick=safeAction(async()=>{await navigator.clipboard.writeText(`https://github.com/${repo.id}.git`);toast('已复制 Git 克隆地址');});
 $('summary-button').onclick=safeAction(()=>generateSummary(repo,token));
 $('repo-note').oninput=event=>{pendingNote={id:repo.id,text:event.target.value};$('note-status').textContent='正在保存…';clearTimeout(noteTimer);noteTimer=setTimeout(()=>safeAction(flushNote)(),450);};
 if(!$('detail-dialog').open)$('detail-dialog').showModal();
 safeAction(async()=>{await mutate({type:'history',repo,period,fetchedAt:sourceEntry.fetchedAt});await mutate({type:'read',id:repo.id});})();
 safeAction(async()=>{const rows=await request(`/api/timeline?name=${encodeURIComponent(repo.id)}&period=${period}`);if(token!==state.detailRequest)return;$('timeline-content').innerHTML=rows.length?`<table><thead><tr><th>观测时间</th><th>语言榜</th><th>Star</th><th>${periodLabels[period]}新增</th><th>排名</th></tr></thead><tbody>${rows.slice(-30).map(r=>`<tr><td>${dateTime(r.fetchedAt)}</td><td>${escapeHTML(languageLabels[r.language]||r.language)}</td><td>${exact(r.stars)}</td><td>${exact(r.periodStars)}</td><td>${r.rank}</td></tr>`).join('')}</tbody></table><p class="detail-info">只显示真实保存的快照；缺失日期不补造。不同语言榜的排名不直接比较。</p>`:'<p class="timeline-empty">还没有这个周期的记录，后续采集会逐步积累。</p>';})();
 try{const response=await request(`/api/repo?name=${encodeURIComponent(repo.id)}`);if(token!==state.detailRequest)return;const d=response.data;$('detail-stars').textContent=compact(d.stars);$('detail-forks').textContent=compact(d.forks);
 $('detail-extra').innerHTML=`<div class="detail-meta"><div><span>主要语言</span><strong>${escapeHTML(d.language||'未标注')}</strong></div><div><span>开源协议</span><strong>${escapeHTML(d.license)}</strong></div><div><span>最近推送</span><strong>${day(d.updatedAt)}</strong></div><div><span>创建时间</span><strong>${day(d.createdAt)}</strong></div><div><span>议题 / PR</span><strong>${exact(d.openIssues)}</strong></div><div><span>状态</span><strong>${d.archived?'已归档':'未归档'}</strong></div></div><div class="detail-tags">${(d.topics||[]).slice(0,12).map(t=>`<span class="category-tag">${escapeHTML(t)}</span>`).join('')}</div>${/^https?:\/\//.test(d.homepage||'')?`<a class="soft-button" href="${escapeHTML(d.homepage)}" target="_blank" rel="noopener noreferrer">访问项目网站 ${icon('external')}</a>`:''}<p class="detail-info">${response.stale?'使用缓存':'资料获取于'} ${dateTime(response.fetchedAt)} · GitHub 公开接口</p>`;
 }catch(error){if(token===state.detailRequest)$('detail-extra').innerHTML=`<p class="notice">${escapeHTML(error.message)}。${storageCopy('本机','浏览器')}收藏和笔记仍然可以使用。</p>`;}
}
async function generateSummary(repo,token){
 if(standalone&&!state.localAI.connected){await openSettings();return;}
 const button=$('summary-button');button.disabled=true;button.textContent=summaryProvider()==='codex'?'Codex 正在解读…':'离线模型正在阅读…';$('summary-content').innerHTML=`<p class="busy-inline">${icon('refresh')}${summaryProvider()==='codex'?'正在读取 README，并通过本机 Codex 联网解读，请稍等。':'正在读取 README 并在本机离线整理，请稍等。'}</p>`;
 try{const result=await post('/api/summary',{id:repo.id,provider:summaryProvider()},260000);if(token!==state.detailRequest)return;const fields=[['purpose','它能做什么'],['audience','适合谁'],['gettingStarted','如何开始'],['requirements','使用门槛'],['caveats','需要留意']];
 $('summary-content').innerHTML=`<dl>${fields.map(([k,label])=>`<dt>${label}</dt><dd>${escapeHTML(result[k]||'资料未说明')}</dd>`).join('')}</dl><p class="summary-source">${result.provider==='codex'?'本机 Codex · 联网解读':'离线模型'}：${escapeHTML(result.model)} · ${dateTime(result.generatedAt)}${result.cached?' · 已缓存':''}<br>模型整理可能有误，请结合 <a href="${escapeHTML(result.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始 README</a> 核对。</p>`;button.textContent='重新读取（可复用缓存）';
 }catch(error){if(token!==state.detailRequest)return;$('summary-content').innerHTML=`<p class="settings-warning">${escapeHTML(error.name==='TimeoutError'?'解读时间较长，请稍后重试；成功生成的结果会保留在本机缓存。':error.message)}</p>`;button.textContent='重试中文速读';}
 finally{if(token===state.detailRequest)button.disabled=false;}
}
async function exportFavorites(){await flushNote();const data=await request('/api/library/export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`开源雷达-${storageCopy('本机资料','浏览器资料')}-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast(storageCopy('已发起资料备份下载，Token 不包含在内','已发起资料备份下载；请妥善保存导出的文件'));}
async function importFavorites(file){if(!file)return;try{if(file.size>8*1024*1024)throw new Error('备份不能超过 8 MB');const payload=JSON.parse(await file.text());const library=await post('/api/library/import',{payload});applyLibrary(library);await loadDiscoveries();render();toast(storageCopy('备份已合并到本机数据库，已有笔记优先保留','资料已导入浏览器，已有笔记优先保留'));}finally{$('import-file').value='';}}
function renderUpdates(){
 const collection=state.status?.collection,updates=collection?.favoriteUpdates||[];
 $('update-status').textContent=collection?.running?'正在检查收藏动态…':collection?.watchCheckedAt?`检查于 ${dateTime(collection.watchCheckedAt)}`:'还没有检查记录';
 const toolbar=`<div class="update-toolbar"><button class="soft-button" id="check-updates" ${collection?.running?'disabled':''}>${icon('refresh')}检查收藏动态</button><span>只读取公开版本与归档状态，每个项目最多每 6 小时更新一次。</span></div>`;
 $('updates-panel').innerHTML=toolbar+(state.favorites.length?state.favorites.map(e=>{
  const u=updates.find(u=>u.id===e.repo.id);
  return `<article class="update-card"><h3>${escapeHTML(e.repo.id)}</h3>${!u?'<p>尚未检查。可点击上方按钮，额度不足时稍后继续。</p>':`<span class="status-chip ${u.newRelease||u.archiveChanged?'good':''}">${u.newRelease?'发现新版本':u.archiveChanged?'归档状态变化':u.baseline?'首次记录':'已检查'}</span><p>${u.latest?`最新记录：<a href="${escapeHTML(u.latest.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(u.latest.name||u.latest.tagName)}</a> · ${day(u.latest.publishedAt)}`:'最近查询的发布记录中没有稳定版本。'}</p><p>${u.archived?'项目已归档':'项目未归档'}</p><p class="detail-info">${dateTime(u.checkedAt)} · 仅检查最近公开发布记录</p>`}</article>`;
 }).join(''):empty('bookmark','先收藏几个喜欢的项目','收藏之后，这里会帮你跟进公开版本和归档状态。'));
 if(collection?.watchWarning){$('data-notice').hidden=false;$('data-notice').textContent=collection.watchWarning;}
 $('check-updates').onclick=safeAction(async()=>{await post('/api/favorites/check');state.status=await request('/api/status');renderUpdates();toast(storageCopy('已开始在本机检查，结果会自动更新','已开始检查收藏，请保持新标签页打开'));});
}
function connectionText(connection){
 if(!connection)return '尚未检查';
 if(connection.nextRetryAt&&Date.parse(connection.nextRetryAt)>Date.now())return `额度暂时受限，${dateTime(connection.nextRetryAt)} 后重试`;
 if(connection.remaining!==null)return `剩余 ${connection.remaining} / ${connection.limit} 次 · ${dateTime(connection.resetAt)} 重置`;
 return connection.configured?'已配置 Token，尚未检查连接':'免 Token 模式 · 尚未检查额度';
}
async function openSettings(){
 $('settings-content').innerHTML=`<p>${storageCopy('正在读取本机设置…','正在读取浏览器设置…')}</p>`;if(!$('settings-dialog').open)$('settings-dialog').showModal();
 [state.settings,state.status]=await Promise.all([request('/api/settings'),request('/api/status')]);if(standalone)await refreshStandaloneAI();renderSettings();
}
function renderSettings(){
 if(standalone)return renderStandaloneSettings();
 const s=state.settings,info=state.status,c=s.collector,status=info.collection,model=info.model,connection=info.connection;
 $('settings-content').innerHTML=`<section class="settings-section"><h3>${icon('radar')}关注范围与后台采集 <span class="status-chip ${c.enabled?'good':''}">${c.enabled?'已开启':'已暂停'}</span></h3><p>网页关闭后仍可收集。电脑关机、休眠或未登录时不采集，恢复后继续读取当前榜单。</p><div class="settings-row"><label><input id="collector-enabled" type="checkbox" ${c.enabled?'checked':''}>开启后台采集</label><label>更新间隔 <select id="collector-interval">${[[60,'每小时'],[120,'每 2 小时'],[240,'每 4 小时'],[720,'每 12 小时'],[1440,'每天']].map(([v,l])=>`<option value="${v}" ${v===c.intervalMinutes?'selected':''}>${l}</option>`).join('')}</select></label></div><p>关注周期</p><div class="choice-grid">${Object.entries(periodLabels).map(([v,l])=>`<label><input name="collect-period" type="checkbox" value="${v}" ${c.periods.includes(v)?'checked':''}>${l}榜</label>`).join('')}</div><p>关注语言（最多 8 个，全部语言榜不会自动遍历每种语言）</p><div class="choice-grid">${Object.entries(languageLabels).map(([v,l])=>`<label><input name="collect-language" type="checkbox" value="${v}" ${c.languages.includes(v)?'checked':''}>${l}</label>`).join('')}</div><label class="settings-checkbox"><input id="watch-releases" type="checkbox" ${c.watchReleases?'checked':''}>顺便检查收藏项目的公开版本与归档状态</label><div class="settings-row"><button class="primary-button" id="save-settings">保存关注设置</button><button class="soft-button" id="run-collection" ${status.running||!c.enabled?'disabled':''}>${status.running?'正在采集…':'现在采集一次'}</button></div><p id="collector-state">${status.running?'正在采集':status.lastFinishedAt?'最近完成：'+dateTime(status.lastFinishedAt):'等待首次采集'}${c.enabled&&status.nextRunAt?' · 下次：'+dateTime(status.nextRunAt):''}</p>${status.error?`<p class="settings-warning">${escapeHTML(status.error)}</p>`:''}<div id="collector-boards" class="small-list">${status.boards.map(b=>`<div><span>${periodLabels[b.period]} · ${escapeHTML(languageLabels[b.language]||b.language)}<br><small>${b.fetchedAt?dateTime(b.fetchedAt):'未成功'}${b.error?' · '+escapeHTML(b.error):''}</small></span><span class="status-chip ${b.stale?'warn':'good'}">${b.count===null?'失败':b.count+' 个'}${b.stale?' · 缓存':''}</span></div>`).join('')}</div></section>
 <section class="settings-section"><h3>${icon('sparkles')}中文解读方式 <span class="status-chip ${model.installed?'good':'warn'}">${model.provider==='codex'?'本机 Codex':'本机离线模型'}</span></h3><p>${escapeHTML(model.model||'中文速读')} · ${escapeHTML(model.message||model.state||'按需启动')}</p><label class="settings-checkbox"><input id="model-enabled" type="checkbox" ${s.localModel.enabled?'checked':''}>允许在项目详情里生成中文解读</label><label class="settings-provider">解读方式 <select id="summary-provider"><option value="codex" ${s.localModel.provider==='codex'?'selected':''}>本机 Codex · 联网解读</option><option value="local" ${s.localModel.provider==='local'?'selected':''}>Qwen 离线模型 · 本机推理</option></select></label><p>Codex 使用现有 ChatGPT 登录，会把公开 README 发给 OpenAI 并使用 Codex 额度；不需要额外 API Key。离线模型在本机推理、闲置后释放内存。两种方式都不读取私人笔记，也不会自动互相切换。</p><button class="soft-button" id="save-model">保存解读设置</button>${model.lastError?`<p class="settings-warning">${escapeHTML(model.lastError)}</p>`:''}</section>
 <section class="settings-section"><h3>${icon('github')}GitHub 连接 <span class="status-chip">${connection.configured?'已配置 Token':'免 Token'}</span></h3><p>${escapeHTML(connectionText(connection))}</p>${connection.lastError?`<p class="settings-warning">${escapeHTML(connection.lastError)}</p>`:''}<div class="settings-row"><input id="github-token" type="password" autocomplete="new-password" placeholder="可选：粘贴 GitHub Token" aria-label="GitHub Token"><button class="soft-button" id="save-token">保存 Token</button><button class="soft-button" id="check-connection">检查连接</button>${connection.configured?'<button class="soft-button" id="clear-token">移除 Token</button>':''}</div><p>Token 只保存在本机受限文件，用于 GitHub 接口；不会返回网页、发给模型或进入备份。不填也可以查看公开榜单。</p></section>
 <section class="settings-section"><h3>${icon('download')}本机资料与备份</h3><p>收藏 ${state.favorites.length} 个 · 笔记 ${Object.values(state.notes).filter(Boolean).length} 条 · 已收录 ${state.discoveries.length} 个项目。每天自动保留一份数据库备份，最近 14 份循环保存。</p><div class="settings-row"><button class="soft-button" id="create-backup">立即备份</button><button class="soft-button" id="export-library">导出资料 JSON</button><button class="soft-button" id="import-library">导入旧版 / 新版资料</button></div><div class="small-list">${info.backups.slice(0,8).map(b=>`<div><span>${dateTime(b.createdAt)} · ${b.kind==='auto'?'自动':b.kind==='manual'?'手动':'恢复前'}<br><small>${Math.ceil(b.size/1024)} KB · 数据库备份</small></span><button data-restore="${escapeHTML(b.name)}">恢复这份备份</button></div>`).join('')||'<p>还没有备份，可以点击“立即备份”。</p>'}</div></section>
 <section class="settings-section"><h3>已隐藏的项目 <span class="status-chip">${state.hiddenIds.length}</span></h3><p>隐藏只影响列表展示，收藏和笔记仍然保留。</p><div class="small-list">${state.hiddenIds.slice(0,30).map(id=>`<div><span>${escapeHTML(id)}</span><button data-unhide="${escapeHTML(id)}">恢复显示</button></div>`).join('')||'<p>没有隐藏的项目。</p>'}</div></section>`;
 $('save-settings').onclick=safeAction(async()=>{
  const languages=Array.from(document.querySelectorAll('[name=collect-language]:checked')).map(e=>e.value),periods=Array.from(document.querySelectorAll('[name=collect-period]:checked')).map(e=>e.value);
  if(!languages.length||languages.length>8||!periods.length)throw new Error('请选择 1–8 个语言榜，以及至少一个周期');
  const settings={...state.settings,collector:{enabled:$('collector-enabled').checked,intervalMinutes:Number($('collector-interval').value),languages,periods,watchReleases:$('watch-releases').checked}};
  state.settings=await post('/api/settings',settings);state.status=await request('/api/status');renderSettings();toast('采集设置已保存在本机');
 });
 $('save-model').onclick=safeAction(async()=>{state.settings=await post('/api/settings',{...state.settings,localModel:{enabled:$('model-enabled').checked,provider:$('summary-provider').value}});state.status=await request('/api/status');renderSettings();toast('中文解读方式已保存，重新打开详情即可使用');});
 $('run-collection').onclick=safeAction(async()=>{await post('/api/collection/run');state.status=await request('/api/status');renderSettings();toast('已开始采集，结果会自动更新');});
 $('save-token').onclick=safeAction(async()=>{const token=$('github-token').value.trim();if(!token)throw new Error('请先填写 Token');await post('/api/token',{token});$('github-token').value='';state.status=await request('/api/status');renderSettings();toast('Token 已保存在本机受限文件');});
 if($('clear-token'))$('clear-token').onclick=safeAction(async()=>{await post('/api/token/clear');state.status=await request('/api/status');renderSettings();toast('已移除本机 Token');});
 $('check-connection').onclick=safeAction(async()=>{const b=$('check-connection');b.disabled=true;try{await post('/api/connection/check');state.status=await request('/api/status');renderSettings();}finally{b.disabled=false;}});
 $('create-backup').onclick=safeAction(async()=>{await post('/api/backups/create');state.status=await request('/api/status');renderSettings();toast('已创建本机数据库备份');});
 $('export-library').onclick=safeAction(exportFavorites);$('import-library').onclick=()=>$('import-file').click();
 document.querySelectorAll('[data-unhide]').forEach(b=>b.onclick=safeAction(async()=>{await mutate({type:'unhide',id:b.dataset.unhide});renderSettings();}));
 document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{$('restore-name').textContent=b.dataset.restore;$('restore-dialog').showModal();});
}
function refreshSummaryConnectionUI(){
 if(!state.activeRepo)return;
 const button=$('summary-button');if(button&&!button.disabled)button.textContent=summaryButtonLabel();
 const panel=$('summary-content');if(panel&&!panel.innerHTML.includes('<dl>'))panel.innerHTML=`<p class="local-model-note">${summaryModeHint()}</p>`;
}
async function refreshStandaloneAI(){
 if(!standalone)return;
 if(typeof RadarLocalAI!=='undefined')try{state.localAI=await RadarLocalAI.status();}catch{state.localAI={connected:false,available:false,authenticated:false,enabled:false,provider:'codex',message:'暂时无法读取本机连接状态；浏览、收藏与笔记仍可独立使用。'};}
 refreshSummaryConnectionUI();
}
function renderStandaloneSettings(){
 const c=state.settings.collector,info=state.status,status=info.collection,connection=info.connection,ai=state.localAI;
 $('settings-content').innerHTML=`<section class="settings-section"><h3>${icon('radar')}新标签页采集 <span class="status-chip ${c.enabled?'good':''}">${c.enabled?'已开启':'已暂停'}</span></h3><p>只有开源雷达新标签页打开时才会按关注范围采集；关闭所有雷达页面后停止。下次打开时继续读取当前榜单，不补造历史。</p><div class="settings-row"><label><input id="collector-enabled" type="checkbox" ${c.enabled?'checked':''}>页面打开时自动采集</label><label>更新间隔 <select id="collector-interval">${[[60,'每小时'],[120,'每 2 小时'],[240,'每 4 小时'],[720,'每 12 小时'],[1440,'每天']].map(([v,l])=>`<option value="${v}" ${v===c.intervalMinutes?'selected':''}>${l}</option>`).join('')}</select></label></div><p>关注周期</p><div class="choice-grid">${Object.entries(periodLabels).map(([v,l])=>`<label><input name="collect-period" type="checkbox" value="${v}" ${c.periods.includes(v)?'checked':''}>${l}榜</label>`).join('')}</div><p>关注语言（最多 8 个，全部语言榜不会自动遍历每种语言）</p><div class="choice-grid">${Object.entries(languageLabels).map(([v,l])=>`<label><input name="collect-language" type="checkbox" value="${v}" ${c.languages.includes(v)?'checked':''}>${l}</label>`).join('')}</div><label class="settings-checkbox"><input id="watch-releases" type="checkbox" ${c.watchReleases?'checked':''}>页面打开时检查收藏项目的公开版本与归档状态</label><div class="settings-row"><button class="primary-button" id="save-settings">保存关注设置</button><button class="soft-button" id="run-collection" ${status.running||!c.enabled?'disabled':''}>${status.running?'正在采集…':'现在采集一次'}</button></div><p id="collector-state">${status.running?'正在采集':status.lastFinishedAt?'最近完成：'+dateTime(status.lastFinishedAt):'等待首次采集'}${c.enabled&&status.nextRunAt?' · 页面保持打开时下次：'+dateTime(status.nextRunAt):''}</p>${status.error?`<p class="settings-warning">${escapeHTML(status.error)}</p>`:''}<div id="collector-boards" class="small-list">${status.boards.map(b=>`<div><span>${periodLabels[b.period]} · ${escapeHTML(languageLabels[b.language]||b.language)}<br><small>${b.fetchedAt?dateTime(b.fetchedAt):'未成功'}${b.error?' · '+escapeHTML(b.error):''}</small></span><span class="status-chip ${b.stale?'warn':'good'}">${b.count===null?'失败':b.count+' 个'}${b.stale?' · 缓存':''}</span></div>`).join('')}</div></section>
 <section class="settings-section"><h3>${icon('sparkles')}连接本机 Codex（可选） <span class="status-chip ${ai.connected&&ai.available?'good':''}">${ai.connected?'已授权连接':'默认不连接'}</span></h3><p>${escapeHTML(ai.message||'无需连接本机服务，即可使用榜单、收藏、笔记与备份。')}</p><p>主动连接时，浏览器会询问是否允许访问这台电脑的开源雷达服务。Codex 使用现有登录与套餐额度，联网解读公开 README；私人笔记不参与生成。可随时断开并撤销访问权限。</p><div class="settings-row"><button class="soft-button" id="connect-local-ai">${ai.connected?'重新检查本机 Codex':'连接本机 Codex（可选）'}</button>${ai.connected?'<button class="soft-button" id="disconnect-local-ai">断开并撤销权限</button>':''}</div><p id="local-ai-message" role="status"></p></section>
 <section class="settings-section"><h3>${icon('github')}GitHub 匿名连接 <span class="status-chip">无需账号或密钥</span></h3><p>${escapeHTML(connectionText(connection))}</p>${connection.lastError?`<p class="settings-warning">${escapeHTML(connection.lastError)}</p>`:''}<button class="soft-button" id="check-connection">检查匿名额度</button><p>公开榜单直接从 GitHub 获取。详情与收藏动态使用匿名接口；额度不足时保留已有记录，等待额度恢复。扩展不保存 GitHub Token。</p></section>
 <section class="settings-section"><h3>${icon('download')}浏览器资料与备份</h3><p>收藏 ${state.favorites.length} 个 · 笔记 ${Object.values(state.notes).filter(Boolean).length} 条 · 已收录 ${state.discoveries.length} 个项目。资料仅保存在此浏览器的扩展中，不会自动同步到其他设备。</p><p>浏览器资料备份只包含收藏、笔记、浏览历史、偏好，以及已读和隐藏标记；不包含收录库、榜单缓存或本机连接授权。最多保留最近 14 份备份。</p><p class="settings-warning">卸载扩展或清理扩展数据会同时删除资料和扩展内备份。请定期导出 JSON 文件，放到自己保管的文件夹。</p><div class="settings-row"><button class="soft-button" id="create-backup">备份浏览器资料</button><button class="soft-button" id="export-library">导出资料 JSON</button><button class="soft-button" id="import-library">导入资料 JSON</button></div><div class="small-list">${info.backups.slice(0,8).map(b=>`<div><span>${dateTime(b.createdAt)} · ${b.kind==='auto'?'自动':b.kind==='manual'?'手动':'恢复前'}<br><small>${Math.ceil(b.size/1024)} KB · 浏览器资料备份</small></span><button data-restore="${escapeHTML(b.name)}">恢复这份备份</button></div>`).join('')||'<p>还没有备份，可以点击“备份浏览器资料”。</p>'}</div></section>
 <section class="settings-section"><h3>缓存与数据来源</h3><p>榜单、项目详情与收录记录缓存在此浏览器中。联网失败时尽量显示上次成功结果，并注明缓存时间；缓存不是实时数据。采集仅在新标签页打开期间运行，清理或卸载扩展会失去这些记录。</p></section>
 <section class="settings-section"><h3>已隐藏的项目 <span class="status-chip">${state.hiddenIds.length}</span></h3><p>隐藏只影响列表展示，收藏和笔记仍然保留。</p><div class="small-list">${state.hiddenIds.slice(0,30).map(id=>`<div><span>${escapeHTML(id)}</span><button data-unhide="${escapeHTML(id)}">恢复显示</button></div>`).join('')||'<p>没有隐藏的项目。</p>'}</div></section>`;
 $('save-settings').onclick=safeAction(async()=>{
  const languages=Array.from(document.querySelectorAll('[name=collect-language]:checked')).map(e=>e.value),periods=Array.from(document.querySelectorAll('[name=collect-period]:checked')).map(e=>e.value);
  if(!languages.length||languages.length>8||!periods.length)throw new Error('请选择 1–8 个语言榜，以及至少一个周期');
  state.settings=await post('/api/settings',{...state.settings,collector:{enabled:$('collector-enabled').checked,intervalMinutes:Number($('collector-interval').value),languages,periods,watchReleases:$('watch-releases').checked}});state.status=await request('/api/status');renderSettings();toast('关注设置已保存在此浏览器');
 });
 $('run-collection').onclick=safeAction(async()=>{await post('/api/collection/run');state.status=await request('/api/status');renderSettings();toast('已开始采集，请保持新标签页打开');});
 // Permission requests must run in the click handler, before any promise or await.
 $('connect-local-ai').onclick=()=>{
  if(typeof RadarLocalAI==='undefined'){toast('当前扩展未提供本机连接功能，其他功能仍可使用');return;}
  let pending;try{pending=RadarLocalAI.connect();}catch(error){toast(error.message);return;}
  const button=$('connect-local-ai');button.disabled=true;$('local-ai-message').textContent='正在请求授权并检查连接…';
  Promise.resolve(pending).then(async result=>{state.localAI=result;[state.settings,state.status]=await Promise.all([request('/api/settings'),request('/api/status')]);renderSettings();refreshSummaryConnectionUI();$('local-ai-message').textContent=result.message||'连接状态已更新';}).catch(error=>{button.disabled=false;$('local-ai-message').textContent=error.message;toast(error.message);});
 };
 if(ai.connected)$('disconnect-local-ai').onclick=safeAction(async()=>{state.localAI=await RadarLocalAI.disconnect();[state.settings,state.status]=await Promise.all([request('/api/settings'),request('/api/status')]);renderSettings();refreshSummaryConnectionUI();toast('已断开本机 Codex；浏览器资料仍保留');});
 $('check-connection').onclick=safeAction(async()=>{const button=$('check-connection');button.disabled=true;try{await post('/api/connection/check');state.status=await request('/api/status');renderSettings();}finally{button.disabled=false;}});
 $('create-backup').onclick=safeAction(async()=>{await flushNote();await post('/api/backups/create');state.status=await request('/api/status');renderSettings();toast('已创建浏览器资料备份，建议另外导出文件');});
 $('export-library').onclick=safeAction(exportFavorites);$('import-library').onclick=()=>$('import-file').click();
 document.querySelectorAll('[data-unhide]').forEach(b=>b.onclick=safeAction(async()=>{await mutate({type:'unhide',id:b.dataset.unhide});renderSettings();}));
 document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{$('restore-name').textContent=b.dataset.restore;$('restore-dialog').showModal();});
}
function configureStandaloneUI(){
 const text=(selector,value)=>{const element=document.querySelector(selector);if(element)element.textContent=value;};
 text('.local-badge','浏览器独立运行');text('.settings-intro','资料保存在此浏览器的扩展中；基本功能无需本机服务、账号或密钥。');text('#settings-button','设置与浏览器资料');text('#collection-actions>span','收藏和笔记保存在此浏览器，请定期导出到文件夹。');text('#restore-dialog>h2','恢复这份浏览器资料备份？');
 $('top-settings').setAttribute('aria-label','设置与浏览器资料');$('top-settings').title='设置与浏览器资料';
 const note=document.querySelector('.local-note');if(note)note.innerHTML='<span class="status-dot"></span>你的浏览器开源角落<p>资料留在浏览器，记得导出备份。</p>';
 const intro=document.querySelector('#help-dialog .help-intro');if(intro)intro.textContent='扩展直接获取公开榜单，收藏和笔记保存在此浏览器。无需账号或密钥；本机 Codex 是可选功能。';
 const sections=document.querySelector('#help-dialog .help-sections');if(sections)sections.innerHTML='<section><h3>01 · 打开新标签页就能逛</h3><p>切换日榜、周榜、月榜和编程语言读取 GitHub Trending。领域发现汇集此浏览器已收录的项目，一个项目可以属于多个领域；分类依据名称和简介推断，可能有遗漏。</p></section><section><h3>02 · 把喜欢的留在浏览器</h3><p>收藏、笔记、历史和阅读标记保存在此浏览器的扩展中，不会给 GitHub 账号点 Star，也不会自动同步到其他设备。卸载扩展或清理扩展数据会丢失，请定期导出资料 JSON。</p></section><section><h3>03 · 看清榜单与快照</h3><p>累计 Star 和当期新增来自相应 GitHub 榜单。收藏保存当时的项目快照；不同周期的新增数量不直接比较。新发现表示此浏览器首次收录，并不代表刚创建。</p></section><section><h3>04 · 采集与备份的边界</h3><p>只有雷达新标签页打开时才采集，关闭所有雷达页面后停止。网络异常时保留已有缓存并注明时间。扩展内备份只保留收藏、笔记、历史、偏好和阅读标记，最多 14 份；卸载扩展也会删除这些备份，导出文件请自行保管。</p></section><section><h3>05 · 中文解读可以稍后连接</h3><p>基本功能无需本机服务。需要中文解读时，可在设置中主动连接本机 Codex，浏览器会请求访问权限。Codex 使用已有登录与额度联网解读公开 README；笔记不参与生成。可以随时断开并撤销权限。</p></section>';
 const footer=document.querySelector('.content-footer>span');if(footer)footer.innerHTML='<span class="status-dot"></span> 来源 <a id="source-link" href="https://github.com/trending" target="_blank" rel="noopener noreferrer">GitHub Trending</a><span class="footer-divider">·</span>仅雷达新标签页打开时采集 · 资料保存在浏览器';
 const restore=document.querySelector('#restore-dialog>p');if(restore)restore.textContent='收藏、笔记、历史、偏好和阅读标记会恢复到所选备份。恢复前会保存当前资料备份；收录库、榜单缓存和本机连接授权不受影响。';
}
async function bootstrap(){
 try{
  let library;[library,state.settings]=await Promise.all([request('/api/library'),request('/api/settings')]);if(standalone)await refreshStandaloneAI();
  const old=read('library',null),oldFavorites=old?.favorites??read('favorites',[]),oldNotes=old?.notes??read('notes',{}),oldHistory=read('history',[]);
  let migrationId=read('migration-id',null);if(!migrationId){migrationId=crypto.randomUUID();save('migration-id',migrationId);}
  if(!read('migration-done',false)&&(oldFavorites.length||Object.keys(oldNotes).length||oldHistory.length)){
   library=await post('/api/library/import',{payload:{favorites:oldFavorites,notes:oldNotes,history:oldHistory,preferences:read('preferences',{})},migrationId});save('migration-done',true);toast(storageCopy('旧浏览器资料已合并到本机数据库','旧资料已合并到扩展资料库'));
  }
  applyLibrary(library);state.previousVisitAt=library.lastVisitAt||null;
  const p=library.preferences||{};if(p.period)state.period=p.period;if(typeof p.language==='string')state.language=p.language;if(p.theme)state.theme=p.theme;if(p.layout)state.layout=p.layout;
  state.ready=true;preferenceUI();await loadDiscoveries();render();await mutate({type:'markVisit'});await loadTrending();
 }catch(error){$('repo-grid').innerHTML=empty('help',storageCopy('本机资料库暂时未能打开','浏览器资料库暂时未能打开'),escapeHTML(error.message),'重新连接','reload');$('storage-status').textContent=storageCopy('尚未连接，旧浏览器资料未删除','暂时无法读取浏览器资料，请重新打开此页；不会主动删除已有数据');}
}
// UI bootstrap boundary; no account credentials are read from browser storage.
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
if(standalone)configureStandaloneUI();
$('today-date').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'});$('today-weekday').textContent=new Date().toLocaleDateString('zh-CN',{weekday:'long'});preferenceUI();
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=safeAction(()=>switchView(button.dataset.view)));
document.querySelectorAll('[data-period]').forEach(button=>button.onclick=safeAction(async()=>{if(state.period===button.dataset.period||!state.ready)return;state.period=button.dataset.period;preferenceUI();await persistPreferences();await loadTrending();}));
document.querySelectorAll('[data-topic]').forEach(button=>button.onclick=safeAction(()=>selectTopic(button.dataset.topic,{global:button.classList.contains('topic-nav')})));
$('language-filter').onchange=safeAction(async event=>{state.language=event.target.value;await persistPreferences();if(state.view==='trending')await loadTrending();else render();});
$('search-input').oninput=event=>{state.search=event.target.value.trim();render();};$('sort-select').onchange=event=>{state.sort=event.target.value;render();};$('reading-filter').onchange=event=>{state.reading=event.target.value;render();};
$('refresh-button').onclick=safeAction(()=>loadTrending(true));
$('theme-button').onclick=safeAction(async()=>{state.theme=state.theme==='dark'?'light':'dark';preferenceUI();await persistPreferences();});
$('grid-button').onclick=safeAction(async()=>{state.layout='grid';preferenceUI();render();await persistPreferences();});$('list-button').onclick=safeAction(async()=>{state.layout='list';preferenceUI();render();await persistPreferences();});
$('repo-grid').onclick=safeAction(async event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.emptyAction){const action=button.dataset.emptyAction;if(action==='reload')return bootstrap();if(action==='retry')return loadTrending(true);if(action==='trending')return switchView('trending');state.topic='all';state.language='';state.search='';state.reading='all';$('search-input').value='';preferenceUI();if(state.view==='trending')await loadTrending();else render();return;}
 if(!state.ready)return;const repo=findRepo(button.closest('[data-repo]')?.dataset.repo);if(!repo)return;
 if(button.dataset.action==='save')await toggleSave(repo);else if(button.dataset.action==='hide'){await mutate({type:state.hiddenIds.includes(repo.id)?'unhide':'hide',id:repo.id});toast('已更新显示状态，可在设置中恢复隐藏项目');}else if(button.dataset.action==='detail')await openDetail(repo);
});
$('brief-title').onclick=safeAction(event=>{const id=event.target.closest('[data-featured]')?.dataset.featured;if(id){const repo=findRepo(id);if(repo)return openDetail(repo);}});
$('new-arrivals').onclick=safeAction(async()=>{await switchView('discoveries');state.reading=state.previousVisitAt?'new':'unread';preferenceUI();render();});
[$('settings-button'),$('top-settings')].forEach(b=>b.onclick=safeAction(openSettings));
[$('help-button'),$('footer-help')].forEach(b=>b.onclick=()=>$('help-dialog').showModal());
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=safeAction(async()=>{if(b.closest('dialog').id==='detail-dialog')await flushNote();b.closest('dialog').close();}));
$('detail-dialog').addEventListener('cancel',event=>{event.preventDefault();safeAction(async()=>{await flushNote();$('detail-dialog').close();})();});
$('detail-dialog').addEventListener('close',()=>{state.detailRequest++;state.activeRepo=null;state.activeEntry=null;render();});
$('cancel-restore').onclick=()=>$('restore-dialog').close();$('confirm-restore').onclick=safeAction(async()=>{await flushNote();const result=await post('/api/backups/restore',{name:$('restore-name').textContent});applyLibrary(result.library);await loadDiscoveries();$('restore-dialog').close();state.status=await request('/api/status');renderSettings();render();toast('已恢复。恢复前的数据也已自动保留备份。');});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();$('search-input').focus();}});
$('export-button').onclick=safeAction(exportFavorites);$('import-button').onclick=()=>$('import-file').click();$('import-file').onchange=safeAction(event=>importFavorites(event.target.files[0]));
window.addEventListener('beforeunload',event=>{if(pendingNote||noteInFlight){event.preventDefault();event.returnValue='';}});
let polling=false;
setInterval(safeAction(async()=>{
 if(document.hidden||!state.ready||polling)return;polling=true;
 try{
  if(state.view==='updates'||$('settings-dialog').open){const status=await request('/api/status');state.status=status;if(state.view==='updates')renderUpdates();if($('settings-dialog').open&&$('collector-state')){const c=status.collection;$('collector-state').textContent=(c.running?'正在采集…':c.lastFinishedAt?'最近完成：'+dateTime(c.lastFinishedAt):'等待首次采集')+(state.settings.collector.enabled&&c.nextRunAt?storageCopy(' · 下次：',' · 页面保持打开时下次：')+dateTime(c.nextRunAt):'');$('run-collection').disabled=c.running||!state.settings.collector.enabled;$('run-collection').textContent=c.running?'正在采集…':'现在采集一次';$('collector-boards').innerHTML=c.boards.map(b=>`<div><span>${periodLabels[b.period]} · ${escapeHTML(languageLabels[b.language]||b.language)}<br><small>${b.fetchedAt?dateTime(b.fetchedAt):'未成功'}${b.error?' · '+escapeHTML(b.error):''}</small></span><span class="status-chip ${b.stale?'warn':'good'}">${b.count===null?'失败':b.count+' 个'}${b.stale?' · 缓存':''}</span></div>`).join('');}}
  if(!document.querySelector('dialog[open]')){const library=await request('/api/library');if(library.revision!==state.revision)applyLibrary(library);await loadDiscoveries();render();}
 }finally{polling=false;}
}),15000);
setInterval(()=>{if(state.view==='trending'&&!document.hidden&&!state.loading&&!document.querySelector('dialog[open]'))safeAction(()=>loadTrending())();},30*60*1000);
bootstrap();
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 register({name:'read_visible_projects',title:'读取当前项目列表',description:'读取看板筛选后的公开项目，不包含私人笔记。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:input=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('不需要参数');return {view:state.view,period:state.period,projects:filteredRepos().map(r=>({id:r.id,description:r.description,stars:r.stars,language:r.language,url:r.url}))};}});
 register({name:'set_trending_filters',title:'切换热门榜单',description:'切换当前页面的公开热门榜单周期、语言和关键词。',inputSchema:{type:'object',properties:{period:{type:'string',enum:['daily','weekly','monthly']},language:{type:'string'},search:{type:'string',maxLength:200}},required:['period'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(!state.ready||!input||!['daily','weekly','monthly'].includes(input.period)||Object.keys(input).some(k=>!['period','language','search'].includes(k))||!Object.hasOwn(languageLabels,input.language||'')||input.search!==undefined&&(typeof input.search!=='string'||input.search.length>200))throw new Error('筛选条件无效');state.view='trending';state.period=input.period;state.language=input.language||'';state.search=input.search||'';state.topic='all';state.reading='all';$('search-input').value=state.search;preferenceUI();await persistPreferences();await loadTrending();return {ok:!state.error,error:state.error,count:filteredRepos().length};}});
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
