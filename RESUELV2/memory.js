const els = {
  insightCard: document.getElementById('insightCard'),
  memoryStream: document.getElementById('memoryStream'),
  refreshInsight: document.getElementById('refreshInsight'),
  exportMemory: document.getElementById('exportMemory'),
  exportMemoryPdf: document.getElementById('exportMemoryPdf'),
  clearMemory: document.getElementById('clearMemory'),
};

const STATE = {
  entries: [],
  insight: null,
  loadingInsight: false,
};

init();

async function init() {
  await loadData();
  attachEvents();
  chrome.storage.onChanged.addListener(handleStorageChange);
}

async function loadData() {
  const { contextQA = [], surveyInsight = null } = await chrome.storage.local.get(['contextQA', 'surveyInsight']);
  STATE.entries = Array.isArray(contextQA) ? contextQA.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)) : [];
  STATE.insight = surveyInsight || null;
  renderInsight();
  renderEntries();
}

function attachEvents() {
  els.refreshInsight?.addEventListener('click', refreshInsight);
  els.exportMemory?.addEventListener('click', exportMemory);
  els.exportMemoryPdf?.addEventListener('click', exportMemoryPdf);
  els.clearMemory?.addEventListener('click', clearMemory);
}

async function refreshInsight() {
  if (!STATE.entries.length) {
    toast('No entries to analyze yet.');
    return;
  }
  if (STATE.entries.length < 8) {
    toast('Answer at least 8 questions to generate a reliable insight.', 'warn');
    return;
  }
  if (STATE.loadingInsight) return;
  STATE.loadingInsight = true;
  renderInsight(true);
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ANALYZE_SURVEY_MEMORY', entries: STATE.entries.slice(-200).reverse() });
    if (!resp?.ok) throw new Error(resp?.error || 'Analysis currently unavailable');
    STATE.insight = resp.analysis || null;
    renderInsight();
    toast('Insight updated successfully.');
  } catch (err) {
    renderInsight(false, err.message || 'Analysis failed');
    toast('Failed to refresh insight: ' + (err.message || err), 'error');
  } finally {
    STATE.loadingInsight = false;
  }
}

async function exportMemory() {
  if (!STATE.entries.length) {
    toast('No entries available for export.', 'warn');
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    totalEntries: STATE.entries.length,
    insight: STATE.insight,
    entries: STATE.entries.map(normalizeEntry)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zepra-memory-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Memory exported successfully.');
}

async function exportMemoryPdf() {
  if (!STATE.entries.length) {
    toast('No entries available for export.', 'warn');
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    totalEntries: STATE.entries.length,
    insight: STATE.insight,
    entries: STATE.entries.map(normalizeEntry)
  };
  showExportOverlay('Rendering your PDF...');
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'EXPORT_PDF',
      exportType: 'memory',
      payload
    });
    if (!resp?.ok) throw new Error(resp?.error || 'PDF export failed');
    toast('Memory PDF downloaded.');
  } catch (err) {
    toast(`Failed to export PDF: ${err.message || err}`, 'error');
  } finally {
    hideExportOverlay();
  }
}

async function clearMemory() {
  if (!confirm('Clear the entire AI memory? This action cannot be undone.')) return;
  await chrome.storage.local.set({ contextQA: [], surveyInsight: null });
  STATE.entries = [];
  STATE.insight = null;
  renderInsight();
  renderEntries();
  toast('All memory entries removed.', 'warn');
}

function renderInsight(forceLoading = false, errorMsg = null) {
  if (!els.insightCard) return;
  els.insightCard.innerHTML = '';

  if (forceLoading || STATE.loadingInsight) {
    els.insightCard.innerHTML = '<div class="empty-state">Running survey analysis... ⚙️</div>';
    return;
  }

  if (errorMsg) {
    els.insightCard.innerHTML = `<div class="empty-state" style="color:#f87171; border-color: rgba(248,113,113,0.35);">${escapeHTML(errorMsg)}</div>`;
    return;
  }

  const insight = STATE.insight?.analysis;
  if (!insight || typeof insight !== 'object') {
    els.insightCard.innerHTML = '<div class="empty-state">Not enough data yet. Answer more questions to unlock the analysis.</div>';
    return;
  }

  const card = document.createElement('div');
  card.className = 'insight-grid';
  const sampleSize = STATE.insight?.sampleSize || STATE.entries.length;
  const updatedAt = STATE.insight?.updatedAt ? formatDate(STATE.insight.updatedAt) : 'Unknown';
  const confidence = formatConfidence(insight.confidence);

  card.innerHTML = `
    <span class="status">Automated Analysis</span>
    <div class="insight-item">
      <h3>Survey Objective</h3>
      <p>${escapeHTML(insight.objective || 'Not identified yet')}</p>
    </div>
    <div class="insight-item">
      <h3>Target Persona</h3>
      <p>${escapeHTML(insight.targetPersona || 'Not identified yet')}</p>
    </div>
    <div class="insight-item">
      <h3>Key Signals</h3>
      ${renderSignals(insight.keySignals)}
    </div>
    <div class="insight-footer">
      <span>Total answers: <strong>${sampleSize}</strong></span>
      <span class="confidence">Confidence: ${confidence}</span>
      <span>Updated: ${updatedAt}</span>
    </div>
  `;

  els.insightCard.appendChild(card);
}

function renderEntries() {
  if (!els.memoryStream) return;
  els.memoryStream.innerHTML = '';
  if (!STATE.entries.length) {
    els.memoryStream.innerHTML = '<div class="empty-state">No responses have been recorded yet. Generate answers and they will appear here.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  STATE.entries.forEach((entry, index) => {
    const card = document.createElement('article');
    card.className = 'memory-card';
    const ts = entry.ts ? formatDate(entry.ts) : 'Unknown';
    const personaTag = entry.personaId ? `<span class="tag">🎭 ${escapeHTML(entry.personaId)}</span>` : '';
    const promptLabel = entry.promptName ? `<span class="tag">🧾 ${escapeHTML(entry.promptName)}</span>` : '';
    card.innerHTML = `
      <div class="memory-card-header">
        <div class="memory-seq">
          <span class="seq-index">ENTRY ${String(index + 1).padStart(3, '0')}</span>
          <span class="seq-time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>${ts}</span>
        </div>
        <div class="memory-tags">
          ${promptLabel}
          ${personaTag}
        </div>
      </div>
      <div class="memory-block">
        <span class="memory-label">Question</span>
        <p class="memory-text">${escapeHTML(entry.q || '')}</p>
      </div>
      <div class="memory-block">
        <span class="memory-label">Answer</span>
        <p class="memory-text">${escapeHTML(entry.a || '')}</p>
      </div>
      <div class="memory-actions">
        <button data-copy="${encodeURIComponent(entry.a || '')}"><span>📋</span> Copy answer</button>
      </div>
    `;
    card.querySelector('[data-copy]')?.addEventListener('click', () => copyAnswer(entry.a || ''));
    fragment.appendChild(card);
  });

  els.memoryStream.appendChild(fragment);
}

function renderSignals(signals) {
  if (!Array.isArray(signals) || !signals.length) {
    return '<p>No specific signals yet.</p>';
  }
  return `<ul>${signals.map(sig => `<li>${escapeHTML(sig)}</li>`).join('')}</ul>`;
}

function formatConfidence(val) {
  const normalized = String(val || '').toLowerCase();
  switch (normalized) {
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    default: return 'Unknown';
  }
}

function formatDate(ts) {
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  } catch {
    return 'Unknown';
  }
}

function normalizeEntry(entry) {
  return {
    q: entry.q || '',
    a: entry.a || '',
    promptName: entry.promptName || '',
    personaId: entry.personaId || '',
    ts: entry.ts || null
  };
}

function copyAnswer(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast('Answer copied to clipboard.')).catch(() => toast('Failed to copy answer.', 'error'));
}

function toast(message, type = 'info') {
  const existing = document.getElementById('memory-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'memory-toast';
  el.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 18px;
    border-radius: 12px;
    backdrop-filter: blur(12px);
    background: rgba(15,23,42,0.88);
    border: 1px solid ${typeColor(type)};
    color: var(--text);
    font-family: inherit;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    z-index: 9999;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function typeColor(type) {
  switch (type) {
    case 'error': return 'rgba(244,63,94,0.55)';
    case 'warn': return 'rgba(250,204,21,0.55)';
    default: return 'rgba(57,255,20,0.45)';
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
  let overlay = document.getElementById('memory-export-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'memory-export-overlay';
    overlay.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;border:3px solid rgba(148,163,184,0.3);border-top-color:#39ff14;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <div class="export-label" style="font-weight:600;color:#e2e8f0;">${label}</div>
        <div style="font-size:12px;color:#94a3b8;">Please wait while we prepare your file.</div>
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
  const overlay = document.getElementById('memory-export-overlay');
  if (overlay) overlay.remove();
}

async function handleStorageChange(changes, area) {
  if (area !== 'local') return;
  let shouldReload = false;
  if (changes.contextQA) shouldReload = true;
  if (changes.surveyInsight) shouldReload = true;
  if (!shouldReload) return;
  await loadData();
}
