const repo='https://github.com/foreverharibo-boop/archive-lore';
let toastTimer;
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
  try {await navigator.clipboard.writeText(repo);const t=document.querySelector('#toast');t.textContent='설치 주소를 복사했습니다. 실리태번에 붙여 넣어 주세요.';t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3200);}
  catch {const d=document.querySelector('#copy-fallback');d.showModal();d.querySelector('input').select();}
}));
const input=document.querySelector('#guide-search');
const sections=[...document.querySelectorAll('.guide-section')];
const links=[...document.querySelectorAll('.toc a')];
function filter(){const query=input.value.trim().toLocaleLowerCase();let found=0;sections.forEach(section=>{const matches=!query||section.textContent.toLocaleLowerCase().includes(query);section.hidden=!matches;if(matches)found++;const link=links.find(a=>a.dataset.section===section.id);if(link)link.hidden=!matches;});document.querySelector('.search-status').textContent=query?`${found}개 섹션을 찾았습니다.`:'';document.querySelector('#no-results').hidden=found!==0;}
input.addEventListener('input',filter);
document.querySelector('#clear-search').addEventListener('click',()=>{input.value='';filter();input.focus();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();document.querySelector('#guide').scrollIntoView();document.querySelector('.sidebar').classList.add('is-open');document.querySelector('.mobile-toc').setAttribute('aria-expanded','true');input.focus();}});
const tocButton=document.querySelector('.mobile-toc');tocButton.addEventListener('click',()=>{const expanded=tocButton.getAttribute('aria-expanded')!=='true';tocButton.setAttribute('aria-expanded',String(expanded));document.querySelector('.sidebar').classList.toggle('is-open',expanded);});
links.forEach(link=>link.addEventListener('click',()=>{tocButton.setAttribute('aria-expanded','false');document.querySelector('.sidebar').classList.remove('is-open');}));
const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){links.forEach(link=>{const active=link.dataset.section===entry.target.id;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});}});},{rootMargin:'-12% 0px -70% 0px'});sections.forEach(s=>observer.observe(s));
let scheduled=false;window.addEventListener('scroll',()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{const max=document.documentElement.scrollHeight-innerHeight;document.querySelector('.reading-progress span').style.width=`${max?100*scrollY/max:0}%`;scheduled=false;});},{passive:true});
