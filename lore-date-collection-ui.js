// Archive Lore — AGPL-3.0-only.
import { planDateCollection, validateDateRanges } from './lore-date-collection.js';

export function createDateCollectionEditor({ messages, start, end, collect, onBusy = () => {}, document: doc = globalThis.document }) {
    const box = doc.createElement('section'); box.className = 'al-date-collection';
    const heading = doc.createElement('h4'); heading.textContent = '날짜별 수집 · 구간 확인';
    const help = doc.createElement('p');
    help.textContent = '본문의 날짜 제목·인포패널 표기를 기준으로 나눕니다. 날짜 없는 메시지는 직전 날짜를 따릅니다. 날짜·시작 번호를 확인하고 수정해 주세요. 날짜를 비우면 날짜 미상으로 저장합니다. 한 메시지 안의 여러 날짜는 자동 분리하지 않습니다.';
    const rows = doc.createElement('div'), actions = doc.createElement('div'), status = doc.createElement('p');
    actions.className = 'al-range-actions'; status.setAttribute('role','status');
    box.append(heading,help,rows,actions,status);
    let plan = planDateCollection(messages,start,end), busy = false;
    const read = () => validateDateRanges(plan.map((row,i) => ({ ...row, end: (plan[i+1]?.start ?? end+1)-1 })),start,end);
    const action = (label, fn) => {
        const b = doc.createElement('button'); b.type='button'; b.className='menu_button'; b.textContent=label; b.onclick=fn; actions.append(b); return b;
    };
    const add = action('구간 추가', () => {
        try {
            const range = read().filter(r => r.end > r.start).sort((a,b) => (b.end-b.start)-(a.end-a.start))[0];
            if (!range) throw Error('더 나눌 수 있는 메시지 구간이 없습니다.');
            const index = plan.findIndex(row => row.start === range.start);
            plan.splice(index+1,0,{ start: Math.floor((range.start+range.end)/2)+1, date: range.date, evidence:'직접 추가한 구간' });
            render();
        } catch(e) { status.textContent=e.message; }
    });
    const run = action('이 구간으로 날짜별 수집', async () => {
        if (busy) return;
        try {
            const ranges = read(); busy=true; onBusy(true); render();
            const result = await collect(ranges, p => { status.textContent=`${p.saved}/${p.total}개 저장 · ${p.range.date || '날짜 미상'} (#${p.range.start}–#${p.range.end}) 수집 중`; });
            status.textContent=`날짜별 수집 완료 · 기억 ${result.saved}개 저장`;
        } catch(e) { status.textContent=e.message; }
        finally { busy=false; onBusy(false); render(false); }
    });
    function render(updateStatus = true) {
        rows.replaceChildren();
        plan.forEach((row,index) => {
            const line=doc.createElement('fieldset'); line.className='al-date-row'; line.disabled=busy;
            const legend=doc.createElement('legend');legend.textContent=`기억 ${index+1}`;line.append(legend);
            for (const [key,label,type,value] of [['date','작중 날짜','date',row.date || ''],['start','시작 메시지','number',row.start]]) {
                const wrap=doc.createElement('label'),text=doc.createElement('span'),input=doc.createElement('input');
                text.textContent=label;input.type=type;input.className='text_pole';input.value=value;
                if(key==='start'){input.min=start;input.max=end;input.disabled=index===0;}
                input.onchange=()=>{row[key]=key==='start'?(input.value===''?NaN:Number(input.value)):(input.value || null);render();};
                wrap.append(text,input);line.append(wrap);
            }
            const detail=doc.createElement('small');
            detail.textContent=`끝 #${(plan[index+1]?.start ?? end+1)-1} · ${row.evidence || '직접 지정'}${row.date?'':' · 날짜 미상'}`;line.append(detail);
            const excerpt=doc.createElement('details'),summary=doc.createElement('summary'),source=doc.createElement('pre');
            summary.textContent='시작 메시지 확인';source.textContent=messages[row.start]?.mes || '';excerpt.append(summary,source);line.append(excerpt);
            if(index>0){const remove=doc.createElement('button');remove.type='button';remove.className='menu_button';remove.textContent='앞 구간에 합치기';remove.onclick=()=>{plan.splice(index,1);render();};line.append(remove);}
            rows.append(line);
        });
        add.disabled=busy;run.disabled=busy;
        try { read();if(updateStatus)status.textContent=busy?'날짜별 수집 준비 중…':`기억 ${plan.length}개로 나누어 저장합니다. 사이드 기록은 마지막 기억 저장 후 한 번 갱신합니다.`; }
        catch(e){run.disabled=true;if(updateStatus)status.textContent=e.message;}
    }
    render();return box;
}
