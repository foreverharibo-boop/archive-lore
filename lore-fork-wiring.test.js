// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./archive-lore.js',import.meta.url),'utf8');
function fn(name,end,scope){const start=source.indexOf('function '+name+'(');vm.runInNewContext(source.slice(start,source.indexOf(end,start)),scope);return scope[name];}

test('fork discovers character-only books before migration and native chat books afterwards',()=>{
    const metadata={};let nativeBooks=[];
    const scope={archiveLoreFork:true,archiveLoreMemoryBooks:{books:()=>nativeBooks},chatSettings:()=>metadata,target:()=> 'Character book',world_names:['Character book','Chat book','New book']};
    const books=fn('books','async function saveChatSettings',scope);
    assert.deepEqual([...books()],['Character book']);
    nativeBooks=['Chat book'];assert.deepEqual([...books()],['Chat book']);
    metadata.target='Character book';metadata.books=['Character book'];assert.deepEqual([...books()],['Character book']);
    metadata.nativeFormat=1;metadata.books=['Chat book'];assert.deepEqual([...books()],['Chat book']);
    nativeBooks=['New book'];assert.deepEqual([...books()],['New book']);
    scope.archiveLoreFork=false;assert.deepEqual([...books()],['Chat book']);
});

test('migrated source exclusions affect only transient WI entries, even with search disabled',()=>{
    const original={uid:0,world:'old',content:'Keep this fact',disable:false};
    const lists={character:[original],chat:[{uid:0,world:'new',disable:false}]};
    const policy=fn('nativePolicy','function init()',{
        chatSettings:()=>({nativeExcludedBooks:['old']}),settings:()=>({enabled:false}),
    });
    policy(lists);
    assert.equal(original.disable,false);
    assert.equal(lists.character[0].disable,true);
    assert.equal(lists.chat[0].disable,false);
});
