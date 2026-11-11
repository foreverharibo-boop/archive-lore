// Archive Lore — AGPL-3.0-only.
import {nextCollectionRange} from './lore-native-progress.js';
export function createHomeContext({settings,markers,length,book,books=[],changeBook,changeProfile,editProfile,newProfile,connection,collectionStatus}) {
    const box=document.createElement('section');box.className='al-home-context';
    const status=document.createElement('p');status.className='al-home-notice';status.setAttribute('role','status');
    const run=async(action,control)=>{control.disabled=true;try{await action();}catch(e){status.textContent=e.message;}finally{control.disabled=false;}};
    const button=(text,action)=>{const b=document.createElement('button');b.type='button';b.className='menu_button';b.textContent=text;b.onclick=()=>run(action,b);return b;};
    const bookRow=document.createElement('div');bookRow.className='al-context-book';
    const title=document.createElement('div'),label=document.createElement('small'),name=document.createElement('strong');
    label.textContent='저장할 로어북';name.textContent=book || '연결된 로어북 없음';title.append(label,name);
    bookRow.append(title,button(book?'변경':'연결',changeBook));box.append(bookRow);
    const others=books.filter(name=>name!==book);
    if(others.length){const extra=document.createElement('small');extra.className='al-connected-books';extra.textContent='함께 연결됨 · '+others.join(', ');box.append(extra);}
    const row=document.createElement('div');row.className='al-context-profile';
    const profileLabel=document.createElement('label'),heading=document.createElement('span');heading.className='al-profile-heading';heading.textContent='수집 프로필';profileLabel.append(heading);
    const select=document.createElement('select');select.className='text_pole';select.id='al-quick-profile';
    for(const [index,p] of (settings.profiles || []).entries())select.append(new Option(p.isBuiltinCurrentST?'기본 수집':p.name,String(index)));
    select.value=String(settings.defaultProfile ?? 0);profileLabel.append(select);
    select.onchange=()=>run(async()=>{try{await changeProfile(Number(select.value));}catch(e){select.value=String(settings.defaultProfile ?? 0);throw e;}},select);
    const actions=document.createElement('div');actions.className='al-context-actions';actions.append(button('편집',editProfile),button('추가',newProfile));
    row.append(profileLabel,actions);box.append(row);
    if(connection)box.append(connection);
    const range=nextCollectionRange(markers,length),progress=document.createElement('div');progress.className='al-next-collection';
    const last=document.createElement('small');last.textContent=range.highest>=0?`저장 완료 #${range.highest}까지`:'아직 수집한 대화가 없습니다';
    const next=document.createElement('strong');next.textContent=range.count?`다음 수집 #${range.start}–#${range.end} · ${range.count}개`:'새로 수집할 메시지가 없습니다';progress.append(last,next);if(collectionStatus)progress.append(collectionStatus);box.append(progress,status);
    return box;
}
