(() => {
'use strict';
const RAW='https://raw.githubusercontent.com/PixiGeko/Minecraft-default-assets/latest/assets/minecraft/textures/block/';
const TREE='https://api.github.com/repos/PixiGeko/Minecraft-default-assets/git/trees/latest?recursive=1';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const canvas=$('#planner'), ctx=canvas.getContext('2d'), wrap=$('#canvasWrap');
ctx.imageSmoothingEnabled=false;

const state={
 tool:'brush', brushSize:1, zoom:1, baseCell:24, panX:0, panY:0, mirrorLines:[], mirrorHover:null, mirrorAngle:0,
 showGrid:true, showChunks:true, showCoords:true, autosave:true,
 current:'stone_bricks', blocks:[], blockMap:new Map(), textureCache:new Map(), palette:['stone_bricks'],
 layers:[{id:crypto.randomUUID(),name:'Layer 1',visible:true,cells:{}}], activeLayer:0,
 history:[], future:[], dragging:false, panning:false, spacePan:false, start:null, hover:null,
 preview:[], polygon:[], curveStage:null, reference:null, refOpacity:.35, refScale:1
};

function pretty(id){return id.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function texUrl(path){return RAW+path.replace(/^assets\/minecraft\/textures\/block\//,'')}
function cellKey(x,y){return x+','+y}
function layer(){return state.layers[state.activeLayer]}
function snapshot(){return JSON.stringify({layers:state.layers,activeLayer:state.activeLayer,palette:state.palette})}
function pushHistory(){state.history.push(snapshot());if(state.history.length>80)state.history.shift();state.future=[]}
function restore(s){const v=JSON.parse(s);state.layers=v.layers;state.activeLayer=Math.min(v.activeLayer,v.layers.length-1);state.palette=v.palette||[];renderUI();draw();autosave()}
function undo(){if(!state.history.length)return;state.future.push(snapshot());restore(state.history.pop())}
function redo(){if(!state.future.length)return;state.history.push(snapshot());restore(state.future.pop())}

function guessTexture(id, textures){
 const candidates=[id,
  id.replace(/_(stairs|slab|wall|fence|fence_gate|button|pressure_plate)$/,'_planks'),
  id.replace(/_(stairs|slab|wall)$/,''),
  id.replace(/_wall$/,''),
  id.replace(/_(door|trapdoor)$/,'_planks'),
  id.replace(/_(sign|hanging_sign)$/,'_planks'),
  id.replace(/^waxed_/,''),
  id+'_side',id+'_top',
 ];
 const wood=id.match(/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_/);
 if(wood)candidates.push(wood[1]+(wood[1]==='bamboo'?'_planks':'_planks'));
 const copper=id.includes('copper')?[id.replace(/_(stairs|slab|grate|door|trapdoor|bulb).*$/,''),id.replace(/^waxed_/,'')]:[];
 for(const c of [...candidates,...copper]) if(textures.has(c+'.png')) return c+'.png';
 const prefix=[...textures].find(t=>t.startsWith(id+'_')&&t.endsWith('.png'));
 return prefix||'stone.png';
}

async function loadBlocks(){
 try{
  const r=await fetch(TREE); if(!r.ok)throw new Error('GitHub '+r.status);
  const j=await r.json(); const paths=j.tree.filter(x=>x.type==='blob').map(x=>x.path);
  const texPaths=paths.filter(p=>p.startsWith('assets/minecraft/textures/block/')&&p.endsWith('.png'));
  const textures=new Set(texPaths.map(p=>p.split('/').pop()));
  const ids=paths.filter(p=>p.startsWith('assets/minecraft/blockstates/')&&p.endsWith('.json')).map(p=>p.split('/').pop().replace('.json','')).sort();
  state.blocks=ids.map(id=>({id,name:pretty(id),texture:guessTexture(id,textures)}));
  state.blockMap=new Map(state.blocks.map(b=>[b.id,b]));
  if(!state.blockMap.has(state.current)) state.current=state.blocks[0]?.id||'stone';
  $('#loadingBlocks').classList.add('hidden'); renderBlockPicker(); updateCurrentBlock(); draw();
 }catch(e){
  console.error(e);
  const fallback=['stone','stone_bricks','cobblestone','oak_planks','spruce_planks','deepslate_bricks','bricks','glass','white_concrete','black_concrete','grass_block','dirt','sand','netherrack','obsidian'];
  state.blocks=fallback.map(id=>({id,name:pretty(id),texture:id==='grass_block'?'grass_block_top.png':id+'.png'}));
  state.blockMap=new Map(state.blocks.map(b=>[b.id,b])); $('#loadingBlocks').textContent='Offline block list loaded'; renderBlockPicker(); updateCurrentBlock(); draw();
 }
}

function getImage(id){
 const b=state.blockMap.get(id)||{texture:id+'.png'}; const key=b.texture;
 if(state.textureCache.has(key))return state.textureCache.get(key);
 const img=new Image(); img.crossOrigin='anonymous'; img.src=texUrl(key); img.onload=draw; img.onerror=()=>{};
 state.textureCache.set(key,img); return img;
}
function drawTexture(img,dx,dy,s){
 if(!img||!img.complete||!img.naturalWidth)return;
 const frame=Math.min(img.naturalWidth,img.naturalHeight);
 ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0,frame,frame,dx,dy,s,s);
}

let lastWrapW=0,lastWrapH=0;
function resize(force=false){
 const d=devicePixelRatio||1, r=wrap.getBoundingClientRect();
 const w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
 const oldW=lastWrapW,oldH=lastWrapH;
 if(!force && Math.abs(w-oldW)<1 && Math.abs(h-oldH)<1)return;
 lastWrapW=w;lastWrapH=h;
 canvas.width=Math.max(1,Math.floor(w*d));
 canvas.height=Math.max(1,Math.floor(h*d));
 canvas.style.width=w+'px';
 canvas.style.height=h+'px';
 ctx.setTransform(d,0,0,d,0,0);
 ctx.imageSmoothingEnabled=false;
 if(!state.panX&&!state.panY){state.panX=w/2;state.panY=h/2}
 else if(oldW&&oldH){
   state.panX+=(w-oldW)/2;
   state.panY+=(h-oldH)/2;
 }
 draw();
}
function cellSize(){return state.baseCell*state.zoom}
function screenToCell(clientX,clientY){
 const r=canvas.getBoundingClientRect(), s=cellSize();
 return {x:Math.floor((clientX-r.left-state.panX)/s),y:Math.floor((clientY-r.top-state.panY)/s)};
}
function screenToGridIntersection(clientX,clientY){
 const r=canvas.getBoundingClientRect(),s=cellSize();
 return {x:Math.round((clientX-r.left-state.panX)/s),y:Math.round((clientY-r.top-state.panY)/s)};
}
function cellToScreen(x,y){const s=cellSize();return{x:state.panX+x*s,y:state.panY+y*s}}

function draw(){
 const r=canvas.getBoundingClientRect(), s=cellSize();ctx.clearRect(0,0,r.width,r.height);ctx.fillStyle='#0e1011';ctx.fillRect(0,0,r.width,r.height);
 const minX=Math.floor(-state.panX/s)-1,maxX=Math.ceil((r.width-state.panX)/s)+1,minY=Math.floor(-state.panY/s)-1,maxY=Math.ceil((r.height-state.panY)/s)+1;
 if(state.reference?.img){ctx.save();ctx.globalAlpha=state.refOpacity;const img=state.reference.img;const w=img.width*state.refScale,h=img.height*state.refScale;ctx.drawImage(img,state.panX-w/2,state.panY-h/2,w,h);ctx.restore()}
 for(let li=0;li<state.layers.length;li++){
  const L=state.layers[li];if(!L.visible)continue;ctx.globalAlpha=li===state.activeLayer?1:.78;
  for(const [k,id] of Object.entries(L.cells)){const [x,y]=k.split(',').map(Number);if(x<minX||x>maxX||y<minY||y>maxY)continue;const p=cellToScreen(x,y);drawTexture(getImage(id),p.x,p.y,s)}
 }
 ctx.globalAlpha=1;
 if(state.preview.length){ctx.globalAlpha=.66;for(const p of mirrorPreview(state.preview)){const q=cellToScreen(p.x,p.y);drawTexture(getImage(state.current),q.x,q.y,s)}ctx.globalAlpha=1}
 if(state.showGrid&&s>=6){ctx.beginPath();ctx.strokeStyle='#2a2e3188';ctx.lineWidth=1;for(let x=minX;x<=maxX;x++){const px=Math.round(state.panX+x*s)+.5;ctx.moveTo(px,0);ctx.lineTo(px,r.height)}for(let y=minY;y<=maxY;y++){const py=Math.round(state.panY+y*s)+.5;ctx.moveTo(0,py);ctx.lineTo(r.width,py)}ctx.stroke()}
 if(state.showChunks&&s>=4){ctx.beginPath();ctx.strokeStyle='#506057aa';ctx.lineWidth=1.5;for(let x=Math.floor(minX/16)*16;x<=maxX;x+=16){const px=Math.round(state.panX+x*s)+.5;ctx.moveTo(px,0);ctx.lineTo(px,r.height)}for(let y=Math.floor(minY/16)*16;y<=maxY;y+=16){const py=Math.round(state.panY+y*s)+.5;ctx.moveTo(0,py);ctx.lineTo(r.width,py)}ctx.stroke()}
 if(state.showCoords&&s>=14){ctx.fillStyle='#778087';ctx.font='9px system-ui';ctx.textAlign='center';for(let x=Math.ceil(minX/8)*8;x<=maxX;x+=8)ctx.fillText(x,state.panX+(x+.5)*s,11);ctx.textAlign='left';for(let y=Math.ceil(minY/8)*8;y<=maxY;y+=8)ctx.fillText(y,3,state.panY+(y+.65)*s)}
 function drawMirrorAxis(line,preview=false){
   const a=cellToScreen(line.x,line.y),ang=line.angle*Math.PI/180,ux=Math.cos(ang),uy=Math.sin(ang),ext=Math.max(r.width,r.height)*2;
   ctx.save();ctx.globalAlpha=preview ? .48 : 1;ctx.beginPath();ctx.moveTo(a.x-ux*ext,a.y-uy*ext);ctx.lineTo(a.x+ux*ext,a.y+uy*ext);
   ctx.strokeStyle=preview?'#9be7ff':'#71d58a';ctx.lineWidth=preview?1.5:2;ctx.setLineDash(preview?[6,6]:[10,6]);ctx.stroke();ctx.setLineDash([]);
   ctx.fillStyle=preview?'#9be7ff':'#71d58a';ctx.beginPath();ctx.arc(a.x,a.y,preview?3:4,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 for(const ml of state.mirrorLines)drawMirrorAxis(ml,false);
 if(state.tool==='mirror'&&state.mirrorHover)drawMirrorAxis({x:state.mirrorHover.x,y:state.mirrorHover.y,angle:state.mirrorAngle},true);
 if(state.hover&&state.tool!=='pan'&&state.tool!=='mirror'){const p=cellToScreen(state.hover.x,state.hover.y);ctx.strokeStyle='#fff9';ctx.lineWidth=1.5;ctx.strokeRect(p.x+.75,p.y+.75,s-1.5,s-1.5)}
}

function reflectCellAcrossLine(x,y,line){
 const px=x+.5,py=y+.5,ax=line.x,ay=line.y,ang=line.angle*Math.PI/180,vx=Math.cos(ang),vy=Math.sin(ang);
 const t=(px-ax)*vx+(py-ay)*vy,qx=ax+t*vx,qy=ay+t*vy,rx=2*qx-px,ry=2*qy-py;
 return {x:Math.round(rx-.5),y:Math.round(ry-.5)};
}
function symmetryClosure(x,y){
 if(!state.mirrorLines.length)return [[x,y]];
 const seen=new Map(),queue=[{x,y}],limit=64;
 while(queue.length&&seen.size<limit){
   const p=queue.shift(),k=p.x+','+p.y;if(seen.has(k))continue;seen.set(k,[p.x,p.y]);
   for(const line of state.mirrorLines){const r=reflectCellAcrossLine(p.x,p.y,line),rk=r.x+','+r.y;if(!seen.has(rk))queue.push(r)}
 }
 return [...seen.values()];
}
function mirroredPoints(x,y){return symmetryClosure(x,y)}
function mirrorPreview(points){
 if(!state.mirrorLines.length)return points;
 const out=[];
 for(const p of points)for(const [x,y] of symmetryClosure(p.x,p.y))out.push({x,y});
 return uniq(out);
}
function paintAt(x,y,id=state.current,erase=false){
 const bs=state.brushSize, half=Math.floor(bs/2);
 for(let ox=-half;ox<bs-half;ox++)for(let oy=-half;oy<bs-half;oy++)for(const [mx,my] of mirroredPoints(x+ox,y+oy)){
  const k=cellKey(mx,my);if(erase)delete layer().cells[k];else layer().cells[k]=id;
 }
}
function bresenham(a,b){let pts=[],x0=a.x,y0=a.y,x1=b.x,y1=b.y,dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;while(true){pts.push({x:x0,y:y0});if(x0===x1&&y0===y1)break;let e=2*err;if(e>=dy){err+=dy;x0+=sx}if(e<=dx){err+=dx;y0+=sy}}return pts}
function rectPts(a,b){const pts=[];for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++){pts.push({x,y:a.y},{x,y:b.y})}for(let y=Math.min(a.y,b.y)+1;y<Math.max(a.y,b.y);y++){pts.push({x:a.x,y},{x:b.x,y})}return uniq(pts)}
function ellipsePts(a,b,circle=false){let cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=circle?rx:Math.abs(b.y-a.y)/2;if(circle)ry=rx;const pts=[];for(let t=0;t<Math.PI*2;t+=1/Math.max(12,(rx+ry)*3)){pts.push({x:Math.round(cx+rx*Math.cos(t)),y:Math.round(cy+ry*Math.sin(t))})}return uniq(pts)}
function trianglePts(a,b){const top={x:Math.round((a.x+b.x)/2),y:a.y},l={x:a.x,y:b.y},r={x:b.x,y:b.y};return uniq([...bresenham(top,l),...bresenham(l,r),...bresenham(r,top)])}
function polygonOutline(points){let out=[];for(let i=0;i<points.length;i++)out.push(...bresenham(points[i],points[(i+1)%points.length]));return uniq(out)}
function uniq(p){return [...new Map(p.map(v=>[v.x+','+v.y,v])).values()]}
function toolPreview(a,b){
 if(state.tool==='line')return bresenham(a,b);if(state.tool==='rectangle')return rectPts(a,b);if(state.tool==='circle')return ellipsePts(a,b,true);if(state.tool==='ellipse')return ellipsePts(a,b,false);if(state.tool==='triangle')return trianglePts(a,b);return[];
}
function commitPoints(points){for(const p of points)paintAt(p.x,p.y);state.preview=[];renderUI();draw();autosave()}
function flood(start){
 const L=layer(), target=L.cells[cellKey(start.x,start.y)]||null,repl=state.current;if(target===repl)return;pushHistory();const q=[start],seen=new Set(),limit=25000;
 while(q.length&&seen.size<limit){const p=q.shift(),k=cellKey(p.x,p.y);if(seen.has(k))continue;seen.add(k);const v=L.cells[k]||null;if(v!==target)continue;paintAt(p.x,p.y,repl,false);q.push({x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1})}
 renderUI();draw();autosave();
}

function pointerDown(e){
 const p=screenToCell(e.clientX,e.clientY);state.start=p;state.dragging=true;
 if(e.button===1||state.tool==='pan'||state.spacePan){state.panning=true;state.start={x:e.clientX,y:e.clientY,panX:state.panX,panY:state.panY};return}
 if(state.tool==='mirror'){
   state.dragging=false;
   if(e.button===2){state.mirrorLines.pop();updateMirrorStatus();draw();autosave();return}
   const g=screenToGridIntersection(e.clientX,e.clientY);
   state.mirrorLines.push({x:g.x,y:g.y,angle:state.mirrorAngle});
   updateMirrorStatus();draw();autosave();return;
 }
 if(e.button===2){pushHistory();paintAt(p.x,p.y,null,true);draw();return}
 if(state.tool==='picker'){const id=topCell(p.x,p.y);if(id)setCurrent(id);state.dragging=false;return}
 if(state.tool==='fill'){flood(p);state.dragging=false;return}
 if(state.tool==='polygon'){if(!state.polygon.length)pushHistory();state.polygon.push(p);state.preview=polygonOutline([...state.polygon,p]);draw();return}
 if(['brush','eraser'].includes(state.tool)){pushHistory();paintAt(p.x,p.y,state.current,state.tool==='eraser');draw();return}
 if(state.tool==='curve'&&state.curveStage){return}
 pushHistory();
}
function pointerMove(e){
 const p=screenToCell(e.clientX,e.clientY);state.hover=p;$('#coordStatus').textContent='X '+p.x+' · Z '+p.y;
 if(state.panning){state.panX=state.start.panX+(e.clientX-state.start.x);state.panY=state.start.panY+(e.clientY-state.start.y);draw();return}
 if(state.tool==='mirror'){state.mirrorHover=screenToGridIntersection(e.clientX,e.clientY);draw();return}
 if(!state.dragging){if(state.tool==='polygon'&&state.polygon.length)state.preview=polygonOutline([...state.polygon,p]);if(state.curveStage?.end)state.preview=bezierPts(state.curveStage.start,p,state.curveStage.end);draw();return}
 if(['brush','eraser'].includes(state.tool)){paintAt(p.x,p.y,state.current,state.tool==='eraser');draw();return}
 if(['line','rectangle','circle','ellipse','triangle'].includes(state.tool)){state.preview=toolPreview(state.start,p);draw()}
 if(state.tool==='curve'&&!state.curveStage){state.preview=bresenham(state.start,p);draw()}
}
function pointerUp(e){
 if(state.panning){state.panning=false;state.dragging=false;autosave();return}
 if(!state.dragging)return;const p=screenToCell(e.clientX,e.clientY);
 if(['line','rectangle','circle','ellipse','triangle'].includes(state.tool))commitPoints(toolPreview(state.start,p));
 else if(state.tool==='curve'&&!state.curveStage){state.curveStage={start:state.start,end:p,ready:false};state.preview=bresenham(state.start,p);setTimeout(()=>{if(state.curveStage)state.curveStage.ready=true},0)}
 else if(['brush','eraser'].includes(state.tool)){renderUI();autosave()}
 state.dragging=false;
}
function bezierPts(a,c,b){let pts=[];let prev=a;for(let t=.03;t<=1.001;t+=.03){const u=1-t,p={x:Math.round(u*u*a.x+2*u*t*c.x+t*t*b.x),y:Math.round(u*u*a.y+2*u*t*c.y+t*t*b.y)};pts.push(...bresenham(prev,p));prev=p}return uniq(pts)}
function topCell(x,y){for(let i=state.layers.length-1;i>=0;i--)if(state.layers[i].visible&&state.layers[i].cells[cellKey(x,y)])return state.layers[i].cells[cellKey(x,y)];return null}

function renderBlockPicker(filter=''){
 const grid=$('#blockGrid'),q=filter.trim().toLowerCase();const arr=state.blocks.filter(b=>!q||b.name.toLowerCase().includes(q)||b.id.includes(q));
 $('#blockCountLabel').textContent=arr.length.toLocaleString()+' blocks';grid.innerHTML='';
 const frag=document.createDocumentFragment();for(const b of arr.slice(0,800)){const el=document.createElement('button');el.className='block-card'+(b.id===state.current?' selected':'');el.title=b.name;el.innerHTML='<img loading="lazy" src="'+texUrl(b.texture)+'" alt=""><span>'+b.name+'</span>';el.onclick=()=>{setCurrent(b.id);closeModal('blockModal')};frag.appendChild(el)}grid.appendChild(frag);
}
function setCurrent(id){if(!state.blockMap.has(id))return;state.current=id;if(!state.palette.includes(id))state.palette.unshift(id);updateCurrentBlock();renderPalette();draw()}
function updateCurrentBlock(){const b=state.blockMap.get(state.current);if(!b)return;$('#currentBlockName').textContent=b.name;$('#currentBlockImg').src=texUrl(b.texture)}
function countMaterials(){const m=new Map();for(const L of state.layers)for(const id of Object.values(L.cells))m.set(id,(m.get(id)||0)+1);return m}
function renderPalette(){const m=countMaterials(),el=$('#palette');el.innerHTML='';for(const id of state.palette){const b=state.blockMap.get(id);if(!b)continue;const btn=document.createElement('button');btn.className='palette-item'+(id===state.current?' active':'');btn.title=b.name;btn.innerHTML='<img src="'+texUrl(b.texture)+'"><em>'+(m.get(id)||0)+'</em>';btn.onclick=()=>setCurrent(id);el.appendChild(btn)}}
function renderLayers(){const el=$('#layers');el.innerHTML='';state.layers.forEach((L,i)=>{const row=document.createElement('div');row.className='layer-row'+(i===state.activeLayer?' active':'');row.innerHTML='<button title="Visibility">'+(L.visible?'◉':'○')+'</button><div class="layer-name">'+L.name+'<small> · '+Object.keys(L.cells).length+' blocks</small></div><button title="Rename">✎</button><button title="Delete">×</button>';row.onclick=()=>{state.activeLayer=i;renderLayers();draw()};row.children[0].onclick=e=>{e.stopPropagation();L.visible=!L.visible;renderLayers();draw();autosave()};row.children[2].onclick=e=>{e.stopPropagation();const n=prompt('Layer name',L.name);if(n){L.name=n;renderLayers();autosave()}};row.children[3].onclick=e=>{e.stopPropagation();if(state.layers.length===1)return;if(confirm('Delete '+L.name+'?')){pushHistory();state.layers.splice(i,1);state.activeLayer=Math.max(0,Math.min(state.activeLayer,state.layers.length-1));renderUI();draw();autosave()}};el.appendChild(row)})}
function renderMaterials(){const m=countMaterials(),total=[...m.values()].reduce((a,b)=>a+b,0);$('#totalBlocks').textContent=total.toLocaleString()+' blocks';const el=$('#materials');el.innerHTML='';if(!total){el.innerHTML='<div class="empty">Nothing placed yet.</div>';return}for(const [id,n] of [...m].sort((a,b)=>b[1]-a[1])){const b=state.blockMap.get(id)||{name:pretty(id),texture:id+'.png'},stacks=n/64,chests=n/1728;const d=document.createElement('div');d.className='material';d.innerHTML='<img src="'+texUrl(b.texture)+'"><div><strong>'+b.name+'</strong><small>'+Math.floor(n/64)+' stacks + '+(n%64)+' · '+chests.toFixed(2)+' chests</small></div><div class="material-count">'+n.toLocaleString()+'</div>';el.appendChild(d)}}
function renderUI(){renderPalette();renderLayers();renderMaterials();updateUndoRedo()}
function updateUndoRedo(){$('#undoBtn').disabled=!state.history.length;$('#redoBtn').disabled=!state.future.length}

function autosave(){if(!state.autosave)return;try{localStorage.setItem('mc-planner-v1',JSON.stringify(projectData()))}catch(e){}}
function projectData(){return{version:1,layers:state.layers,activeLayer:state.activeLayer,palette:state.palette,current:state.current,panX:state.panX,panY:state.panY,zoom:state.zoom,mirrorLines:state.mirrorLines,mirrorAngle:state.mirrorAngle,settings:{grid:state.showGrid,chunks:state.showChunks,coords:state.showCoords}}}
function loadProject(v){if(!v||!Array.isArray(v.layers))throw Error('Invalid project');state.layers=v.layers;state.activeLayer=v.activeLayer||0;state.palette=v.palette||[];state.current=v.current||'stone_bricks';state.panX=v.panX??state.panX;state.panY=v.panY??state.panY;state.zoom=v.zoom||1;state.mirrorLines=Array.isArray(v.mirrorLines)?v.mirrorLines:(v.mirrorLine?[{x:v.mirrorLine.a?.x??0,y:v.mirrorLine.a?.y??0,angle:0}]:[]);state.mirrorAngle=Number.isFinite(v.mirrorAngle)?v.mirrorAngle:0;updateMirrorStatus();if(v.settings){state.showGrid=v.settings.grid!==false;state.showChunks=v.settings.chunks!==false;state.showCoords=v.settings.coords!==false}state.history=[];state.future=[];syncSettings();renderUI();draw();autosave()}
function download(name,data,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportImage(){
 const oldHover=state.hover,oldPrev=state.preview;state.hover=null;state.preview=[];draw();
 canvas.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mc-planner.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);state.hover=oldHover;state.preview=oldPrev;draw()},'image/png')
}
function exportPdf(){if(!window.jspdf){alert('PDF library did not load. Try Export PNG.');return}const old=state.hover;state.hover=null;draw();const img=canvas.toDataURL('image/png');const {jsPDF}=window.jspdf;const landscape=canvas.width>=canvas.height;const pdf=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'px',format:[canvas.width,canvas.height]});pdf.addImage(img,'PNG',0,0,canvas.width,canvas.height);pdf.save('mc-planner.pdf');state.hover=old;draw()}

function openModal(id){$('#'+id).classList.remove('hidden');if(id==='blockModal'){renderBlockPicker($('#blockSearch').value);setTimeout(()=>$('#blockSearch').focus(),30)}}
function closeModal(id){$('#'+id).classList.add('hidden')}
function syncSettings(){$('#gridToggle').checked=state.showGrid;$('#chunkToggle').checked=state.showChunks;$('#coordsToggle').checked=state.showCoords;$('#autosaveToggle').checked=state.autosave}

$$('.tool').forEach(b=>b.onclick=()=>{$$('.tool').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.tool=b.dataset.tool;state.preview=[];state.polygon=[];state.curveStage=null;state.mirrorHover=null;$('#mirrorControls').classList.toggle('hidden',state.tool!=='mirror');canvas.style.cursor=state.tool==='pan'?'grab':'crosshair';draw()});
function updateMirrorStatus(){const el=$('#mirrorStatus');if(!el)return;$('#mirrorCount').textContent=state.mirrorLines.length;el.classList.toggle('hidden',!state.mirrorLines.length)}
function setMirrorAngle(v){state.mirrorAngle=((+v%180)+180)%180;$('#mirrorAngle').value=state.mirrorAngle;$('#mirrorAngleLabel').textContent=state.mirrorAngle+'°';draw()}
$('#mirrorAngle').oninput=e=>setMirrorAngle(e.target.value);
$$('.mirror-presets button').forEach(b=>b.onclick=()=>setMirrorAngle(b.dataset.angle));
$('#undoMirrorBtn').onclick=()=>{state.mirrorLines.pop();updateMirrorStatus();draw();autosave()};
$('#clearMirrorBtn').onclick=()=>{state.mirrorLines=[];state.mirrorHover=null;updateMirrorStatus();draw();autosave()};
const workspace=$('.workspace');
function setPanelState(side,collapsed){
 workspace.classList.toggle(side+'-collapsed',collapsed);
 const btn=side==='left'?$('#leftCollapse'):$('#rightCollapse');
 btn.textContent=side==='left'?(collapsed?'›':'‹'):(collapsed?'‹':'›');
 btn.title=(collapsed?'Open ':'Collapse ')+(side==='left'?'tools':'details');
 requestAnimationFrame(()=>requestAnimationFrame(()=>resize(true)));
 setTimeout(()=>resize(true),80);
 setTimeout(()=>resize(true),220);
 setTimeout(()=>resize(true),320);
}
$('#leftCollapse').onclick=()=>setPanelState('left',!workspace.classList.contains('left-collapsed'));
$('#rightCollapse').onclick=()=>setPanelState('right',!workspace.classList.contains('right-collapsed'));
$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$$('.modal').forEach(m=>m.addEventListener('mousedown',e=>{if(e.target===m)closeModal(m.id)}));
$('#currentBlock').onclick=$('#chooseBlockBtn').onclick=()=>openModal('blockModal');$('#blockSearch').oninput=e=>renderBlockPicker(e.target.value);
$('#settingsBtn').onclick=()=>openModal('settingsModal');$('#helpBtn').onclick=()=>openModal('helpModal');$('#referenceBtn').onclick=()=>openModal('referenceModal');
$('#brushSize').oninput=e=>{state.brushSize=+e.target.value;$('#brushSizeLabel').textContent=e.target.value};
$('#gridToggle').onchange=e=>{state.showGrid=e.target.checked;draw();autosave()};$('#chunkToggle').onchange=e=>{state.showChunks=e.target.checked;draw();autosave()};$('#coordsToggle').onchange=e=>{state.showCoords=e.target.checked;draw();autosave()};$('#autosaveToggle').onchange=e=>state.autosave=e.target.checked;
$('#addLayerBtn').onclick=()=>{pushHistory();state.layers.push({id:crypto.randomUUID(),name:'Layer '+(state.layers.length+1),visible:true,cells:{}});state.activeLayer=state.layers.length-1;renderUI();draw();autosave()};
$('#clearPaletteBtn').onclick=()=>{const used=countMaterials();state.palette=state.palette.filter(id=>used.has(id)||id===state.current);renderPalette();autosave()};
$('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;
$('#newBtn').onclick=()=>{if(!confirm('Start a new plan?'))return;pushHistory();state.layers=[{id:crypto.randomUUID(),name:'Layer 1',visible:true,cells:{}}];state.activeLayer=0;state.palette=[state.current];state.mirrorLines=[];state.mirrorHover=null;updateMirrorStatus();renderUI();draw();autosave()};
$('#saveBtn').onclick=()=>download('mc-planner.mcplan',JSON.stringify(projectData()),'application/json');
$('#importBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{loadProject(JSON.parse(await f.text()))}catch(err){alert('Could not open that MC Planner file.')}e.target.value=''};
$('#exportBtn').onclick=exportImage;$('#pdfBtn').onclick=exportPdf;
$('#zoomIn').onclick=()=>zoomAt(1.2);$('#zoomOut').onclick=()=>zoomAt(1/1.2);$('#zoomReset').onclick=()=>{state.zoom=1;updateZoom();draw()};
function zoomAt(f,cx=wrap.clientWidth/2,cy=wrap.clientHeight/2){const old=cellSize(),nz=Math.max(.15,Math.min(6,state.zoom*f)),nw=state.baseCell*nz;state.panX=cx-(cx-state.panX)*(nw/old);state.panY=cy-(cy-state.panY)*(nw/old);state.zoom=nz;updateZoom();draw()}
function updateZoom(){$('#zoomStatus').textContent=Math.round(state.zoom*100)+'%';$('#zoomReset').textContent=Math.round(state.zoom*100)+'%'}
$('#uploadReference').onclick=()=>$('#referenceInput').click();$('#referenceInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const img=new Image();img.onload=()=>{state.reference={img};draw()};img.src=URL.createObjectURL(f)};
$('#referenceOpacity').oninput=e=>{state.refOpacity=+e.target.value;draw()};$('#referenceScale').oninput=e=>{state.refScale=+e.target.value;draw()};$('#clearReference').onclick=()=>{state.reference=null;draw()};

canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('mousedown',pointerDown);window.addEventListener('mousemove',pointerMove);window.addEventListener('mouseup',pointerUp);
canvas.addEventListener('dblclick',e=>{if(state.tool==='polygon'&&state.polygon.length>2){commitPoints(polygonOutline(state.polygon));state.polygon=[];state.dragging=false}else if(state.tool==='curve'&&state.curveStage?.end){const c=screenToCell(e.clientX,e.clientY);commitPoints(bezierPts(state.curveStage.start,c,state.curveStage.end));state.curveStage=null}});
canvas.addEventListener('click',e=>{if(state.tool==='curve'&&state.curveStage?.end&&state.curveStage.ready&&!state.dragging){const c=screenToCell(e.clientX,e.clientY);commitPoints(bezierPts(state.curveStage.start,c,state.curveStage.end));state.curveStage=null}});
canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoomAt(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top)},{passive:false});
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}else if(e.code==='Space'&&!/INPUT/.test(document.activeElement.tagName)){e.preventDefault();state.spacePan=true;canvas.style.cursor='grab'}else if(e.key==='Escape'){state.preview=[];state.polygon=[];state.curveStage=null;state.mirrorHover=null;$$('.modal:not(.hidden)').forEach(m=>m.classList.add('hidden'));draw()}else{const map={b:'brush',e:'eraser',f:'fill',i:'picker',l:'line',r:'rectangle',c:'circle',o:'ellipse',t:'triangle',p:'polygon',m:'mirror'};const t=map[e.key.toLowerCase()];if(t){const b=$('.tool[data-tool="'+t+'"]');b?.click()}}});
window.addEventListener('keyup',e=>{if(e.code==='Space'){state.spacePan=false;canvas.style.cursor=state.tool==='pan'?'grab':'crosshair'}});
window.addEventListener('resize',resize);
const wrapResizeObserver=new ResizeObserver(()=>resize(true));
wrapResizeObserver.observe(wrap);
workspace.addEventListener('transitionend',()=>resize(true));

(async function init(){if(innerWidth<900)setPanelState('right',true);resize();syncSettings();setMirrorAngle(state.mirrorAngle);updateMirrorStatus();await loadBlocks();try{const saved=localStorage.getItem('mc-planner-v1');if(saved)loadProject(JSON.parse(saved));else renderUI()}catch(e){renderUI()}updateZoom();})();
})();