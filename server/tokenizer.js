// SPDX-License-Identifier: AGPL-3.0-only
// Reuse ST's tokenizer selected by its browser. No provider keys or AI call.
export function tokenizerRequest(router,user,model,body,array=false) {
    return new Promise((resolve,reject)=>{
        let settled=false,code=200;
        const timer=setTimeout(()=>finish(Error('서버 토큰 계산 시간이 초과됐어.')),30000);
        function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);}
        const send=value=>{
            const count=array?value?.token_count:value?.count;
            if(code>=400 || !Number.isFinite(count) || count<0 || (JSON.stringify(body).length>20 && count===0))
                finish(Error('서버 토큰 계산에 실패해 요청을 중단했어.'));
            else finish(null,count);
        };
        const req={method:'POST',url:array?'/openai/count':'/openai/encode',query:{model},body,user,headers:{}};
        const res={status:n=>{code=n;return res;},send,json:send,sendStatus:n=>{code=n;send({});},setHeader(){},getHeader(){}};
        try{router.handle(req,res,error=>finish(error||Error('서버 토크나이저 경로가 없어.')));}catch(error){finish(error);}
    });
}
