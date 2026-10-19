import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createDemo } from "../server.mjs";

async function fixture() {
  const app=await createDemo();
  const response=await fetch(app.url);
  const cookie=response.headers.get("set-cookie").split(";")[0];
  const commands=[];
  const state={locked:false,interactive:true,secure:true,video:{active:true}};
  const phone=net.connect(app.phonePort,"127.0.0.1");await once(phone,"connect");
  phone.on("error",()=>{});
  phone.write(JSON.stringify({type:"hello",token:app.token,generation:"fixture",state})+"\n");
  let buffer="";
  phone.on("data",bytes=>{
    buffer+=bytes;let cut;
    while((cut=buffer.indexOf("\n"))>=0){
      const c=JSON.parse(buffer.slice(0,cut));buffer=buffer.slice(cut+1);commands.push(c);
      phone.write(JSON.stringify({type:"result",id:c.id,ok:true,message:"fixture result",state,
        data:{held:c.op==="touch"?c.points.filter(p=>p.held).length:0}})+"\n");
    }
  });
  await new Promise(r=>setTimeout(r,20));
  const viewer=async(options={})=>{
    const ws=new WebSocket(app.url.replace("http:","ws:")+"/api/live",{origin:app.url,headers:{Cookie:cookie},...options});
    await once(ws,"open");return ws;
  };
  const send=async(ws,data)=>{const result=once(ws,"message");ws.send(JSON.stringify(data));return JSON.parse((await result)[0]);};
  const touch=(gesture,sequence=0)=>({op:"touch",request:sequence+1,gesture,sequence,frame:"fixture-frame",duration:40,points:[{id:1,path:[[200,200]],held:true}]});
  return {app,phone,cookie,state,commands,viewer,send,touch};
}

test("live upgrades require cookie, Host and same-origin browser authority",async()=>{
  const f=await fixture();
  try{
    for(const options of [{origin:"https://foreign.example"},{headers:{}},{headers:{Cookie:f.cookie,Host:"foreign.example"}}]){
      const ws=new WebSocket(f.app.url.replace("http:","ws:")+"/api/live",{origin:f.app.url,headers:{Cookie:f.cookie},...options});
      const code=await new Promise(resolve=>{ws.on("unexpected-response",(req,res)=>{resolve(res.statusCode);res.resume();req.destroy();});ws.on("error",()=>{});});
      assert.equal(code,403);
    }
    const viewer=await f.viewer();
    const result=await f.send(viewer,{request:1,op:"shell",command:"anything"});
    assert.equal(result.ok,false);assert.match(result.message,/Only touch/);
    viewer.terminate();
  }finally{await f.app.close();}
});

test("one viewer owns held touch; socket loss releases it and reconnect never replays",async()=>{
  const f=await fixture();
  try{
    const a=await f.viewer(),b=await f.viewer();
    assert.equal((await f.send(a,f.touch("first-gesture-0001"))).ok,true);
    const refused=await f.send(b,f.touch("second-gesture-0002"));assert.equal(refused.ok,false);assert.match(refused.message,/Another viewer/);
    a.terminate();
    for(let i=0;i<50&&!f.commands.some(c=>c.op==="touchEnd");i++)await new Promise(r=>setTimeout(r,10));
    assert.ok(f.commands.some(c=>c.op==="touchEnd"));
    const stale=await f.send(b,f.touch("first-gesture-0001",1));assert.equal(stale.ok,false);assert.match(stale.message,/start again/);
    assert.equal((await f.send(b,f.touch("second-gesture-0002"))).ok,true);
    assert.equal(f.commands.filter(c=>c.op==="touch").length,2);b.terminate();
  }finally{await f.app.close();}
});

test("video requires the current native grant and is withheld while locked",async()=>{
  const f=await fixture();let video;
  try{
    const wrong=net.connect(f.app.phonePort,"127.0.0.1");await once(wrong,"connect");
    wrong.write(JSON.stringify({type:"hello",role:"video",token:f.app.token,generation:"old-grant"})+"\n");await once(wrong,"close");assert.equal(f.app.status().connected,true);
    const viewer=await f.viewer();
    video=net.connect(f.app.phonePort,"127.0.0.1");await once(video,"connect");
    video.write(JSON.stringify({type:"hello",role:"video",token:f.app.token,generation:"fixture"})+"\n");
    const frame={type:"video",key:true,codec:"avc1.42c028",data:"AA==",timestamp:1,width:720,height:1600};
    const received=once(viewer,"message");video.write(JSON.stringify(frame)+"\n");assert.equal(JSON.parse((await received)[0]).type,"video");
    f.state.locked=true;f.phone.write(JSON.stringify({type:"state",state:f.state})+"\n");await new Promise(r=>setTimeout(r,20));
    let leaked=false;viewer.on("message",()=>{leaked=true;});video.write(JSON.stringify({...frame,timestamp:2})+"\n");await new Promise(r=>setTimeout(r,50));assert.equal(leaked,false);
    viewer.terminate();
  }finally{video?.destroy();await f.app.close();}
});
