const els = {
  personaList: document.getElementById('personaList'),
  togglePersona: document.getElementById('togglePersona'),
  createPersonaBtn: document.getElementById('createPersonaBtn'),
  generatePersonaBtn: document.getElementById('generatePersonaBtn'),
  exportPersonaPdf: document.getElementById('exportPersonaPdf'),
  personaName: document.getElementById('personaName'),
  personaTagline: document.getElementById('personaTagline'),
  personaDomains: document.getElementById('personaDomains'),
  personaTone: document.getElementById('personaTone'),
  personaPrompt: document.getElementById('personaPrompt'),
  savePersonaBtn: document.getElementById('savePersonaBtn'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),
  editorStatus: document.getElementById('editorStatus'),
};

const STATE = {
  personas: [],
  personaEnabled: false,
  activeId: '',
  editingId: null,
  isGenerating: false,
};

init();

async function init() {
  await loadPersonas();
  attachEvents();
  chrome.storage.onChanged.addListener(handleStorageChange);
}

function attachEvents() {
  els.togglePersona?.addEventListener('change', handleTogglePersona);
  els.createPersonaBtn?.addEventListener('click', () => startEdit());
  els.generatePersonaBtn?.addEventListener('click', generatePersonaWithAI);
  els.exportPersonaPdf?.addEventListener('click', exportPersonaPdf);
  els.savePersonaBtn?.addEventListener('click', savePersona);
  els.cancelEditBtn?.addEventListener('click', resetEditor);
}

async function loadPersonas() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_PERSONAS' });
    if (!resp?.ok) throw new Error(resp?.error || 'Failed to load personas');
    STATE.personas = Array.isArray(resp.personas) ? resp.personas : [];
    STATE.personaEnabled = !!resp.personaEnabled;
    STATE.activeId = resp.personaActiveId || '';
    els.togglePersona.checked = STATE.personaEnabled;
    renderPersonas();
    resetEditor();
  } catch (err) {
    toast('Failed to load personas: ' + (err.message || err), 'error');
    renderPersonas();
  }
}

function renderPersonas() {
  if (!els.personaList) return;
  els.personaList.innerHTML = '';
  if (!STATE.personas.length) {
    els.personaList.innerHTML = '<div class="empty-state">No personas yet. Add a new profile or let the AI craft one for you.</div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  STATE.personas.forEach((persona) => {
    const card = document.createElement('article');
    card.className = 'persona-card' + (persona.id === STATE.activeId && STATE.personaEnabled ? ' active' : '');
    card.innerHTML = `
      <div class="persona-header">
        <div class="persona-main">
          <div class="persona-name">${escapeHTML(persona.name || 'Untitled Persona')}</div>
          <div class="persona-tagline">${escapeHTML(persona.tagline || '')}</div>
          <div class="persona-tags">
            ${renderTags(persona.domains || [], persona.tone)}
          </div>
        </div>
        ${persona.id === STATE.activeId && STATE.personaEnabled ? '<span class="badge">Active</span>' : ''}
      </div>
      <div class="prompt-preview">${escapeHTML(persona.prompt || '')}</div>
      <div class="persona-actions">
        <button class="btn" data-action="activate">${persona.id === STATE.activeId && STATE.personaEnabled ? '✅ Active' : '🚀 Activate'}</button>
        <button class="btn" data-action="edit">✏️ Edit</button>
        <button class="btn" data-action="delete">🗑️ Delete</button>
      </div>
    `;
    card.querySelector('[data-action="activate"]')?.addEventListener('click', () => activatePersona(persona.id));
    card.querySelector('[data-action="edit"]')?.addEventListener('click', () => startEdit(persona.id));
    card.querySelector('[data-action="delete"]')?.addEventListener('click', () => deletePersona(persona.id));
    fragment.appendChild(card);
  });
  els.personaList.appendChild(fragment);
}

function renderTags(domains, tone) {
  const pieces = [];
  if (Array.isArray(domains)) {
    domains.filter(Boolean).forEach(domain => {
      pieces.push(`<span class="tag">📊 ${escapeHTML(domain)}</span>`);
    });
  }
  if (tone) {
    pieces.push(`<span class="tag">🎙️ ${escapeHTML(tone)}</span>`);
  }
  return pieces.join('');
}

function startEdit(id = null) {
  STATE.editingId = id;
  let persona = {
    name: '',
    tagline: '',
    domains: [],
    tone: '',
    prompt: ''
  };
  if (id) {
    const found = STATE.personas.find(p => p.id === id);
    if (found) persona = { ...found };
  }
  els.personaName.value = persona.name || '';
  els.personaTagline.value = persona.tagline || '';
  els.personaDomains.value = (persona.domains || []).join(', ');
  els.personaTone.value = persona.tone || '';
  els.personaPrompt.value = persona.prompt || '';
  updateEditorStatus(`Editing persona ${persona.name || ''}`);
}

function resetEditor() {
  STATE.editingId = null;
  els.personaName.value = '';
  els.personaTagline.value = '';
  els.personaDomains.value = '';
  els.personaTone.value = '';
  els.personaPrompt.value = '';
  updateEditorStatus('Select a persona to edit or add a new one.');
}

async function savePersona() {
  const name = els.personaName.value.trim();
  const prompt = els.personaPrompt.value.trim();
  if (!name || !prompt) {
    updateEditorStatus('Name and system prompt are required.', 'error');
    return;
  }
  const persona = {
    id: STATE.editingId || `persona_${Date.now()}`,
    name,
    tagline: els.personaTagline.value.trim(),
    domains: els.personaDomains.value.split(',').map(s => s.trim()).filter(Boolean),
    tone: els.personaTone.value.trim(),
    prompt,
  };
  const idx = STATE.personas.findIndex(p => p.id === persona.id);
  if (idx >= 0) {
    STATE.personas[idx] = persona;
  } else {
    STATE.personas.push(persona);
  }
  await persistPersonas();
  resetEditor();
  renderPersonas();
  toast('Persona saved.');
}

async function deletePersona(id) {
  if (!confirm('Delete this persona?')) return;
  STATE.personas = STATE.personas.filter(p => p.id !== id);
  if (STATE.activeId === id) {
    STATE.activeId = '';
    STATE.personaEnabled = false;
    els.togglePersona.checked = false;
    await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PERSONA', persona: null });
  }
  await persistPersonas();
  renderPersonas();
  resetEditor();
  toast('Persona deleted.', 'warn');
}

async function activatePersona(id) {
  if (STATE.activeId === id && STATE.personaEnabled) return;
  const persona = STATE.personas.find(p => p.id === id);
  if (!persona) {
    toast('Persona not found.', 'error');
    return;
  }
  STATE.activeId = id;
  STATE.personaEnabled = true;
  els.togglePersona.checked = true;
  await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PERSONA', persona });
  renderPersonas();
  toast(`${persona.name} activated.`);
}

async function handleTogglePersona() {
  const enabled = !!els.togglePersona.checked;
  if (!enabled) {
    STATE.personaEnabled = false;
    await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PERSONA', persona: null });
    renderPersonas();
    toast('Persona mode disabled.', 'warn');
    return;
  }
  if (!STATE.activeId) {
    els.togglePersona.checked = false;
    toast('Select a persona to enable first.', 'warn');
    return;
  }
  const persona = STATE.personas.find(p => p.id === STATE.activeId);
  if (!persona) {
    els.togglePersona.checked = false;
    toast('Selected persona is not available.', 'error');
    return;
  }
  STATE.personaEnabled = true;
  await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PERSONA', persona });
  renderPersonas();
  toast('Persona mode enabled.');
}

async function persistPersonas() {
  await chrome.runtime.sendMessage({ type: 'SAVE_PERSONAS', personas: STATE.personas });
}

async function generatePersonaWithAI() {
  if (STATE.isGenerating) return;
  const desc = prompt('Describe the persona you want (e.g., "Healthcare screener specialist who passes medical panels"):');
  if (desc === null) return;
  if (!desc.trim()) {
    toast('Description is required to generate a persona.', 'warn');
    return;
  }
  STATE.isGenerating = true;
  updateEditorStatus('Generating persona with AI...', 'info');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GENERATE_PERSONA_PROFILE', description: desc.trim() });
    if (!resp?.ok) throw new Error(resp?.error || 'Generation failed');
    const generated = resp.persona || null;
    if (!generated) throw new Error('No usable persona returned');
    const persona = normalizePersona(generated);
    STATE.personas.push(persona);
    await persistPersonas();
    STATE.activeId = persona.id;
    STATE.personaEnabled = true;
    els.togglePersona.checked = true;
    await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PERSONA', persona });
    renderPersonas();
    startEdit(persona.id);
    toast('Generated a new persona and activated it!');
  } catch (err) {
    toast('Failed to generate persona: ' + (err.message || err), 'error');
  } finally {
    STATE.isGenerating = false;
    updateEditorStatus('Select a persona to edit or add a new one.');
  }
}

async function exportPersonaPdf() {
  if (!STATE.personas.length) {
    toast('No personas available to export.', 'warn');
    return;
  }
  showExportOverlay('Rendering your PDF...');
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'EXPORT_PDF',
      exportType: 'personas',
      payload: STATE.personas
    });
    if (!resp?.ok) throw new Error(resp?.error || 'PDF export failed');
    toast('Personas PDF downloaded.');
  } catch (err) {
    toast(`Failed to export PDF: ${err.message || err}`, 'error');
  } finally {
    hideExportOverlay();
  }
}

function normalizePersona(p) {
  return {
    id: p.id || `persona_${Date.now()}`,
    name: p.name || 'Survey Expert',
    tagline: p.tagline || '',
    domains: Array.isArray(p.domains) ? p.domains.map(String) : [],
    tone: p.tone || '',
    prompt: p.prompt || '',
  };
}

function updateEditorStatus(message, type = 'info') {
  if (!els.editorStatus) return;
  els.editorStatus.textContent = message || '';
  els.editorStatus.style.color = typeColor(type);
}

function toast(message, type = 'info') {
  const existing = document.getElementById('personas-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'personas-toast';
  el.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 18px;
    border-radius: 12px;
    backdrop-filter: blur(12px);
    background: rgba(10,15,25,0.9);
    border: 1px solid ${typeColor(type)};
    color: var(--text);
    font-family: inherit;
    box-shadow: 0 12px 30px rgba(0,0,0,0.35);
    z-index: 9999;
    letter-spacing: 0.03em;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function typeColor(type) {
  switch (type) {
    case 'error': return 'rgba(244,63,94,0.55)';
    case 'warn': return 'rgba(250,204,21,0.55)';
    case 'info': return 'rgba(34,211,238,0.55)';
    default: return 'rgba(74,222,128,0.55)';
  }
}

function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showExportOverlay(label) {
  let overlay = document.getElementById('personas-export-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'personas-export-overlay';
    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;border:3px solid rgba(148,163,184,0.3);border-top-color:#39ff14;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <div class="export-label" style="font-weight:600;color:#e2e8f0;">${label}</div>
        <div style="font-size:12px;color:#94a3b8;">Generating your personas PDF...</div>
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
  const overlay = document.getElementById('personas-export-overlay');
  if (overlay) overlay.remove();
}

async function handleStorageChange(changes, area) {
  if (area !== 'local') return;
  if (changes.personas || changes.personaEnabled || changes.personaActiveId) {
    await loadPersonas();
  }
}
