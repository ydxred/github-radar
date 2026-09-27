import {mkdirSync,readFileSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {LANGUAGES,PERIODS} from './github.mjs';
const dir=resolve(process.env.GITHUB_TOP_DATA||'data'),file=resolve(dir,'settings.json');
const defaults={collector:{enabled:true,intervalMinutes:120,languages:['','python','typescript','javascript','go','rust','java','c++'],periods:['daily','weekly'],watchReleases:true},localModel:{enabled:true,provider:'codex'}};
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['collector','localModel'].includes(k)))throw Object.assign(new Error('设置格式无效'),{status:400});
 const c=input.collector,m=input.localModel;
 if(!c||typeof c.enabled!=='boolean'||![60,120,240,720,1440].includes(c.intervalMinutes)||!Array.isArray(c.languages)||!c.languages.length||c.languages.length>8||c.languages.some(v=>!LANGUAGES.includes(v))||!Array.isArray(c.periods)||!c.periods.length||c.periods.some(v=>!PERIODS.includes(v))||typeof c.watchReleases!=='boolean'||!m||typeof m.enabled!=='boolean'||m.provider!==undefined&&!['codex','local'].includes(m.provider))throw Object.assign(new Error('请选择有效的采集周期与语言'),{status:400});
 return {collector:{enabled:c.enabled,intervalMinutes:c.intervalMinutes,languages:[...new Set(c.languages)],periods:[...new Set(c.periods)],watchReleases:c.watchReleases},localModel:{enabled:m.enabled,provider:m.provider||'codex'}};
}
export function getSettings(){try{return validate(JSON.parse(readFileSync(file,'utf8')));}catch{return structuredClone(defaults);}}
export function saveSettings(input){const value=validate(input);mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);writeFileSync(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});renameSync(file+'.tmp',file);return value;}
