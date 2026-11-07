// Run from the SillyTavern server directory. AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { atomic } from './storage.js';
const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(String(pkg.name).toLowerCase()!=='sillytavern')throw Error('SillyTavern 서버 폴더로 이동한 뒤 실행해 줘.');
const file=path.join(root,'config.yaml'),text=fs.readFileSync(file,'utf8');
const entries=[...text.matchAll(/^enableServerPlugins:[^\r\n]*$/gm)];
if(entries.length>1)throw Error('config.yaml에 enableServerPlugins가 여러 번 있어. 직접 확인해 줘.');
if(entries.length && !/^enableServerPlugins:\s*(true|false)\s*(?:#.*)?$/.test(entries[0][0]))throw Error('enableServerPlugins 값을 직접 true로 설정해 줘.');
const next=entries.length?text.replace(/^enableServerPlugins:\s*(true|false)/m,'enableServerPlugins: true'):text.replace(/\s*$/,'')+'\nenableServerPlugins: true\n';
if(next!==text){const backup=file+'.archive-lore-'+Date.now()+'.bak';fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);atomic(file,next);console.log('서버 플러그인 활성화 설정 완료. 기존 config.yaml 백업을 남겼어.');}
else console.log('서버 플러그인이 이미 활성화돼 있어.');
console.log('실리태번 서버를 재시작한 뒤 Archive Lore → 서버에서 실행을 켜 줘.');
