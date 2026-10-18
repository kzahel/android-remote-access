import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { createDemo } from '../server.mjs';

async function viewer(app) {
  const response=await fetch(app.url);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  return async (path,data,origin=app.url) => fetch(app.url+path, {headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)})});
}
async function device(app, token=app.token) {
  const socket=net.connect(app.phonePort,'127.0.0.1');
  await once(socket,'connect');
  socket.write(JSON.stringify({type:'hello',token,generation:'test',state:{locked:false}})+'\n');
  return socket;
}

test('browser actions require same-origin authority; unknown operations are refused',async()=>{
  const app=await createDemo();
  try {
    assert.equal((await fetch(app.url+'/api/state')).status,401);
    const call=await viewer(app);
    assert.equal((await call('/api/action',{op:'lock'},'https://untrusted.example')).status,403);
    assert.equal((await call('/api/action',{op:'shell',command:'anything'})).status,400);
    const hostResult=await new Promise(resolve=>{http.get(app.url+'/api/state',{headers:{Host:'untrusted.example'}},r=>{r.resume();resolve(r.statusCode)})});
    assert.equal(hostResult,403);
  } finally { await app.close(); }
});

test('wrong phone token never gains control',async()=>{
  const app=await createDemo();
  try {
    const socket=await device(app,'x'.repeat(app.token.length));
    await once(socket,'close');
    assert.equal(app.status().connected,false);
  } finally { await app.close(); }
});

test('an interrupted action is uncertain and is never replayed on reconnect',async()=>{
  const app=await createDemo();
  try {
    const socket=await device(app);
    await new Promise(r=>setTimeout(r,20));
    const received=once(socket,'data');
    const action=app.command('tap',{x:10,y:20,frame:'old'});
    await received;
    socket.destroy();
    await assert.rejects(action,/not be replayed/);
    const next=await device(app);
    let replayed=false; next.on('data',()=>{replayed=true});
    await new Promise(r=>setTimeout(r,100));
    assert.equal(replayed,false);
    next.destroy();
  } finally { await app.close(); }
});

test('timed-out commands do not accept late results as another action',async()=>{
  const app=await createDemo();
  try {
    const socket=await device(app); await new Promise(r=>setTimeout(r,20));
    const received=once(socket,'data');
    const first=app.command('tap',{},30); const [bytes]=await received;
    const old=JSON.parse(bytes.toString().trim());
    await assert.rejects(first,/not be replayed/);
    const secondReceived=once(socket,'data');
    const second=app.command('state',{},1000); const [nextBytes]=await secondReceived;
    const next=JSON.parse(nextBytes.toString().trim());
    socket.write(JSON.stringify({type:'result',id:old.id,ok:true,message:'late'})+'\n');
    socket.write(JSON.stringify({type:'result',id:next.id,ok:true,message:'fresh'})+'\n');
    assert.equal((await second).message,'fresh'); socket.destroy();
  } finally { await app.close(); }
});
