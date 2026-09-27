import {mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'extension'),output=resolve(root,'browser-extension');
await mkdir(resolve(output,'icons'),{recursive:true});
const manifest=JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3||manifest.chrome_url_overrides?.newtab!=='newtab.html'||manifest.host_permissions?.join(',')!=='https://github.com/*,https://api.github.com/*'||!manifest.key)throw new Error('独立扩展配置不一致');
const $=load(await readFile(resolve(root,'public/index.html'),'utf8'));
$('title').text('开源雷达 · 新标签页');
$('meta[name=description]').attr('content',manifest.description);
$('script').remove();
for(const script of ['storage.js','github-client.js','local-ai.js','api.js','app.js','bridge.js'])$('head').append(`<script src="${script}" defer></script>`);
for(const node of $('link[href],img[src],a[href]').toArray()){
 const el=$(node),attr=el.attr('src')?'src':'href',value=el.attr(attr);
 if(value==='/')el.attr(attr,'newtab.html');else if(['/icon.svg','/style.css'].includes(value))el.attr(attr,value.slice(1));
}
$('.local-note').html('<span class="status-dot"></span>你的浏览器开源角落<p>无需账号，收藏与笔记留在浏览器。</p>');
$('.local-badge').html('<span class="status-dot"></span>独立运行');
$('.sidebar-footer').html('<span>为好奇心，留一扇窗。</span><span>扩展 v2.0</span>');
$('#settings-button').html('<span data-icon="settings"></span>设置与本地数据');
$('#top-settings').attr('aria-label','设置与本地数据').attr('title','设置与本地数据');
$('.workspace-label').each((_,node)=>{$(node).text($(node).text().replace('全部本机收录','全部浏览器收录'));});
$('#filter-scope').text('筛选当前榜单 · 左侧领域发现可查看全部浏览器收录');
$('#brief-description').text('直接读取 GitHub 公开榜单，无需安装本机服务。');
$('#arrival-text').text('正在打开浏览器资料库…');
$('#storage-status').text('浏览器本地存储');
$('#collection-actions>span').text('收藏与笔记只保存在本浏览器；导出一份文件可防止清理数据时丢失。');
$('.content-footer').html('<span><span class="status-dot"></span> 来源 <a id="source-link" href="https://github.com/trending" target="_blank" rel="noopener noreferrer">GitHub Trending <span data-icon="external"></span></a><span class="footer-divider">·</span>新标签页打开期间自动采集 · 关闭后暂停</span><a href="privacy.html" target="_blank" rel="noopener noreferrer">隐私说明</a><button id="footer-help">数据与使用说明<span data-icon="arrow"></span></button>');
$('.help-intro').text('安装后直接发现开源项目，无需账号、密钥或本机服务。收藏和笔记留在浏览器里，中文 AI 解读为可选增强。');
$('.help-sections').html(`<section><h3>01 · 直接看榜单</h3><p>今日、本周、本月和语言榜直接读取 GitHub Trending。来源、更新时刻和缓存状态均可查看。GitHub 暂时无法访问时保留上次成功数据，不把错误页面当成空榜，也不补造数据。</p></section>
<section><h3>02 · 发现更多领域</h3><p>左侧领域汇总本浏览器已收录的多语言榜单，包含 AI、开发工具、数据分析、金融与量化和学习资源。首次打开时会逐步补充多个榜单。领域由名称和简介推断，可能重叠或遗漏；新发现表示首次被这个浏览器收录，不代表项目刚创建。</p></section>
<section><h3>03 · 数据留在浏览器</h3><p>收藏、笔记、阅读状态和历史保存在当前浏览器的扩展数据库，不会给 GitHub 账号点 Star，也不跨设备同步。每日首次使用可生成本地备份；这些备份与资料在同一浏览器内，卸载扩展或清除站点数据可能一起删除。请定期导出 JSON 到电脑。可导入原桌面版导出的资料，两个版本的资料库独立保存。</p></section>
<section><h3>04 · 按你的节奏采集</h3><p>至少保留一个开源雷达新标签页时，按关注范围和间隔检查榜单；关闭全部标签页、浏览器退出或电脑休眠时暂停，不保证浏览器节能状态下准点执行，回来后再继续。收藏动态每次最多检查 10 个项目。公开 API 有额度限制，额度耗尽时保留缓存和本地资料。</p></section>
<section><h3>05 · 可选本机 Codex</h3><p>基础功能不需要 AI。设置中主动连接后才申请访问本机配套服务；使用者需要自己安装并登录 Codex。只有点击生成时才读取公开 README 并发送给 OpenAI，使用使用者自己的 Codex 额度；私人笔记不参与生成。断开连接会撤销扩展访问本机服务的权限。</p></section>`);
$('.settings-intro').text('数据保存在当前浏览器，不需要本机服务。请定期导出备份，可选连接自己的本机 Codex。');
$('#restore-dialog>h2').text('恢复这份浏览器备份？');
$('#restore-dialog>p').first().text('当前收藏、笔记和历史会恢复到所选备份状态。恢复前会保存当前资料，便于撤回；采集设置不受影响。');
await writeFile(resolve(output,'newtab.html'),$.html());
await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
for(const file of ['app.js','style.css','icon.svg'])await copyFile(resolve(root,'public',file),resolve(output,file));
for(const file of ['bridge.js','storage.js','github-client.js','api.js','local-ai.js','privacy.html'])await copyFile(resolve(source,file),resolve(output,file));
for(const size of [16,32,48,128])await copyFile(resolve(source,`icons/${size}.png`),resolve(output,`icons/${size}.png`));
await rm(resolve(output,'connection.css'),{force:true});
const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
console.log(`独立扩展已构建：${output}\n开发版扩展 ID：${id}\n商店上传时使用 npm run package:extension 生成的专用 ZIP`);
