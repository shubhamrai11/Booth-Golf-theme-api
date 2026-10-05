// No web storage, file system or history: one portrait lives only in this object.
export class MemoryPortrait {
  constructor({urls=URL,changed=()=>{},publish=()=>{}}={}){Object.assign(this,{urls,changed,publish});this.epoch=0;this.job=null;this.guest=null;this.result=null;this.controller=null;}
  release(){if(this.job?.url)this.urls.revokeObjectURL(this.job.url);this.guest=null;this.result=null;this.job=null;}
  clear(){this.epoch++;this.controller?.abort();this.controller=null;this.release();this.changed(null);this.publish(null);}
  capture(blob){this.clear();this.guest=blob;this.job={id:crypto.randomUUID(),status:'captured',url:this.urls.createObjectURL(blob)};this.changed(this.job);return this.job;}
  async generate(fn,mode){
    if(this.job?.status!=='captured')throw new Error('This photo was already submitted. Start a new photo after reviewing any AI charge.');
    const epoch=this.epoch;this.controller=new AbortController();this.job={...this.job,status:'generating',mode};this.changed(this.job);
    try{
      const result=await fn(this.guest,this.controller.signal);
      if(epoch!==this.epoch)return false;
      this.urls.revokeObjectURL(this.job.url);this.guest=null;this.result=result;
      this.job={...this.job,status:'complete',url:this.urls.createObjectURL(result),completedAt:new Date().toISOString()};this.changed(this.job);this.publish({blob:result,job:{...this.job,url:undefined}});return true;
    }catch(e){if(epoch!==this.epoch)return false;this.job={...this.job,status:'failed',error:e.message};this.changed(this.job);throw e;}
    finally{if(epoch===this.epoch)this.controller=null;}
  }
}
