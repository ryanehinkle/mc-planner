const THREE_URLS=[
  'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js',
  'https://unpkg.com/three@0.184.0/build/three.module.js'
];
const BLOCK_TEXTURE_ROOT='https://raw.githubusercontent.com/PixiGeko/Minecraft-default-assets/latest/assets/minecraft/textures/block/';

const modal=document.getElementById('preview3dModal');
const canvas=document.getElementById('preview3dCanvas');
const stage=canvas?.parentElement;
const loading=document.getElementById('preview3dLoading');
const statusEl=document.getElementById('preview3dStatus');
const statsEl=document.getElementById('preview3dStats');
const hintEl=document.getElementById('preview3dHint');
const openBtn=document.getElementById('preview3dBtn');
const closeBtn=document.getElementById('preview3dClose');
const refreshBtn=document.getElementById('preview3dRefresh');
const perspectiveBtn=document.getElementById('preview3dPerspective');
const isoBtn=document.getElementById('preview3dIso');
const flyBtn=document.getElementById('preview3dFly');
const sliceBtn=document.getElementById('preview3dSlice');
const orbitBtn=document.getElementById('preview3dOrbit');
const shotBtn=document.getElementById('preview3dShot');
const slicePanel=document.getElementById('preview3dSlicePanel');
const sliceRange=document.getElementById('preview3dSliceRange');
const sliceValue=document.getElementById('preview3dSliceValue');

let THREE=null;
let webgl=null;
let scene=null;
let perspectiveCamera=null;
let orthoCamera=null;
let activeCamera=null;
let modelGroup=null;
let grid=null;
let catalog=null;
let faceCatalog=null;
let catalogPromise=null;
let initialized=false;
let building=false;
let visible=false;
let mode='perspective';
let autoOrbit=false;
let sliceEnabled=false;
let slicePlane=null;
let sliceMin=0;
let sliceMax=0;
let sliceY=0;
let centerY=0;
let boundsInfo=null;
let animationId=0;
let lastFrame=performance.now();
let flyYaw=0;
let flyPitch=0;
let flySpeed=0.12;
const flyKeys=new Set();
const textureCache=new Map();
const materialCache=new Map();

const orbit={
  target:null,
  radius:20,
  theta:Math.PI/4,
  phi:Math.PI/3,
  orthoHalf:10
};
const pointer={down:false,button:0,x:0,y:0,moved:false};

function setLoading(on,title='Preparing 3D preview…',detail='Loading the Minecraft scene'){
  if(!loading)return;
  loading.classList.toggle('hidden',!on);
  const b=loading.querySelector('b'),s=loading.querySelector('small');
  if(b)b.textContent=title;
  if(s)s.textContent=detail;
}
function setStatus(text){if(statusEl)statusEl.textContent=text}
function setModeButton(active){
  [perspectiveBtn,isoBtn,flyBtn].forEach(b=>b?.classList.remove('active'));
  active?.classList.add('active');
}
function parseState(state){
  const out={};
  const m=String(state||'').match(/\[([^\]]+)\]/);
  if(!m)return out;
  for(const pair of m[1].split(',')){
    const i=pair.indexOf('=');
    if(i>0)out[pair.slice(0,i)]=pair.slice(i+1);
  }
  return out;
}
function projectBlocks(){
  const src=window.MCPlanner3DSource?.getProject?.();
  if(!src)throw new Error('Planner project data is not available yet.');
  const out=[];
  src.layers.forEach((layer,i)=>{
    const y=Number.isFinite(layer.sourceY)?layer.sourceY:i;
    for(const [key,id] of Object.entries(layer.cells||{})){
      if(!id||id==='air'||id==='cave_air'||id==='void_air')continue;
      const [x,z]=key.split(',').map(Number);
      if(!Number.isFinite(x)||!Number.isFinite(z))continue;
      out.push({x,y,z,id,state:layer.states?.[key]||('minecraft:'+id)});
    }
  });
  return out;
}
async function loadThree(){
  if(THREE)return THREE;
  let lastErr=null;
  for(const url of THREE_URLS){
    try{
      setStatus('Loading 3D engine…');
      const mod=await import(url);
      if(!mod?.WebGLRenderer||!mod?.Scene||!mod?.InstancedMesh)throw new Error('Incomplete Three.js module');
      THREE=mod;
      return THREE;
    }catch(err){lastErr=err}
  }
  throw new Error('Could not load Three.js: '+(lastErr?.message||lastErr));
}
async function loadCatalog(){
  if(catalog&&faceCatalog)return catalog;
  if(catalogPromise)return catalogPromise;
  catalogPromise=Promise.all([
    fetch('blocks.json?v=20261006-1',{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error('blocks '+r.status);return r.json()}),
    fetch('block-faces.json?v=20261006-2',{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error('faces '+r.status);return r.json()})
  ]).then(([rows,faces])=>{
    catalog=new Map(rows.map(b=>[b.id,b.texture]));
    faceCatalog=new Map(Object.entries(faces));
    return catalog;
  }).catch(err=>{
    console.warn('[3D Preview] Block texture catalogs unavailable',err);
    catalog=new Map();faceCatalog=new Map();
    return catalog;
  });
  return catalogPromise;
}
function textureNameFor(id){
  if(id==='water'||id==='bubble_column')return 'water_still.png';
  if(id==='lava')return 'lava_still.png';
  return catalog?.get(id)||null;
}
function faceTexturesForBlock(id,state){
  if(id==='water'||id==='bubble_column')return Array(6).fill('water_still.png');
  if(id==='lava')return Array(6).fill('lava_still.png');
  const primary=textureNameFor(id);
  const f=faceCatalog?.get(id)||{side:primary,top:primary,bottom:primary,front:primary,back:primary,end:null};
  const side=f.side||primary,top=f.top||side,bottom=f.bottom||side,front=f.front||side,back=f.back||side,end=f.end||null;
  const props=parseState(state);
  let out=[side,side,top,bottom,side,side]; // +X,-X,+Y,-Y,+Z,-Z

  if(end&&props.axis){
    if(props.axis==='x')out=[end,end,side,side,side,side];
    else if(props.axis==='z')out=[side,side,side,side,end,end];
    else out=[side,side,end,end,side,side];
    return out;
  }

  const facing=props.facing;
  const idx={east:0,west:1,south:4,north:5};
  const opposite={0:1,1:0,4:5,5:4};
  if(facing&&idx[facing]!==undefined){
    out[idx[facing]]=front;
    out[opposite[idx[facing]]]=back;
  }else{
    out[4]=front;
    out[5]=back;
  }
  return out;
}
function styleFor(id){
  if(/glass|ice|water|bubble_column/.test(id))return 'transparent';
  if(/leaves|sapling|flower|grass|fern|vine|roots|mushroom|azalea|torch|rail|redstone_wire|crop|wheat|carrots|potatoes|beetroots|seagrass|kelp|cactus_flower|bush|lily|orchid|tulip|dandelion|poppy/.test(id))return 'cutout';
  return 'solid';
}
async function textureFor(name){
  if(!name)return null;
  if(textureCache.has(name))return textureCache.get(name);
  const promise=new Promise(resolve=>{
    const loader=new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(BLOCK_TEXTURE_ROOT+name,loaded=>{
      try{
        const img=loaded.image;
        let tex=loaded;
        // Animated Minecraft textures are vertical sprite sheets. Crop one frame
        // before mipmapping so distant/angled views don't sample neighboring frames.
        if(img&&img.width&&img.height>img.width){
          const size=img.width,cv=document.createElement('canvas');
          cv.width=size;cv.height=size;
          const c=cv.getContext('2d',{alpha:true});
          c.imageSmoothingEnabled=false;
          c.drawImage(img,0,0,size,size,0,0,size,size);
          tex.dispose?.();
          tex=new THREE.CanvasTexture(cv);
        }
        tex.colorSpace=THREE.SRGBColorSpace;
        tex.magFilter=THREE.NearestFilter;
        tex.minFilter=THREE.NearestMipmapLinearFilter;
        tex.generateMipmaps=true;
        tex.anisotropy=Math.min(8,webgl?.capabilities?.getMaxAnisotropy?.()||1);
        tex.wrapS=THREE.ClampToEdgeWrapping;
        tex.wrapT=THREE.ClampToEdgeWrapping;
        tex.needsUpdate=true;
        resolve(tex);
      }catch(err){
        console.warn('[3D Preview] texture setup failed',name,err);
        resolve(loaded);
      }
    },undefined,()=>resolve(null));
  });
  textureCache.set(name,promise);
  return promise;
}
async function materialFor(textureName,style){
  const key=(textureName||'none')+'|'+style;
  if(materialCache.has(key))return materialCache.get(key);
  const tex=await textureFor(textureName);
  const opts={
    map:tex||null,
    color:tex?0xffffff:0x8a8f93,
    roughness:0.82,
    metalness:0.0
  };
  if(style==='transparent'){
    opts.transparent=true;
    opts.opacity=0.62;
    opts.depthWrite=false;
    opts.alphaTest=0.02;
  }else if(style==='cutout'){
    opts.transparent=false;
    opts.alphaTest=0.35;
    opts.side=THREE.DoubleSide;
    opts.polygonOffset=true;
    opts.polygonOffsetFactor=-0.15;
    opts.polygonOffsetUnits=-0.15;
  }
  const mat=new THREE.MeshStandardMaterial(opts);
  mat.clippingPlanes=sliceEnabled?[slicePlane]:null;
  mat.clipShadows=false;
  materialCache.set(key,mat);
  return mat;
}
async function materialArrayFor(faceNames,style){
  const mats=[];
  for(const name of faceNames)mats.push(await materialFor(name,style));
  return mats;
}
function faceSignature(id,state){
  return faceTexturesForBlock(id,state).map(x=>x||'none').join('|');
}

function boxPart(minX,minY,minZ,maxX,maxY,maxZ){
  return{
    sx:maxX-minX,sy:maxY-minY,sz:maxZ-minZ,
    ox:(minX+maxX)/2,oy:(minY+maxY)/2,oz:(minZ+maxZ)/2
  };
}
function transformStairPart(part,xFlip,yDeg){
  let x=part.ox,y=part.oy,z=part.oz;
  if(xFlip){y=-y;z=-z}
  const turns=((Math.round(yDeg/90)%4)+4)%4;
  for(let i=0;i<turns;i++){const nx=-z,nz=x;x=nx;z=nz}
  const swap=turns%2===1;
  return{
    sx:swap?part.sz:part.sx,
    sy:part.sy,
    sz:swap?part.sx:part.sz,
    ox:x,oy:y,oz:z
  };
}
function stairParts(props){
  const shape=props.shape||'straight';
  const facing=props.facing||'east';
  const top=props.half==='top';
  const facingRot={east:0,south:90,west:180,north:270}[facing]??0;

  // These boxes are the vanilla block/stairs, inner_stairs and outer_stairs
  // element bounds normalized from Minecraft's 0..16 model coordinates.
  const slab=boxPart(-.5,-.5,-.5,.5,0,.5);
  const eastHalf=boxPart(0,0,-.5,.5,.5,.5);
  const southWestQuarter=boxPart(-.5,0,0,0,.5,.5);
  const southEastQuarter=boxPart(0,0,0,.5,.5,.5);

  let base;
  if(shape.startsWith('inner'))base=[slab,eastHalf,southWestQuarter];
  else if(shape.startsWith('outer'))base=[slab,southEastQuarter];
  else base=[slab,eastHalf];

  // Vanilla blockstate rotations:
  // bottom-right/straight = facing rotation; bottom-left = facing - 90
  // top-left/straight = facing rotation; top-right = facing + 90.
  let yRot=facingRot;
  if(!top&&shape.endsWith('_left'))yRot=(facingRot+270)%360;
  if(top&&shape.endsWith('_right'))yRot=(facingRot+90)%360;

  return base.map(part=>transformStairPart(part,top,yRot));
}

function partsForBlock(id,state){
  const p=parseState(state);
  if(id.endsWith('_slab')){
    if(p.type==='double')return[{sx:1,sy:1,sz:1,ox:0,oy:0,oz:0}];
    return[{sx:1,sy:.5,sz:1,ox:0,oy:p.type==='top'?.25:-.25,oz:0}];
  }
  if(id.endsWith('_stairs'))return stairParts(p);
  if(id.endsWith('_carpet'))return[{sx:1,sy:.0625,sz:1,ox:0,oy:-.46875,oz:0}];
  if(id.includes('pressure_plate'))return[{sx:.875,sy:.0625,sz:.875,ox:0,oy:-.46875,oz:0}];
  if(id==='snow'){
    const h=Math.max(1,Math.min(8,Number(p.layers)||1))/8;
    return[{sx:1,sy:h,sz:1,ox:0,oy:-.5+h/2,oz:0}];
  }
  if(id.endsWith('_trapdoor')||id==='iron_trapdoor'){
    const t=.1875;
    if(p.open==='true'){
      if(p.facing==='east')return[{sx:t,sy:1,sz:1,ox:.5-t/2,oy:0,oz:0}];
      if(p.facing==='west')return[{sx:t,sy:1,sz:1,ox:-.5+t/2,oy:0,oz:0}];
      if(p.facing==='south')return[{sx:1,sy:1,sz:t,ox:0,oy:0,oz:.5-t/2}];
      return[{sx:1,sy:1,sz:t,ox:0,oy:0,oz:-.5+t/2}];
    }
    return[{sx:1,sy:t,sz:1,ox:0,oy:p.half==='top'?.5-t/2:-.5+t/2,oz:0}];
  }
  if(id.endsWith('_door')||id==='iron_door'){
    const t=.1875,f=p.facing||'north';
    if(f==='east')return[{sx:t,sy:1,sz:1,ox:.5-t/2,oy:0,oz:0}];
    if(f==='west')return[{sx:t,sy:1,sz:1,ox:-.5+t/2,oy:0,oz:0}];
    if(f==='south')return[{sx:1,sy:1,sz:t,ox:0,oy:0,oz:.5-t/2}];
    return[{sx:1,sy:1,sz:t,ox:0,oy:0,oz:-.5+t/2}];
  }
  if(id.endsWith('_pane')||id==='iron_bars'){
    return[
      {sx:.125,sy:1,sz:1,ox:0,oy:0,oz:0},
      {sx:1,sy:1,sz:.125,ox:0,oy:0,oz:0}
    ];
  }
  if(id.endsWith('_fence')||id.endsWith('_wall')){
    return[
      {sx:.25,sy:1,sz:.25,ox:0,oy:0,oz:0},
      {sx:1,sy:.14,sz:.14,ox:0,oy:.15,oz:0},
      {sx:1,sy:.14,sz:.14,ox:0,oy:-.18,oz:0},
      {sx:.14,sy:.14,sz:1,ox:0,oy:.15,oz:0},
      {sx:.14,sy:.14,sz:1,ox:0,oy:-.18,oz:0}
    ];
  }
  if(/torch|sapling|flower|mushroom|bush|roots|fern|grass$/.test(id)){
    return[{sx:.3,sy:.72,sz:.3,ox:0,oy:-.14,oz:0}];
  }
  return[{sx:1,sy:1,sz:1,ox:0,oy:0,oz:0}];
}
function clearModel(){
  if(!modelGroup)return;
  scene.remove(modelGroup);
  modelGroup.traverse(o=>{
    if(o.geometry&&o.geometry!==unitGeometry)o.geometry.dispose?.();
  });
  modelGroup.clear();
  modelGroup=null;
  if(grid){scene.remove(grid);grid.geometry?.dispose?.();grid.material?.dispose?.();grid=null}
}
let unitGeometry=null;
async function buildScene(){
  if(building)return;
  building=true;
  try{
    await init3D();
    await loadCatalog();
    const blocks=projectBlocks();
    if(!blocks.length)throw new Error('Place or import some blocks before opening the 3D preview.');
    setLoading(true,'Building 3D preview…',blocks.length.toLocaleString()+' blocks');

    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const b of blocks){
      minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);minZ=Math.min(minZ,b.z);
      maxX=Math.max(maxX,b.x);maxY=Math.max(maxY,b.y);maxZ=Math.max(maxZ,b.z);
    }
    const cx=(minX+maxX+1)/2,cy=(minY+maxY+1)/2,cz=(minZ+maxZ+1)/2;
    centerY=cy;
    sliceMin=minY;sliceMax=maxY;sliceY=maxY;
    boundsInfo={minX,minY,minZ,maxX,maxY,maxZ,width:maxX-minX+1,height:maxY-minY+1,depth:maxZ-minZ+1};

    clearModel();
    modelGroup=new THREE.Group();
    modelGroup.name='MCPlannerBuild';
    scene.add(modelGroup);

    const groups=new Map();
    for(let i=0;i<blocks.length;i++){
      const b=blocks[i],style=styleFor(b.id),faces=faceTexturesForBlock(b.id,b.state),key=faces.map(x=>x||'none').join('|')+'|'+style;
      if(!groups.has(key))groups.set(key,{faces,style,parts:[]});
      const g=groups.get(key);
      for(const part of partsForBlock(b.id,b.state)){
        g.parts.push({
          x:b.x+.5-cx+part.ox,
          y:b.y+.5-cy+part.oy,
          z:b.z+.5-cz+part.oz,
          sx:part.sx,sy:part.sy,sz:part.sz
        });
      }
      if(i&&i%12000===0){
        setLoading(true,'Building 3D preview…',Math.round(i/blocks.length*100)+'% · '+i.toLocaleString()+' / '+blocks.length.toLocaleString());
        await new Promise(requestAnimationFrame);
      }
    }

    const entries=[...groups.values()];
    for(let gi=0;gi<entries.length;gi++){
      const g=entries[gi];
      setLoading(true,'Loading block textures…',(gi+1)+' / '+entries.length);
      const mats=await materialArrayFor(g.faces,g.style);
      const mesh=new THREE.InstancedMesh(unitGeometry,mats,g.parts.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const q=new THREE.Quaternion(),m=new THREE.Matrix4(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
      for(let i=0;i<g.parts.length;i++){
        const p=g.parts[i];
        pos.set(p.x,p.y,p.z);scale.set(p.sx,p.sy,p.sz);m.compose(pos,q,scale);mesh.setMatrixAt(i,m);
      }
      mesh.instanceMatrix.needsUpdate=true;
      mesh.castShadow=false;mesh.receiveShadow=false;
      modelGroup.add(mesh);
    }

    const size=Math.max(boundsInfo.width,boundsInfo.depth,8);
    const divisions=Math.min(160,Math.max(8,Math.ceil(size)));
    grid=new THREE.GridHelper(size*1.6,divisions,0x526a58,0x252b2f);
    grid.position.y=-boundsInfo.height/2-.502;
    grid.material.transparent=true;grid.material.opacity=.62;
    scene.add(grid);

    const diag=Math.sqrt(boundsInfo.width**2+boundsInfo.height**2+boundsInfo.depth**2);
    const far=Math.max(128,diag*12);
    const near=Math.max(.03,Math.min(.2,diag/5000));
    perspectiveCamera.near=near;
    perspectiveCamera.far=far;
    perspectiveCamera.updateProjectionMatrix();
    orthoCamera.near=-far;
    orthoCamera.far=far;
    orthoCamera.updateProjectionMatrix();
    orbit.target.set(0,0,0);
    orbit.radius=Math.max(6,diag*1.15);
    orbit.theta=Math.PI/4;
    orbit.phi=Math.PI/3.05;
    orbit.orthoHalf=Math.max(3,Math.max(boundsInfo.width,boundsInfo.depth,boundsInfo.height)*.72);
    flySpeed=Math.max(.08,diag*.006);
    setupSliceUI();
    setPerspective(true);
    if(statsEl)statsEl.textContent=blocks.length.toLocaleString()+' blocks · '+boundsInfo.width+' × '+boundsInfo.height+' × '+boundsInfo.depth;
    setStatus(blocks.length.toLocaleString()+' blocks · '+boundsInfo.width+' × '+boundsInfo.height+' × '+boundsInfo.depth);
    setLoading(false);
    render();
  }finally{building=false}
}
async function init3D(){
  if(initialized)return;
  await loadThree();
  setLoading(true,'Starting 3D engine…','Setting up WebGL');
  try{
    webgl=new THREE.WebGLRenderer({
      canvas,
      antialias:true,
      alpha:false,
      preserveDrawingBuffer:true,
      powerPreference:'high-performance',
      logarithmicDepthBuffer:true,
      precision:'highp'
    });
  }catch(err){
    throw new Error('WebGL could not start: '+(err?.message||err));
  }
  webgl.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
  webgl.outputColorSpace=THREE.SRGBColorSpace;
  webgl.toneMapping=THREE.ACESFilmicToneMapping;
  webgl.toneMappingExposure=1.08;
  webgl.localClippingEnabled=true;

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0b0d0e);
  scene.fog=null;

  perspectiveCamera=new THREE.PerspectiveCamera(50,1,.1,2000);
  orthoCamera=new THREE.OrthographicCamera(-10,10,10,-10,-2000,2000);
  activeCamera=perspectiveCamera;
  orbit.target=new THREE.Vector3();

  const hemi=new THREE.HemisphereLight(0xffffff,0x39424a,2.25);
  scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffffff,2.35);
  sun.position.set(18,30,12);
  scene.add(sun);
  const fill=new THREE.DirectionalLight(0x9ab8ff,.65);
  fill.position.set(-18,10,-20);
  scene.add(fill);

  slicePlane=new THREE.Plane(new THREE.Vector3(0,-1,0),99999);
  unitGeometry=new THREE.BoxGeometry(1,1,1);
  bindControls();
  resize3D();
  initialized=true;
  lastFrame=performance.now();
  animationId=requestAnimationFrame(frame);
}
function cameraFromOrbit(){
  const r=orbit.radius,sp=Math.sin(orbit.phi);
  const x=orbit.target.x+r*sp*Math.sin(orbit.theta);
  const y=orbit.target.y+r*Math.cos(orbit.phi);
  const z=orbit.target.z+r*sp*Math.cos(orbit.theta);
  activeCamera.position.set(x,y,z);
  activeCamera.lookAt(orbit.target);
  activeCamera.updateMatrixWorld();
}
function updateOrthoFrustum(){
  if(!orthoCamera||!stage)return;
  const aspect=Math.max(.01,stage.clientWidth/Math.max(1,stage.clientHeight));
  orthoCamera.left=-orbit.orthoHalf*aspect;
  orthoCamera.right=orbit.orthoHalf*aspect;
  orthoCamera.top=orbit.orthoHalf;
  orthoCamera.bottom=-orbit.orthoHalf;
  orthoCamera.updateProjectionMatrix();
}
function setPerspective(refocus=false){
  mode='perspective';activeCamera=perspectiveCamera;
  if(refocus&&boundsInfo){
    const d=Math.sqrt(boundsInfo.width**2+boundsInfo.height**2+boundsInfo.depth**2);
    orbit.radius=Math.max(6,d*1.15);orbit.theta=Math.PI/4;orbit.phi=Math.PI/3.05;orbit.target.set(0,0,0);
  }
  perspectiveCamera.aspect=Math.max(.01,stage.clientWidth/Math.max(1,stage.clientHeight));
  perspectiveCamera.updateProjectionMatrix();cameraFromOrbit();setModeButton(perspectiveBtn);
  if(hintEl)hintEl.textContent='Left drag: orbit · Right drag: pan · Wheel: zoom';
}
function setIsometric(){
  mode='isometric';activeCamera=orthoCamera;
  orbit.theta=Math.PI/4;orbit.phi=Math.acos(1/Math.sqrt(3));
  updateOrthoFrustum();cameraFromOrbit();setModeButton(isoBtn);
  if(hintEl)hintEl.textContent='Left drag: orbit · Right drag: pan · Wheel: zoom';
}
function enterFly(){
  mode='fly';activeCamera=perspectiveCamera;
  perspectiveCamera.aspect=Math.max(.01,stage.clientWidth/Math.max(1,stage.clientHeight));
  perspectiveCamera.updateProjectionMatrix();
  const dir=new THREE.Vector3();perspectiveCamera.getWorldDirection(dir);
  flyPitch=Math.asin(Math.max(-1,Math.min(1,dir.y)));
  flyYaw=Math.atan2(dir.x,dir.z);
  setModeButton(flyBtn);
  if(hintEl)hintEl.textContent='Fly: drag to look · W/S forward/back · A/D strafe · Q/E down/up · Shift faster';
}
function exitFly(){
  const dir=flyDirection();
  orbit.target.copy(perspectiveCamera.position).addScaledVector(dir,Math.max(2,orbit.radius*.35));
  orbit.radius=perspectiveCamera.position.distanceTo(orbit.target);
  mode='perspective';activeCamera=perspectiveCamera;cameraFromOrbit();setModeButton(perspectiveBtn);
  if(hintEl)hintEl.textContent='Left drag: orbit · Right drag: pan · Wheel: zoom';
}
function flyDirection(){
  const cp=Math.cos(flyPitch);
  return new THREE.Vector3(Math.sin(flyYaw)*cp,Math.sin(flyPitch),Math.cos(flyYaw)*cp).normalize();
}
function applyFlyLook(){
  const d=flyDirection();
  perspectiveCamera.lookAt(perspectiveCamera.position.clone().add(d));
  perspectiveCamera.updateMatrixWorld();
}
function panBy(dx,dy){
  const right=new THREE.Vector3().setFromMatrixColumn(activeCamera.matrixWorld,0);
  const up=new THREE.Vector3().setFromMatrixColumn(activeCamera.matrixWorld,1);
  const scale=mode==='isometric'
    ? (orbit.orthoHalf*2/Math.max(1,stage.clientHeight))
    : (orbit.radius*Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov*.5))*2/Math.max(1,stage.clientHeight));
  orbit.target.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);
  cameraFromOrbit();
}
function bindControls(){
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    pointer.down=true;pointer.button=e.button;pointer.x=e.clientX;pointer.y=e.clientY;pointer.moved=false;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!pointer.down)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer.x=e.clientX;pointer.y=e.clientY;
    if(Math.abs(dx)+Math.abs(dy)>1)pointer.moved=true;
    if(mode==='fly'){
      flyYaw-=dx*.0052;flyPitch=Math.max(-1.54,Math.min(1.54,flyPitch-dy*.0052));applyFlyLook();return;
    }
    if(pointer.button===2||e.shiftKey){
      panBy(dx,dy);return;
    }
    orbit.theta-=dx*.008;
    orbit.phi=Math.max(.05,Math.min(Math.PI-.05,orbit.phi-dy*.008));
    cameraFromOrbit();
  });
  const end=e=>{pointer.down=false;try{canvas.releasePointerCapture?.(e.pointerId)}catch{}};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    if(mode==='isometric'){
      orbit.orthoHalf=Math.max(.35,Math.min(5000,orbit.orthoHalf*Math.exp(e.deltaY*.001)));
      updateOrthoFrustum();
    }else if(mode!=='fly'){
      orbit.radius=Math.max(.6,Math.min(50000,orbit.radius*Math.exp(e.deltaY*.001)));
      cameraFromOrbit();
    }else{
      flySpeed=Math.max(.01,Math.min(100,flySpeed*Math.exp(-e.deltaY*.001)));
    }
  },{passive:false});
}
function setupSliceUI(){
  if(!sliceRange)return;
  sliceRange.min=String(sliceMin);sliceRange.max=String(sliceMax);sliceRange.value=String(sliceMax);
  sliceY=sliceMax;updateSlicePlane();
}
function updateSlicePlane(){
  if(!slicePlane)return;
  slicePlane.constant=sliceY+1-centerY;
  if(sliceValue)sliceValue.textContent=sliceEnabled?'Y ≤ '+sliceY:'All layers';
  for(const mat of materialCache.values()){
    mat.clippingPlanes=sliceEnabled?[slicePlane]:null;
    mat.needsUpdate=true;
  }
}
function toggleSlice(){
  sliceEnabled=!sliceEnabled;
  slicePanel?.classList.toggle('hidden',!sliceEnabled);
  sliceBtn?.classList.toggle('active',sliceEnabled);
  if(sliceEnabled){sliceY=Number(sliceRange.value)||sliceMax}
  updateSlicePlane();
}
function resize3D(){
  if(!webgl||!stage)return;
  const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
  webgl.setSize(w,h,false);
  perspectiveCamera.aspect=w/h;perspectiveCamera.updateProjectionMatrix();
  updateOrthoFrustum();
}
function render(){if(webgl&&scene&&activeCamera)webgl.render(scene,activeCamera)}
function frame(now){
  const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
  if(visible&&initialized){
    if(autoOrbit&&mode!=='fly'){orbit.theta+=dt*.28;cameraFromOrbit()}
    if(mode==='fly'&&flyKeys.size){
      const d=flyDirection(),right=new THREE.Vector3().crossVectors(d,new THREE.Vector3(0,1,0)).normalize();
      const up=new THREE.Vector3(0,1,0),move=new THREE.Vector3();
      if(flyKeys.has('KeyW'))move.add(d);if(flyKeys.has('KeyS'))move.sub(d);
      if(flyKeys.has('KeyD'))move.add(right);if(flyKeys.has('KeyA'))move.sub(right);
      if(flyKeys.has('KeyE'))move.add(up);if(flyKeys.has('KeyQ'))move.sub(up);
      if(move.lengthSq()){move.normalize().multiplyScalar(flySpeed*dt*60*(flyKeys.has('ShiftLeft')||flyKeys.has('ShiftRight')?3:1));perspectiveCamera.position.add(move);applyFlyLook()}
    }
    render();
  }
  animationId=requestAnimationFrame(frame);
}
async function openPreview(){
  modal.classList.remove('hidden');document.body.classList.add('preview3d-open');visible=true;
  setLoading(true);
  try{await buildScene()}
  catch(err){console.error('[3D Preview]',err);setLoading(true,'Could not render 3D preview',err?.message||String(err));setStatus('Preview error')}
}
function closePreview(){
  modal.classList.add('hidden');document.body.classList.remove('preview3d-open');visible=false;
  flyKeys.clear();if(mode==='fly')exitFly();
}
async function refreshPreview(){
  try{await buildScene()}catch(err){console.error(err);setLoading(true,'Could not refresh 3D preview',err?.message||String(err))}
}
async function screenshot(){
  if(!webgl)return;
  render();
  shotBtn.disabled=true;
  try{
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Screenshot failed')),'image/png'));
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='mc-planner-3d.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(err){alert('Could not save screenshot: '+(err?.message||err))}
  finally{shotBtn.disabled=false}
}

openBtn?.addEventListener('click',openPreview);
closeBtn?.addEventListener('click',closePreview);
refreshBtn?.addEventListener('click',refreshPreview);
perspectiveBtn?.addEventListener('click',()=>{if(initialized){if(mode==='fly')exitFly();else setPerspective(false)}});
isoBtn?.addEventListener('click',()=>{if(initialized){if(mode==='fly')exitFly();setIsometric()}});
flyBtn?.addEventListener('click',()=>{if(!initialized)return;if(mode==='fly')exitFly();else enterFly()});
sliceBtn?.addEventListener('click',()=>{if(initialized)toggleSlice()});
orbitBtn?.addEventListener('click',()=>{autoOrbit=!autoOrbit;orbitBtn.classList.toggle('active',autoOrbit)});
shotBtn?.addEventListener('click',screenshot);
sliceRange?.addEventListener('input',()=>{sliceY=Number(sliceRange.value);updateSlicePlane()});

window.addEventListener('keydown',e=>{
  if(!visible)return;
  if(e.key==='Escape'){e.preventDefault();closePreview();return}
  if(mode==='fly'&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){flyKeys.add(e.code);e.preventDefault()}
},{capture:true});
window.addEventListener('keyup',e=>flyKeys.delete(e.code),{capture:true});
window.addEventListener('blur',()=>flyKeys.clear());
window.addEventListener('resize',()=>{if(initialized){resize3D();render()}});
if(typeof ResizeObserver!=='undefined'&&stage)new ResizeObserver(()=>{if(initialized){resize3D();render()}}).observe(stage);
