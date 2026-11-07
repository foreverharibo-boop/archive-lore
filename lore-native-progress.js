// Archive Lore — AGPL-3.0-only.
export function nextCollectionRange(markers, length) {
    const highest=Number.isInteger(markers?.highestMemoryProcessed) && markers.highestMemoryProcessed>=0
        ? markers.highestMemoryProcessed : -1;
    const end=length-1;
    const start=highest+1;
    return {highest,start,end,count:Math.max(0,end-start+1)};
}
export function advanceCollectionCheckpoint(markers,end) {
    if(!Number.isInteger(end) || end<0)throw new Error('수집 완료 메시지 번호가 올바르지 않습니다.');
    const previous=Number.isInteger(markers.highestMemoryProcessed)?markers.highestMemoryProcessed:-1;
    markers.highestMemoryProcessed=Math.max(previous,end);
    delete markers.highestMemoryProcessedManuallySet;
    return markers.highestMemoryProcessed;
}
