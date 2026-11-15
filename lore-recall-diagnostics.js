// Archive Lore — AGPL-3.0-only
// Bounded excerpts for inspection, never a second copy of source/AI bodies.
export const RECALL_REVIEW_CHARS = 24000;
const clip=(value,size)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>size?text.slice(0,size)+'…':text;};
const key=u=>JSON.stringify([u.entryId??u.id,u.index]);
const describe=u=>`${clip(u.id,100)} [${clip(u.entryId??u.id,100)} #${u.index??'?'}] ${clip(u.title,90)}${Number.isFinite(u.score)?` · 유사도 ${u.score.toFixed(4)}`:''}\n  ${clip(u.text,140)}${u.reason?` · 선택 근거: ${clip(u.reason,140)}`:''}`;
function sample(rows,limit,render=describe){
    let text='',shown=0;
    for(const row of rows){const line=render(row)+'\n';if(text.length+line.length>limit)break;text+=line;shown++;}
    return `표시 ${shown}/${rows.length}개${shown<rows.length?' · 나머지는 진단 표시 한도로 생략 (실제 선별·주입과 무관)':''}\n`+text;
}
export function createRecallAudit(sanitize=value=>value){
    const parts=new Map();
    const set=(name,text,limit)=>parts.set(name,clipBlock(sanitize(text),limit));
    const add=(name,text,limit)=>set(name,(parts.get(name)||'')+text,limit);
    const cleanUnit=u=>({id:clip(sanitize(u.id),100),entryId:clip(sanitize(u.entryId??u.id),100),index:u.index,
        title:clip(sanitize(u.title),90),text:sanitize(String(u.text??'')).slice(0,140),reason:sanitize(String(u.reason??'')).slice(0,140),score:u.score});
    const sampled=(rows,limit)=>sample(rows,limit,u=>describe(cleanUnit(u)));
    return {
        capture(stage,data={}){
            switch(stage){
                case 'search.queries':
                    set('검색 질문·질의',`방식: ${data.mode} · 정책: ${data.policy}\n`+sample(data.queries||[],1700,q=>clip(sanitize(q),350)),1900);break;
                case 'retrieval.cache':{
                    const chunks=data.chunks||[];
                    set('검색 가능 여부',`전체 ${chunks.length}구간 · 임베딩 있음 ${chunks.filter(c=>c.hit).length} · 미임베딩 ${chunks.filter(c=>!c.hit).length}구간`,400);break;
                }
                case 'retrieval.empty':set('빈 검색',String(data.reason||'')+` · 미임베딩 ${data.pending??0}구간`,400);break;
                case 'search.ranking':{
                    const rows=data.ranked||[],offered=rows.filter(r=>r.offered),outside=rows.filter(r=>!r.offered);
                    set('검색 후보',`순위 계산 ${rows.length}구간 · 후보 채택 ${offered.length} · 후보 밖 ${outside.length} · 순위 제외 ${data.notRanked?.length||0}\n`+sampled(offered,4300),4600);
                    set('후보 밖 기록',sampled(outside,1000),1200);break;
                }
                case 'selection.plan':set('선별 계획',`정책 ${data.policy} · 원문 ${data.units}단위 · ${data.batches}묶음 · 동시 처리 ${data.concurrency}`,500);break;
                case 'selection.validated':{
                    const accepted=data.accepted||[],offered=data.offered||[];
                    const covered=new Set(accepted.flatMap(u=>[u,...(u.requiredContext||[])]).map(key));
                    const contexts=new Map(accepted.flatMap(u=>u.requiredContext||[]).filter(u=>!accepted.some(a=>key(a)===key(u))).map(u=>[key(u),u]));
                    const unselected=offered.filter(u=>!covered.has(key(u)));
                    add('묶음별 선별 집계',`묶음 ${data.batch??1}: 검토 ${offered.length} · 선택 중심 문장 ${accepted.length} · 연결 문장 ${contexts.size} · 미선택 ${unselected.length}\n`,1400);
                    add('AI 선택·연결 문장',`[묶음 ${data.batch??1}]\n`+sampled([...accepted,...contexts.values()],4200),4600);
                    add('AI 미선택',`[묶음 ${data.batch??1}] 개별 탈락 이유는 모델이 반환하지 않아 알 수 없음.\n`+sampled(unselected,3400),3800);break;
                }
                case 'injection.budget':{
                    const kept=data.kept||[],dropped=data.dropped||[];
                    set('주입 한도 적용',`상한 ${data.limit}토큰 · 사용 ${data.tokens}토큰 · 유지 ${kept.length}원문 단위 · 빠진 중심 문장 ${dropped.length}개\n빠진 항목 (예산·중복 정리 등; 개별 원인은 반환되지 않음):\n`+sampled(dropped,2100),2500);break;
                }
                case 'injection.prepared':
                    set('주입 준비 완료',`후보 ${data.candidateTotal}구간 · 선별 원문 ${data.selected?.length||0}단위 · ${data.tokens}토큰 · 코어 ${String(data.core||'').length}자 · 안내 ${data.guidanceTokens||0}토큰\n`+sampled(data.selected||[],1800)+'\n아직 프롬프트 등록 확인 전. 전체 원문은 기존 주입 내용 보기에서 확인.',2200);break;
                case 'injection.installed':case 'injection.reserved':
                    set('프롬프트 등록',`${stage==='injection.installed'?'주입 슬롯 등록 완료 (최종 API 전송·모델 준수 여부는 별도)':'서버 주입 예약 (설치 완료 아님)'}\n`+sample(data.slots||[],650,s=>`${clip(sanitize(s.name),100)} · ${String(s.text||'').length}자 · ${s.position} · 깊이 ${s.depth}`)+`선택 항목 ${data.selected?.length||0}개`,900);break;
                default:return false;
            }
            return true;
        },
        text(){return [...parts].map(([name,text])=>`[${name}]\n${text}`).join('\n\n').slice(0,RECALL_REVIEW_CHARS);},
    };
}
function clipBlock(text,limit){return text.length>limit?text.slice(0,limit-70)+'\n… 진단 표시 한도로 이후 내용 생략 (실제 선별·주입과 무관)':text;}
