(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.MCImport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const td=new TextDecoder('utf-8');
const AIR=new Set(['air','cave_air','void_air','structure_void']);

class NBTReader{
  constructor(buffer){this.u8=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);this.v=new DataView(this.u8.buffer,this.u8.byteOffset,this.u8.byteLength);this.o=0;}
  need(n){if(this.o+n>this.u8.length)throw new Error('Unexpected end of NBT data');}
  u8v(){this.need(1);return this.v.getUint8(this.o++);}
  i8(){this.need(1);return this.v.getInt8(this.o++);}
  u16(){this.need(2);const x=this.v.getUint16(this.o,false);this.o+=2;return x;}
  i16(){this.need(2);const x=this.v.getInt16(this.o,false);this.o+=2;return x;}
  i32(){this.need(4);const x=this.v.getInt32(this.o,false);this.o+=4;return x;}
  i64(){this.need(8);const x=this.v.getBigInt64(this.o,false);this.o+=8;return x;}
  f32(){this.need(4);const x=this.v.getFloat32(this.o,false);this.o+=4;return x;}
  f64(){this.need(8);const x=this.v.getFloat64(this.o,false);this.o+=8;return x;}
  str(){const n=this.u16();this.need(n);const s=td.decode(this.u8.subarray(this.o,this.o+n));this.o+=n;return s;}
  payload(type){
    switch(type){
      case 0:return null;
      case 1:return this.i8();
      case 2:return this.i16();
      case 3:return this.i32();
      case 4:return this.i64();
      case 5:return this.f32();
      case 6:return this.f64();
      case 7:{const n=this.i32();if(n<0)throw new Error('Invalid NBT byte array length');this.need(n);const a=this.u8.slice(this.o,this.o+n);this.o+=n;return a;}
      case 8:return this.str();
      case 9:{const t=this.u8v(),n=this.i32();if(n<0)throw new Error('Invalid NBT list length');const a=new Array(n);for(let i=0;i<n;i++)a[i]=this.payload(t);return a;}
      case 10:{const o={};while(true){const t=this.u8v();if(t===0)break;const n=this.str();o[n]=this.payload(t);}return o;}
      case 11:{const n=this.i32();if(n<0)throw new Error('Invalid NBT int array length');const a=new Array(n);for(let i=0;i<n;i++)a[i]=this.i32();return a;}
      case 12:{const n=this.i32();if(n<0)throw new Error('Invalid NBT long array length');const a=new Array(n);for(let i=0;i<n;i++)a[i]=this.i64();return a;}
      default:throw new Error('Unsupported NBT tag type '+type);
    }
  }
  root(){const type=this.u8v();if(type!==10)throw new Error('NBT root must be a compound');const name=this.str();return{name,value:this.payload(10)};}
}

async function decompressMaybe(buffer){
  let u8=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(u8[0]===0x1f&&u8[1]===0x8b){
    if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress gzip schematic files.');
    const ds=new DecompressionStream('gzip');
    u8=new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  return u8;
}

function cleanBlockName(s){
  if(!s)return 'air';
  s=String(s).trim();
  const bracket=s.indexOf('[');if(bracket>=0)s=s.slice(0,bracket);
  const colon=s.indexOf(':');if(colon>=0)s=s.slice(colon+1);
  return s||'air';
}
function normalizeBlockState(s){
  if(!s)return 'minecraft:air';
  s=String(s).trim();
  if(!s.includes(':'))s='minecraft:'+s;
  return s;
}
function compoundBlockState(p){
  const name=normalizeBlockState(p?.Name||'minecraft:air');
  const props=p?.Properties&&typeof p.Properties==='object'?Object.entries(p.Properties):[];
  if(!props.length)return name;
  return name+'['+props.map(([k,v])=>k+'='+v).join(',')+']';
}
function isAir(id){return AIR.has(cleanBlockName(id));}

function decodeVarInts(bytes,count){
  const out=[];let value=0,shift=0;
  for(let i=0;i<bytes.length&&out.length<count;i++){
    const b=bytes[i];value|=(b&0x7f)<<shift;
    if((b&0x80)===0){out.push(value>>>0);value=0;shift=0;}else{shift+=7;if(shift>28)throw new Error('Invalid schematic varint');}
  }
  if(out.length<count)throw new Error(`Schematic block data ended early (${out.length}/${count})`);
  return out;
}

function makeBuild(blocks,meta={}){
  let minX=meta.bounds?.minX??Infinity,minY=meta.bounds?.minY??Infinity,minZ=meta.bounds?.minZ??Infinity,maxX=meta.bounds?.maxX??-Infinity,maxY=meta.bounds?.maxY??-Infinity,maxZ=meta.bounds?.maxZ??-Infinity;
  for(const b of blocks){minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);minZ=Math.min(minZ,b.z);maxX=Math.max(maxX,b.x);maxY=Math.max(maxY,b.y);maxZ=Math.max(maxZ,b.z);}
  if(!Number.isFinite(minX))return{layers:[{id:uid(),name:'Y 0',visible:true,cells:{}}],palette:[],width:1,depth:1,height:1,format:meta.format||'Minecraft',name:meta.name||'Imported build'};
  const height=maxY-minY+1,width=maxX-minX+1,depth=maxZ-minZ+1;
  const byY=new Map(),statesByY=new Map();const palette=[];const palSet=new Set();
  for(let y=minY;y<=maxY;y++){byY.set(y,{});statesByY.set(y,{})}
  for(const b of blocks){const id=cleanBlockName(b.id);if(isAir(id))continue;const key=(b.x-minX)+','+(b.z-minZ),cells=byY.get(b.y),states=statesByY.get(b.y);cells[key]=id;states[key]=normalizeBlockState(b.state||b.id);if(!palSet.has(id)){palSet.add(id);palette.push(id);}}
  const layers=[];let i=0;for(let y=minY;y<=maxY;y++,i++)layers.push({id:uid(),name:`Y ${y}`,sourceY:y,visible:i===0,cells:byY.get(y),states:statesByY.get(y)});
  return{layers,palette,width,depth,height,format:meta.format||'Minecraft',name:meta.name||'Imported build',bounds:{minX,minY,minZ,maxX,maxY,maxZ}};
}
function uid(){return (globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():'layer-'+Math.random().toString(36).slice(2)+Date.now().toString(36);}

function parseSponge(root){
  const s=root.Schematic||root;
  const width=Number(s.Width),height=Number(s.Height),length=Number(s.Length);
  if(!(width>0&&height>0&&length>0))throw new Error('Invalid Sponge schematic dimensions');
  const container=s.Blocks||s;
  const paletteObj=container.Palette||s.Palette;
  const data=container.Data||s.BlockData;
  if(!paletteObj||!data)throw new Error('Sponge schematic is missing Palette or block Data');
  const reverse=[];for(const [name,index] of Object.entries(paletteObj))reverse[Number(index)]={id:cleanBlockName(name),state:normalizeBlockState(name)};
  const total=width*height*length,indices=decodeVarInts(data,total),blocks=[];
  for(let i=0;i<total;i++){
    const entry=reverse[indices[i]]||{id:'air',state:'minecraft:air'},id=entry.id;if(isAir(id))continue;
    const y=Math.floor(i/(width*length)),rem=i-y*width*length,z=Math.floor(rem/width),x=rem-z*width;
    blocks.push({x,y,z,id,state:entry.state});
  }
  return makeBuild(blocks,{format:'Sponge .schem',name:s.Metadata?.Name||'Imported schematic',bounds:{minX:0,minY:0,minZ:0,maxX:width-1,maxY:height-1,maxZ:length-1}});
}

function unpackLitematicIndex(longs,index,bits){
  const start=BigInt(index*bits),li=Number(start>>6n),off=Number(start&63n),mask=(1n<<BigInt(bits))-1n;
  let v=BigInt.asUintN(64,longs[li]??0n)>>BigInt(off);
  if(off+bits>64)v|=BigInt.asUintN(64,longs[li+1]??0n)<<BigInt(64-off);
  return Number(v&mask);
}
function vec(c){return{x:Number(c?.x||0),y:Number(c?.y||0),z:Number(c?.z||0)};}
function parseLitematic(root){
  const regions=root.Regions;if(!regions||typeof regions!=='object')throw new Error('Litematic file has no Regions compound');
  const blocks=[];let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const [regionName,r] of Object.entries(regions)){
    const pos=vec(r.Position),size=vec(r.Size),sx=Math.abs(size.x),sy=Math.abs(size.y),sz=Math.abs(size.z);
    if(!sx||!sy||!sz)continue;
    const origin={x:pos.x+(size.x<0?size.x+1:0),y:pos.y+(size.y<0?size.y+1:0),z:pos.z+(size.z<0?size.z+1:0)};
    minX=Math.min(minX,origin.x);minY=Math.min(minY,origin.y);minZ=Math.min(minZ,origin.z);maxX=Math.max(maxX,origin.x+sx-1);maxY=Math.max(maxY,origin.y+sy-1);maxZ=Math.max(maxZ,origin.z+sz-1);
    const palette=(r.BlockStatePalette||[]).map(p=>({id:cleanBlockName(p?.Name),state:compoundBlockState(p)}));
    const longs=r.BlockStates||[];const bits=Math.max(2,Math.ceil(Math.log2(Math.max(1,palette.length))));const volume=sx*sy*sz;
    for(let i=0;i<volume;i++){
      const pi=unpackLitematicIndex(longs,i,bits),entry=palette[pi]||{id:'air',state:'minecraft:air'},id=entry.id;if(isAir(id))continue;
      const y=Math.floor(i/(sx*sz)),rem=i-y*sx*sz,z=Math.floor(rem/sx),x=rem-z*sx;
      blocks.push({x:origin.x+x,y:origin.y+y,z:origin.z+z,id,state:entry.state,region:regionName});
    }
  }
  const name=root.Metadata?.Name||'Imported litematic';return makeBuild(blocks,{format:'Litematica',name,bounds:Number.isFinite(minX)?{minX,minY,minZ,maxX,maxY,maxZ}:undefined});
}

const COLORS=['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const WOODS=['oak','spruce','birch','jungle','acacia','dark_oak'];
function legacyName(id,meta){
  meta&=15;
  const simple={0:'air',2:'grass_block',4:'cobblestone',7:'bedrock',8:'water',9:'water',10:'lava',11:'lava',13:'gravel',14:'gold_ore',15:'iron_ore',16:'coal_ore',19:'sponge',20:'glass',21:'lapis_ore',22:'lapis_block',23:'dispenser',25:'note_block',27:'powered_rail',28:'detector_rail',29:'sticky_piston',30:'cobweb',32:'dead_bush',33:'piston',34:'piston_head',37:'dandelion',39:'brown_mushroom',40:'red_mushroom',41:'gold_block',42:'iron_block',45:'bricks',46:'tnt',47:'bookshelf',48:'mossy_cobblestone',49:'obsidian',50:'torch',52:'spawner',53:'oak_stairs',54:'chest',55:'redstone_wire',56:'diamond_ore',57:'diamond_block',58:'crafting_table',59:'wheat',60:'farmland',61:'furnace',62:'furnace',64:'oak_door',65:'ladder',66:'rail',67:'cobblestone_stairs',69:'lever',70:'stone_pressure_plate',71:'iron_door',72:'oak_pressure_plate',73:'redstone_ore',74:'redstone_ore',75:'redstone_torch',76:'redstone_torch',77:'stone_button',78:'snow',79:'ice',80:'snow_block',81:'cactus',82:'clay',83:'sugar_cane',84:'jukebox',85:'oak_fence',86:'pumpkin',87:'netherrack',88:'soul_sand',89:'glowstone',91:'jack_o_lantern',92:'cake',95:'white_stained_glass',96:'oak_trapdoor',101:'iron_bars',102:'glass_pane',103:'melon',106:'vine',107:'oak_fence_gate',108:'brick_stairs',109:'stone_brick_stairs',110:'mycelium',111:'lily_pad',112:'nether_bricks',113:'nether_brick_fence',114:'nether_brick_stairs',115:'nether_wart',116:'enchanting_table',117:'brewing_stand',118:'cauldron',120:'end_portal_frame',121:'end_stone',122:'dragon_egg',123:'redstone_lamp',124:'redstone_lamp',128:'sandstone_stairs',129:'emerald_ore',130:'ender_chest',131:'tripwire_hook',133:'emerald_block',134:'spruce_stairs',135:'birch_stairs',136:'jungle_stairs',137:'command_block',138:'beacon',140:'flower_pot',141:'carrots',142:'potatoes',143:'oak_button',145:'anvil',146:'trapped_chest',147:'light_weighted_pressure_plate',148:'heavy_weighted_pressure_plate',151:'daylight_detector',152:'redstone_block',153:'nether_quartz_ore',154:'hopper',156:'quartz_stairs',157:'activator_rail',158:'dropper',165:'slime_block',166:'barrier',167:'iron_trapdoor',169:'sea_lantern',170:'hay_block',172:'terracotta',173:'coal_block',174:'packed_ice',179:'red_sandstone',180:'red_sandstone_stairs',198:'end_rod',199:'chorus_plant',200:'chorus_flower',201:'purpur_block',203:'purpur_stairs',205:'purpur_slab',206:'end_stone_bricks',208:'dirt_path',213:'magma_block',214:'nether_wart_block',215:'red_nether_bricks',216:'bone_block',217:'structure_void',218:'observer',255:'structure_block'};
  if(id===1)return ['stone','granite','polished_granite','diorite','polished_diorite','andesite','polished_andesite'][meta]||'stone';
  if(id===3)return ['dirt','coarse_dirt','podzol'][meta]||'dirt';
  if(id===5)return (WOODS[meta]||'oak')+'_planks';
  if(id===12)return meta===1?'red_sand':'sand';
  if(id===17)return (['oak','spruce','birch','jungle'][meta&3]||'oak')+'_log';
  if(id===18)return (['oak','spruce','birch','jungle'][meta&3]||'oak')+'_leaves';
  if(id===24)return ['sandstone','chiseled_sandstone','cut_sandstone'][meta]||'sandstone';
  if(id===35)return COLORS[meta]+'_wool';
  if(id===38)return ['poppy','blue_orchid','allium','azure_bluet','red_tulip','orange_tulip','white_tulip','pink_tulip','oxeye_daisy'][meta]||'poppy';
  if(id===44){const v=['stone_slab','sandstone_slab','petrified_oak_slab','cobblestone_slab','brick_slab','stone_brick_slab','nether_brick_slab','quartz_slab'];return v[meta&7]||'stone_slab';}
  if(id===95)return COLORS[meta]+'_stained_glass';
  if(id===97)return ['infested_stone','infested_cobblestone','infested_stone_bricks','infested_mossy_stone_bricks','infested_cracked_stone_bricks','infested_chiseled_stone_bricks'][meta]||'infested_stone';
  if(id===98)return ['stone_bricks','mossy_stone_bricks','cracked_stone_bricks','chiseled_stone_bricks'][meta]||'stone_bricks';
  if(id===126)return (WOODS[meta&7]||'oak')+'_slab';
  if(id===139)return meta===1?'mossy_cobblestone_wall':'cobblestone_wall';
  if(id===155)return ['quartz_block','chiseled_quartz_block','quartz_pillar'][meta]||'quartz_block';
  if(id===159)return COLORS[meta]+'_terracotta';
  if(id===160)return COLORS[meta]+'_stained_glass_pane';
  if(id===161)return (meta&1?'dark_oak':'acacia')+'_leaves';
  if(id===162)return (meta&1?'dark_oak':'acacia')+'_log';
  if(id===168)return ['prismarine','prismarine_bricks','dark_prismarine'][meta]||'prismarine';
  if(id===171)return COLORS[meta]+'_carpet';
  if(id===179)return ['red_sandstone','chiseled_red_sandstone','cut_red_sandstone'][meta]||'red_sandstone';
  if(id>=219&&id<=234)return COLORS[id-219]+'_shulker_box';
  if(id>=235&&id<=250)return COLORS[id-235]+'_glazed_terracotta';
  if(id===251)return COLORS[meta]+'_concrete';
  if(id===252)return COLORS[meta]+'_concrete_powder';
  return simple[id]||'stone';
}
function parseLegacy(root){
  const width=Number(root.Width),height=Number(root.Height),length=Number(root.Length),raw=root.Blocks,data=root.Data||new Uint8Array(raw?.length||0),add=root.AddBlocks;
  if(!(width>0&&height>0&&length>0)||!raw)throw new Error('Invalid legacy .schematic file');
  const total=width*height*length;if(raw.length<total)throw new Error('Legacy schematic Blocks array is too short');
  const blocks=[];
  for(let i=0;i<total;i++){
    let id=raw[i];if(add&&add.length){const nib=add[i>>1]||0;id|=((i&1)?(nib>>4):(nib&15))<<8;}
    const name=legacyName(id,data[i]||0);if(isAir(name))continue;
    const y=Math.floor(i/(width*length)),rem=i-y*width*length,z=Math.floor(rem/width),x=rem-z*width;blocks.push({x,y,z,id:name,state:'minecraft:'+name});
  }
  return makeBuild(blocks,{format:'Legacy .schematic',name:'Imported schematic',bounds:{minX:0,minY:0,minZ:0,maxX:width-1,maxY:height-1,maxZ:length-1}});
}

async function importFile(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase(),bytes=await decompressMaybe(new Uint8Array(await file.arrayBuffer())),parsed=new NBTReader(bytes).root().value;
  if(ext==='litematic'||ext==='litematica'||parsed.Regions)return parseLitematic(parsed);
  if(ext==='schem'||parsed.Version>=1&&(parsed.Palette||parsed.Blocks))return parseSponge(parsed);
  if(ext==='schematic'||parsed.Blocks instanceof Uint8Array)return parseLegacy(parsed);
  throw new Error('Unsupported schematic format. Use .schem, .schematic, .litematic, or .litematica.');
}

return{NBTReader,decompressMaybe,decodeVarInts,parseSponge,parseLitematic,parseLegacy,legacyName,importFile,makeBuild,cleanBlockName,normalizeBlockState,compoundBlockState,unpackLitematicIndex};
});
