import { waitUntil, getDeadline } from '@vercel/functions';
import { createStore } from '../cloud/store.mjs';
import { CloudBooth } from '../cloud/service.mjs';
import { cloudEnvironment } from '../cloud/auth.mjs';
let booth;
export default {
  async fetch(request) {
    if (!booth && !cloudEnvironment(process.env).length) booth=new CloudBooth({env:process.env,store:createStore(process.env),schedule:waitUntil,getDeadline});
    if (!booth) return Response.json({cloud:true,error:'Cloud setup is incomplete.',missing:cloudEnvironment(process.env)},{status:503,headers:{'Cache-Control':'no-store'}});
    return booth.handle(request);
  },
};
