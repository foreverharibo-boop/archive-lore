// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { shouldIndexBookUpdate } from './lore-automation.js';
import { normalizeSettings } from './lore-core.js';

function queueFixture(config={}) {
    const source=fs.readFileSync(new URL('./archive-lore-fork.js',import.meta.url),'utf8');
    const start=source.indexOf('function queueIndex(){'),end=source.indexOf('\nfunction setup()',start);
    const listeners=new Map(),timers=new Map();let id=0,indexes=0,busy=false,error=null;
    const state={busy:false},settings=normalizeSettings(config),failures=[];
    const scope={shouldIndexBookUpdate,native:{busy:()=>busy},search:()=>({settings:()=>settings,books:()=>['native-book'],controller:{state:()=>state,index:async()=>{indexes++;if(error)throw error;}}}),fail:e=>failures.push(e),
        setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n),
        event_types:{WORLDINFO_UPDATED:'save',GENERATION_STARTED:'start',GENERATION_ENDED:'end',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},
        eventSource:{on:(event,listener)=>listeners.set(event,listener)}};
    vm.runInNewContext('let migrating=false,generating=false,indexPending=false,indexTimer;\n'+source.slice(start,end),scope);
    const eventsStart=source.indexOf('    eventSource.on(event_types.WORLDINFO_UPDATED',source.indexOf('function setup()'));
    const eventsEnd=source.indexOf('\n    for(const [name,fn,help]',eventsStart);
    vm.runInNewContext(source.slice(eventsStart,eventsEnd),scope);
    return {settings,failures,state,get indexes(){return indexes;},set busy(value){busy=value;},set error(value){error=value;},
        emit:(event,...args)=>listeners.get(event)(...args),
        tick:async()=>{const pending=[...timers.values()];timers.clear();for(const fn of pending)await fn();},get queued(){return timers.size;}};
}
test('native book save automatically queues embedding after collection finishes and coalesces side saves',async()=>{
    const f=queueFixture();f.busy=true;
    f.emit('save','native-book');f.emit('save','native-book');f.emit('save','native-book');
    await f.tick();assert.equal(f.indexes,0);assert.equal(f.queued,1);
    f.busy=false;await f.tick();assert.equal(f.indexes,1);assert.equal(f.queued,0);
    f.emit('save','other-book');await f.tick();assert.equal(f.indexes,1);
    f.emit('save','native-book',{}, {archiveLoreServerSync:true});await f.tick();assert.equal(f.indexes,1);
});
test('native automatic embedding honors disabled settings, generation, chat changes and failed requests',async()=>{
    for(const config of [{autoEmbed:false},{enabled:false}]){
        const f=queueFixture(config);f.emit('save','native-book');await f.tick();assert.equal(f.indexes,0);assert.equal(f.queued,0);
    }
    const f=queueFixture();f.emit('start','normal',{},false);f.emit('save','native-book');await f.tick();assert.equal(f.indexes,0);
    f.emit('end');await f.tick();assert.equal(f.indexes,1);
    f.emit('save','native-book');f.emit('chat');await f.tick();assert.equal(f.indexes,1);
    f.error=Error('Invalid embedding key');f.emit('save','native-book');await f.tick();assert.equal(f.failures.length,1);assert.equal(f.queued,0);
});
