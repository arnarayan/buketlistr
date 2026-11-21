'use strict';
const $=id=>document.getElementById(id);
const DB_NAME='pricetag',STORE='prices';
let db,scanner,photoBlob=null,coords=null,all=[];

/* ---------- storage (IndexedDB; photos are stored as blobs) ---------- */
function openDB(){return new Promise((res,rej)=>{
  const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
})}
const tx=(mode,fn)=>new Promise((res,rej)=>{const t=db.transaction(STORE,mode);const out=fn(t.objectStore(STORE));t.oncomplete=()=>res(out&&out.result);t.onerror=()=>rej(t.error)});
const dbAll=()=>tx('readonly',s=>s.getAll());
const dbPut=o=>tx('readwrite',s=>s.put(o));
const dbDel=id=>tx('readwrite',s=>s.delete(id));
const dbClear=()=>tx('readwrite',s=>s.clear());

/* ---------- helpers ---------- */
const today=()=>new Date().toISOString().slice(0,10);
const money=n=>'$'+Number(n).toFixed(n<10?(n%1?3:2):2).replace(/(\.\d\d)0$/,'$1');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function status(p){
  if(!p.ends)return{cls:'ok',txt:'No end date'};
  const d=Math.ceil((new Date(p.ends+'T23:59:59')-Date.now())/864e5);
  if(d<0)return{cls:'exp',txt:'Expired',expired:true};
  if(d===0)return{cls:'soon',txt:'Ends today'};
  if(d<=2)return{cls:'soon',txt:`${d} day${d>1?'s':''} left`};
  return{cls:'ok',txt:d>60?'Ends '+fmtDate(p.ends):`${d} days left`};
}
// Comparison key: tag/barcode when present, else normalised name
const key=p=>p.tag?('t:'+p.tag):('n:'+p.cat+':'+p.name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim());
// Normalise to a base unit so lb/oz/kg and gal/L compare fairly
const BASE={each:['each',1],dozen:['each',12],lb:['lb',1],oz:['lb',1/16],kg:['lb',2.20462],gal:['gal',1],L:['gal',0.264172]};
function perBase(p){const [b,f]=BASE[p.unit]||['each',1];return{unit:b,val:p.price/f}}
function fmtDate(d){return d?new Date(d+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):''}

/* ---------- tag parsing ---------- */
// Standard seller tag: PT1|SKU|Item|price|unit|YYYY-MM-DD|Store
function parseTag(text){
  if(text.startsWith('PT1|')){
    const [,sku,name,price,unit,end,store]=text.split('|');
    return{tag:sku,name,price,unit,ends:end,store,standard:true};
  }
  return{tag:text.trim(),standard:false};
}

/* ---------- views ---------- */
function show(v){
  document.querySelectorAll('.view').forEach(e=>e.classList.toggle('active',e.id==='view-'+v));
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v!=='add')stopScan();
  if(v==='about')$('count').textContent=`${all.length} saved price${all.length===1?'':'s'} on this device.`;
  scrollTo(0,0);
}
document.querySelector('nav').addEventListener('click',e=>{if(e.target.dataset.v)show(e.target.dataset.v)});

async function refresh(){all=(await dbAll()).sort((a,b)=>b.seen.localeCompare(a.seen));renderFeed();renderCompare()}

function renderFeed(){
  const q=$('q').value.toLowerCase(),cat=$('f-cat').value,act=$('f-active').checked;
  const list=all.filter(p=>(!cat||p.cat===cat)&&(!act||!status(p).expired)&&(!q||(p.name+' '+p.store+' '+p.place).toLowerCase().includes(q)));
  $('feed').innerHTML=list.length?'':'<p class="empty">No prices yet. Tap ＋ Add to log your first one.</p>';
  list.forEach(p=>{
    const s=status(p),el=document.createElement('div');el.className='card';
    el.innerHTML=`${p.photo?'<img>':''}<div class="body">
      <h3>${esc(p.name)}</h3>
      <div><span class="price">${money(p.price)}</span> <span class="meta">/ ${esc(p.unit)}</span></div>
      <div class="meta">${esc(p.store)}${p.place?' · '+esc(p.place):''}</div>
      <div class="meta">Seen ${fmtDate(p.seen)}${p.starts?' · from '+fmtDate(p.starts):''}${p.ends?' · until '+fmtDate(p.ends):''}</div>
      <div><span class="pill ${s.cls}">${s.txt}</span>${p.tag?`<span class="pill">tag ${esc(p.tag)}</span>`:''}</div>
      ${p.notes?`<div class="meta">${esc(p.notes)}</div>`:''}
      ${p.lat!=null?`<a class="meta" href="https://maps.apple.com/?q=${p.lat},${p.lon}">Open map</a> · `:''}
      <button class="del">Delete</button></div>`;
    if(p.photo)el.querySelector('img').src=URL.createObjectURL(p.photo);
    el.querySelector('.del').onclick=async()=>{if(confirm('Delete this price?')){await dbDel(p.id);refresh()}};
    $('feed').append(el);
  });
}

function renderCompare(){
  const groups={};
  all.filter(p=>!status(p).expired).forEach(p=>{(groups[key(p)]??=[]).push(p)});
  // keep latest sighting per store within each group
  const out=[];
  for(const g of Object.values(groups)){
    const byStore={};g.forEach(p=>{const k=p.store.toLowerCase();if(!byStore[k]||p.seen>byStore[k].seen)byStore[k]=p});
    const opts=Object.values(byStore).map(p=>({p,b:perBase(p)})).sort((a,b)=>a.b.val-b.b.val);
    if(opts.length>1)out.push(opts);
  }
  $('compare').innerHTML=out.length?'':'<p class="empty">Nothing to compare yet. Log the same item (same tag/barcode) at two or more stores and it will appear here.</p>';
  out.forEach(opts=>{
    const best=opts[0].b.val,div=document.createElement('div');div.className='group';
    div.innerHTML=`<h3>${esc(opts[0].p.name)}</h3>`+opts.map((o,i)=>`
      <div class="opt ${i?'':'best'}"><span>${esc(o.p.store)}<span class="meta"> ${esc(o.p.place||'')} · ${status(o.p).txt}</span></span>
      <span><b>${money(o.p.price)}</b>/${esc(o.p.unit)}${i?` <span class="meta">+${((o.b.val/best-1)*100).toFixed(0)}%</span>`:' ✓'}</span></div>`).join('');
    $('compare').append(div);
  });
}
['q','f-cat','f-active'].forEach(id=>$(id).addEventListener('input',renderFeed));

/* ---------- add form ---------- */
async function downscale(file,max=1000){
  const bmp=await createImageBitmap(file);
  const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
  const c=document.createElement('canvas');c.width=bmp.width*k;c.height=bmp.height*k;
  c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
  return new Promise(r=>c.toBlob(r,'image/jpeg',.75));
}
$('photo').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{photoBlob=await downscale(f)}catch{photoBlob=f}
  $('preview').src=URL.createObjectURL(photoBlob);$('preview').hidden=false;
};
$('gps').onclick=()=>{
  if(!navigator.geolocation)return alert('Location not available');
  $('gps').textContent='…';
  navigator.geolocation.getCurrentPosition(async pos=>{
    coords={lat:pos.coords.latitude,lon:pos.coords.longitude};
    $('gps').textContent='✓ GPS';
    if(!$('place').value){
      try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}`);
        const j=await r.json();const a=j.address||{};
        $('place').value=[a.road,a.city||a.town||a.village].filter(Boolean).join(', ')||`${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`;
      }catch{$('place').value=`${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`}
    }
  },()=>{$('gps').textContent='📍 Use GPS';alert('Could not get location. Check Settings › Privacy › Location Services for Safari/PriceTag.')},{enableHighAccuracy:true,timeout:15000});
};

function stopScan(){if(scanner){const s=scanner;scanner=null;s.stop().then(()=>s.clear()).catch(()=>{});}$('reader').hidden=true;$('scan').textContent='▦ Scan tag / barcode'}
$('scan').onclick=async()=>{
  if(scanner)return stopScan();
  $('reader').hidden=false;$('scan').textContent='Stop scanning';
  scanner=new Html5Qrcode('reader',{formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.UPC_E,Html5QrcodeSupportedFormats.CODE_128]});
  try{
    await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:260,height:160}},text=>{
      const t=parseTag(text);
      $('tag').value=t.tag||'';
      ['name','price','unit','ends','store'].forEach(f=>{if(t[f])$(f).value=t[f]});
      $('tagline').hidden=false;
      $('tagline').textContent=t.standard?'✓ Standard PriceTag read — fields filled in.':'✓ Barcode '+t.tag+' captured.';
      if(navigator.vibrate)navigator.vibrate(60);
      stopScan();
    },()=>{});
  }catch(err){stopScan();alert('Camera unavailable: '+err);}
};

$('form').onsubmit=async e=>{
  e.preventDefault();
  const p={id:crypto.randomUUID(),cat:$('cat').value,name:$('name').value.trim(),tag:$('tag').value.trim(),
    price:parseFloat($('price').value),unit:$('unit').value,store:$('store').value.trim(),place:$('place').value.trim(),
    starts:$('starts').value,ends:$('ends').value,notes:$('notes').value.trim(),seen:today(),
    lat:coords?.lat??null,lon:coords?.lon??null,photo:photoBlob};
  if(p.ends&&p.starts&&p.ends<p.starts)return alert('End date is before the start date.');
  await dbPut(p);
  const keepStore=p.store,keepPlace=p.place,keepCoords=coords;
  e.target.reset();photoBlob=null;$('preview').hidden=true;$('tagline').hidden=true;
  $('store').value=keepStore;$('place').value=keepPlace;coords=keepCoords; // speed up logging many items in one store
  await refresh();show('feed');
};
$('cat').onchange=()=>{if($('cat').value==='Gas')$('unit').value='gal'};

/* ---------- data ---------- */
$('export').onclick=async()=>{
  const rows=await dbAll();
  const toB64=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b)});
  for(const r of rows)if(r.photo)r.photo=await toB64(r.photo);
  const blob=new Blob([JSON.stringify(rows,null,1)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='pricetag-export.json';a.click();
};
$('wipe').onclick=async()=>{if(confirm('Delete ALL saved prices?')){await dbClear();refresh()}};

/* ---------- boot ---------- */
(async()=>{
  db=await openDB();await refresh();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
