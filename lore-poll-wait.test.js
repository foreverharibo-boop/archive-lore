// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {waitForServerPoll} from './lore-poll-wait.js';
import {serverChatSnapshot} from './lore-server.js';
import {sourceRange,matchesRange} from './lore-core.js';

for(const event of ['visibilitychange','focus','pageshow','online'])test(`returning to the app wakes a waiting poll on ${event} and cleans listeners`,async()=>{
    const doc=new EventTarget(),win=new EventTarget();doc.visibilityState='hidden';
    const pending=waitForServerPoll(60000,undefined,doc,win);
    doc.visibilityState='visible';(event==='visibilitychange'?doc:win).dispatchEvent(new Event(event));
    const result=await pending;assert.notEqual(result.wakeReason,'timer');
    assert.equal(getEventListeners(doc,'visibilitychange').length,0);assert.equal(getEventListeners(win,'focus').length,0);
});
test('poll cancellation clears timers/listeners, while ordinary timers still work',async()=>{
    const doc=new EventTarget(),win=new EventTarget(),abort=new AbortController();doc.visibilityState='hidden';
    const pending=waitForServerPoll(60000,abort.signal,doc,win);abort.abort();
    await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(getEventListeners(win,'pageshow').length,0);
    assert.equal((await waitForServerPoll(1,undefined,doc,win)).wakeReason,'timer');
});
test('lean server snapshots retain full message text and source fingerprints but omit old swipes and plugin data',()=>{
    const original={key:'chat',messages:[{mes:'Complete current text',name:'A',is_user:true,is_system:false,send_date:'date',original_avatar:'a.png',swipes:['older'],extra:{reasoning:'private',translation:'large'}}]};
    const snapshot=serverChatSnapshot(original);
    assert.equal(snapshot.messages[0].mes,original.messages[0].mes);
    assert.equal(snapshot.messages[0].extra,undefined);assert.equal(snapshot.messages[0].swipes,undefined);
    assert(matchesRange(sourceRange(original.messages,0,0),snapshot.messages));
    original.messages[0].mes='edited';assert.equal(snapshot.messages[0].mes,'Complete current text');
    assert(!matchesRange(sourceRange(snapshot.messages,0,0),original.messages));
});
