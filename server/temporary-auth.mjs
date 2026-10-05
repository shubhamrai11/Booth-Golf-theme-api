import { createHmac, timingSafeEqual } from 'node:crypto';
export const equal = (a,b) => { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && timingSafeEqual(x,y); };
const signingKey = key => createHmac('sha256',key).update('fairway:temporary-request:v1').digest();
const mac = (data,key) => createHmac('sha256',signingKey(key)).update(data).digest('base64url');
export function issueProof({digest,id,audience},key,now=Date.now()) {
  if(!key) throw new Error('Save your OpenAI API key in Windows helper Setup first.');
  const value=Buffer.from(JSON.stringify({digest,id,audience,expires:now+60000})).toString('base64url');
  return value+'.'+mac(value,key);
}
export function checkProof(proof,digest,key,audience,now=Date.now()) {
  if(!key) return null;
  const [value,signature,...extra]=String(proof||'').split('.');
  if(!value || !signature || extra.length || !equal(signature,mac(value,key))) return null;
  try {const claims=JSON.parse(Buffer.from(value,'base64url').toString());
    if(claims.digest!==digest || claims.audience!==audience || !Number.isFinite(claims.expires) || claims.expires<=now || claims.expires>now+60000 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.id)) return null;
    return claims;
  }catch{return null;}
}
