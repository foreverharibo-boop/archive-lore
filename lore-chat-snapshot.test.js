// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {serverChatSnapshot,chatSnapshotInfo,matchesChatSnapshot} from './lore-chat-snapshot.js';

test('2,608 messages transmit fingerprints only, including hidden message identities',()=>{
    const messages=Array.from({length:2608},(_,i)=>({name:'A',mes:`PRIVATE-${i}:`+'가'.repeat(1200),is_system:i<2600}));
    const context={key:'chat',name:'Chat',messages,unrelated:'PRIVATE-OTHER'};
    const snapshot=serverChatSnapshot(context),wire=JSON.stringify(snapshot);
    assert(Buffer.byteLength(JSON.stringify(context))>8*1024*1024);
    assert(Buffer.byteLength(wire)<32*1024);
    assert(!wire.includes('PRIVATE'));assert.equal(snapshot.messages,undefined);
    assert.equal(snapshot.messageCount,2608);assert(matchesChatSnapshot(snapshot,messages));
    messages[0].mes+='edited';assert(!matchesChatSnapshot(snapshot,messages));
});

test('compact snapshots preserve source guards, legacy requests and automatic hiding semantics',()=>{
    const messages=[{mes:'one',is_user:true},{mes:'two'}],snapshot=serverChatSnapshot({key:'chat',messages});
    assert(matchesChatSnapshot({messages},messages));
    messages[0].is_system=true;assert(matchesChatSnapshot(snapshot,messages));
    messages.push({mes:'three'});assert(!matchesChatSnapshot(snapshot,messages));
    assert(matchesChatSnapshot(snapshot,messages,false));
    messages.pop();messages.pop();assert(!matchesChatSnapshot(snapshot,messages,false));
    const empty=serverChatSnapshot({key:'chat',messages:[]});assert(matchesChatSnapshot(empty,[]));
    assert(!matchesChatSnapshot(empty,[{mes:'new'}]));
    for(const bad of [{},{...snapshot,messageCount:0},{...snapshot,source:null},{...snapshot,messageCount:3},
        {...snapshot,source:{...snapshot.source,hashes:[null,null]}},{...snapshot,snapshotVersion:2,messages:[]}])
        assert.throws(()=>chatSnapshotInfo(bad),/확장과 서버 플러그인/);
});
