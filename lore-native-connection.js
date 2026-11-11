// Archive Lore — AGPL-3.0-only.
// A binding belongs to a Memory Books collection profile, never to ST's active RP connection.
export function bindSavedConnection(profile, id, profiles, service) {
    if (!profile) throw new Error('수집 설정을 찾을 수 없습니다.');
    if (id) {
        if (!profiles.some(p => String(p.id) === id)) throw new Error('삭제되었거나 없는 연결 프로필입니다. 다시 선택해 주세요.');
        if (!service?.getProfile || !service?.validateProfile || !service?.sendRequest) throw new Error('실리태번 연결 프로필 기능을 사용할 수 없습니다. 실리태번을 업데이트해 주세요.');
        const connection = service.getProfile(id);
        if (!connection) throw new Error('연결 프로필을 불러올 수 없습니다.');
        const mapping = service.validateProfile(connection);
        if (mapping?.selected !== 'openai' || !mapping.source) throw new Error('Chat Completion 연결 프로필을 선택해 주세요.');
        if (!connection.model) throw new Error('실리태번 연결 프로필에 모델을 저장한 뒤 다시 선택해 주세요.');
    }
    profile.archiveLoreConnectionProfileId = id;
}

export function savedConnectionOptions(profiles, selected = '') {
    const options=profiles.map(p=>({id:String(p.id),name:p.name || String(p.id),selected:String(p.id)===String(selected)}));
    if(selected && !options.some(p=>p.selected))options.push({id:selected,name:'연결 프로필 없음 · 다시 선택해 주세요',selected:true});
    return options;
}

export function createConnectionPicker({settings, profiles, service, save, compact=false}) {
    const box=document.createElement('div');box.className='al-native-connection';
    const profile=settings.profiles?.[settings.defaultProfile];
    const label=document.createElement('label');label.textContent=compact?'현재 수집 프로필의 AI 연결':'수집·통합·사이드 AI';
    const select=document.createElement('select');select.className='text_pole';select.id='al-home-connection';
    const existing=String(profile?.archiveLoreConnectionProfileId || '');
    select.append(new Option('기존 연결 설정 사용',''));
    for(const p of profiles)select.append(new Option(p.name || String(p.id),String(p.id)));
    if(existing && !profiles.some(p=>String(p.id)===existing))select.append(new Option('연결 프로필 없음 · 다시 선택해 주세요',existing));
    select.value=existing;select.disabled=!profile;label.append(select);
    const help=document.createElement('small');help.textContent='실리에 저장된 연결 프로필을 선택합니다. 모델명은 입력하지 않아도 됩니다.';
    const status=document.createElement('small');status.setAttribute('role','status');
    status.textContent=compact?'':profile ? `적용할 수집 설정: ${profile.name}` : '수집 설정을 먼저 만들어 주세요.';
    select.addEventListener('change',()=>{
        const before=profile?.archiveLoreConnectionProfileId || '';
        try {bindSavedConnection(profile,select.value,profiles,service);save();status.textContent='저장했습니다. 별도 AI 설정이 있는 사이드 항목은 해당 설정을 따릅니다.';}
        catch(error){select.value=before;status.textContent=error.message;}
    });
    box.append(label);if(!compact)box.append(help);box.append(status);return box;
}

// Mirror the explicit saved-profile route used by sendRawCompletionRequest.
// Never present the active RP model as fallback for an unavailable explicit binding.
export function boundConnectionDisplay(profile, service) {
    const id = String(profile?.archiveLoreConnectionProfileId || '');
    if (!id) return {};
    try {
        const saved = service?.getProfile?.(id);
        if (!saved?.model) return {profileModel:'연결 프로필을 확인해 주세요 · 모델을 불러올 수 없습니다'};
        return {profileModel:`${saved.name || id} · ${saved.model}`};
    } catch {
        return {profileModel:'연결 프로필을 확인해 주세요 · 모델을 불러올 수 없습니다'};
    }
}
