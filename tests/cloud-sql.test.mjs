import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
test('PostgreSQL schema executes; atomic queue claims, leases, RLS and command expiration protect billing/hardware',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    const schema=readFileSync(new URL('../cloud/schema.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
    assert.equal((await db.query(`select public from storage.buckets where id='booth-private'`)).rows[0].public,false);
    const id=randomUUID(),id2=randomUUID(),worker=randomUUID();
    const create=id=>db.query(`insert into public.booth_jobs(id,request_id,status,expires_at,data) values($1,$1,'captured',now()+interval '7 days',$2)`,[id,{token:randomUUID()}]);await create(id);await create(id2);
    const snapshot={mode:'live',prompt:'Original prompt'};
    await db.query('select public.booth_enqueue($1,$2,false,$1)',[id,snapshot]);await db.query('select public.booth_enqueue($1,$2,false,$1)',[id,{mode:'live',prompt:'Changed prompt'}]);await db.query('select public.booth_enqueue($1,$2,false,$1)',[id2,snapshot]);
    let row=(await db.query('select * from public.booth_claim($1,285)',[worker])).rows[0];assert.equal(row.id,id);assert.equal(row.data.snapshot.prompt,'Original prompt');
    row=(await db.query('select * from public.booth_claim($1,285)',[randomUUID()])).rows[0];assert.equal(row.id,null);
    await db.query(`update public.booth_jobs set lease_until=now()-interval '1 second' where id=$1`,[id]);row=(await db.query('select * from public.booth_claim($1,285)',[randomUUID()])).rows[0];assert.equal(row.id,id2);
    assert.equal((await db.query('select status from public.booth_jobs where id=$1',[id])).rows[0].status,'failed');
    await assert.rejects(db.query('select public.booth_enqueue($1,$2,false,$3)',[id,snapshot,randomUUID()]),/Review/);
    const approval=randomUUID();await db.query('select public.booth_enqueue($1,$2,true,$3)',[id,snapshot,approval]);
    await db.query("update public.booth_jobs set status='failed' where id=$1",[id]);
    await db.query('select public.booth_enqueue($1,$2,true,$3)',[id,snapshot,approval]);
    assert.equal((await db.query('select status from public.booth_jobs where id=$1',[id])).rows[0].status,'failed');
    const command=randomUUID();await db.query(`insert into public.booth_commands(id,kind,target,data) values($1,'print',$2,'{}')`,[command,id2]);
    await assert.rejects(db.query(`insert into public.booth_commands(id,kind,target,data) values($1,'print',$2,'{}')`,[randomUUID(),id2]),/unique/);
    assert.equal((await db.query('select * from public.booth_command_claim()')).rows[0].id,command);
    assert.equal((await db.query('select * from public.booth_command_claim()')).rows[0].id,command);
    await db.query(`update public.booth_commands set claimed_at=now()-interval '5 minutes' where id=$1`,[command]);await db.query('select public.booth_command_claim()');assert.equal((await db.query('select status from public.booth_commands where id=$1',[command])).rows[0].status,'failed');
    await db.exec('set role anon');await assert.rejects(db.query('select * from public.booth_jobs'),/permission denied/);await assert.rejects(db.query('select public.booth_claim($1,285)',[randomUUID()]),/permission denied/);await db.exec('reset role');
    for(let n=0;n<15;n++)assert.equal((await db.query("select public.booth_login_attempt('test') as allowed")).rows[0].allowed,true);
    assert.equal((await db.query("select public.booth_login_attempt('test') as allowed")).rows[0].allowed,false);
    const expired=randomUUID();await create(expired);await db.query('select public.booth_enqueue($1,$2,false,$1)',[expired,snapshot]);
    await db.query("update public.booth_jobs set expires_at=now()-interval '1 second' where id=$1",[expired]);
    await db.query('select public.booth_claim($1,285)',[randomUUID()]);assert.equal((await db.query('select status from public.booth_jobs where id=$1',[expired])).rows[0].status,'failed');
  } finally {await db.close();}
});
