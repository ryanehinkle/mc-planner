(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MCLitematicExport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const TAG={END:0,BYTE:1,SHORT:2,INT:3,LONG:4,FLOAT:5,DOUBLE:6,BYTE_ARRAY:7,STRING:8,LIST:9,COMPOUND:10,INT_ARRAY:11,LONG_ARRAY:12};
const DEFAULT_DATA_VERSION=4790; // modern 1.20.5+ / v7-compatible target
const LITEMATIC_VERSION=7;
const LITEMATIC_SUBVERSION=1;
const te=new TextEncoder();

class NBTWriter{
  constructor(capacity=65536){this.b=new Uint8Array(capacity);this.v=new DataView(this.b.buffer);this.o=0;}
  ensure(n){if(this.o+n<=this.b.length)return;let size=this.b.length;while(size<this.o+n)size*=2;const next=new Uint8Array(size);next.set(this.b);this.b=next;this.v=new DataView(next.buffer);}
  u8(x){this.ensure(1);this.v.setUint8(this.o,x&255);this.o++;}
  i8(x){this.ensure(1);this.v.setInt8(this.o,x);this.o++;}
  u16(x){this.ensure(2);this.v.setUint16(this.o,x,false);this.o+=2;}
  i32(x){this.ensure(4);this.v.setInt32(this.o,x|0,false);this.o+=4;}
  i64(x){this.ensure(8);this.v.setBigInt64(this.o,BigInt.asIntN(64,BigInt(x)),false);this.o+=8;}
  raw(bytes){this.ensure(bytes.length);this.b.set(bytes,this.o);this.o+=bytes.length;}
  str(s){const bytes=te.encode(String(s));if(bytes.length>65535)throw new Error('NBT string is too long');this.u16(bytes.length);this.raw(bytes);}
  header(type,name){this.u8(type);this.str(name);}
  end(){this.u8(TAG.END);}
  bytes(){return this.b.slice(0,this.o);}
}

function normalizeState(state,id){
  let s=String(state||'').trim();
  if(!s)s='minecraft:'+(id||'air');
  const bracket=s.indexOf('[');
  const head=bracket>=0?s.slice(0,bracket):s;
  const props=bracket>=0?s.slice(bracket):'';
  s=(head.includes(':')?head:'minecraft:'+head)+props;
  return s;
}
function decomposeState(state){
  const s=normalizeState(state,'air');
  const m=s.match(/^([^\[]+)(?:\[([^\]]*)\])?$/);
  const name=m?.[1]||'minecraft:air';
  const properties={};
  if(m?.[2]){
    for(const pair of m[2].split(',')){
      const i=pair.indexOf('=');
      if(i>0){
        const k=pair.slice(0,i).trim(),v=pair.slice(i+1).trim();
        if(k)properties[k]=v;
      }
    }
  }
  return{name,properties};
}
function isAir(id,state){
  const name=decomposeState(state||id).name.replace(/^minecraft:/,'');
  return name==='air'||name==='cave_air'||name==='void_air'||name==='structure_void';
}
function cleanRegionName(name){
  const s=String(name||'MC Planner').trim().replace(/[\x00-\x1f]/g,'');
  return s||'MC Planner';
}
function collectProject(project){
  if(!project||!Array.isArray(project.layers))throw new Error('No MC Planner project is available.');
  const placements=new Map();
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  project.layers.forEach((layer,i)=>{
    const y=Number.isFinite(layer.sourceY)?Math.trunc(layer.sourceY):i;
    for(const [key,id] of Object.entries(layer.cells||{})){
      const parts=key.split(',');
      const x=Number(parts[0]),z=Number(parts[1]);
      if(!Number.isFinite(x)||!Number.isFinite(z)||!id)continue;
      const state=normalizeState(layer.states?.[key],id);
      if(isAir(id,state))continue;
      const p={x:Math.trunc(x),y,z:Math.trunc(z),id,state};
      placements.set(p.x+','+p.y+','+p.z,p);
    }
  });
  if(!placements.size)throw new Error('There are no blocks to export.');
  for(const p of placements.values()){
    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);minZ=Math.min(minZ,p.z);
    maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z);
  }
  const width=maxX-minX+1,height=maxY-minY+1,depth=maxZ-minZ+1;
  const volume=width*height*depth;
  if(!Number.isSafeInteger(volume)||volume<=0)throw new Error('Project dimensions are too large to export safely.');
  return{placements,minX,minY,minZ,maxX,maxY,maxZ,width,height,depth,volume};
}
function buildPalette(info){
  const list=['minecraft:air'],map=new Map([['minecraft:air',0]]);
  for(const p of info.placements.values()){
    if(!map.has(p.state)){map.set(p.state,list.length);list.push(p.state);}
  }
  return{list,map};
}
function bitsForPalette(n){return Math.max(2,Math.ceil(Math.log2(Math.max(1,n))));}
function packStates(info,palette){
  const bits=bitsForPalette(palette.list.length);
  const count=Math.ceil(info.volume*bits/64);
  const longs=new BigUint64Array(count);
  const mask=(1n<<BigInt(bits))-1n;
  for(const p of info.placements.values()){
    const x=p.x-info.minX,y=p.y-info.minY,z=p.z-info.minZ;
    const index=x+z*info.width+y*info.width*info.depth;
    const value=BigInt(palette.map.get(p.state)||0)&mask;
    const bitIndex=index*bits,start=Math.floor(bitIndex/64),off=bitIndex%64;
    longs[start]|=value<<BigInt(off);
    if(off+bits>64)longs[start+1]|=value>>BigInt(64-off);
  }
  return{bits,longs};
}
function writeVec3(w,name,x,y,z){
  w.header(TAG.COMPOUND,name);
  w.header(TAG.INT,'x');w.i32(x);
  w.header(TAG.INT,'y');w.i32(y);
  w.header(TAG.INT,'z');w.i32(z);
  w.end();
}
function writeEmptyCompoundList(w,name){
  w.header(TAG.LIST,name);w.u8(TAG.COMPOUND);w.i32(0);
}
function writePalette(w,palette){
  w.header(TAG.LIST,'BlockStatePalette');w.u8(TAG.COMPOUND);w.i32(palette.list.length);
  for(const state of palette.list){
    const {name,properties}=decomposeState(state);
    w.header(TAG.STRING,'Name');w.str(name);
    const keys=Object.keys(properties);
    if(keys.length){
      w.header(TAG.COMPOUND,'Properties');
      keys.sort().forEach(k=>{w.header(TAG.STRING,k);w.str(properties[k]);});
      w.end();
    }
    w.end();
  }
}
function writeLongArray(w,name,longs){
  w.header(TAG.LONG_ARRAY,name);w.i32(longs.length);
  for(let i=0;i<longs.length;i++)w.i64(BigInt.asIntN(64,longs[i]));
}
function encodeProjectNBT(project,options={}){
  const info=collectProject(project),palette=buildPalette(info),packed=packStates(info,palette);
  const name=cleanRegionName(options.name||'MC Planner Export');
  const author=String(options.author||'MC Planner');
  const description=String(options.description||'Created with MC Planner');
  const dataVersion=Number.isInteger(options.dataVersion)?options.dataVersion:DEFAULT_DATA_VERSION;
  const now=BigInt(Date.now());
  const w=new NBTWriter();

  w.header(TAG.COMPOUND,'');

  w.header(TAG.INT,'Version');w.i32(LITEMATIC_VERSION);
  w.header(TAG.INT,'SubVersion');w.i32(LITEMATIC_SUBVERSION);
  w.header(TAG.INT,'MinecraftDataVersion');w.i32(dataVersion);

  w.header(TAG.COMPOUND,'Metadata');
  w.header(TAG.STRING,'Name');w.str(name);
  w.header(TAG.STRING,'Author');w.str(author);
  w.header(TAG.STRING,'Description');w.str(description);
  w.header(TAG.STRING,'Software');w.str('MC Planner');
  w.header(TAG.LONG,'TimeCreated');w.i64(now);
  w.header(TAG.LONG,'TimeModified');w.i64(now);
  writeVec3(w,'EnclosingSize',info.width,info.height,info.depth);
  w.header(TAG.INT,'TotalVolume');w.i32(info.volume);
  w.header(TAG.INT,'TotalBlocks');w.i32(info.placements.size);
  w.header(TAG.INT,'RegionCount');w.i32(1);
  w.end();

  w.header(TAG.COMPOUND,'Regions');
  w.header(TAG.COMPOUND,name);
  writeVec3(w,'Position',info.minX,info.minY,info.minZ);
  writeVec3(w,'Size',info.width,info.height,info.depth);
  writePalette(w,palette);
  writeLongArray(w,'BlockStates',packed.longs);
  writeEmptyCompoundList(w,'TileEntities');
  writeEmptyCompoundList(w,'Entities');
  writeEmptyCompoundList(w,'PendingBlockTicks');
  writeEmptyCompoundList(w,'PendingFluidTicks');
  w.end();
  w.end();
  w.end();

  return{bytes:w.bytes(),info,palette:palette.list,bits:packed.bits,name,dataVersion};
}
async function loadFflate(){
  if(globalThis.fflate?.gzipSync)return globalThis.fflate;
  if(typeof document==='undefined')return null;
  const urls=[
    'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
    'https://unpkg.com/fflate@0.8.2/umd/index.js'
  ];
  for(const src of urls){
    try{
      await new Promise((resolve,reject)=>{
        const s=document.createElement('script');s.src=src;s.async=true;
        s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error('Failed '+src))};
        document.head.appendChild(s);
      });
      if(globalThis.fflate?.gzipSync)return globalThis.fflate;
    }catch{}
  }
  return null;
}
async function gzipBytes(bytes){
  if(typeof CompressionStream==='function'){
    const cs=new CompressionStream('gzip');
    const stream=new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const fflate=await loadFflate();
  if(fflate)return fflate.gzipSync(bytes,{level:6});
  throw new Error('This browser cannot create gzip-compressed Litematica files.');
}
function safeFileName(name){
  return cleanRegionName(name).replace(/[<>:"/\\|?*]+/g,'-').replace(/\s+/g,' ').trim()||'mc-planner';
}
async function exportProject(project,options={}){
  const built=encodeProjectNBT(project,options);
  const gz=await gzipBytes(built.bytes);
  return{...built,bytes:gz,rawBytes:built.bytes};
}
function downloadBytes(bytes,filename){
  if(typeof document==='undefined')return;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([bytes],{type:'application/gzip'}));
  a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1200);
}
async function exportCurrentProject(){
  const project=globalThis.MCPlanner3DSource?.getProject?.();
  if(!project)throw new Error('MC Planner project data is not available yet.');
  const suggested='MC Planner Export';
  const entered=typeof prompt==='function'?prompt('Litematic name',suggested):suggested;
  if(entered===null)return null;
  const name=cleanRegionName(entered||suggested);
  const result=await exportProject(project,{name,author:'MC Planner'});
  downloadBytes(result.bytes,safeFileName(name)+'.litematic');
  return result;
}

if(typeof document!=='undefined'){
  document.addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('exportLitematicBtn');
    if(btn)btn.addEventListener('click',async()=>{
      const old=btn.textContent;btn.disabled=true;btn.textContent='Exporting…';
      try{
        const result=await exportCurrentProject();
        if(result)console.info('[MC Planner] Litematic exported',result.info,result.palette.length+' palette entries');
      }catch(err){
        console.error('[MC Planner] Litematic export failed',err);
        alert('Could not export Litematic: '+(err?.message||err));
      }finally{btn.disabled=false;btn.textContent=old}
    });
  });
}

return{NBTWriter,normalizeState,decomposeState,collectProject,buildPalette,bitsForPalette,packStates,encodeProjectNBT,gzipBytes,exportProject,exportCurrentProject};
});
