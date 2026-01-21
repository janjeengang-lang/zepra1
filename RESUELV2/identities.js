const grid = document.getElementById('grid');
const createBtn = document.getElementById('create');
const createAIBtn = document.getElementById('createAI');
const exportIdentityPdfBtn = document.getElementById('exportIdentityPdf');
const panel = document.getElementById('identityPanel');
const panelTitle = document.getElementById('panelTitle');
const closePanelBtn = document.getElementById('closePanel');
const aiSetup = document.getElementById('aiSetup');
const aiPrompt = document.getElementById('aiPrompt');
const aiGenerate = document.getElementById('aiGenerate');
const aiSkeleton = document.getElementById('aiSkeleton');
const form = document.getElementById('identityForm');
const saveIdentity = document.getElementById('saveIdentity');

let identities = [];
let activeId = null;

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function load(){
  chrome.storage.local.get(['identities','activeIdentityId'], res => {
    identities = res.identities || [];
    activeId = res.activeIdentityId || null;
    render();
  });
}

// --- Visual: global page background (key.webm) and panel background ---
(function bootstrapVisualLayer(){
  try{
    // Page background
    if(!document.querySelector('.id-page-bg')){
      const wrap = document.createElement('div');
      wrap.className = 'id-page-bg';
      wrap.innerHTML = `<video autoplay loop muted playsinline src="${chrome.runtime.getURL('src/media/key.webm')}"></video>`;
      document.body.prepend(wrap);
    }

    // Style
    const style = document.createElement('style');
    style.textContent = `
      /* Deep black page base and remove any grid background */
      html, body { background-color:#000 !important; background-image:none !important; }
      .id-page-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background:#000}
      .id-page-bg video{width:100%;height:100%;object-fit:cover;opacity:.28;filter:brightness(.85) saturate(1.05)}
      /* Keep only intended layers above the background video */
      #bgGrid{ position:fixed !important; z-index:-1 !important; }
      header.dashboard-header, main{ position:relative; z-index:2; }

      /* Remove any grid overlay */
      #grid, .grid { background: transparent !important; }
      #grid::before, #grid::after, body::before, body::after { content: none !important; background: none !important; }
      [class*="grid"]::before, [class*="grid"]::after { content: none !important; background: none !important; }

      /* Grid cards refinement to sit atop video */
      .identity-card{background:rgba(15,23,42,0.55)!important;border:1px solid rgba(148,163,184,0.18)!important;backdrop-filter:blur(10px)!important;}
      .identity-card.active{box-shadow:0 0 0 1px rgba(74,222,128,.5), 0 8px 30px rgba(2,6,23,.6), 0 0 22px rgba(255,146,43,.35), 0 0 44px rgba(255,69,0,.25); position:relative}
      .identity-card.active::after{content:"";position:absolute;inset:-4px;border-radius:1rem;pointer-events:none;background:conic-gradient(from 0deg, rgba(255,146,43,.30), rgba(255,69,0,.45), rgba(255,146,43,.30));filter:blur(16px);opacity:.85;animation:firePulse 1.3s ease-in-out infinite alternate;z-index:-1}
      @keyframes firePulse{0%{filter:blur(12px);opacity:.65}100%{filter:blur(20px);opacity:.95}}
      .identity-card .pic-wrap{width:96px!important;height:96px!important;border-radius:9999px!important;overflow:hidden!important;margin:12px auto 8px auto!important;border:1px solid rgba(148,163,184,0.22)!important;box-shadow:0 8px 24px rgba(0,0,0,.35)!important}
      .identity-card .pic-wrap video{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important}

      /* Sliding panel visuals */
      #identityPanel{position:fixed;inset:0 0 0 auto;max-width:420px;background:rgba(2,6,23,0.80);backdrop-filter:blur(16px);border-left:1px solid rgba(148,163,184,0.22)}
      #identityPanel .panel-bg{position:absolute;inset:0;z-index:-1;opacity:.22;pointer-events:none}
      #identityPanel .panel-bg video{width:100%;height:100%;object-fit:cover;filter:brightness(.85)}

      /* Inputs glass styling */
      #identityPanel input, #identityPanel textarea, #identityPanel select{
        background:rgba(255,255,255,0.05)!important;
        border:1px solid rgba(148,163,184,0.25)!important;
        color:#e5e7eb!important;
        border-radius:10px!important;
        outline:none!important;
        box-shadow:none!important;
      }
      #identityPanel input:focus, #identityPanel textarea:focus, #identityPanel select:focus{
        border-color:rgba(56,189,248,0.55)!important;
        box-shadow:0 0 0 2px rgba(56,189,248,0.20)!important;
      }

      /* Save button neon green */
      #identityPanel footer{background:linear-gradient(180deg, rgba(2,6,23,.55), rgba(2,6,23,.75));backdrop-filter:blur(8px)}
      #identityPanel #saveIdentity{background:#39ff14!important;color:#041a06!important;border:none!important;border-radius:.65rem!important;font-weight:700!important;box-shadow:0 0 0 2px rgba(57,255,20,.25), 0 8px 28px rgba(57,255,20,.25)!important;transition:all .25s ease}
      #identityPanel #saveIdentity:hover{filter:brightness(1.05);transform:translateY(-2px);box-shadow:0 0 0 2px rgba(57,255,20,.35), 0 14px 36px rgba(57,255,20,.35)!important}

      /* AI setup area */
      #aiSetup, #identityForm{position:relative;z-index:1}
    `;
    document.head.appendChild(style);
  }catch(_){/* ignore */}
})();

function render(){
  grid.innerHTML = '';
  const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const trashIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
  for(const id of identities){
    const card = document.createElement('div');
    card.className = 'identity-card' + (id.id===activeId ? ' active' : '');
    card.innerHTML = `
      ${id.id===activeId?'<div class="badge">Active</div>':''}
      <div class="card-actions">
        <button class="edit" title="Edit">${editIcon}</button>
        <button class="del" title="Delete">${trashIcon}</button>
      </div>
      <div class="pic-wrap">
        ${id.profilePictureUrl && id.profilePictureUrl.startsWith('http') 
          ? `<img src="${id.profilePictureUrl}" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;border:2px solid #39ff14;box-shadow:0 0 15px rgba(57,255,20,0.5);" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"/>
             <video autoplay loop muted src="src/media/zepra.webm" style="display:none;"></video>`
          : `<video autoplay loop muted src="src/media/zepra.webm"></video>`}
      </div>
      <div class="name">${id.identityName||'No name'}</div>
      <div class="full">${id.fullName||''}</div>
      <div class="email">${id.email||''}</div>
      <div class="actions"><button class="btn act">${id.id===activeId?'Deactivate':'Activate'}</button></div>
    `;
    card.querySelector('.act').addEventListener('click',()=>toggleActive(id.id));
    card.querySelector('.edit').addEventListener('click',()=>openPanel(id));
    card.querySelector('.del').addEventListener('click',()=>remove(id.id));
    grid.appendChild(card);
  }
}

function openPanel(data, mode='manual'){
  form.reset();
  form.id.value = data?.id || '';
  for(const k of Object.keys(data||{})){
    if(form[k]) form[k].value = data[k];
  }
  if(mode==='ai'){
    panelTitle.textContent = 'Create Identity with AI';
    aiSetup.classList.remove('hidden');
    form.classList.add('hidden');
  } else {
    panelTitle.textContent = data ? 'Edit Identity' : 'Create New Identity';
    aiSetup.classList.add('hidden');
    form.classList.remove('hidden');
  }
  // Ensure panel has video bg
  if(!panel.querySelector('.panel-bg')){
    const bg = document.createElement('div');
    bg.className = 'panel-bg';
    bg.innerHTML = `<video autoplay loop muted playsinline src="${chrome.runtime.getURL('src/media/static(1).webm')}"></video>`;
    panel.prepend(bg);
  }
  panel.classList.add('open');
}

function closePanel(){
  panel.classList.remove('open');
  aiSetup.classList.add('hidden');
  aiSkeleton.classList.add('hidden');
  form.classList.remove('hidden');
}

function remove(id){
  identities = identities.filter(i=>i.id!==id);
  if(activeId===id) activeId = null;
  save();
  render();
}

function save(){
  chrome.storage.local.set({identities, activeIdentityId: activeId});
}

function toggleActive(id){
  if(activeId===id){
    activeId = null;
  } else {
    activeId = id;
  }
  save();
  render();
}

form.addEventListener('submit', e=>{
  e.preventDefault();
  const fd = new FormData(form);
  const obj = {};
  fd.forEach((v,k)=>{obj[k]=v;});
  if(obj.id){
    const idx = identities.findIndex(i=>i.id===obj.id);
    if(idx>-1) identities[idx] = Object.assign(identities[idx], obj);
  } else {
    obj.id = uid();
    identities.push(obj);
  }
  closePanel();
  save();
  render();
});
try{ createBtn.addEventListener('click', ()=>openPanel()); }catch(_){}
try{ createAIBtn.addEventListener('click', ()=>{ aiPrompt.value=''; openPanel({}, 'ai'); }); }catch(_){}
try{ closePanelBtn.addEventListener('click', closePanel); }catch(_){}
try{ exportIdentityPdfBtn.addEventListener('click', exportIdentityPdf); }catch(_){}

// Delegated safety net
document.addEventListener('click', (e)=>{
  const t = e.target;
  if(!t) return;
  if(t.id === 'create' || t.closest && t.closest('#create')){
    e.preventDefault();
    openPanel();
  } else if(t.id === 'createAI' || (t.closest && t.closest('#createAI'))){
    e.preventDefault();
    aiPrompt.value='';
    openPanel({}, 'ai');
  } else if(t.id === 'closePanel' || (t.closest && t.closest('#closePanel'))){
    e.preventDefault();
    closePanel();
  }
});
aiGenerate.addEventListener('click', async () => {
  const prompt = aiPrompt.value.trim();
  if (!prompt) return;
  aiSkeleton.classList.remove('hidden');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GENERATE_IDENTITY', prompt });
    if (!res?.ok) throw new Error('fetch');
    let data;
    try {
      data = JSON.parse(res.result);
    } catch (e) {
      console.error('Zepra Debug: Failed to parse AI response. Raw response was:', res?.result);
      alert('Error: AI provided an invalid response format.');
      aiSkeleton.classList.add('hidden');
      return;
    }
    data.profilePictureUrl = '';
    aiSkeleton.classList.add('hidden');
    openPanel(data, 'manual');
  } catch (e) {
    aiSkeleton.classList.add('hidden');
    alert('Error: Could not connect to the AI service. Please check your API key and network connection.');
  }
});

load();

async function exportIdentityPdf() {
  if (!identities.length) {
    alert('No identities available to export.');
    return;
  }
  const active = identities.find((item) => item.id === activeId) || identities[0];
  showExportOverlay('Rendering your PDF...');
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'EXPORT_PDF',
      exportType: 'identities',
      payload: active
    });
    if (!resp?.ok) throw new Error(resp?.error || 'PDF export failed');
    alert('Identity PDF downloaded.');
  } catch (err) {
    alert(`Failed to export PDF: ${err.message || err}`);
  } finally {
    hideExportOverlay();
  }
}

function showExportOverlay(label) {
  let overlay = document.getElementById('identity-export-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'identity-export-overlay';
    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div style="width:42px;height:42px;border:3px solid rgba(148,163,184,0.3);border-top-color:#39ff14;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <div class="export-label" style="font-weight:600;color:#e2e8f0;">${label}</div>
        <div style="font-size:12px;color:#94a3b8;">Preparing your identity file...</div>
      </div>
    `;
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(2,6,23,0.78);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      backdrop-filter: blur(10px);
    `;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `;
    overlay.appendChild(style);
    document.body.appendChild(overlay);
  } else {
    overlay.querySelector('.export-label').textContent = label;
    overlay.style.display = 'flex';
  }
}

function hideExportOverlay() {
  const overlay = document.getElementById('identity-export-overlay');
  if (overlay) overlay.remove();
}
