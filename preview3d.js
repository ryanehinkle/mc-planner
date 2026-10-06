const THREE_URLS=[
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
  'https://unpkg.com/three@0.160.0/build/three.min.js'
];
const RENDERER_URLS=[
  'https://cdn.jsdelivr.net/npm/schematic-renderer@1.6.1/dist/schematic-renderer.umd.js',
  'https://unpkg.com/schematic-renderer@1.6.1/dist/schematic-renderer.umd.js'
];
const VANILLA_PACK_URL='https://raw.githubusercontent.com/Schem-at/schematic-renderer/master/test/public/pack.zip';

const modal=document.getElementById('preview3dModal');
const canvas=document.getElementById('preview3dCanvas');
const loading=document.getElementById('preview3dLoading');
const statusEl=document.getElementById('preview3dStatus');
const openBtn=document.getElementById('preview3dBtn');
const closeBtn=document.getElementById('preview3dClose');
const refreshBtn=document.getElementById('preview3dRefresh');
const perspectiveBtn=document.getElementById('preview3dPerspective');
const isoBtn=document.getElementById('preview3dIso');
const flyBtn=document.getElementById('preview3dFly');
const sliceBtn=document.getElementById('preview3dSlice');
const orbitBtn=document.getElementById('preview3dOrbit');
const shotBtn=document.getElementById('preview3dShot');

let renderer=null;
let api=null;
let readyPromise=null;
let readyResolve=null;
let fly=false;
let slicer=false;
let orbit=false;
let loadingProject=false;

function setLoading(on,title='Preparing 3D preview…',detail='Loading Minecraft renderer and resource pack'){
  loading.classList.toggle('hidden',!on);
  const b=loading.querySelector('b'),s=loading.querySelector('small');
  if(b)b.textContent=title;
  if(s)s.textContent=detail;
}
function setStatus(text){statusEl.textContent=text}
function setModeButton(active){
  [perspectiveBtn,isoBtn,flyBtn].forEach(b=>b.classList.remove('active'));
  active?.classList.add('active');
}
function normalizeState(id,state){
  let s=state||('minecraft:'+id);
  if(!s.includes(':'))s='minecraft:'+s;
  return s;
}
function projectBlocks(){
  const src=window.MCPlanner3DSource?.getProject?.();
  if(!src)throw new Error('Planner project data is not available yet.');
  const out=[];
  src.layers.forEach((layer,i)=>{
    const y=Number.isFinite(layer.sourceY)?layer.sourceY:i;
    for(const [key,id] of Object.entries(layer.cells||{})){
      const [x,z]=key.split(',').map(Number);
      if(!Number.isFinite(x)||!Number.isFinite(z)||!id||id==='air')continue;
      out.push({x,y,z,id,state:normalizeState(id,layer.states?.[key])});
    }
  });
  return out;
}
async function buildWrapper(SchematicWrapper){
  const blocks=projectBlocks();
  if(!blocks.length)throw new Error('Place some blocks before opening the 3D preview.');
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(const b of blocks){minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);minZ=Math.min(minZ,b.z);maxX=Math.max(maxX,b.x);maxY=Math.max(maxY,b.y);maxZ=Math.max(maxZ,b.z)}
  const wrapper=new SchematicWrapper();
  const total=blocks.length;
  for(let i=0;i<total;i++){
    const b=blocks[i],x=b.x-minX,y=b.y-minY,z=b.z-minZ;
    try{
      if(b.state.includes('[')&&typeof wrapper.set_block_from_string==='function')wrapper.set_block_from_string(x,y,z,b.state);
      else wrapper.set_block(x,y,z,b.state);
    }catch(err){
      console.warn('[3D Preview] Could not place block',b.state,x,y,z,err);
      try{wrapper.set_block(x,y,z,'minecraft:'+b.id)}catch{}
    }
    if(i&&i%4000===0){
      setLoading(true,'Building 3D project…',Math.round(i/total*100)+'% · '+i.toLocaleString()+' / '+total.toLocaleString()+' blocks');
      await new Promise(requestAnimationFrame);
    }
  }
  return{wrapper,count:total,size:[maxX-minX+1,maxY-minY+1,maxZ-minZ+1]};
}
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const existing=[...document.scripts].find(s=>s.src===src);
    if(existing){
      if(existing.dataset.loaded==='1')return resolve();
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Failed to load '+src)),{once:true});
      return;
    }
    const s=document.createElement('script');
    s.src=src;s.async=true;s.crossOrigin='anonymous';
    s.onload=()=>{s.dataset.loaded='1';resolve()};
    s.onerror=()=>{s.remove();reject(new Error('Failed to load '+src))};
    document.head.appendChild(s);
  });
}
async function loadFirst(urls,test,label){
  if(test())return;
  let lastErr=null;
  for(const url of urls){
    try{
      setStatus('Loading '+label+'…');
      await loadScript(url);
      if(test())return;
      lastErr=new Error(label+' loaded but did not expose its browser API');
    }catch(err){lastErr=err}
  }
  throw lastErr||new Error('Could not load '+label);
}

async function initRenderer(){
  if(renderer)return renderer;
  if(readyPromise)return readyPromise;
  setLoading(true);
  setStatus('Loading Schem-at renderer…');
  readyPromise=new Promise((resolve,reject)=>{
    readyResolve=resolve;
    setTimeout(()=>reject(new Error('3D renderer initialization timed out. Check WebGL/browser support.')),45000);
  });
  try{
    await loadFirst(THREE_URLS,()=>!!window.THREE,'Three.js');
    await loadFirst(RENDERER_URLS,()=>!!window.SchematicRenderer?.SchematicRenderer,'Schem-at renderer');
    api=window.SchematicRenderer;
  }catch(err){
    readyPromise=null;
    throw new Error('Could not load the 3D renderer: '+(err?.message||err));
  }
  const {SchematicRenderer}=api;
  renderer=new SchematicRenderer(
    canvas,
    {},
    {
      vanillaPack:async()=>{
        setLoading(true,'Loading vanilla resource pack…','One-time 3D texture/model load');
        const packUrls=[
          VANILLA_PACK_URL,
          'https://cdn.jsdelivr.net/gh/Schem-at/schematic-renderer@master/test/public/pack.zip'
        ];
        let lastErr=null;
        for(const url of packUrls){
          try{
            const r=await fetch(url);
            if(!r.ok)throw new Error('HTTP '+r.status);
            return new Blob([await r.arrayBuffer()],{type:'application/zip'});
          }catch(err){lastErr=err}
        }
        throw new Error('Could not load vanilla 3D resource pack: '+(lastErr?.message||lastErr));
      }
    },
    {
      backgroundColor:0x0b0d0e,
      gamma:0.5,
      showGrid:true,
      showAxes:false,
      enableInteraction:true,
      enableDragAndDrop:false,
      enableGizmos:false,
      singleSchematicMode:true,
      enableProgressBar:true,
      enableAnimatedTextures:true,
      enableAdaptiveFPS:true,
      targetFPS:60,
      idleFPS:1,
      cameraOptions:{useTightBounds:true,enableZoomInOnLoad:true,autoOrbitAfterZoom:false},
      interactionOptions:{enableSelection:false,enableMovingSchematics:false,enableBlockSelection:false},
      postProcessingOptions:{enabled:true,enableSSAO:true,enableSMAA:true,enableGamma:true},
      wasmMeshBuilderOptions:{enabled:true,greedyMeshingEnabled:false,maxWorkers:0},
      resourcePackOptions:{autoRebuild:true,showMissingPackNotice:false},
      sidebarOptions:{
        enabled:true,
        position:'right',
        width:320,
        collapsedByDefault:true,
        hiddenByDefault:false,
        defaultTab:'renderSettings',
        disabledTabs:['performance']
      },
      callbacks:{
        onRendererInitialized:(r)=>{
          setStatus('Renderer ready');
          readyResolve?.(r);
        },
        onSchematicRendered:()=>setLoading(false),
        onSchematicLoaded:()=>setStatus('3D project loaded')
      }
    }
  );
  canvas.schematicRenderer=renderer;
  window.mcPlanner3DRenderer=renderer;
  try{return await readyPromise}
  catch(err){readyPromise=null;renderer=null;api=null;throw err}
}
async function loadCurrentProject(){
  if(loadingProject)return;
  loadingProject=true;
  try{
    const r=await initRenderer();
    const {SchematicWrapper}=api;
    setLoading(true,'Building 3D project…','Converting planner layers into a Minecraft schematic');
    setStatus('Building current project…');
    const built=await buildWrapper(SchematicWrapper);
    await r.schematicManager.removeAllSchematics();
    await r.schematicManager.loadSchematic('MC Planner',built.wrapper,{focused:true});
    r.cameraManager.focusOnSchematics();
    r.invalidate?.();
    setStatus(built.count.toLocaleString()+' blocks · '+built.size.join(' × '));
    setLoading(false);
    setModeButton(perspectiveBtn);
    fly=false;flyBtn.classList.remove('active');
  }catch(err){
    console.error('[3D Preview]',err);
    setLoading(true,'Could not render 3D preview',err?.message||String(err));
    setStatus('Preview error');
  }finally{loadingProject=false}
}
async function openPreview(){
  modal.classList.remove('hidden');
  document.body.classList.add('preview3d-open');
  await loadCurrentProject();
}
function closePreview(){
  modal.classList.add('hidden');
  document.body.classList.remove('preview3d-open');
  if(renderer){
    renderer.setAutoOrbit?.(false);orbit=false;orbitBtn.classList.remove('active');
    renderer.cameraManager?.disableFlyControls?.();fly=false;flyBtn.classList.remove('active');
  }
}
openBtn?.addEventListener('click',openPreview);
closeBtn?.addEventListener('click',closePreview);
refreshBtn?.addEventListener('click',loadCurrentProject);
perspectiveBtn?.addEventListener('click',()=>{
  if(!renderer)return;renderer.cameraManager.disableFlyControls?.();fly=false;
  renderer.cameraManager.switchCameraPreset('perspective');renderer.cameraManager.focusOnSchematics();
  setModeButton(perspectiveBtn);
});
isoBtn?.addEventListener('click',()=>{
  if(!renderer)return;renderer.cameraManager.disableFlyControls?.();fly=false;
  renderer.cameraManager.switchCameraPreset('isometric');renderer.cameraManager.focusOnSchematics();
  setModeButton(isoBtn);
});
flyBtn?.addEventListener('click',()=>{
  if(!renderer)return;fly=!fly;
  if(fly){renderer.cameraManager.switchCameraPreset('perspective_fpv');renderer.cameraManager.enableFlyControls();setModeButton(flyBtn)}
  else{renderer.cameraManager.disableFlyControls();renderer.cameraManager.switchCameraPreset('perspective');renderer.cameraManager.focusOnSchematics();setModeButton(perspectiveBtn)}
});
sliceBtn?.addEventListener('click',()=>{
  if(!renderer)return;renderer.toggleSlicerOverlay();slicer=!slicer;sliceBtn.classList.toggle('active',slicer);
});
orbitBtn?.addEventListener('click',()=>{
  if(!renderer)return;orbit=!orbit;renderer.setAutoOrbit(orbit);orbitBtn.classList.toggle('active',orbit);
});
shotBtn?.addEventListener('click',async()=>{
  if(!renderer)return;
  shotBtn.disabled=true;
  try{await renderer.downloadScreenshot('mc-planner-3d',{format:'image/png',width:1920,height:1080})}
  finally{shotBtn.disabled=false}
});
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!modal.classList.contains('hidden')){e.stopPropagation();closePreview()}
},{capture:true});
window.addEventListener('resize',()=>{if(renderer&&!modal.classList.contains('hidden'))renderer.invalidate?.()});
