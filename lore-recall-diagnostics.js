// Archive Lore — AGPL-3.0-only
// Compact overview plus complete recall evidence. No raw API/vector payloads.
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
    const parts=new Map(),details=new Map();
    const fullUnit=u=>`${u.id??''} [${u.entryId??u.id??''} #${u.index??'?'}] ${u.title??''}\n${u.text??''}`;
    const detail=(name,text)=>details.set(name,String(sanitize(text)));
    const injection=(label,slots)=>detail('injection',`[${label}]\n`+slots.map(s=>`--- ${s.name} · ${String(s.text??'').length}자 ---\n${s.text??''}\n--- 끝: ${s.name} ---`).join('\n\n'));
    const set=(name,text,limit)=>parts.set(name,clipBlock(sanitize(text),limit));
    const add=(name,text,limit)=>set(name,(parts.get(name)||'')+text,limit);
    const cleanUnit=u=>({id:clip(sanitize(u.id),100),entryId:clip(sanitize(u.entryId??u.id),100),index:u.index,
        title:clip(sanitize(u.title),90),text:sanitize(String(u.text??'')).slice(0,140),reason:sanitize(String(u.reason??'')).slice(0,140),score:u.score});
    const sampled=(rows,limit)=>sample(rows,limit,u=>describe(cleanUnit(u)));
    return {
        capture(stage,data={}){
            switch(stage){
                case 'search.queries':
                    detail('queries','[검색 질문·질의 전체]\n'+(data.queries||[]).map((q,i)=>`${i+1}. ${q}`).join('\n'));
                    set('검색 질문·질의',`방식: ${data.mode} · 정책: ${data.policy}\n`+sample(data.queries||[],1700,q=>clip(sanitize(q),350)),1900);break;
                case 'retrieval.cache':{
                    const chunks=data.chunks||[];
                    set('검색 가능 여부',`전체 ${chunks.length}구간 · 임베딩 있음 ${chunks.filter(c=>c.hit).length} · 미임베딩 ${chunks.filter(c=>!c.hit).length}구간`,400);break;
                }
                case 'retrieval.empty':set('빈 검색',String(data.reason||'')+` · 미임베딩 ${data.pending??0}구간`,400);break;
                case 'search.ranking':{
                    const rows=data.ranked||[],offered=rows.filter(r=>r.offered),outside=rows.filter(r=>!r.offered);
                    detail('candidates',`[검색 후보 목록 전체 · ${offered.length}구간]\n`+offered.map(u=>data.policy==='cosine-similarity'?fullUnit(u):`${u.id??''} #${u.index??'?'} · ${u.title??''} · 점수 ${u.score??'없음'}`).join('\n\n'));
                    set('검색 후보',`순위 계산 ${rows.length}구간 · 후보 채택 ${offered.length} · 후보 밖 ${outside.length} · 순위 제외 ${data.notRanked?.length||0}\n`+sampled(offered,4300),4600);
                    set('후보 밖 기록',sampled(outside,1000),1200);break;
                }
                case 'selection.plan':set('선별 계획',`정책 ${data.policy} · 원문 ${data.units}단위 · ${data.batches}묶음 · 동시 처리 ${data.concurrency}`,500);break;
                case 'selection.invalid':{
                    const batch=data.batch??'?',attempt=data.attempt??'?';
                    const response=String(data.response??'');
                    detail(`selection-error:${batch}`,`[선별 형식 오류 · 묶음 ${batch}/${data.batchCount??'?'} · 시도 ${attempt}]\n${data.message||''}\n`+
                        `[검사 상세]\n${JSON.stringify(data.details||{},null,2)}\n`+
                        `[해당 묶음의 허용 ID · 항목별]\n`+(data.offered||[]).map(u=>`${u.id} · ${u.entryId}`).join('\n')+
                        `\n[마지막 실패 응답 · 미검증, 주입되지 않음]\n${response.slice(0,32000)}${response.length>32000?'\n… 실패 응답 표시 32,000자 한도':''}`);
                    add('선별 오류·재시도',`묶음 ${batch} · 시도 ${attempt}: ${data.message||'형식 검사 실패'}\n`,1400);break;
                }
                case 'selection.validated':{
                    if(data.contextOverflowRecovered)add('선별 오류·재시도',`묶음 ${data.batch??'?'} · 시도 ${data.attempt}: 연결 개수 초과 복구 · 전체 ID 재검증 · 원문 연결 유지 · 주입 예산 별도 적용\n`,1400);
                    else if(data.attempt>1)add('선별 오류·재시도',`묶음 ${data.batch??'?'} · 시도 ${data.attempt}: 수정 응답 재검증 성공\n`,1400);
                    const accepted=data.accepted||[],offered=data.offered||[];
                    const covered=new Set(accepted.flatMap(u=>[u,...(u.requiredContext||[])]).map(key));
                    const contexts=new Map(accepted.flatMap(u=>u.requiredContext||[]).filter(u=>!accepted.some(a=>key(a)===key(u))).map(u=>[key(u),u]));
                    const unselected=offered.filter(u=>!covered.has(key(u)));
                    const anchors=new Map(accepted.map(u=>[key(u),u]));
                    detail(`selection:${data.batch??1}`,`[선별 검토 원문 전체 · 묶음 ${data.batch??1} · ${offered.length}단위]\n`+offered.map(u=>{
                        const anchor=anchors.get(key(u)),parents=accepted.filter(a=>(a.requiredContext||[]).some(c=>key(c)===key(u)));
                        const state=anchor?'선택 중심 문장':covered.has(key(u))?'연결 맥락으로 선택':'미선택';
                        return `[${state}] ${fullUnit(u)}\n`+(anchor?`선택 근거: ${anchor.reason||'모델이 반환하지 않음'}\n우선순위: ${anchor.priority??'없음'}\n연결 ID: ${(anchor.requiredContext||[]).map(c=>c.id).join(', ')||'없음'}\n`:parents.length?`연결된 중심 문장: ${parents.map(a=>a.id).join(', ')}\n`:'미선택 사유: 모델이 반환하지 않아 알 수 없음\n');
                    }).join('\n'));
                    add('묶음별 선별 집계',`묶음 ${data.batch??1}: 검토 ${offered.length} · 선택 중심 문장 ${accepted.length} · 연결 문장 ${contexts.size} · 미선택 ${unselected.length}\n`,1400);
                    add('AI 선택·연결 문장',`[묶음 ${data.batch??1}]\n`+sampled([...accepted,...contexts.values()],4200),4600);
                    add('AI 미선택',`[묶음 ${data.batch??1}] 개별 탈락 이유는 모델이 반환하지 않아 알 수 없음.\n`+sampled(unselected,3400),3800);break;
                }
                case 'injection.budget':{
                    const kept=data.kept||[],dropped=data.dropped||[];
                    detail('budget','[주입 한도 적용 후 빠진 중심 문장 전체]\n'+(dropped.length?dropped.map(fullUnit).join('\n\n'):'없음'));
                    set('주입 한도 적용',`상한 ${data.limit}토큰 · 사용 ${data.tokens}토큰 · 유지 ${kept.length}원문 단위 · 빠진 중심 문장 ${dropped.length}개\n빠진 항목 (예산·중복 정리 등; 개별 원인은 반환되지 않음):\n`+sampled(dropped,2100),2500);break;
                }
                case 'injection.prepared':
                    injection('주입 준비 원문 전체 · 아직 프롬프트 등록 확인 전',[{name:'검색 기억',text:data.recalled},{name:'코어',text:data.core},{name:'답변 안내',text:data.guidance}]);
                    set('주입 준비 완료',`후보 ${data.candidateTotal}구간 · 선별 원문 ${data.selected?.length||0}단위 · ${data.tokens}토큰 · 코어 ${String(data.core||'').length}자 · 안내 ${data.guidanceTokens||0}토큰\n`+sampled(data.selected||[],1800)+'\n준비 단계 시점: 프롬프트 등록 확인 전. 전체 원문 블록을 함께 확인.',2200);break;
                case 'injection.installed':case 'injection.reserved':
                    if(stage==='injection.installed')injection('실제 주입 슬롯에 등록한 원문 전체',data.slots||[]);
                    // Reserved Relay markers are not recalled memories or installed output.
                    set('프롬프트 등록',`${stage==='injection.installed'?'주입 슬롯 등록 완료 (최종 API 전송·모델 준수 여부는 별도)':'서버 주입 예약 (설치 완료 아님)'}\n`+sample(data.slots||[],650,s=>`${clip(sanitize(s.name),100)} · ${String(s.text||'').length}자 · ${s.position} · 깊이 ${s.depth}`)+`선택 항목 ${data.selected?.length||0}개`,900);break;
                default:return false;
            }
            return true;
        },
        text(){return [...parts].map(([name,text])=>`[${name}]\n${text}`).join('\n\n').slice(0,RECALL_REVIEW_CHARS);},
        // Strings only, retaining exact source text and newlines without excerpt caps.
        // Put final injection first so a copied log is immediately useful.
        details(){return [details.get('injection'),...Array.from(details).filter(([name])=>name!=='injection').map(([,text])=>text)].filter(Boolean).join('\n\n');},
    };
}
function clipBlock(text,limit){return text.length>limit?text.slice(0,limit-70)+'\n… 진단 표시 한도로 이후 내용 생략 (실제 선별·주입과 무관)':text;}
