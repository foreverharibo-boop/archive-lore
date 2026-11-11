// Archive Lore server © 2026 foreverharibo-boop — AGPL-3.0-only
import { EventEmitter } from 'node:events';
// Use ST's authenticated provider routing, stored secrets and provider-specific conversion.
// A detached socket deliberately outlives the browser that submitted a job.
export function invokeBackend(router,user,payload,signal,timeoutMs=180000) {
    return new Promise((resolve,reject)=>{
        const socket=new EventEmitter(),request=new EventEmitter();let settled=false;
        const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(data);};
        const abort=()=>{socket.emit('close');finish(new Error('서버 AI 요청이 중지됐어.'));};
        const timer=setTimeout(()=>{socket.emit('close');finish(new Error('서버 AI 요청 시간이 초과됐어.'));},timeoutMs);
        let chunks='',code=200;const response=new EventEmitter();
        Object.assign(response,{locals:{},headersSent:false,writableEnded:false,
            status(n){code=n;return this;},setHeader(){return this;},getHeader(){},removeHeader(){},set(){return this;},type(){return this;},flushHeaders(){},
            write(chunk){chunks+=String(chunk);return true;},
            end(data){if(data!==undefined)chunks+=String(data);this.send(chunks);},
            json(data){return this.send(data);},sendStatus(n){code=n;return this.send({error:String(n)});},
            send(data){this.headersSent=true;this.writableEnded=true;let parsed=data;try{if(typeof data==='string')parsed=JSON.parse(data);}catch{}
                if(code>=400||parsed?.error)finish(new Error(`수집·검색 AI 오류 (${code}): ${typeof parsed?.error==='string'?parsed.error:parsed?.error?.message || '연결 프로필과 서버 키를 확인해 줘.'}`));else finish(null,parsed);return this;},
        });
        Object.assign(request,{method:'POST',url:'/generate',originalUrl:'/generate',headers:{},query:{},params:{},body:{...structuredClone(payload),stream:false},user,socket,connection:socket,res:response});response.req=request;
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
        try{router.handle(request,response,error=>finish(error||new Error('실리태번 Chat Completion 경로를 찾을 수 없어.')));}catch(error){finish(error);}
    });
}
