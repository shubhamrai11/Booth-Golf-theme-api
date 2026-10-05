import path from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadKey } from './secrets.mjs';
import { TemporaryHelper } from './temporary-helper.mjs';
async function main(){
const appRoot=process.env.FAIRWAY_APP_ROOT||process.cwd();
const root=process.env.FAIRWAY_SETTINGS_DIR||path.join(appRoot,'settings');
const helper=new TemporaryHelper({root,appRoot,key:await loadKey(root,appRoot)});
const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host||'',url=new URL(req.url,'http://'+host);
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)){res.writeHead(403);res.end('Use localhost.');return;}
    if(url.pathname.startsWith('/api/')){
      const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:req,duplex:'half',signal:controller.signal});
      const response=await helper.handle(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const relative=['/','/kiosk','/display'].includes(url.pathname)?'index.html':decodeURIComponent(url.pathname).slice(1);
    const file=path.resolve(appRoot,'dist',relative),dist=path.resolve(appRoot,'dist')+path.sep;
    if(!file.startsWith(dist)){res.writeHead(404);res.end();return;}
    const content=await readFile(file);const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':relative==='index.html'?'no-store':'public, max-age=3600'});res.end(content);
  }catch{if(!res.headersSent)res.writeHead(500);res.end('The helper could not finish this request.');}
});
server.requestTimeout=660000;
server.listen(Number(process.env.FAIRWAY_PORT||4310),'127.0.0.1',()=>console.log('Fairway temporary booth ready at http://127.0.0.1:'+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
main().catch(()=>{console.error('The temporary booth could not start. Check the settings folder and port.');process.exitCode=1;});
