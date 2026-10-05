import { cloudDefaults } from '../cloud/settings.mjs';
const clone=value=>structuredClone(value);
export class MemoryStore {
  constructor(now=()=>Date.now()) {this.now=now;this.row={config:{...cloudDefaults},paused:false,device:{}};this.rows=new Map();this.files=new Map();this.cmds=new Map();this.logins=new Map();}
  async settings(){return clone(this.row);}
  async patchConfig(p){Object.assign(this.row.config,p);}
  async pause(p){this.row.paused=p;}
  async heartbeat(d){this.row.device=clone(d);}
  async loginAttempt(key){const n=(this.logins.get(key)||0)+1;this.logins.set(key,n);return n<=15;}
  async jobs(){return [...this.rows.values()].filter(j=>j.status!=='deleting').reverse().map(clone);}
  async job(id){return clone(this.rows.get(id)||null);}
  async tokenJob(token){return clone([...this.rows.values()].find(j=>j.data.token===token && j.status==='complete' && new Date(j.expires_at).getTime()>this.now())||null);}
  async createJob(row){if(!this.rows.has(row.id))this.rows.set(row.id,{created_at:new Date(this.now()).toISOString(),...clone(row)});return this.job(row.id);}
  async enqueue(id,snapshot,retry,approval=id){const row=this.rows.get(id);if(row.data.lastApprovalId===approval)return clone(row);if(['queued','generating','complete'].includes(row.status))return clone(row);if(row.status!=='captured' && !(retry && row.status==='failed'))throw new Error('Review before retrying.');row.status='queued';row.data={...row.data,snapshot:clone(snapshot),mode:snapshot.mode,error:'',lastApprovalId:approval};return clone(row);}
  async claim(worker,seconds){for(const row of this.rows.values())if(row.status==='generating' && row.lease_until<this.now()){row.status='failed';row.worker=null;row.data.error='Interrupted. Review before retrying.';}if(this.row.paused||[...this.rows.values()].some(j=>j.status==='generating'))return null;const row=[...this.rows.values()].find(j=>j.status==='queued');if(!row)return null;row.status='generating';row.data.outputPaths=[...(row.data.outputPaths || []),'results/'+row.id+'-'+worker+'.jpg'];row.worker=worker;row.lease_until=this.now()+seconds*1000;return clone(row);}
  async finish(id,worker,status,data,expiresAt){const row=this.rows.get(id);if(!row||row.worker!==worker||row.status!=='generating')return null;Object.assign(row,{worker:null,status,data:clone(data),...(expiresAt?{expires_at:expiresAt}:{})});return clone(row);}
  async markDeleting(id){const row=this.rows.get(id);if(!row||['generating','queued'].includes(row.status))return null;row.status='deleting';return clone(row);}
  async deleteJob(id){this.rows.delete(id);}
  async expired(){return [...this.rows.values()].filter(j=>!['generating','queued'].includes(j.status)&&new Date(j.expires_at).getTime()<this.now()).map(clone);}
  async command(id){return clone(this.cmds.get(id)||null);}
  async commands(){return [...this.cmds.values()].reverse().map(clone);}
  async createCommand(c){if(this.cmds.has(c.id))return this.command(c.id);if([...this.cmds.values()].some(x=>['pending','claimed'].includes(x.status)&&x.kind===c.kind&&(c.kind==='capture'||x.target===c.target)))throw new Error('Command already waiting.');this.cmds.set(c.id,{status:'pending',created_at:new Date(this.now()).toISOString(),...clone(c)});return this.command(c.id);}
  async claimCommand(){let c=[...this.cmds.values()].find(x=>x.status==='claimed');if(!c)c=[...this.cmds.values()].find(x=>x.status==='pending');if(!c)return null;c.status='claimed';return clone(c);}
  async ackCommand(id,status,data){const c=this.cmds.get(id);if(c.status!=='claimed')return null;c.status=status;c.data=clone(data);return clone(c);}
  async cancelCapture(id){for(const c of this.cmds.values())if(c.target===id&&c.kind==='capture')c.status='canceled';}
  async put(name,buffer){if(this.files.has(name))throw new Error('File already exists.');this.files.set(name,Buffer.from(buffer));}
  async get(name){if(!this.files.has(name))throw new Error('No file.');return Buffer.from(this.files.get(name));}
  async remove(names){for(const name of names)this.files.delete(name);}
  async signed(name){if(!this.files.has(name))throw new Error('No file.');return 'https://example.supabase.co/private/'+name+'?short-lived-test-token';}
}
