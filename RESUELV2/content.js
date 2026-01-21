// content.js
// - Extract selected text or from DOM
// - Overlay to select OCR region
// - Fallback image crop
// - Type text into focused field (no humanize; speed only)
// - Floating bubble with rainbow modal
// (Video dubbing feature removed)

// Global-safe modal helper for use across the file
function _safeCreateStyledModal(title, content){
  try{
    if (typeof createStyledModal === 'function') {
      return createStyledModal(title, content);
    }
  }catch(_){}
  // Fallback lightweight modal
  const modal = document.createElement('div');
  modal.id = 'zepra-styled-modal';
  modal.innerHTML = `
    <div class="styled-modal-content" style="background:rgba(15,23,42,0.95);border:1px solid #334155;border-radius:12px;min-width:260px;max-width:92vw;">
      <div class="styled-modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #334155;color:#e2e8f0;">
        <h3 style="margin:0;font-size:14px;">${title}</h3>
        <button class="styled-modal-close" style="background:transparent;border:0;color:#94a3b8;font-size:20px;cursor:pointer;">&times;</button>
      </div>
      <div class="styled-modal-body" style="padding:14px;color:#e2e8f0;">${content}</div>
    </div>`;
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(3px);z-index:2147483647;display:flex;align-items:center;justify-content:center;';
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.remove(); });
  setTimeout(()=>{ modal.querySelector('.styled-modal-close')?.addEventListener('click',()=>modal.remove()); },0);
  document.body.appendChild(modal);
  return modal;
}

function init() {
  if (window.zepraInit) return;
  window.zepraInit = true;
  const STATE = {
    overlay: null,
    rectEl: null,
    modal: null,
    bubble: null,
    currentAnswer: '',
    isTyping: false,
    selBtn: null,
    lastFocused: null,
    lastMouse: { x: 20, y: 20 },
    fillIcon: null
  };

  let customPrompts = [];
  chrome.storage.sync.get('customPrompts', r => { customPrompts = r.customPrompts || []; });
  chrome.storage.onChanged.addListener((chg, area) => {
    if(area === 'sync' && chg.customPrompts){ customPrompts = chg.customPrompts.newValue || []; }
  });

  // Identity handling
  const FIELD_KEYWORDS = {
    email: ['email','e-mail','user_email','customer_email','mailid','emailaddress','email_address','useremail','emailid','contact_email','work_email','primary_email',/e-?mail/],
    username: ['username','user','userid','login','login_id','user-name','nickname','user_name','loginname','account','membername',/user.?name/],
    password: ['password','pass','pwd','secret','user_pass','passwd','passcode','userpassword',/pass.?word/],
    fullName: ['fullname','your-name','cardholder','card_name','nameoncard','full_name','customer_name','name','contact_name','realname',/full.?name/],
    firstName: ['firstname','first_name','fname','given-name','forename','given_name','first','customer_firstname','person_first_name','firstname1','first-name',/first.?name/],
    lastName: ['lastname','last_name','lname','surname','family-name','family_name','last','customer_lastname','person_last_name','lastname1','last-name',/last.?name/],
    age: ['age','user_age','yourage','member_age','ageyears','yrs','years_old','yearsold','birthyear',/years?\s?old/],
    phone: ['phone','mobile','telephone','tel','contact_number','phone_number','contact-no','cell','cellphone','phonenumber','dayphone','evephone','homephone',/phone|tel/],
    address1: ['address','address1','street_address','street','address-line1','billing_address','line1','addr1','street1','address_1','addressline1'],
    address2: ['address2','suite','apt','apartment','address-line2','line2','addr2','street2','address_2','addressline2'],
    city: ['city','town','user_city','locality','cityname','municipality',/city|town/],
    state: ['state','province','region','county','state_province','stateprovince','territory','prefecture',/state|province/],
    zipCode: ['zip','zipcode','postal','postal_code','postcode','zip_code','post_code','pin','pincode',/post.?code/],
    country: ['country','nation','country_name','countrycode','country-code',/country|nation/],
    macAddress: ['mac','mac_address','macaddress','device_mac','mac-addr','hardwareaddress','hwaddress',/mac.*address/],
    companyName: ['company','company_name','business_name','organization','organisation','employer','business','corp','corporation','workplace','companyname','firm',/company.?name|business/],
    companyIndustry: ['industry','field','business_type','area_of_work','sector','line_of_business','business_sector','industry_type','occupation','trade',/industry|sector/],
    companySize: ['company_size','employees','number_of_employees','employee_count','staff_size','num_employees','employee_number','workforce','team_size','size_of_company',/employee.?count|staff/],
    companyAnnualRevenue: ['revenue','annual_revenue','company_revenue','sales_volume','annual_sales','turnover','yearly_revenue','yearly_sales','company_turnover','gross_revenue',/annual.?revenue|turnover/],
    companyWebsite: ['website','company_website','company_url','business_url','site_url','web_address','companysite','companyweb','corporate_website','business_website',/web.?site|url/],
    companyAddress: ['company_address','business_address','work_address','office_address','corporate_address','company_location','workplace_address','company_addr',/office.?address|business.?addr/]
  };

  let activeIdentity = null;
  function loadIdentity(){
    chrome.storage.local.get(['activeIdentityId','identities'], res => {
      const list = res.identities || [];
      const id = res.activeIdentityId;
      activeIdentity = list.find(i=>i.id===id) || null;
    });
  }
  chrome.storage.onChanged.addListener((chg, area)=>{
    if(area==='local' && (chg.activeIdentityId || chg.identities)){
      loadIdentity();
    }
  });
  loadIdentity();

  function addFieldToIdentity(btn, value, key, success='Saved!'){
    chrome.storage.local.get('identities', ({identities=[]})=>{
      if(!identities.length){ showNotification('No identities saved'); return; }
      
      // Remove existing dropdown if it exists
      const existingSelect = btn.parentElement.querySelector('.ati-select');
      if(existingSelect){ existingSelect.remove(); return; }
      
      // Create styled dropdown
      const dropdownContainer = document.createElement('div');
      dropdownContainer.className = 'ati-dropdown-container';
      dropdownContainer.style.cssText = `
        position: absolute;
        top: 100%;
        left: 0;
        z-index: 2147483648;
        margin-top: 4px;
        min-width: 180px;
        background: rgba(15,23,42,0.95);
        border: 1px solid #334155;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        backdrop-filter: blur(16px);
        overflow: hidden;
      `;
      
      const dropdownHeader = document.createElement('div');
      dropdownHeader.style.cssText = `
        padding: 8px 12px;
        background: rgba(56,189,248,0.1);
        border-bottom: 1px solid #334155;
        color: #38bdf8;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      `;
      dropdownHeader.textContent = 'Select Identity';
      
      const dropdownList = document.createElement('div');
      dropdownList.style.cssText = 'max-height: 200px; overflow-y: auto;';
      
      identities.forEach(identity => {
        const option = document.createElement('div');
        option.className = 'ati-option';
        option.style.cssText = `
          padding: 10px 12px;
          cursor: pointer;
          color: #e2e8f0;
          font-size: 14px;
          border-bottom: 1px solid rgba(75,85,99,0.3);
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        `;
        
        option.innerHTML = `
          <div style="width: 8px; height: 8px; background: #4ade80; border-radius: 50%; flex-shrink: 0;"></div>
          <span style="font-weight: 500;">${identity.identityName || 'Unnamed Identity'}</span>
        `;
        
        option.addEventListener('mouseenter', () => {
          option.style.background = 'rgba(74,222,128,0.15)';
          option.style.color = '#4ade80';
        });
        
        option.addEventListener('mouseleave', () => {
          option.style.background = 'transparent';
          option.style.color = '#e2e8f0';
        });
        
        option.addEventListener('click', () => {
          const idx = identities.findIndex(i => i.id === identity.id);
          if(idx > -1) {
            identities[idx][key] = value;
            chrome.storage.local.set({identities});
          }
          
          dropdownContainer.remove();
          
          // Show success message
          const successMsg = document.createElement('div');
          successMsg.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            z-index: 2147483648;
            margin-top: 4px;
            padding: 6px 12px;
            background: #4ade80;
            color: #0b1b13;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(74,222,128,0.4);
            animation: slideInUp 0.3s ease;
          `;
          successMsg.textContent = success;
          
          // Position relative to button
          btn.parentElement.style.position = 'relative';
          btn.parentElement.appendChild(successMsg);
          
          setTimeout(() => successMsg.remove(), 2000);
        });
        
        dropdownList.appendChild(option);
      });
      
      dropdownContainer.appendChild(dropdownHeader);
      dropdownContainer.appendChild(dropdownList);
      
      // Position relative to button
      btn.parentElement.style.position = 'relative';
      btn.parentElement.appendChild(dropdownContainer);
      
      // Close dropdown when clicking outside
      const closeDropdown = (e) => {
        if (!dropdownContainer.contains(e.target) && !btn.contains(e.target)) {
          dropdownContainer.remove();
          document.removeEventListener('click', closeDropdown);
        }
      };
      
      setTimeout(() => {
        document.addEventListener('click', closeDropdown);
      }, 100);
    });
  }
  function detectField(el){
    if(!el) return null;
    const attrs = ((el.id||'') + ' ' + (el.name||'') + ' ' + (el.placeholder||'') + ' ' + (el.type||'')).toLowerCase();
    let labelText = '';
    if(el.id){
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if(lbl) labelText = lbl.textContent.toLowerCase();
    }
    const hay = attrs + ' ' + labelText;
    for(const [key, vals] of Object.entries(FIELD_KEYWORDS)){
      if(vals.some(v=> v instanceof RegExp ? v.test(hay) : hay.includes(v))) return key;
    }
    return null;
  }

  function showFieldIcon(el){
    removeFieldIcon();
    if(!activeIdentity) return;
    const fieldKey = detectField(el);
    if(!fieldKey || !activeIdentity[fieldKey]) return;
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/zepra.svg');
    icon.className = 'zepra-fill-icon';
    icon.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);width:16px;height:16px;cursor:pointer;z-index:2147483647;';
    const parent = el.parentElement;
    if(!parent) return;
    const prevPos = parent.style.position;
    if(getComputedStyle(parent).position === 'static') parent.style.position='relative';
    parent.appendChild(icon);
    icon.addEventListener('mousedown', ev=>{
      ev.preventDefault();
      el.focus();
      typeIntoFocusedElement(activeIdentity[fieldKey], { speed: 'normal' });
    });
    STATE.fillIcon = {icon, parent, prevPos};
  }

  function removeFieldIcon(){
    const fi = STATE.fillIcon;
    if(fi){
      fi.icon.remove();
      if(fi.prevPos) fi.parent.style.position = fi.prevPos;
      STATE.fillIcon = null;
    }
  }


  function toggleIdentityPanel(){
    if(!activeIdentity){ showNotification('No active identity'); return; }
    // Build rows from available fields with labels
    const fieldOrder=[
      ['fullName','Full Name'],
      ['email','Email'],
      ['phone','Phone'],
      ['address1','Address'],
      ['city','City'],
      ['state','State/Region'],
      ['zipCode','Postal Code'],
      ['country','Country']
    ];
    const items = fieldOrder
      .filter(([k])=> activeIdentity[k])
      .map(([k,label])=>({ key:k, label, value:String(activeIdentity[k]||'') }));

    const copySVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    const checkSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

    const content = `
      <style>
        /* Shell refinements (glassmorphism/aurora) */
        #zepra-styled-modal .styled-modal-content.id-shell{ 
          background: radial-gradient(1200px 500px at 20% -20%, rgba(56,189,248,0.10), transparent 60%),
                      radial-gradient(900px 400px at 120% 120%, rgba(74,222,128,0.08), transparent 60%),
                      rgba(2,6,23,0.50); /* lighter alpha so bg video shows */
          backdrop-filter: blur(22px);
          border: 1px solid rgba(75,85,99,0.5);
          border-radius: 1.25rem; /* ~ rounded-2xl */
        }
        #zepra-styled-modal .id-wrap{position:relative;overflow:hidden}
        #zepra-styled-modal .id-bg{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.32}
        #zepra-styled-modal .id-bg video{width:100%;height:100%;object-fit:cover;filter:brightness(.8) saturate(1.05)}
        #zepra-styled-modal .id-header-bar{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(148,163,184,0.18)}
        #zepra-styled-modal .id-title{color:#e5e7eb;font-weight:800;font-size:18px}
        #zepra-styled-modal .id-close{background:transparent;border:none;color:#9ca3af;width:28px;height:28px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}
        #zepra-styled-modal .id-close:hover{color:#e5e7eb;background:rgba(255,255,255,0.06)}

        #zepra-styled-modal .id-body{position:relative;z-index:1;padding:18px;max-height:62vh;overflow:auto}
        #zepra-styled-modal .id-list{display:flex;flex-direction:column;gap:8px}

          /* Row */
          #zepra-styled-modal .id-row{position:relative;display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:12px;border:1px solid rgba(75,85,99,0.5);background:rgba(255,255,255,0.02);transition:background .2s,border-color .2s}
          #zepra-styled-modal .id-row:hover{background:rgba(255,255,255,0.06);}
          #zepra-styled-modal .id-label{font-size:11px;letter-spacing:.2px;color:#9ca3af;font-weight:600}
          #zepra-styled-modal .id-value{color:#f3f4f6;font-size:15px;display:flex;align-items:center;justify-content:space-between;gap:8px}
          #zepra-styled-modal .id-copy{opacity:0;transition:opacity .15s;color:#9cc0ff}
          #zepra-styled-modal .id-row:hover .id-copy{opacity:1}
          #zepra-styled-modal .id-copy-btn{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;border:1px solid rgba(148,163,184,0.25);background:rgba(255,255,255,0.04);cursor:pointer;color:#93c5fd}
          #zepra-styled-modal .id-copy-btn:hover{color:#38bdf8;border-color:rgba(56,189,248,0.4)}
          #zepra-styled-modal .id-copy-btn svg{width:18px;height:18px}
          #zepra-styled-modal .id-copied{color:#4ade80}
      </style>
      <div class="id-wrap">
        <div class="id-header-bar">
          <div class="id-title">Identity Data</div>
          <button class="id-close" aria-label="Close">×</button>
        </div>
        <div class="id-bg"><video autoplay loop muted playsinline src="${chrome.runtime.getURL('src/media/static (1).webm')}"></video></div>
        <div class="id-body">
          <div class="id-list">
            ${items.map(it=>`
              <div class="id-row" data-key="${it.key}">
                <div class="id-label">${it.label}</div>
                <div class="id-value">
                  <span class="id-text">${it.value}</span>
                  <span class="id-copy">
                    <button class="id-copy-btn" data-copy="${it.key}" title="Copy">${copySVG}</button>
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;

    const modal = createStyledModal('Identity Data', content);
    // apply shell class for glass look
    modal.querySelector('.styled-modal-content')?.classList.add('id-shell');
    // custom close to keep consistent iconography
    modal.querySelector('.id-close')?.addEventListener('click',()=>{
      modal.remove();
    });

    // Copy logic with 2.2s feedback
    modal.querySelectorAll('[data-copy]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const key = btn.getAttribute('data-copy');
        const text = (activeIdentity[key]||'').toString();
        try{ await navigator.clipboard.writeText(text); }catch(_){ /* ignore */ }
        // swap icon to check
        btn.innerHTML = `${checkSVG}`;
        btn.classList.add('id-copied');
        setTimeout(()=>{
          btn.innerHTML = `${copySVG}`;
          btn.classList.remove('id-copied');
        }, 2200);
      });
    });
  }

  document.addEventListener('keydown', e => {
    const combo = (e.ctrlKey ? 'Ctrl+' : '') +
                  (e.altKey ? 'Alt+' : '') +
                  (e.shiftKey ? 'Shift+' : '') +
                  e.key.toUpperCase();
    const pr = customPrompts.find(p => p.hotkey && p.hotkey.toUpperCase() === combo);
    if (pr) {
      const text = window.getSelection().toString().trim();
      if (!text) return;
      // Use integrated rainbow modal for a consistent UX instead of a simple alert.
      createRainbowModal(text, pr.id);
      e.preventDefault();
    }
  });

  document.addEventListener('focusin', (e) => { STATE.lastFocused = e.target; showFieldIcon(e.target); });
  document.addEventListener('focusout', () => removeFieldIcon());

  // Start floating bubble and helpers
  createFloatingBubble();
  watchForms();

  function watchForms(){
    let dismissed = false;
    const check = ()=>{
      if(dismissed || document.getElementById('zepra-helper-bar')) return;
      const forms = Array.from(document.querySelectorAll('form'));
      let target = null;
      for(const f of forms){
        const els = f.querySelectorAll('input,select');
        let matches = 0;
        for(const el of els){
          if(detectField(el)){
            matches++;
            if(matches >= 3) break;
          }
        }
        if(matches >= 3){ target = f; break; }
      }
      if(target){
        const bar=document.createElement('div');
        bar.id='zepra-helper-bar';
        bar.innerHTML = `
          <style>
            @keyframes zepraEntry{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}
            @keyframes zepraExit{to{opacity:0;transform:translate(-50%,-14px)}}
            .zepra-float{position:fixed;top:20px;left:50%;transform:translate(-50%,0);z-index:2147483647;animation:zepraEntry .35s ease-out forwards}
            .zf-wrap{display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(30,41,59,0.80);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,0.10);border-radius:14px;box-shadow:0 25px 60px rgba(0,0,0,0.55);min-width:280px;max-width:min(92vw,860px)}
            .zf-icon{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.25);color:#86efac;box-shadow:0 0 20px rgba(16,185,129,0.15)}
            .zf-text{color:#e5e7eb}
            .zf-text b{font-weight:800}
            .zf-actions{display:flex;gap:10px;margin-left:auto}
            .btn-pill{padding:8px 14px;border-radius:9999px;border:1px solid rgba(255,255,255,0.10);background:transparent;color:#e5e7eb;cursor:pointer;transition:all .25s ease}
            .btn-pill:hover{background:rgba(255,255,255,0.06)}
            .btn-primary{background:#34d399;color:#0b1b13;border:none;box-shadow:0 0 20px rgba(16,185,129,0.30)}
            .btn-primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
            .zf-shine{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(16,185,129,.5),transparent);background-size:200% 100%;animation:shine 2.2s linear infinite}
            @keyframes shine{0%{background-position:200% 0}100%{background-position:-200% 0}}
          </style>
          <div class="zepra-float">
            <div class="zf-shine"></div>
            <div class="zf-wrap">
              <div class="zf-icon">🛡️</div>
              <div class="zf-text"><b>Zepra</b> has detected a form. Fill with your active identity?</div>
              <div class="zf-actions">
                <button id="zepra-fill" class="btn-pill btn-primary">Fill Form</button>
                <button id="zepra-dismiss" class="btn-pill">Dismiss</button>
              </div>
            </div>
          </div>`;
        document.body.prepend(bar);
        const removeBar=()=>{ const node=bar.querySelector('.zepra-float'); if(node){ node.style.animation='zepraExit .25s ease-in forwards'; setTimeout(()=>bar.remove(),250);} else bar.remove(); };
        bar.querySelector('#zepra-fill').addEventListener('click',async ()=>{
          try{
            // Show loading indicator
            const fillBtn = bar.querySelector('#zepra-fill');
            const originalText = fillBtn.innerHTML;
            fillBtn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px;">🔄 <span>Filling...</span></span>';
            fillBtn.disabled = true;
            
            const { autofillWithAI=false } = await chrome.storage.local.get('autofillWithAI');
            if(autofillWithAI){ await analyzeFormWithAI(target); } else { await fillForm(target); }
            
            // Restore button
            fillBtn.innerHTML = originalText;
            fillBtn.disabled = false;
          }finally{ removeBar(); dismissed = true; }
        });
        bar.querySelector('#zepra-dismiss').addEventListener('click',()=>{ removeBar(); dismissed = true; });
      }
    };
    const mo=new MutationObserver(check);
    mo.observe(document.documentElement,{childList:true,subtree:true});
    check();
  }

  async function fillForm(form){
    if(!activeIdentity) {
      showNotification('No active identity selected', 'warn');
      return;
    }
    
    showNotification('Filling form...', 'info');
    
    const fields=form.querySelectorAll('input,textarea,select');
    let filledCount = 0;
    
    for(const el of fields){
      const key=detectField(el);
      if(key && activeIdentity[key]){
        el.focus();
        await typeIntoFocusedElement(activeIdentity[key], {speed:'normal'});
        await sleep(120);
        filledCount++;
      }
    }
    
    if (filledCount > 0) {
      showNotification(`Form filled! ${filledCount} fields completed`, 'success');
    } else {
      showNotification('No matching fields found for current identity', 'warn');
    }
  }

  async function analyzeFormWithAI(form){
    if(!activeIdentity) return fillForm(form);
    try {
      // Show loading notification
      showNotification('Analyzing form with AI...', 'info');
      
      // Serialize richer context for higher-accuracy mapping
      const serialize = (el)=>{  
        const arr = Array.from(el.querySelectorAll('input,select,textarea')).map((n)=>{
          const id=n.id||''; const name=n.name||''; const ph=n.placeholder||''; const type=n.type||n.tagName.toLowerCase();
          let label='';
          if(id){ const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`); if(lbl) label = (lbl.textContent||'').trim(); }
          if(!label){ const p = n.closest('label'); if(p) label = (p.textContent||'').trim(); }
          // Get surrounding context
          const parent = n.parentElement;
          const siblings = parent ? Array.from(parent.children).map(c => c.textContent?.trim()).filter(Boolean).join(' ') : '';
          return { tag:n.tagName.toLowerCase(), id, name, placeholder:ph, type, label, context: siblings.slice(0, 200) };
        });
        return JSON.stringify(arr).slice(0,12000);
      };
      const contextJSON = serialize(form);
      const html = form.outerHTML?.slice(0,15000) || form.innerHTML.slice(0,15000);

      let screenshot = '';
      try {
        const shotRes = await chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE_IMAGE' });
        if (shotRes?.ok && shotRes.dataUrl) {
          screenshot = shotRes.dataUrl;
        }
      } catch (err) {
        console.warn('Zepra debug: screenshot capture failed', err);
      }

      const identityPayload = activeIdentity ? JSON.parse(JSON.stringify(activeIdentity)) : {};
      const res = await chrome.runtime.sendMessage({
        type: 'ANALYZE_FORM',
        html,
        contextJSON,
        screenshot,
        identity: identityPayload
      });
      if(!res?.ok) throw new Error('AI analysis failed');
      const mapping = JSON.parse(res.result);

      showNotification('Filling form with AI mapping...', 'info');
      
      for(const [selector,key] of Object.entries(mapping)){
        const el=form.querySelector(selector);
        if(el && activeIdentity[key]){
          el.focus();
          await typeIntoFocusedElement(activeIdentity[key], {speed:'normal'});
          await sleep(150);
        }
      }
      
      showNotification('Form filled successfully with AI!', 'success');
    } catch(e){
      console.error('Form analysis failed, using fallback', e);
      showNotification('AI analysis failed, using basic fill...', 'warn');
      await fillForm(form);
    }
  }

  // Create floating bubble
  function createFloatingBubble() {
    if (STATE.bubble || document.getElementById('zepra-bubble')) return;
    
    const bubble = document.createElement('div');
    bubble.id = 'zepra-bubble';
    bubble.innerHTML = `
      <div class="bubble-icon">
        <video autoplay loop muted src="${chrome.runtime.getURL('src/media/zepra.webm')}"></video>
        <div class="bubble-glow"></div>
      </div>
    `;
    
    bubble.style.cssText = `
      position: fixed;
      width: 60px;
      height: 60px;
      z-index: 2147483647;
      cursor: grab;
      border-radius: 50%;
      background: #000;
      box-shadow: 0 0 10px #39ff14, 0 0 20px #ffe600;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease;
      border: 2px solid #39ff14;
      animation: bubbleFloat 3s ease-in-out infinite;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes bubbleFloat {
        0%, 100% { transform: translateY(0px) scale(1); }
        50% { transform: translateY(-10px) scale(1.05); }
      }
      
      #zepra-bubble:hover {
        transform: scale(1.1) !important;
        box-shadow: 0 6px 30px rgba(57,255,20,0.6), 0 0 20px rgba(255,230,0,0.5) !important;
      }

      .bubble-icon {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        overflow: hidden;
      }
      
      .bubble-icon video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: 50%;
      }
      
      .bubble-glow {
        position: absolute;
        top: -5px;
        left: -5px;
        right: -5px;
        bottom: -5px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(57,255,20,0.4) 0%, rgba(255,230,0,0.2) 40%, transparent 70%);
        animation: pulse 2s ease-in-out infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.1); }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(bubble);
    STATE.bubble = bubble;

    // Position bubble using stored value or default
    chrome.storage.local.get('bubblePos', ({ bubblePos }) => {
      if (bubblePos && typeof bubblePos.top === 'number' && typeof bubblePos.left === 'number') {
        bubble.style.top = bubblePos.top + 'px';
        bubble.style.left = bubblePos.left + 'px';
        bubble.style.right = 'unset';
      } else {
        bubble.style.top = '20px';
        bubble.style.right = '20px';
      }
    });


    // Drag behaviour
    let drag = { active: false, moved: false, offsetX: 0, offsetY: 0 };

    bubble.addEventListener('mousedown', (e) => {
      drag.active = true;
      drag.moved = false;
      drag.offsetX = e.clientX - bubble.offsetLeft;
      drag.offsetY = e.clientY - bubble.offsetTop;
      bubble.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
      if (!drag.active) return;
      drag.moved = true;
      const x = Math.min(window.innerWidth - bubble.offsetWidth, Math.max(0, e.clientX - drag.offsetX));
      const y = Math.min(window.innerHeight - bubble.offsetHeight, Math.max(0, e.clientY - drag.offsetY));
      bubble.style.left = x + 'px';
      bubble.style.top = y + 'px';
      bubble.style.right = 'unset';
    }

    function onUp() {
      if (!drag.active) return;
      drag.active = false;
      bubble.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      chrome.storage.local.set({ bubblePos: { top: parseInt(bubble.style.top, 10), left: parseInt(bubble.style.left, 10) } });
      setTimeout(() => { drag.moved = false; }, 0);
    }

    bubble.addEventListener('click', (e) => {
      if (drag.moved) return;
      showBubbleMenu();
    });
  }

  function showBubbleMenu() {
    if (document.getElementById('zepra-sidebar')) return;

    const menu = document.createElement('aside');
    menu.id = 'zepra-sidebar';
    menu.innerHTML = `
      <div class="sidebar-bg"><video autoplay loop muted playsinline src="${chrome.runtime.getURL('src/media/static (1).webm')}"></video></div>
      <div class="zepra-particles"></div>
      <header class="sidebar-header">
        <svg class="zap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <div class="title-group">
          <h2>Zepra Menu</h2>
          <p>Chrome Extension Suite</p>
        </div>
        <button class="close-btn" aria-label="Close">&times;</button>
      </header>
      <nav class="sidebar-nav">
        <ul>
          <li><a href="#" data-action="ask-by-photo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg><span>Ask by Photo</span></a></li>
          <li><a href="#" data-action="ocr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg><span>OCR Capture</span></a></li>
          <li><a href="#" data-action="ocr-full"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg><span>OCR Full Page</span></a></li>
          <li><a href="#" data-action="write-last"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Write Last Answer</span></a></li>
          <li><a href="#" data-action="clear-context"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Clear AI Context</span></a></li>
          <li><a href="#" data-action="ip-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>IP Information</span></a></li>
          <li><a href="#" data-action="ip-qual"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg><span>IP Qualification</span></a></li>
          <li><a href="#" data-action="fake-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a7.5 7.5 0 0 1 13 0"/></svg><span>Generate Fake Info</span></a></li>
          <li><a href="#" data-action="temp-mail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg><span>Temp Mail</span></a></li>
          <li><a href="#" data-action="custom-web"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg><span>Custom Web</span></a></li>
          <li><a href="#" data-action="ai-humanizer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7v4a7 7 0 0 0 7 7 7 7 0 0 0 7-7V9a7 7 0 0 0-7-7z"/><path d="M9 9h6"/><path d="M9 13h6"/></svg><span>AI Humanizer</span></a></li>
          <li><a href="#" data-action="real-address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7"/><path d="M9 22V12h6v10"/><path d="M9 22H5a2 2 0 0 1-2-2v-7"/><path d="M21 13v7a2 2 0 0 1-2 2h-4"/></svg><span>Generate Real Address</span></a></li>
          <li><a href="#" data-action="company-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 3v18"/><path d="M8 3v18"/><path d="M3 8h18"/><path d="M3 16h18"/></svg><span>Generate Company Info</span></a></li>
          <li><a href="#" data-action="identity-panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/></svg><span>Show Identity Data</span></a></li>
          <li><a href="#" data-action="zebra-vps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="8" rx="2"/><rect x="2" y="12" width="20" height="8" rx="2"/><path d="M6 8h.01"/><path d="M6 16h.01"/></svg><span>Zepra VPS</span></a></li>
        </ul>
      </nav>
      <footer class="sidebar-footer">
        <p>Powered by Advanced AI · Secure & Encrypted</p>
        <div class="footer-dots"><span></span><span></span><span></span></div>
      </footer>
    `;

    const menuStyle = document.createElement('style');
    menuStyle.textContent = `
      #zepra-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        height: 100vh;
        width: 100%;
        max-width: 360px;
        background-color: rgba(0,0,0,0.8);
        backdrop-filter: blur(12px);
        border-left: 1px solid rgba(74,222,128,0.2);
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.4s ease-in-out;
        z-index: 2147483648;
        overflow-y: auto;
      }

      #zepra-sidebar.open { transform: translateX(0); }

      #zepra-sidebar .sidebar-bg{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.35}
      #zepra-sidebar .sidebar-bg video{width:100%;height:100%;object-fit:cover;filter:brightness(.85) contrast(1.05)}

      #zepra-sidebar .zepra-particles {
        position: absolute;
        inset: 0;
        overflow: hidden;
        z-index: 1;
      }

      /* Sidebar base should be translucent so bg video shows */
      #zepra-sidebar{ background: rgba(2,6,23,0.70); }
      /* Ensure content sits above bg and particles */
      #zepra-sidebar .sidebar-header,
      #zepra-sidebar .sidebar-nav{ position: relative; z-index: 2; }

      #zepra-sidebar .zepra-particles span {
        position: absolute;
        display: block;
        border-radius: 50%;
        background: rgba(74,222,128,0.4);
        animation: float 6s linear infinite;
      }

      @keyframes float {
        0% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
        100% { transform: translateY(0); }
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid rgba(74,222,128,0.2);
      }

      .sidebar-header .title-group { flex: 1; margin-left: 8px; }
      .sidebar-header h2 {
        margin: 0;
        font-size: 1.2rem;
        color: #4ade80;
        text-shadow: 0 0 8px #4ade80;
      }
      .sidebar-header p {
        margin: 2px 0 0;
        font-size: 0.75rem;
        color: #94a3b8;
      }
      .zap-icon {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        color: #4ade80;
        filter: drop-shadow(0 0 5px #4ade80);
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%,100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      .close-btn {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 20px;
        cursor: pointer;
        transition: color 0.2s;
      }
      .close-btn:hover { color: #fff; }

      .sidebar-nav ul {
        list-style: none;
        padding: 8px;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .sidebar-nav a {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 8px;
        color: #4ade80;
        text-decoration: none;
        transition: all 0.2s ease;
      }

      .sidebar-nav a svg { width: 20px; height: 20px; flex-shrink: 0; }

      .sidebar-nav a::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #4ade80;
        opacity: 0;
        box-shadow: 0 0 6px #4ade80;
        transition: opacity 0.2s;
      }

      .sidebar-nav a:hover {
        background-color: rgba(74,222,128,0.1);
        transform: translateX(5px);
      }
      .sidebar-nav a:hover::before { opacity: 1; }

      .sidebar-footer {
        margin-top: auto;
        padding: 12px;
        border-top: 1px solid rgba(74,222,128,0.2);
        display: flex;
        align-items: center;
        gap: 6px;
        color: #9ca3af;
        font-size: 0.75rem;
      }
      .footer-dots { display: flex; gap: 4px; margin-left: 4px; }
      .footer-dots span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
        animation: pulse 2s infinite;
      }
    `;

    document.head.appendChild(menuStyle);
    document.body.appendChild(menu);

    // spawn particles
    const particleBox = menu.querySelector('.zepra-particles');
    for (let i = 0; i < 25; i++) {
      const s = document.createElement('span');
      const size = Math.random() * 4 + 2;
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDuration = `${Math.random() * 5 + 5}s`;
      s.style.animationDelay = `${Math.random() * 5}s`;
      particleBox.appendChild(s);
    }

    requestAnimationFrame(() => menu.classList.add('open'));

    const closeMenu = () => {
      menu.classList.remove('open');
      setTimeout(() => { menu.remove(); menuStyle.remove(); }, 400);
    };

    menu.querySelector('.close-btn').addEventListener('click', closeMenu);

    menu.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-action]');
      if (!link) return;
      e.preventDefault();
      const action = link.dataset.action;
      handleBubbleAction(action);
      closeMenu();
    });

    setTimeout(() => {
      document.addEventListener('click', function outside(e) {
        if (!menu.contains(e.target) && !STATE.bubble.contains(e.target)) {
          closeMenu();
          document.removeEventListener('click', outside);
        }
      });
    }, 100);
  }

  async function handleBubbleAction(action) {
    switch (action) {
      case 'ask-by-photo':
        console.log('Ask by Photo clicked - starting function');
        try {
          openAskByPhotoModal();
          console.log('Ask by Photo modal function called successfully');
        } catch (error) {
          console.error('Error opening Ask by Photo modal:', error);
          showNotification('Error opening Ask by Photo modal: ' + error.message, 'error');
        }
        break;
      case 'ocr':
        startOCRCapture();
        break;
      case 'ocr-full':
        startFullPageOCR();
        break;
      case 'write-last':
        try {
          const { lastAnswer = '' } = await chrome.storage.local.get('lastAnswer');
          showLastAnswerModal(lastAnswer);
        } catch (e) {
          showNotification('No last answer available');
        }
        break;
      case 'clear-context':
        await chrome.storage.local.set({ contextQA: [] });
        showNotification('AI context cleared');
        break;
      case 'ip-info':
        try {
          const response = await chrome.runtime.sendMessage({ type: 'GET_PUBLIC_IP' });
          if (response.ok) {
            showFullIPModal(response.info);
          } else {
            showNotification('Failed to get IP information: ' + (response.error || 'Unknown error'));
          }
        } catch (e) {
          showNotification('Failed to get IP information: ' + e.message);
        }
        break;
      case 'ip-qual':
        runIPQualification();
        break;
      case 'fake-info':
        showFakeInfoModal();
        break;
      case 'temp-mail':
        window.open('https://yopmail.com/', '_blank');
        break;
      case 'custom-web':
        await chrome.runtime.sendMessage({ type: 'OPEN_CUSTOM_WEB' });
        break;
      case 'ai-humanizer':
        await openAIHumanizer();
        break;
      case 'real-address':
        showCleanRealAddressModal();
        break;
      case 'company-info':
        showCompanyInfoModal();
        break;
      case 'zebra-vps':
        showZebraVPSModal();
        break;
      case 'identity-panel':
        toggleIdentityPanel();
        break;
    }
  }

  function showZebraVPSModal(){
    const content = `
      <style>
        /* Shell overrides to match single modern modal like IP Information (no outer green frame) */
        #zepra-styled-modal .styled-modal-content.vps-shell{background:linear-gradient(180deg,rgba(15,23,42,.96),rgba(11,15,25,.94));border:none;border-radius:20px;box-shadow:0 25px 50px -12px rgba(15,23,42,.8)}
        #zepra-styled-modal .vps-shell .styled-modal-header{background:linear-gradient(90deg,rgba(148,163,184,.14),rgba(148,163,184,0));border-bottom:1px solid rgba(148,163,184,.18)}
        #zepra-styled-modal .vps-shell .styled-modal-header h3{display:flex;align-items:center;gap:.5rem}
        #zepra-styled-modal .vps-shell .styled-modal-close{color:#94a3b8;border-radius:10px}
        #zepra-styled-modal .vps-shell .styled-modal-close:hover{background:rgba(148,163,184,.16);color:#e2e8f0}
        .zvps-wrap{color:#e2e8f0}
        .zvps-metrics{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;margin-bottom:1rem}
        .zvps-chip{display:flex;align-items:center;gap:.4rem;background:rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.2);padding:.45rem .7rem;border-radius:.8rem;font-size:.8rem}
        .zvps-chip svg{width:16px;height:16px;color:#22d3ee;stroke:#22d3ee}

        .zvps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
        .zvps-card{position:relative;overflow:hidden;border-radius:16px;background:rgba(15,23,42,.65);border:1px solid rgba(148,163,184,.18);
          padding:18px;cursor:pointer;min-height:160px;display:flex;flex-direction:column;justify-content:space-between;
          transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease}
        .zvps-card::before{content:"";position:absolute;inset:-2px;border-radius:18px;background:linear-gradient(135deg,rgba(34,197,94,.35),rgba(59,130,246,.35),rgba(168,85,247,.35));
          opacity:.25;filter:blur(18px);z-index:0;transition:opacity .3s ease}
        .zvps-card:hover{transform:translateY(-4px);box-shadow:0 15px 35px rgba(0,0,0,.45);border-color:rgba(34,197,94,.45)}
        .zvps-card:hover::before{opacity:.55}
        .zvps-top{display:flex;align-items:center;gap:.6rem;z-index:1}
        .zvps-ic{width:38px;height:38px;border-radius:10px;background:rgba(148,163,184,.14);display:flex;align-items:center;justify-content:center}
        .zvps-ic svg{width:20px;height:20px}
        .zvps-title{font-weight:700}
        .zvps-sub{font-size:.8rem;color:#94a3b8}
        .zvps-badge{align-self:flex-start;margin-top:.6rem;padding:.25rem .55rem;border-radius:999px;background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.35);font-size:.75rem;z-index:1}

        .zvps-footer{margin-top:14px;text-align:center;color:#94a3b8;font-size:.85rem}

        /* entrance animation */
        .zvps-card{opacity:0;transform:translateY(8px);animation:cardIn .4s ease forwards}
        .zvps-card:nth-child(1){animation-delay:.05s}
        .zvps-card:nth-child(2){animation-delay:.15s}
        .zvps-card:nth-child(3){animation-delay:.25s}
        @keyframes cardIn{to{opacity:1;transform:translateY(0)}}
      </style>
      <div class="zvps-wrap">
        <div class="zvps-metrics">
          <div class="zvps-chip">${icon('uptime')}<span>Uptime <strong>99.9%</strong></span></div>
          <div class="zvps-chip">${icon('lock')}<span>Secure <strong>SSL</strong></span></div>
          <div class="zvps-chip">${icon('speed')}<span>Speed <strong>Ultra</strong></span></div>
        </div>
        <div class="zvps-grid">
          <div class="zvps-card" data-url="https://app.apponfly.com/trial" data-mode="desktop">
            <div class="zvps-top">
              <div class="zvps-ic">${icon('desktop')}</div>
              <div>
                <div class="zvps-title">Windows Desktop</div>
                <div class="zvps-sub">Access a remote Windows OS</div>
              </div>
            </div>
            <div class="zvps-badge">20 Minute Session</div>
          </div>
          <div class="zvps-card" data-mode="android6">
            <div class="zvps-top">
              <div class="zvps-ic">${icon('android')}</div>
              <div>
                <div class="zvps-title">Android VM</div>
                <div class="zvps-sub">Open a virtual Android env</div>
              </div>
            </div>
            <div class="zvps-badge" style="background:rgba(59,130,246,.12);color:#60a5fa;border-color:rgba(59,130,246,.4)">6 Hour Session</div>
          </div>
          <div class="zvps-card" data-url="https://www.myandroid.org/run/start.php?apkid=com.chengwaikwong.multigame&app=com-chengwaikwong-multigame" data-mode="pixel">
            <div class="zvps-top">
              <div class="zvps-ic">${icon('pixel')}</div>
              <div>
                <div class="zvps-title">Android Google Pixel</div>
                <div class="zvps-sub">Cloud-based Pixel instance</div>
              </div>
            </div>
            <div class="zvps-badge" style="background:rgba(168,85,247,.12);color:#a78bfa;border-color:rgba(168,85,247,.4)">Unlimited Session</div>
          </div>
        </div>
        <div class="zvps-footer">Choose your preferred virtual environment above</div>
      </div>`;

    // inline SVG icons
    function icon(name){
      const base = {
        uptime: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg>',
        lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
        speed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 15a8 8 0 1 0-16.8 0"/><path d="M12 12v6"/><path d="m15 10-3 2"/></svg>',
        desktop: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        android: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="8" width="12" height="12" rx="2"/><line x1="8" y1="8" x2="5" y2="4"/><line x1="16" y1="8" x2="19" y2="4"/></svg>',
        pixel: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg>'
      };
      return base[name] || '';
    }

    const modal = createStyledModal(`${icon('speed')} Zepra VPS`, content);
    const shell = modal.querySelector('.styled-modal-content');
    shell.classList.add('vps-shell');
    modal.querySelectorAll('.zvps-card').forEach(card=>{
      card.addEventListener('click', async ()=>{
        const mode = card.dataset.mode;
        if(mode==='android6'){
          await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', initialUrl:'https://cloud.vmoscloud.com/', urls:['https://www.fakemail.net/','https://cloud.vmoscloud.com/'] });
        }else{
          const url = card.dataset.url;
          await chrome.runtime.sendMessage({ type:'OPEN_CUSTOM_WEB', initialUrl:url, urls:[url] });
        }
        modal.remove();
      });
    });
  }

  async function openAIHumanizer(){
    await chrome.runtime.sendMessage({ type:'OPEN_OR_FOCUS_CUSTOM_WEB', url:'https://bypassai.writecream.com/' });
  }

  // Ask by Photo Modal Function - following Zepra design specifications
  async function openAskByPhotoModal() {
    console.log('openAskByPhotoModal function started');
    
    try {
      // Prevent multiple instances (project specification)
      const existingModal = document.getElementById('zepra-ask-photo-modal');
      if (existingModal) {
        console.log('Modal already exists, removing existing instance');
        existingModal.remove();
      }
      
      console.log('Creating modal element...');
      // Create Ask by Photo modal following za-modal structure
      const modal = document.createElement('div');
      modal.id = 'zepra-ask-photo-modal';
      modal.innerHTML = `
        <div class="za-modal apbp-modal">
          <header class="za-header">
            <div class="apbp-title">
              <svg class="apbp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <circle cx="12" cy="12" r="3"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <path d="M12 17h.01"/>
              </svg>
              <h2>Ask by Photo</h2>
            </div>
            <button class="modal-close">×</button>
          </header>
          <main class="za-body">
            <div class="apbp-chat-container">
              <div class="apbp-messages" id="apbpMessages"></div>
              <div class="apbp-input-section">
                <div class="apbp-photo-controls">
                  <input type="file" id="apbpFileInput" accept="image/*" style="display: none;" />
                  <button id="apbpUploadBtn" class="apbp-control-btn" title="Upload Image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7,10 12,15 17,10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Upload
                  </button>
                  <button id="apbpFullScreenBtn" class="apbp-control-btn" title="Full Page Screenshot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                    </svg>
                    Full Page
                  </button>
                  <button id="apbpPartialScreenBtn" class="apbp-control-btn" title="Partial Screenshot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="5" width="18" height="14" rx="2"/>
                      <path d="M3 10h18"/>
                    </svg>
                    Partial
                  </button>
                </div>
                <div class="apbp-input-container">
                  <textarea id="apbpTextInput" placeholder="Ask a question about the image..." rows="2"></textarea>
                  <button id="apbpSendBtn" class="apbp-send-btn" disabled>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22,2 15,22 11,13 2,9 22,2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      `;

      console.log('Setting modal styles...');
      // Centered positioning following project specifications
      modal.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background-color: rgba(0, 0, 0, 0.7) !important;
        backdrop-filter: blur(4px) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: fadeIn 0.3s ease-out !important;
      `;

      console.log('Adding CSS styles...');
      // Add comprehensive CSS styling following Zepra theme
      const style = document.createElement('style');
      style.id = 'apbp-modal-styles';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .apbp-modal {
          background: linear-gradient(145deg, #1a1d23 0%, #0a0d14 100%);
          border-radius: 20px;
          width: min(800px, 92vw);
          height: min(700px, 90vh);
          overflow: hidden;
          border: 1px solid transparent;
          background-clip: padding-box;
          box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1);
          animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          display: flex;
          flex-direction: column;
        }
        
        @keyframes modalSlideIn {
          from { opacity: 0; transform: scale(0.9) translateY(30px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        
        .apbp-modal::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(45deg, #06b6d4, #3b82f6, #8b5cf6, #06b6d4);
          background-size: 300% 300%;
          animation: rainbowBorder 3s ease-in-out infinite;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: destination-out;
        }
        
        @keyframes rainbowBorder {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        
        .apbp-modal .za-header {
          position: relative;
          z-index: 1;
          background: rgba(0,0,0,0.4);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid rgba(59, 130, 246, 0.2);
          padding: 18px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .apbp-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .apbp-icon {
          width: 24px;
          height: 24px;
          color: #3b82f6;
          filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.4));
        }
        
        .apbp-title h2 {
          margin: 0;
          color: #3b82f6;
          font-size: 22px;
          font-weight: 700;
          text-shadow: 0 0 20px rgba(59, 130, 246, 0.4);
          letter-spacing: 0.5px;
        }
        
        .apbp-modal .modal-close {
          background: none;
          border: none;
          color: #9ca3af;
          font-size: 28px;
          cursor: pointer;
          padding: 0;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .apbp-modal .modal-close:hover {
          background: rgba(59, 130, 246, 0.1);
          color: #3b82f6;
          transform: scale(1.1);
        }
        
        .apbp-modal .za-body {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        
        .apbp-chat-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px;
          gap: 20px;
        }
        
        .apbp-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          background: rgba(15, 23, 42, 0.3);
          border-radius: 16px;
          border: 1px solid rgba(59, 130, 246, 0.1);
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 300px;
        }
        
        .apbp-message {
          display: flex;
          gap: 12px;
          animation: messageSlideIn 0.3s ease-out;
        }
        
        @keyframes messageSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .apbp-message.user {
          flex-direction: row-reverse;
        }
        
        .apbp-message-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          flex-shrink: 0;
        }
        
        .apbp-message.user .apbp-message-avatar {
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          color: white;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        
        .apbp-message.ai .apbp-message-avatar {
          background: linear-gradient(135deg, #06b6d4, #0891b2);
          color: white;
          box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
        }
        
        .apbp-message-content {
          flex: 1;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 16px;
          padding: 14px 18px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          backdrop-filter: blur(8px);
        }
        
        .apbp-message.user .apbp-message-content {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.2);
          margin-left: 40px;
        }
        
        .apbp-message.ai .apbp-message-content {
          background: rgba(6, 182, 212, 0.1);
          border-color: rgba(6, 182, 212, 0.2);
          margin-right: 40px;
        }
        
        .apbp-message-text {
          color: #e2e8f0;
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }
        
        .apbp-input-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .apbp-photo-controls {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        
        .apbp-control-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 8px;
          color: #3b82f6;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .apbp-control-btn:hover {
          background: rgba(59, 130, 246, 0.2);
          border-color: rgba(59, 130, 246, 0.5);
          transform: translateY(-1px);
        }
        
        .apbp-control-btn svg {
          width: 16px;
          height: 16px;
        }
        
        .apbp-input-container {
          display: flex;
          gap: 12px;
          align-items: flex-end;
        }
        
        .apbp-input-container textarea {
          flex: 1;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 12px;
          color: #e2e8f0;
          padding: 12px 16px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: all 0.3s;
          resize: none;
          min-height: 44px;
          max-height: 120px;
        }
        
        .apbp-input-container textarea:focus {
          border-color: rgba(59, 130, 246, 0.6);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .apbp-send-btn {
          width: 44px;
          height: 44px;
          background: linear-gradient(135deg, #3b82f6, #1d4ed8);
          border: none;
          border-radius: 50%;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        
        .apbp-send-btn:hover:not(:disabled) {
          transform: scale(1.05);
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
        }
        
        .apbp-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        
        .apbp-send-btn svg {
          width: 20px;
          height: 20px;
        }
      `;

      console.log('Appending styles and modal to document...');
      document.head.appendChild(style);
      document.body.appendChild(modal);
      
      console.log('Modal added to DOM, setting up event handlers...');
      showNotification('Ask by Photo modal opened successfully!', 'success');

      // State for current conversation
      let currentImage = null;

      // DOM elements
      const messagesContainer = modal.querySelector('#apbpMessages');
      const textInput = modal.querySelector('#apbpTextInput');
      const sendBtn = modal.querySelector('#apbpSendBtn');
      const fileInput = modal.querySelector('#apbpFileInput');
      const uploadBtn = modal.querySelector('#apbpUploadBtn');
      const fullScreenBtn = modal.querySelector('#apbpFullScreenBtn');
      const partialScreenBtn = modal.querySelector('#apbpPartialScreenBtn');
      const closeBtn = modal.querySelector('.modal-close');

      console.log('Setting up close functionality...');
      // Close modal functionality
      const closeModal = () => {
        console.log('Closing modal...');
        modal.remove();
        style.remove();
      };

      closeBtn.addEventListener('click', closeModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });

      console.log('Adding welcome message...');
      // Add welcome message function
      function addMessage(type, text, imageData = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `apbp-message ${type}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'apbp-message-avatar';
        avatar.textContent = type === 'user' ? 'U' : 'AI';
        
        const content = document.createElement('div');
        content.className = 'apbp-message-content';
        
        if (imageData && type === 'user') {
          const img = document.createElement('img');
          img.src = imageData;
          img.style.cssText = 'max-width: 300px; border-radius: 12px; margin-bottom: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);';
          content.appendChild(img);
        }
        
        const textElement = document.createElement('p');
        textElement.className = 'apbp-message-text';
        textElement.textContent = text;
        content.appendChild(textElement);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }

      addMessage('ai', 'Hello! I\'m ready to help you analyze images. Upload an image, take a screenshot, or capture a specific area, then ask me anything about what you see!');

      console.log('Setting up functionality...');
      // File upload functionality
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
          showNotification('Please select an image file', 'error');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
          currentImage = e.target.result;
          addMessage('user', 'Image uploaded successfully! What would you like to know about this image?', currentImage);
          updateSendButton();
          showNotification('Image uploaded! You can now ask questions about it.', 'success');
        };
        reader.readAsDataURL(file);
      });

      // Screenshot buttons (placeholder functionality)
      fullScreenBtn.addEventListener('click', () => {
        showNotification('Full page screenshot feature coming soon!', 'info');
      });

      partialScreenBtn.addEventListener('click', () => {
        showNotification('Partial screenshot feature coming soon!', 'info');
      });

      // Send button state management
      function updateSendButton() {
        const hasText = textInput.value.trim().length > 0;
        const hasImage = currentImage !== null;
        sendBtn.disabled = !(hasText && hasImage);
      }

      textInput.addEventListener('input', updateSendButton);
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });
      
      sendBtn.addEventListener('click', handleSendMessage);

      function handleSendMessage() {
        const question = textInput.value.trim();
        if (!question || !currentImage) return;
        
        addMessage('user', question);
        textInput.value = '';
        updateSendButton();
        
        // Demo AI response
        setTimeout(() => {
          addMessage('ai', 'Thank you for your question! The AI image analysis feature will be fully connected in the next update. This demonstrates the chat interface working correctly.');
        }, 1000);
      }

      // Auto-resize textarea
      textInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      // Update send button state initially
      updateSendButton();

      // Focus on text input
      setTimeout(() => textInput.focus(), 100);
      console.log('Ask by Photo modal setup complete!');
      
    } catch (error) {
      console.error('Error in openAskByPhotoModal:', error);
      showNotification('Error creating Ask by Photo modal: ' + error.message, 'error');
    }
  }

  async function runIPQualification(){
    // Prevent multiple instances
    if (document.getElementById('zepra-styled-modal')) {
      return; // Modal already exists, don't create another
    }
    
    // Show modal with loading indicator immediately
    const loadingModal = showIPQLoadingModal();
    
    try{
      // 1) Try to get cached data first (non-blocking)
      let cachedData = null;
      try {
        const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
        cachedData = lastIPQ;
      } catch(_){}
      
      // 2) Fetch fresh data
      const resp = await chrome.runtime.sendMessage({ type: 'GET_IP_QUALIFICATION' });
      const data = resp?.ok ? resp.data : cachedData;
      
      // 3) Save fresh data if successful
      if(resp?.ok){
        await chrome.storage.local.set({ lastIPQ: resp.data });
      }
      
      // 4) Remove loading modal
      if (loadingModal && loadingModal.parentNode) {
        loadingModal.remove();
      }
      
      // 5) Show final modal
      showCleanIPQualificationModal(data);
      
    }catch(e){
      // Remove loading modal on error
      if (loadingModal && loadingModal.parentNode) {
        loadingModal.remove();
      }
      
      // Try to show cached data on error
      try{
        const { lastIPQ } = await chrome.storage.local.get('lastIPQ');
        showCleanIPQualificationModal(lastIPQ || null);
      }catch(err){
        _safeCreateStyledModal('IP Qualification', `<div style="padding:20px;text-align:center;color:#e2e8f0;">Unable to retrieve IP qualification data.<br/>${(err&&err.message)||'Network error'}</div>`);
      }
    }
  }

  // Lightweight loader modal that appears instantly while fetching IP data
  function showIPQLoadingModal(){
    const html = `
      <style>
        .ipq-load-wrap{display:flex;flex-direction:column;align-items:center;gap:.75rem;min-width:240px}
        .ipq-spinner{width:54px;height:54px;border-radius:50%;background:
          conic-gradient(from 0deg, rgba(34,197,94,.9), rgba(34,197,94,.2) 60%, rgba(34,197,94,.05));
          -webkit-mask:radial-gradient(circle 22px,#0000 96%,#000 0);animation:spin 1s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .ipq-skel{width:100%;height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(148,163,184,.15),rgba(148,163,184,.3),rgba(148,163,184,.15));
          background-size:200% 100%;animation:shimmer 1.2s ease-in-out infinite}
        .ipq-skel.small{height:8px;opacity:.85}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      </style>
      <div class="ipq-load-wrap">
        <div class="ipq-spinner"></div>
        <div style="color:#e2e8f0;font-weight:600">Qualifying your IP…</div>
        <div class="ipq-skel" style="margin-top:4px"></div>
        <div class="ipq-skel small" style="width:80%"></div>
      </div>`;
    return _safeCreateStyledModal('IP Qualification', html);
  }

  function showIPQualificationModal(data){
    if(!data){
      // Remove existing modal
      const existing = document.getElementById('zepra-ipq-modal');
      if (existing) existing.remove();

      // Create simple error modal
      const errorModal = document.createElement('div');
      errorModal.id = 'zepra-ipq-modal';
      errorModal.innerHTML = `
        <div class="ipq-modal-overlay">
          <div class="ipq-modal-container">
            <div class="ipq-modal-header">
              <h3>IP Qualification</h3>
              <button class="ipq-modal-close">&times;</button>
            </div>
            <div class="ipq-modal-body">
              <div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>
            </div>
          </div>
        </div>
      `;
      
      const errorStyle = document.createElement('style');
      errorStyle.textContent = `
        #zepra-ipq-modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease-out;
        }
        
        .ipq-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(8px);
        }
        
        .ipq-modal-container {
          position: relative;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 2px solid #f43f5e;
          border-radius: 20px;
          max-width: 400px;
          width: 90%;
          overflow: hidden;
          box-shadow: 0 0 50px rgba(244, 63, 94, 0.3);
        }
        
        .ipq-modal-header {
          background: rgba(0, 0, 0, 0.4);
          padding: 20px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(244, 63, 94, 0.2);
        }
        
        .ipq-modal-header h3 {
          margin: 0;
          color: #f43f5e;
          font-size: 18px;
          font-weight: bold;
        }
        
        .ipq-modal-close {
          background: none;
          border: none;
          color: #e2e8f0;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .ipq-modal-close:hover {
          background: rgba(244, 63, 94, 0.2);
          color: #f43f5e;
        }
        
        .ipq-modal-body {
          padding: 24px;
        }
      `;
      
      document.head.appendChild(errorStyle);
      document.body.appendChild(errorModal);
      
      errorModal.querySelector('.ipq-modal-close').addEventListener('click', () => {
        errorModal.remove();
        errorStyle.remove();
      });
      
      errorModal.querySelector('.ipq-modal-overlay').addEventListener('click', (e) => {
        if (e.target === errorModal.querySelector('.ipq-modal-overlay')) {
          errorModal.remove();
          errorStyle.remove();
        }
      });
      
      return;
    }

    const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
    const ip = data.ip || data.query || '';
    const city = data.city || data.region_name || data.region || '';
    const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
    const isp = data.isp || data.org || '';
    const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const detection = data?.blacklists?.detection || 'none';
    const proxy = !!data?.security?.proxy;
    const vpn = !!data?.security?.vpn;
    const tor = !!data?.security?.tor;

    // Enhanced status logic with three states
    const riskPass = risk < 30;
    const riskWarning = risk >= 30 && risk <= 50;
    const riskFail = risk > 50;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;

    // Determine overall status
    let statusState = 'qualified'; // qualified, warning, not-qualified
    let statusText = 'QUALIFIED';
    let statusMessage = 'Your IP is clean and ready to use.';
    let statusClass = 'status-qualified';

    if (riskFail || !blacklistPass || !anonymityPass) {
      statusState = 'not-qualified';
      statusText = 'NOT QUALIFIED';
      statusClass = 'status-not-qualified';
      
      if (riskFail) {
        statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
      } else if (!blacklistPass) {
        statusMessage = 'Your IP is on a blacklist. You must change your connection.';
      } else if (!anonymityPass) {
        statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
      }
    } else if (riskWarning) {
      statusState = 'warning';
      statusText = 'WARNING';
      statusClass = 'status-warning';
      statusMessage = 'Your IP is moderately risky. Proceed with caution.';
    }

    // Enhanced particles with different counts based on status
    const particleCount = statusState === 'qualified' ? 20 : statusState === 'warning' ? 15 : 10;
    const particles = Array.from({ length: particleCount })
      .map((_, i) => `<span class="particle" style="--i:${i};"></span>`)
      .join('');

    // SVG Icons
    const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    
    // Status-specific icons
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"/></svg>`;
    const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="warning-icon"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
    const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="x-icon"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

    // Build checklist with enhanced logic
    const checks = [
      { 
        pass: riskPass, 
        warning: riskWarning,
        fail: riskFail,
        label: 'Risk Score Assessment', 
        icon: shieldSVG 
      },
      { 
        pass: blacklistPass, 
        warning: false,
        fail: !blacklistPass,
        label: 'Blacklist Verification', 
        icon: eyeSVG 
      },
      { 
        pass: anonymityPass, 
        warning: false,
        fail: !anonymityPass,
        label: 'Anonymity Detection', 
        icon: globeSVG 
      },
    ];

    const checklistHTML = checks
      .map((c, i) => {
        let resultIcon = checkSVG;
        let resultClass = 'check-result-pass';
        
        if (c.fail) {
          resultIcon = xSVG;
          resultClass = 'check-result-fail';
        } else if (c.warning) {
          resultIcon = warningSVG;
          resultClass = 'check-result-warning';
        }
        
        return `
        <div class="ipq-check-card ${resultClass}" style="--i:${i};">
          <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
          <div class="ipq-check-result">${resultIcon}</div>
        </div>`;
      })
      .join('');

    // Header icons based on status
    const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
    const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
    const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
    
    let headerIcon = shieldCheckSVG;
    if (statusState === 'warning') headerIcon = shieldWarningSVG;
    else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

    const html = `
      <style>
        /* Enhanced status color system */
        .styled-modal-content.status-qualified { --ipq-color: #4ade80; --ipq-bg: rgba(74, 222, 128, 0.1); }
        .styled-modal-content.status-warning { --ipq-color: #fbbf24; --ipq-bg: rgba(251, 191, 36, 0.1); }
        .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; --ipq-bg: rgba(244, 63, 94, 0.1); }
        
        .styled-modal-content .styled-modal-header h3 { display: flex; align-items: center; gap: 8px; }
        .styled-modal-content .styled-modal-header svg { width: 24px; height: 24px; }
        .styled-modal-content .styled-modal-header h3,
        .styled-modal-content .styled-modal-header svg {
          color: var(--ipq-color);
          stroke: var(--ipq-color);
          filter: drop-shadow(0 0 8px var(--ipq-color));
          animation: headerGlow 2s ease-in-out infinite alternate;
        }

        @keyframes headerGlow {
          from { filter: drop-shadow(0 0 8px var(--ipq-color)); }
          to { filter: drop-shadow(0 0 16px var(--ipq-color)) drop-shadow(0 0 24px var(--ipq-color)); }
        }

        .ipq-modal {
          position: relative;
          overflow: hidden;
          max-width: 420px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid var(--ipq-color);
          border-radius: 24px;
          box-shadow: 
            0 0 50px var(--ipq-bg),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* Animated grid background */
        .ipq-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(to right, var(--ipq-color) 1px, transparent 1px),
            linear-gradient(var(--ipq-color) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.08;
          animation: moveGrid 25s linear infinite;
          pointer-events: none;
        }

        @keyframes moveGrid {
          from { background-position: 0 0, 0 0; }
          to { background-position: 30px 30px, 30px 30px; }
        }

        .ipq-main {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 24px;
        }

        /* Enhanced circle design */
        .ipq-circle {
          position: relative;
          width: 220px;
          height: 220px;
          animation: circleEntrance 1s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes circleEntrance {
          from { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) rotate(0deg); 
          }
        }

        .ipq-circle .ring {
          position: absolute;
          border-radius: 50%;
          inset: 0;
        }

        /* Outer rotating ring */
        .ipq-circle .ring.outer {
          border: 4px dashed var(--ipq-color);
          animation: spin 15s linear infinite;
          filter: drop-shadow(0 0 10px var(--ipq-color));
        }

        /* Inner solid ring */
        .ipq-circle .ring.inner {
          inset: 24px;
          border: 3px solid var(--ipq-color);
          opacity: 0.6;
          animation: spinReverse 10s linear infinite;
        }

        /* Glow ring */
        .ipq-circle .ring.glow {
          inset: -8px;
          border: 1px solid var(--ipq-color);
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px var(--ipq-color);
          opacity: 0.3;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.05); 
          }
        }

        /* Radar sweep effect */
        .ipq-circle .radar {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, var(--ipq-color) 0deg, transparent 90deg);
          mix-blend-mode: screen;
          animation: spin 8s linear infinite;
          opacity: 0.3;
        }

        /* Center content */
        .ipq-circle .center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 2;
        }

        .ipq-status {
          font-size: 20px;
          font-weight: 800;
          color: var(--ipq-color);
          text-shadow: 0 0 15px var(--ipq-color);
          margin-bottom: 8px;
          animation: statusPulse 2s ease-in-out infinite;
          letter-spacing: 1px;
        }

        @keyframes statusPulse {
          0%, 100% { 
            text-shadow: 0 0 15px var(--ipq-color); 
          }
          50% { 
            text-shadow: 
              0 0 25px var(--ipq-color), 
              0 0 35px var(--ipq-color);
          }
        }

        .ipq-risk {
          font-size: 48px;
          font-weight: 900;
          color: var(--ipq-color);
          text-shadow: 0 0 20px var(--ipq-color);
          font-family: 'Courier New', monospace;
        }

        /* Enhanced particles */
        .particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: var(--ipq-color);
          border-radius: 50%;
          animation: 
            orbit 8s linear infinite,
            particleGlow 2s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -0.4s);
          box-shadow: 0 0 8px var(--ipq-color);
        }

        @keyframes particleGlow {
          from { 
            box-shadow: 0 0 8px var(--ipq-color);
            opacity: 0.8;
          }
          to { 
            box-shadow: 0 0 16px var(--ipq-color);
            opacity: 1;
          }
        }

        @keyframes orbit {
          from { 
            transform: rotate(0deg) translateX(110px) rotate(0deg); 
          }
          to { 
            transform: rotate(360deg) translateX(110px) rotate(-360deg); 
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes spinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        /* Enhanced checklist */
        .ipq-checklist {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ipq-check-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--ipq-bg);
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeUp 0.6s ease forwards;
          opacity: 0;
          animation-delay: calc(var(--i) * 0.15s + 0.5s);
          backdrop-filter: blur(10px);
        }

        .ipq-check-card:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(8px) scale(1.02);
          border-color: var(--ipq-color);
          box-shadow: 0 8px 25px var(--ipq-bg);
        }

        .ipq-check-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ipq-check-left svg {
          width: 20px;
          height: 20px;
          stroke: #9ca3af;
          filter: drop-shadow(0 0 4px rgba(156, 163, 175, 0.5));
        }

        .ipq-check-left span {
          font-weight: 600;
          color: #e2e8f0;
        }

        .ipq-check-result svg {
          width: 24px;
          height: 24px;
          transition: all 0.3s ease;
        }

        /* Status-specific result icons */
        .check-result-pass .check-icon {
          stroke: #4ade80;
          filter: drop-shadow(0 0 8px #4ade80);
          animation: checkBounce 0.6s ease;
        }

        .check-result-warning .warning-icon {
          stroke: #fbbf24;
          fill: #fbbf24;
          filter: drop-shadow(0 0 8px #fbbf24);
          animation: warningPulse 1.5s ease-in-out infinite;
        }

        .check-result-fail .x-icon {
          stroke: #f43f5e;
          filter: drop-shadow(0 0 8px #f43f5e);
          animation: xShake 0.6s ease;
        }

        @keyframes checkBounce {
          0%, 20%, 53%, 80%, 100% { transform: scale(1); }
          40%, 43% { transform: scale(1.3); }
          70% { transform: scale(1.1); }
        }

        @keyframes warningPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes xShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        @keyframes fadeUp {
          from { 
            opacity: 0; 
            transform: translateY(20px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        /* Footer enhancements */
        .ipq-footer {
          width: 100%;
          padding: 0 24px 24px;
        }

        .ipq-summary {
          font-weight: 700;
          color: var(--ipq-color);
          text-align: center;
          margin-top: 16px;
          font-size: 16px;
          text-shadow: 0 0 10px var(--ipq-color);
          animation: summaryFade 0.8s ease 1.2s both;
        }

        @keyframes summaryFade {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-cards {
          display: flex;
          gap: 16px;
          margin-top: 20px;
        }

        .ipq-info-card {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          animation: cardSlideUp 0.6s ease both;
          animation-delay: 1.4s;
        }

        .ipq-info-card:hover {
          box-shadow: 0 8px 25px rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
          border-color: var(--ipq-color);
        }

        @keyframes cardSlideUp {
          from { 
            opacity: 0; 
            transform: translateY(15px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ipq-info-value {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin-top: 4px;
        }

        /* Responsive adjustments */
        @media (max-width: 480px) {
          .ipq-modal { max-width: 95vw; }
          .ipq-circle { width: 180px; height: 180px; }
          .ipq-status { font-size: 16px; }
          .ipq-risk { font-size: 36px; }
          .ipq-main { padding: 24px 16px; }
        }
      </style>
      <div class="ipq-modal">
        <div class="ipq-grid"></div>
        <main class="ipq-main">
          <div class="ipq-circle">
            <div class="ring outer"></div>
            <div class="ring inner"></div>
            <div class="ring glow"></div>
            <div class="radar"></div>
            <div class="center">
              <div class="ipq-status">${statusText}</div>
              <div class="ipq-risk">${risk}</div>
            </div>
            ${particles}
          </div>
          <div class="ipq-checklist">${checklistHTML}</div>
        </main>
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-cards">
            <div class="ipq-info-card">
              <div class="ipq-info-label">IP Address</div>
              <div class="ipq-info-value">${ip}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">Location</div>
              <div class="ipq-info-value">${flag} ${city ? city+', ' : ''}${cc}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">ISP</div>
              <div class="ipq-info-value">${isp || 'Unknown'}</div>
            </div>
          </div>
        </footer>
      </div>`;

    const modal = createStyledModal(`${headerIcon} IP Qualification`, html);
    modal.querySelector('.styled-modal-content').classList.add(statusClass);
  }

  

    // Clean IP Qualification Modal - New Implementation (old duplicate removed)
  function showCleanIPQualificationModal_OLD(data){
    if(!data){
      createStyledModal(
        'IP Qualification',
        `<div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>`
      );
      return;
    }

    const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
    const ip = data.ip || data.query || '';
    const city = data.city || data.region_name || data.region || '';
    const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
    const isp = data.isp || data.org || '';
    const flag = cc ? cc.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const detection = data?.blacklists?.detection || 'none';
    const proxy = !!data?.security?.proxy;
    const vpn = !!data?.security?.vpn;
    const tor = !!data?.security?.tor;

    const riskPass = risk < 30;
    const riskWarning = risk >= 30 && risk <= 50;
    const riskFail = risk > 50;
    const blacklistPass = detection === 'none';
    const anonymityPass = !proxy && !vpn && !tor;

    let statusState = 'qualified';
    if (riskFail || !blacklistPass || !anonymityPass) statusState = 'not-qualified';
    else if (riskWarning) statusState = 'warning';

    const statusConfig = {
      'qualified': { color: '#22c55e', label: 'QUALIFIED', footer: 'Your IP is secure and verified' },
      'warning': { color: '#fbbf24', label: 'WARNING', footer: 'Your IP has moderate risk' },
      'not-qualified': { color: '#ef4444', label: 'NOT QUALIFIED', footer: 'Your IP is not recommended' }
    }[statusState];

    const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const riskState = riskFail ? 'fail' : (riskWarning ? 'warn' : 'pass');
    const checks = [
      { key: 'risk', label: 'Risk Score Assessment', detail: `${risk}/100`, state: riskState, icon: shieldSVG },
      { key: 'blacklist', label: 'Blocklist Verification', detail: blacklistPass ? 'No matches' : 'Listed', state: blacklistPass ? 'pass' : 'fail', icon: eyeSVG },
      { key: 'anonymity', label: 'Anonymity Detection', detail: anonymityPass ? 'No proxy/VPN/Tor' : 'Detected', state: anonymityPass ? 'pass' : 'fail', icon: globeSVG }
    ];

    const checklistHTML = checks
      .map((c, i) => {
        let resultIcon = checkSVG;
        let resultClass = 'check-result-pass';
        
        if (c.fail) {
          resultIcon = xSVG;
          resultClass = 'check-result-fail';
        } else if (c.warning) {
          resultIcon = warningSVG;
          resultClass = 'check-result-warning';
        }
        
        return `
        <div class="ipq-check-card ${resultClass}" style="--i:${i};">
          <div class="ipq-check-left">${c.icon}<span>${c.label}</span></div>
          <div class="ipq-check-result">${resultIcon}</div>
        </div>`;
      })
      .join('');

    // Header icons based on status
    const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
    const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
    const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;
    
    let headerIcon = shieldCheckSVG;
    if (statusState === 'warning') headerIcon = shieldWarningSVG;
    else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

    const html = `
      <style>
        /* Enhanced status color system */
        .styled-modal-content.status-qualified { --ipq-color: #4ade80; --ipq-bg: rgba(74, 222, 128, 0.1); }
        .styled-modal-content.status-warning { --ipq-color: #fbbf24; --ipq-bg: rgba(251, 191, 36, 0.1); }
        .styled-modal-content.status-not-qualified { --ipq-color: #f43f5e; --ipq-bg: rgba(244, 63, 94, 0.1); }
        
        .styled-modal-content .styled-modal-header h3 { display: flex; align-items: center; gap: 8px; }
        .styled-modal-content .styled-modal-header svg { width: 24px; height: 24px; }
        .styled-modal-content .styled-modal-header h3,
        .styled-modal-content .styled-modal-header svg {
          color: var(--ipq-color);
          stroke: var(--ipq-color);
          filter: drop-shadow(0 0 8px var(--ipq-color));
          animation: headerGlow 2s ease-in-out infinite alternate;
        }

        @keyframes headerGlow {
          from { filter: drop-shadow(0 0 8px var(--ipq-color)); }
          to { filter: drop-shadow(0 0 16px var(--ipq-color)) drop-shadow(0 0 24px var(--ipq-color)); }
        }

        .ipq-modal {
          position: relative;
          overflow: hidden;
          max-width: 420px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
          backdrop-filter: blur(20px);
          border: 2px solid var(--ipq-color);
          border-radius: 24px;
          box-shadow: 
            0 0 50px var(--ipq-bg),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        /* Animated grid background */
        .ipq-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(to right, var(--ipq-color) 1px, transparent 1px),
            linear-gradient(var(--ipq-color) 1px, transparent 1px);
          background-size: 30px 30px;
          opacity: 0.08;
          animation: moveGrid 25s linear infinite;
          pointer-events: none;
        }

        @keyframes moveGrid {
          from { background-position: 0 0, 0 0; }
          to { background-position: 30px 30px, 30px 30px; }
        }

        .ipq-main {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
          padding: 32px 24px;
        }

        /* Enhanced circle design */
        .ipq-circle {
          position: relative;
          width: 220px;
          height: 220px;
          animation: circleEntrance 1s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes circleEntrance {
          from { 
            opacity: 0; 
            transform: scale(0.5) rotate(-180deg); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) rotate(0deg); 
          }
        }

        .ipq-circle .ring {
          position: absolute;
          border-radius: 50%;
          inset: 0;
        }

        /* Outer rotating ring */
        .ipq-circle .ring.outer {
          border: 4px dashed var(--ipq-color);
          animation: spin 15s linear infinite;
          filter: drop-shadow(0 0 10px var(--ipq-color));
        }

        /* Inner solid ring */
        .ipq-circle .ring.inner {
          inset: 24px;
          border: 3px solid var(--ipq-color);
          opacity: 0.6;
          animation: spinReverse 10s linear infinite;
        }

        /* Glow ring */
        .ipq-circle .ring.glow {
          inset: -8px;
          border: 1px solid var(--ipq-color);
          box-shadow: 
            0 0 30px var(--ipq-color),
            inset 0 0 30px var(--ipq-color);
          opacity: 0.3;
          animation: pulse 3s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { 
            opacity: 0.3; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.05); 
          }
        }

        /* Radar sweep effect */
        .ipq-circle .radar {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(from 0deg, var(--ipq-color) 0deg, transparent 90deg);
          mix-blend-mode: screen;
          animation: spin 8s linear infinite;
          opacity: 0.3;
        }

        /* Center content */
        .ipq-circle .center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          z-index: 2;
        }

        .ipq-status {
          font-size: 20px;
          font-weight: 800;
          color: var(--ipq-color);
          text-shadow: 0 0 15px var(--ipq-color);
          margin-bottom: 8px;
          animation: statusPulse 2s ease-in-out infinite;
          letter-spacing: 1px;
        }

        @keyframes statusPulse {
          0%, 100% { 
            text-shadow: 0 0 15px var(--ipq-color); 
          }
          50% { 
            text-shadow: 
              0 0 25px var(--ipq-color), 
              0 0 35px var(--ipq-color);
          }
        }

        .ipq-risk {
          font-size: 48px;
          font-weight: 900;
          color: var(--ipq-color);
          text-shadow: 0 0 20px var(--ipq-color);
          font-family: 'Courier New', monospace;
        }

        /* Enhanced particles */
        .particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 4px;
          height: 4px;
          background: var(--ipq-color);
          border-radius: 50%;
          animation: 
            orbit 8s linear infinite,
            particleGlow 2s ease-in-out infinite alternate;
          animation-delay: calc(var(--i) * -0.4s);
          box-shadow: 0 0 8px var(--ipq-color);
        }

        @keyframes particleGlow {
          from { 
            box-shadow: 0 0 8px var(--ipq-color);
            opacity: 0.8;
          }
          to { 
            box-shadow: 0 0 16px var(--ipq-color);
            opacity: 1;
          }
        }

        @keyframes orbit {
          from { 
            transform: rotate(0deg) translateX(110px) rotate(0deg); 
          }
          to { 
            transform: rotate(360deg) translateX(110px) rotate(-360deg); 
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes spinReverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }

        /* Enhanced checklist */
        .ipq-checklist {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .ipq-check-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: var(--ipq-bg);
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          animation: fadeUp 0.6s ease forwards;
          opacity: 0;
          animation-delay: calc(var(--i) * 0.15s + 0.5s);
          backdrop-filter: blur(10px);
        }

        .ipq-check-card:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(8px) scale(1.02);
          border-color: var(--ipq-color);
          box-shadow: 0 8px 25px var(--ipq-bg);
        }

        .ipq-check-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ipq-check-left svg {
          width: 20px;
          height: 20px;
          stroke: #9ca3af;
          filter: drop-shadow(0 0 4px rgba(156, 163, 175, 0.5));
        }

        .ipq-check-left span {
          font-weight: 600;
          color: #e2e8f0;
        }

        .ipq-check-result svg {
          width: 24px;
          height: 24px;
          transition: all 0.3s ease;
        }

        /* Status-specific result icons */
        .check-result-pass .check-icon {
          stroke: #4ade80;
          filter: drop-shadow(0 0 8px #4ade80);
          animation: checkBounce 0.6s ease;
        }

        .check-result-warning .warning-icon {
          stroke: #fbbf24;
          fill: #fbbf24;
          filter: drop-shadow(0 0 8px #fbbf24);
          animation: warningPulse 1.5s ease-in-out infinite;
        }

        .check-result-fail .x-icon {
          stroke: #f43f5e;
          filter: drop-shadow(0 0 8px #f43f5e);
          animation: xShake 0.6s ease;
        }

        @keyframes checkBounce {
          0%, 20%, 53%, 80%, 100% { transform: scale(1); }
          40%, 43% { transform: scale(1.3); }
          70% { transform: scale(1.1); }
        }

        @keyframes warningPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        @keyframes xShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        @keyframes fadeUp {
          from { 
            opacity: 0; 
            transform: translateY(20px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        /* Footer enhancements */
        .ipq-footer {
          width: 100%;
          padding: 0 24px 24px;
        }

        .ipq-summary {
          font-weight: 700;
          color: var(--ipq-color);
          text-align: center;
          margin-top: 16px;
          font-size: 16px;
          text-shadow: 0 0 10px var(--ipq-color);
          animation: summaryFade 0.8s ease 1.2s both;
        }

        @keyframes summaryFade {
          from { 
            opacity: 0; 
            transform: translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-cards {
          display: flex;
          gap: 16px;
          margin-top: 20px;
        }

        .ipq-info-card {
          flex: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          animation: cardSlideUp 0.6s ease both;
          animation-delay: 1.4s;
        }

        .ipq-info-card:hover {
          box-shadow: 0 8px 25px rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
          border-color: var(--ipq-color);
        }

        @keyframes cardSlideUp {
          from { 
            opacity: 0; 
            transform: translateY(15px); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0); 
          }
        }

        .ipq-info-label {
          font-size: 12px;
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ipq-info-value {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin-top: 4px;
        }

        /* Responsive adjustments */
        @media (max-width: 480px) {
          .ipq-modal { max-width: 95vw; }
          .ipq-circle { width: 180px; height: 180px; }
          .ipq-status { font-size: 16px; }
          .ipq-risk { font-size: 36px; }
          .ipq-main { padding: 24px 16px; }
        }
      </style>
      <div class="ipq-modal">
        <div class="ipq-grid"></div>
        <main class="ipq-main">
          <div class="ipq-circle">
            <div class="ring outer"></div>
            <div class="ring inner"></div>
            <div class="ring glow"></div>
            <div class="radar"></div>
            <div class="center">
              <div class="ipq-status">${statusText}</div>
              <div class="ipq-risk">${risk}</div>
            </div>
            ${particles}
          </div>
          <div class="ipq-checklist">${checklistHTML}</div>
        </main>
        <footer class="ipq-footer">
          <div class="ipq-summary">${statusMessage}</div>
          <div class="ipq-info-cards">
            <div class="ipq-info-card">
              <div class="ipq-info-label">IP Address</div>
              <div class="ipq-info-value">${ip}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">Location</div>
              <div class="ipq-info-value">${flag} ${city ? city+', ' : ''}${cc}</div>
            </div>
            <div class="ipq-info-card">
              <div class="ipq-info-label">ISP</div>
              <div class="ipq-info-value">${isp || 'Unknown'}</div>
            </div>
          </div>
        </footer>
      </div>`;
  }

  function showFullIPModal(info){
    const data = info || {};
    const get = (obj, path, fb='')=>{ try{ return path.split('.').reduce((o,k)=> (o && k in o ? o[k] : undefined), obj) ?? fb; }catch(_){ return fb; } };
    const or = (...vals)=> vals.find(v=> v!==undefined && v!==null && v!=='') ?? '';

    const ip = or(data.ip, data.query, 'Unknown');
    const city = or(data.city, get(data,'location.city'), get(data,'city.name'), '');
    const region = or(data.region, data.region_name, get(data,'location.region'), '');
    const countryName = or(data.country_name, data.country, get(data,'country_name'), get(data,'location.country'), 'Unknown');
    const countryCode = or((data.country_code||data.countryCode||'').toUpperCase(), get(data,'country_code'), get(data,'location.country_code'), '').toUpperCase();
    const postal = or(data.postal, data.postal_code, get(data,'location.postal'), '');
    const lat = or(data.latitude, get(data,'location.latitude'), data.lat, '');
    const lon = or(data.longitude, get(data,'location.longitude'), data.lon, '');
    const isp = or(data.isp, data.org, get(data,'asn.name'), get(data,'company.name'), '');
    const asn = or(get(data,'asn.asn'), data.asn, get(data,'organization.asn'), '');
    const tz = or(get(data,'time_zone.name'), data.timezone, get(data,'timezone.name'), '');
    const currency = or(get(data,'currency.code'), get(data,'currency.name'), '');
    const callingCode = or(get(data,'calling_code'), get(data,'country_calling_code'), '');
    const languages = Array.isArray(get(data,'languages',[])) ? get(data,'languages',[]) : [];
    const carrier = get(data,'carrier.name','');
    const company = get(data,'company.name','');
    const threat = get(data,'threat',{});
    const isTor = !!or(threat.is_tor, get(data,'security.tor'), false);
    const isProxy = !!or(threat.is_proxy, get(data,'security.proxy'), false);
    const isAnonymous = !!or(threat.is_anonymous, get(data,'security.anonymous'), false);
    const isKnownAttacker = !!or(threat.is_known_attacker, get(data,'security.attacker'), false);
    const isKnownAbuser = !!or(threat.is_known_abuser, get(data,'security.abuser'), false);
    const riskScore = Number(or(threat.score, data.risk_score, data.risk, data.score, 'NaN'));
    const flagEmoji = countryCode ? countryCode.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

    const globe = `<svg class="ip-info-header-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    const icons = {
      ip:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
      map:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6l7-3 7 3 7-3v15l-7 3-7-3-7 3z"/><path d="M8 3v15"/><path d="M15 6v15"/></svg>`,
      globe,
      shield:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
      sim:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/></svg>`,
      clock:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      asn:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`
    };

    const chip = (icon, text)=>`<div class="ip-chip">${icon}<span>${text}</span></div>`;
    const metrics = [
      chip(icons.ip, `IP ${ip}`),
      chip(icons.globe, `${flagEmoji || countryCode || ''} ${countryName}`),
      city ? chip(icons.map, region ? `${city}, ${region}` : city) : '',
      isp ? chip(icons.sim, `ISP ${isp}`) : '',
      asn ? chip(icons.asn, `ASN ${asn}`) : '',
      tz ? chip(icons.clock, tz) : '',
      Number.isFinite(riskScore) ? chip(icons.shield, `Risk ${riskScore}/100`) : ''
    ].filter(Boolean).join('');

    const section = (title, items)=>{
      if(!items || !items.length) return '';
      const rows = items.map(([k,v])=>`<div class="ip-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
      return `<section class="ip-card"><h4>${title}</h4>${rows}</section>`;
    };

    const locationItems = [
      ['IP', ip],
      ['City', city],
      ['Region', region],
      ['Postal', postal],
      ['Country', `${countryName} ${flagEmoji}`],
      ['Latitude', lat],
      ['Longitude', lon]
    ].filter(([,v])=>v!=='' && v!==undefined);

    const networkItems = [
      ['ISP/Org', isp],
      ['ASN', asn],
      ['Company', company],
      ['Carrier', carrier]
    ].filter(([,v])=>v);

    const tzItems = [
      ['Time Zone', tz],
      ['Calling Code', callingCode],
      ['Currency', currency]
    ].filter(([,v])=>v);

    const langItems = Array.isArray(languages) && languages.length
      ? languages.map(l => [l.name || l.native || 'Language', l.code || l.alpha2 || l.native || '']).filter(([,v])=>v)
      : [];

    const threatItems = [
      ['Proxy', String(isProxy)],
      ['VPN', String(or(get(data,'security.vpn'), false))],
      ['Tor', String(isTor)],
      ['Anonymous', String(isAnonymous)],
      ['Known Attacker', String(isKnownAttacker)],
      ['Known Abuser', String(isKnownAbuser)],
      Number.isFinite(riskScore) ? ['Risk Score', `${riskScore}/100`] : null
    ].filter(Boolean);

    const html = `
      <style>
        #zepra-styled-modal .styled-modal-content.ip-info-shell{background:linear-gradient(180deg,rgba(15,23,42,.96),rgba(11,15,25,.94));border:none;border-radius:20px}
        #zepra-styled-modal .ip-info-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid rgba(56,189,248,0.2);background:linear-gradient(120deg,rgba(2,6,23,0.6),rgba(8,47,73,0.35));}
        #zepra-styled-modal .ip-info-header h3{margin:0;color:#fff;font-weight:700;display:flex;align-items:center;gap:0.5rem;}
        #zepra-styled-modal .ip-info-header-icon{width:24px;height:24px;animation:spin 20s linear infinite;}
        #zepra-styled-modal .ip-info-body{padding:1.25rem}
        .ip-metrics{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-bottom:1rem}
        .ip-chip{display:flex;align-items:center;gap:.4rem;background:rgba(2,6,23,.55);border:1px solid rgba(56,189,248,.25);padding:.45rem .7rem;border-radius:.8rem;font-size:.8rem;color:#e2e8f0}
        .ip-chip svg{width:16px;height:16px;color:#38bdf8;stroke:#38bdf8}
        .ip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
        .ip-card{background:rgba(0,0,0,.3);border:1px solid rgba(148,163,184,.2);border-radius:12px;padding:12px}
        .ip-card h4{margin:0 0 .5rem 0;color:#e2e8f0;font-size:.95rem}
        .ip-row{display:flex;justify-content:space-between;gap:6px;padding:6px 8px;border-radius:8px;background:rgba(2,6,23,.35);border:1px solid rgba(148,163,184,.12)}
        .ip-row .k{color:#94a3b8;font-size:.8rem}
        .ip-row .v{color:#e2e8f0;font-weight:600}
        @keyframes spin{to{transform:rotate(360deg)}}
      </style>
      <div class="ip-info-wrap">
        <div class="ip-metrics">${metrics}</div>
        <div class="ip-grid">
          ${section('Location', locationItems)}
          ${section('Network', networkItems)}
          ${section('Timezone & Locale', tzItems)}
          ${langItems.length ? section('Languages', langItems) : ''}
          ${section('Threat & Risk', threatItems)}
        </div>
      </div>`;

    const modal = createStyledModal(`${globe} IP Information`, html);
    modal.querySelector('.styled-modal-content')?.classList.add('ip-info-shell');
  }

  async function showFakeInfoModal() {
    const COUNTRY_CODES = "AF AX AL DZ AS AD AO AI AQ AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(' ');
    const datalist = `<datalist id="fiNatList">${COUNTRY_CODES.map(c=>`<option value="${c}">`).join('')}</datalist>`;
    const { fakeInfo } = await chrome.storage.local.get('fakeInfo');

    const icons = {
      userPlus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>`,
      user: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
      mail: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>`,
      phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/></svg>`,
      house: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
      cake: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/></svg>`,
      lock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
      map: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>`,
      globe: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
      copy: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
      pencil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
      plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`
    };

    const content = `
      <div class="fi-controls">
        <select id="fiGender">
          <option value="">Any Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        <input id="fiNat" list="fiNatList" placeholder="Country code (e.g., us)" />
      </div>
      ${datalist}
      <main id="fiMain" class="fi-main">
        <div id="fiLoader" class="fi-loader"></div>
        <div id="fiData" class="fi-data"></div>
      </main>
      <footer class="fi-footer">
        <button id="fiRegenerate" class="fi-regenerate"><span class="fi-regenerate-text">Regenerate Info</span></button>
      </footer>
    `;
    const modal = createStyledModal(`${icons.userPlus} Fake User Info`, content);

    const contentEl = modal.querySelector('.styled-modal-content');
    const headerEl = modal.querySelector('.styled-modal-header');
    const bodyEl = modal.querySelector('.styled-modal-body');
    contentEl.classList.add('fi-modal');
    headerEl.classList.add('fi-header');
    bodyEl.classList.add('fi-body');

    const style = document.createElement('style');
    style.textContent = `
      #zepra-styled-modal .fi-modal{background-color:rgba(17,24,39,0.7);backdrop-filter:blur(24px);border:1px solid rgba(74,222,128,0.2);box-shadow:0 0 40px rgba(10,70,30,0.5);border-radius:1.25rem;max-width:360px;width:90%;}
      #zepra-styled-modal .fi-header{background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(74,222,128,0.2);}
      #zepra-styled-modal .fi-header h3{margin:0;display:flex;align-items:center;gap:0.5rem;color:#fff;font-weight:700;}
      #zepra-styled-modal .fi-header svg{width:20px;height:20px;color:#4ade80;stroke:#4ade80;filter:drop-shadow(0 0 6px #4ade80);}
      #zepra-styled-modal .fi-body{padding:1rem;display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-controls{display:flex;gap:0.5rem;}
      #zepra-styled-modal .fi-controls select,#zepra-styled-modal .fi-controls input{flex:1;background:rgba(0,0,0,0.3);border:1px solid #334155;border-radius:0.5rem;color:#e2e8f0;padding:0.5rem;font-size:0.875rem;}
      #zepra-styled-modal .fi-main{display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-loader .fi-skel-card{height:80px;border-radius:0.75rem;background:#374151;animation:fiPulse 1.5s ease-in-out infinite;}
      #zepra-styled-modal .fi-loader .fi-skel-line{height:16px;border-radius:0.25rem;background:#374151;animation:fiPulse 1.5s ease-in-out infinite;margin-top:0.5rem;}
      @keyframes fiPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      #zepra-styled-modal .fi-data{display:flex;flex-direction:column;gap:1rem;}
      #zepra-styled-modal .fi-id-card{position:relative;display:flex;align-items:center;gap:0.75rem;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;}
      #zepra-styled-modal .fi-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(74,222,128,0.6);box-shadow:0 0 10px rgba(74,222,128,0.4);}
      #zepra-styled-modal .fi-pic-add{position:absolute;top:-8px;right:-8px;}
      #zepra-styled-modal .fi-name{font-weight:600;color:#fff;}
      #zepra-styled-modal .fi-age{font-size:0.875rem;color:#d1d5db;display:flex;align-items:center;gap:0.25rem;}
      #zepra-styled-modal .fi-age svg{width:16px;height:16px;}
      #zepra-styled-modal .fi-info-row{display:flex;align-items:center;justify-content:space-between;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.5rem 0.75rem;}
      #zepra-styled-modal .fi-info-left{display:flex;align-items:center;gap:0.5rem;}
      #zepra-styled-modal .fi-info-icon{width:32px;height:32px;background:rgba(74,222,128,0.15);border-radius:9999px;display:flex;align-items:center;justify-content:center;}
      #zepra-styled-modal .fi-info-icon svg{width:18px;height:18px;color:#4ade80;stroke:#4ade80;}
      #zepra-styled-modal .fi-info-label{font-size:0.75rem;color:#d1d5db;}
      #zepra-styled-modal .fi-info-value{font-weight:600;color:#fff;font-size:0.875rem;}
      #zepra-styled-modal .fi-actions{display:flex;gap:0.25rem;}
      #zepra-styled-modal .fi-action{position:relative;background:transparent;border:none;color:#e2e8f0;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.2s;}
      #zepra-styled-modal .fi-action:hover{background:rgba(74,222,128,0.15);}
      #zepra-styled-modal .fi-action svg{width:14px;height:14px;}
      #zepra-styled-modal .fi-action::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-4px);background:#000;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;}
      #zepra-styled-modal .fi-action:hover::after{opacity:1;}
      #zepra-styled-modal .fi-footer{padding-top:0.5rem;border-top:1px solid rgba(74,222,128,0.2);}
      #zepra-styled-modal .fi-regenerate{width:100%;background:#4ade80;color:#0b1b13;font-weight:600;border:none;border-radius:0.75rem;padding:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:opacity 0.3s;}
      #zepra-styled-modal .fi-regenerate:disabled{opacity:0.5;cursor:not-allowed;}
      #zepra-styled-modal .fi-spinner{width:16px;height:16px;border:2px solid rgba(0,0,0,0.2);border-top-color:#0b1b13;border-radius:50%;animation:spin 1s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(style);

    const loader = modal.querySelector('#fiLoader');
    const dataEl = modal.querySelector('#fiData');
    const regenBtn = modal.querySelector('#fiRegenerate');

    function showLoader(){
      loader.innerHTML = `
        <div class="fi-skel-card"></div>
        <div class="fi-skel-line"></div>
        <div class="fi-skel-line"></div>
        <div class="fi-skel-line"></div>
      `;
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="fi-spinner"></span><span>Generating...</span>';
      
      try {
        const gender = modal.querySelector('#fiGender').value || '';
        const nat = modal.querySelector('#fiNat').value.trim() || '';
        
        const resp = await chrome.runtime.sendMessage({ type:'GENERATE_FAKE_INFO', gender, nat });
        if (!resp?.ok) throw new Error(resp?.error || 'Failed to generate user info');
        
        await chrome.storage.local.set({ fakeInfo: resp.data });
        render(resp.data);
      } catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<span class="fi-regenerate-text">Regenerate Info</span>';
        showNotification('Failed to generate: ' + e.message, 'error');
        
        // Show error in data area if generation fails
        dataEl.style.display = 'block';
        dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Failed to generate user info. Please try again.</div>';
      }
    }

    function render(user){
      const name = `${user.name?.first || ''} ${user.name?.last || ''}`.trim();
      
      // Build address components safely
      const addressParts = [];
      if(user.location?.street?.number) addressParts.push(user.location.street.number);
      if(user.location?.street?.name) addressParts.push(user.location.street.name);
      if(user.location?.city) addressParts.push(user.location.city);
      if(user.location?.country) addressParts.push(user.location.country);
      const address = addressParts.join(', ');
      
      const age = user.dob?.age || '';
      
      // Create individual fields for each piece of data with proper validation
      const fields = [
        { label:'First Name', value:user.name?.first, key:'firstName', icon:icons.user },
        { label:'Last Name', value:user.name?.last, key:'lastName', icon:icons.user },
        { label:'Full Name', value:name, key:'fullName', icon:icons.user },
        { label:'Age', value:age ? age.toString() : '', key:'age', icon:icons.cake },
        { label:'Email', value:user.email, key:'email', icon:icons.mail },
        { label:'Phone', value:user.phone, key:'phone', icon:icons.phone },
        { label:'Username', value:user.login?.username, key:'username', icon:icons.user },
        { label:'Password', value:user.login?.password, key:'password', icon:icons.lock },
        { label:'Address', value:address, key:'address1', icon:icons.house },
        { label:'City', value:user.location?.city, key:'city', icon:icons.map },
        { label:'State', value:user.location?.state, key:'state', icon:icons.map },
        { label:'Zip Code', value:user.location?.postcode ? user.location.postcode.toString() : '', key:'zipCode', icon:icons.map },
        { label:'Country', value:user.location?.country, key:'country', icon:icons.globe }
      ].filter(f => {
        // Only show fields with actual values (not null, undefined, empty string, or just whitespace)
        return f.value && typeof f.value === 'string' && f.value.trim() !== '' && f.value !== 'undefined';
      });
      
      dataEl.innerHTML = `
        <div class="fi-id-card">
          ${user.picture?.large ? `<img class="fi-avatar" src="${user.picture.large}"/>` : ''}
          <div class="fi-id-info">
            <div class="fi-name">${name || 'Unknown User'}</div>
            <div class="fi-age">${icons.cake} ${age ? `${age} years old` : 'Age not available'}</div>
          </div>
          ${user.picture?.large ? `<button id="fiPicAdd" class="fi-action fi-pic-add" data-tip="Add Picture">${icons.plus}</button>` : ''}
        </div>
        ${fields.map((f,i)=>`
          <div class="fi-info-row">
            <div class="fi-info-left">
              <div class="fi-info-icon">${f.icon}</div>
              <div>
                <div class="fi-info-label">${f.label}</div>
                <div class="fi-info-value">${f.value || 'Not available'}</div>
              </div>
            </div>
            <div class="fi-actions">
              <button class="fi-action" data-copy="${i}" data-tip="Copy">${icons.copy}</button>
              <button class="fi-action" data-write="${i}" data-tip="Write Here">${icons.pencil}</button>
              <button class="fi-action" data-add="${i}" data-tip="Add to Identity">${icons.plus}</button>
            </div>
          </div>
        `).join('')}
      `;
      hideLoader();
      dataEl.style.display = 'flex';
      regenBtn.disabled = false;
      regenBtn.innerHTML = '<span class="fi-regenerate-text">Regenerate Info</span>';

      const picBtn = dataEl.querySelector('#fiPicAdd');
      if(picBtn){
        picBtn.addEventListener('click',()=>{
          addFieldToIdentity(picBtn, user.picture.large, 'profilePictureUrl', 'Picture Saved!');
        });
      }
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value || '');
          showNotification('Copied to clipboard');
        });
      });
      dataEl.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const idx = btn.getAttribute('data-write');
          const text = fields[idx].value || '';
          const m = document.getElementById('zepra-styled-modal');
          if (m) m.remove();
          // Show countdown and then type
          await showCountdown(3);
          await typeIntoFocusedElement(text, {speed:'normal'});
          showNotification('Information typed successfully!');
        });
      });
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx = btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
    }

    regenBtn.addEventListener('click', async (e)=>{
      // Prevent any default behavior that might cause scrolling
      e.preventDefault();
      e.stopPropagation();
      
      // Clear saved data and regenerate
      await chrome.storage.local.remove('fakeInfo');
      
      // Clear current data and show loader
      dataEl.style.display = 'none';
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="fi-spinner"></span><span>Generating...</span>';
      
      // Generate new data
      await generate();
    });

    if(fakeInfo){
      render(fakeInfo);
    } else {
      // Generate initial data if none exists
      generate();
    }
  }
  async function showRealAddressModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-real-address-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-real-address-modal';
    modal.innerHTML = `
      <div class="ra-modal-overlay">
        <div class="ra-modal-container">
          <div class="ra-modal-header">
            <div class="ra-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h3>Generate Real Address</h3>
            </div>
            <button class="ra-modal-close">&times;</button>
          </div>
          <div class="ra-modal-body">
            <div id="raInputs" class="ra-controls">
              <input id="raCountry" placeholder="Country" class="ra-input"/>
              <input id="raState" placeholder="State/Province" class="ra-input"/>
              <input id="raCity" placeholder="City/Zip Code" class="ra-input"/>
              <button id="raGenerate" class="ra-generate-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg>
                <span>Generate</span>
              </button>
            </div>
            <div id="raLoader" class="ra-loader" style="display:none;">
              <div class="ra-skel-card"></div>
              <div class="ra-skel-line"></div>
              <div class="ra-skel-line"></div>
            </div>
            <div id="raResult" class="ra-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;

    // Add clean unified styling
    const raStyle = document.createElement('style');
    raStyle.textContent = `
      #zepra-real-address-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: fadeIn 0.3s ease-out;
      }
      
      .ra-modal-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
      }
      
      .ra-modal-container {
        position: relative;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #4ade80;
        border-radius: 20px;
        max-width: 450px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 
          0 0 50px rgba(74, 222, 128, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes modalSlideIn {
        from { 
          opacity: 0; 
          transform: scale(0.8) translateY(50px); 
        }
        to { 
          opacity: 1; 
          transform: scale(1) translateY(0); 
        }
      }
      
      .ra-modal-header {
        background: rgba(0, 0, 0, 0.4);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
      }
      
      .ra-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ra-header-content svg {
        width: 24px;
        height: 24px;
        color: #4ade80;
        stroke: #4ade80;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ra-modal-header h3 {
        margin: 0;
        color: #4ade80;
        font-size: 18px;
        font-weight: bold;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ra-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ra-modal-close:hover {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      .ra-modal-body {
        padding: 24px;
        overflow-y: auto;
        max-height: 60vh;
      }
      
      .ra-controls {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      
      .ra-input {
        background: rgba(0,0,0,0.3);
        border: 1px solid #334155;
        border-radius: 0.5rem;
        color: #e2e8f0;
        padding: 0.75rem;
        font-size: 0.875rem;
        transition: all 0.3s;
      }
      
      .ra-input:focus {
        outline: none;
        border-color: #4ade80;
        box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2);
      }
      
      .ra-generate-btn {
        background: #4ade80;
        color: #0b1b13;
        font-weight: 600;
        border: none;
        border-radius: 0.75rem;
        padding: 0.75rem 1rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s;
      }
      
      .ra-generate-btn:hover {
        background: #22d3ee;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(34,211,238,0.4);
      }
      
      .ra-generate-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      
      .ra-generate-btn svg {
        width: 16px;
        height: 16px;
      }
      
      .ra-loader {
        padding: 1rem;
      }
      
      .ra-skel-card {
        height: 80px;
        border-radius: 0.75rem;
        background: #374151;
        animation: raPulse 1.5s ease-in-out infinite;
      }
      
      .ra-skel-line {
        height: 16px;
        border-radius: 0.25rem;
        background: #374151;
        animation: raPulse 1.5s ease-in-out infinite;
        margin-top: 0.5rem;
      }
      
      @keyframes raPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      
      .ra-data {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      
      .ra-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(31,41,55,0.5);
        border: 1px solid #374151;
        border-radius: 0.75rem;
        padding: 0.75rem;
        transition: all 0.3s;
      }
      
      .ra-info-row:hover {
        background: rgba(31,41,55,0.8);
        border-color: #4ade80;
        transform: translateY(-1px);
      }
      
      .ra-info-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      
      .ra-info-icon {
        width: 32px;
        height: 32px;
        background: rgba(74,222,128,0.15);
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .ra-info-icon svg {
        width: 18px;
        height: 18px;
        color: #4ade80;
        stroke: #4ade80;
      }
      
      .ra-info-content {
        flex: 1;
      }
      
      .ra-info-label {
        font-size: 0.75rem;
        color: #d1d5db;
        margin-bottom: 2px;
      }
      
      .ra-info-value {
        font-weight: 600;
        color: #fff;
        font-size: 0.875rem;
      }
      
      .ra-actions {
        display: flex;
        gap: 0.25rem;
      }
      
      .ra-action {
        position: relative;
        background: transparent;
        border: none;
        color: #e2e8f0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .ra-action:hover {
        background: rgba(74,222,128,0.15);
        transform: scale(1.1);
      }
      
      .ra-action svg {
        width: 14px;
        height: 14px;
      }
      
      .ra-action::after {
        content: attr(data-tip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translate(-50%,-8px);
        background: rgba(0,0,0,0.9);
        color: #fff;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
        z-index: 1000;
      }
      
      .ra-action:hover::after {
        opacity: 1;
      }
      
      .ra-regenerate {
        width: 100%;
        background: #4ade80;
        color: #0b1b13;
        font-weight: 600;
        border: none;
        border-radius: 0.75rem;
        padding: 0.75rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s;
        margin-top: 1rem;
      }
      
      .ra-regenerate:hover {
        background: #22d3ee;
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(34,211,238,0.4);
      }
      
      .ra-regenerate svg {
        width: 16px;
        height: 16px;
      }
      
      .ra-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(11,27,19,0.2);
        border-top-color: #0b1b13;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    
    document.head.appendChild(raStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ra-modal-close').addEventListener('click', () => {
      modal.remove();
      raStyle.remove();
    });
    
    modal.querySelector('.ra-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ra-modal-overlay')) {
        modal.remove();
        raStyle.remove();
      }
    });
    const loader = modal.querySelector('#raLoader');
    const dataEl = modal.querySelector('#raResult');
    const regenBtn = modal.querySelector('#raGenerate');

    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    function parse(text){
      try {
        const obj = JSON.parse(text);
        return {
          a1: obj.address_1 || '',
          a2: obj.address_2 || '',
          zip: obj.zip_code || ''
        };
      } catch (e) {
        return { a1: '', a2: '', zip: '' };
      }
    }

    function render(parts){
      hideLoader();
      const fields=[
        {label:'Address 1', value:parts.a1, key:'address1', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`},
        {label:'Address 2', value:parts.a2, key:'address2', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`},
        {label:'Zip Code', value:parts.zip, key:'zipCode', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>`}
      ];
      const box = modal.querySelector('#raResult');
      box.innerHTML = fields.map((f,i)=>`
        <div class="ra-info-row">
          <div class="ra-info-left">
            <div class="ra-info-icon">${f.icon}</div>
            <div class="ra-info-content">
              <div class="ra-info-label">${f.label}</div>
              <div class="ra-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ra-actions">
            <button class="ra-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-write="${i}" data-tip="Write Here">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            </button>
          </div>
        </div>
      `).join('');
      
      // Add regenerate button
      box.innerHTML += `
        <button class="ra-regenerate" id="raRegenerate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
          <span>Regenerate Info</span>
        </button>
      `;
      
      box.style.display='block';
      chrome.storage.local.set({realAddress: parts});
      box.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      box.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-write');
          const text=fields[idx].value||'';
          const m=document.getElementById('zepra-styled-modal');
          if(m) m.remove();
          typeAnswer(text);
        });
      });
      box.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });
      
      box.querySelector('#raRegenerate').addEventListener('click', async ()=>{
        await chrome.storage.local.remove('realAddress');
        modal.remove();
        showCleanRealAddressModal();
      });
    }

    if(saved){
      modal.querySelector('#raInputs').style.display='none';
      render(saved);
    }

    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="ra-spinner"></span><span>Generating...</span>';
      try{
        const country=modal.querySelector('#raCountry').value.trim();
        const state=modal.querySelector('#raState').value.trim();
        const city=modal.querySelector('#raCity').value.trim();
        const resp=await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        modal.querySelector('#raInputs').style.display='none';
        render(parse(resp.result));
      }catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg><span>Generate</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    modal.querySelector('#raGenerate').addEventListener('click', generate);
  }

  // Clean Real Address Modal - New Implementation
  async function showCleanRealAddressModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-real-address-modal');
    if (existing) existing.remove();

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-real-address-modal';
    modal.innerHTML = `
      <div class="ra-modal-overlay">
        <div class="ra-modal-container">
          <div class="ra-modal-header">
            <div class="ra-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <h3>Generate Real Address</h3>
            </div>
            <button class="ra-modal-close">&times;</button>
          </div>
          <div class="ra-modal-body">
            <div id="raInputs" class="ra-controls">
              <input id="raCountry" placeholder="Country" class="ra-input"/>
              <input id="raState" placeholder="State/Province" class="ra-input"/>
              <input id="raCity" placeholder="City/Zip Code" class="ra-input"/>
              <button id="raGenerate" class="ra-generate-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg>
                <span>Generate</span>
              </button>
            </div>
            <div id="raLoader" class="ra-loader" style="display:none;">
              <div class="ra-skel-card"></div>
              <div class="ra-skel-line"></div>
              <div class="ra-skel-line"></div>
            </div>
            <div id="raResult" class="ra-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;

    // Add clean unified styling
    const raStyle = document.createElement('style');
    raStyle.textContent = `
             @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
       #zepra-real-address-modal {
         position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; z-index: 2147483647;
         display: flex !important; align-items: center !important; justify-content: center !important; animation: fadeIn 0.3s ease-out;
       }
      .ra-modal-overlay { position: absolute !important; inset: 0 !important; background: rgba(0, 0, 0, 0.8); backdrop-filter: blur(8px); }
      .ra-modal-container {
        position: relative !important; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 2px solid #4ade80;
        border-radius: 20px; max-width: 450px; width: 90%; max-height: 80vh; overflow: hidden;
        box-shadow: 0 0 50px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes modalSlideIn { from { opacity: 0; transform: scale(0.8) translateY(50px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      .ra-modal-header { background: rgba(0, 0, 0, 0.4); padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(74, 222, 128, 0.2); }
      .ra-header-content { display: flex; align-items: center; gap: 12px; }
      .ra-header-content svg { width: 24px; height: 24px; color: #4ade80; stroke: #4ade80; filter: drop-shadow(0 0 8px #4ade80); }
      .ra-modal-header h3 { margin: 0; color: #4ade80; font-size: 18px; font-weight: bold; filter: drop-shadow(0 0 8px #4ade80); }
      .ra-modal-close { background: none; border: none; color: #e2e8f0; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
      .ra-modal-close:hover { background: rgba(74, 222, 128, 0.2); color: #4ade80; transform: scale(1.1); }
      .ra-modal-body { padding: 24px; overflow-y: auto; max-height: 60vh; }
      .ra-controls { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; }
      .ra-input { background: rgba(0,0,0,0.3); border: 1px solid #334155; border-radius: 0.5rem; color: #e2e8f0; padding: 0.75rem; font-size: 0.875rem; transition: all 0.3s; }
      .ra-input:focus { outline: none; border-color: #4ade80; box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2); }
      .ra-generate-btn { background: #4ade80; color: #0b1b13; font-weight: 600; border: none; border-radius: 0.75rem; padding: 0.75rem 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.3s; }
      .ra-generate-btn:hover { background: #22d3ee; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34,211,238,0.4); }
      .ra-generate-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
      .ra-generate-btn svg { width: 16px; height: 16px; }
      .ra-loader { padding: 1rem; }
      .ra-skel-card { height: 80px; border-radius: 0.75rem; background: #374151; animation: raPulse 1.5s ease-in-out infinite; }
      .ra-skel-line { height: 16px; border-radius: 0.25rem; background: #374151; animation: raPulse 1.5s ease-in-out infinite; margin-top: 0.5rem; }
      @keyframes raPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      .ra-data { display: flex; flex-direction: column; gap: 1rem; }
      .ra-info-row { display: flex; align-items: center; justify-content: space-between; background: rgba(31,41,55,0.5); border: 1px solid #374151; border-radius: 0.75rem; padding: 0.75rem; transition: all 0.3s; }
      .ra-info-row:hover { background: rgba(31,41,55,0.8); border-color: #4ade80; transform: translateY(-1px); }
      .ra-info-left { display: flex; align-items: center; gap: 0.75rem; }
      .ra-info-icon { width: 32px; height: 32px; background: rgba(74,222,128,0.15); border-radius: 9999px; display: flex; align-items: center; justify-content: center; }
      .ra-info-icon svg { width: 18px; height: 18px; color: #4ade80; stroke: #4ade80; }
      .ra-info-content { flex: 1; }
      .ra-info-label { font-size: 0.75rem; color: #d1d5db; margin-bottom: 2px; }
      .ra-info-value { font-weight: 600; color: #fff; font-size: 0.875rem; }
      .ra-actions { display: flex; gap: 0.25rem; }
      .ra-action { position: relative; background: transparent; border: none; color: #e2e8f0; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
      .ra-action:hover { background: rgba(74,222,128,0.15); transform: scale(1.1); }
      .ra-action svg { width: 14px; height: 14px; }
      .ra-action::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translate(-50%,-8px); background: rgba(0,0,0,0.9); color: #fff; padding: 4px 8px; border-radius: 6px; font-size: 11px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 1000; }
      .ra-action:hover::after { opacity: 1; }
      .ra-regenerate { width: 100%; background: #4ade80; color: #0b1b13; font-weight: 600; border: none; border-radius: 0.75rem; padding: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: all 0.3s; margin-top: 1rem; }
      .ra-regenerate:hover { background: #22d3ee; transform: translateY(-2px); box-shadow: 0 8px 25px rgba(34,211,238,0.4); }
      .ra-regenerate svg { width: 16px; height: 16px; }
      .ra-spinner { width: 16px; height: 16px; border: 2px solid rgba(11,27,19,0.2); border-top-color: #0b1b13; border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    
    document.head.appendChild(raStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ra-modal-close').addEventListener('click', () => {
      modal.remove();
      raStyle.remove();
    });
    
    modal.querySelector('.ra-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ra-modal-overlay')) {
        modal.remove();
        raStyle.remove();
      }
    });

    // Get elements
    const loader = modal.querySelector('#raLoader');
    const dataEl = modal.querySelector('#raResult');
    const regenBtn = modal.querySelector('#raGenerate');

    // Utility functions
    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }

    function hideLoader(){
      loader.style.display = 'none';
    }

    function parse(text){
      try {
        const obj = JSON.parse(text);
        return {
          a1: obj.address_1 || '',
          a2: obj.address_2 || '',
          zip: obj.zip_code || ''
        };
      } catch (e) {
        return { a1: '', a2: '', zip: '' };
      }
    }

    function render(parts){
      hideLoader();
      const fields=[
        {label:'Address 1', value:parts.a1, key:'address1', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`},
        {label:'Address 2', value:parts.a2, key:'address2', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z"/><path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9"/><path d="M12 3v6"/></svg>`},
        {label:'Zip Code', value:parts.zip, key:'zipCode', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c.552 0 1-.448 1-1V5c0-.552-.448-1-1-1H3c-.552 0-1 .448-1 1v6c0 .552.448 1 1 1h18z"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>`}
      ];
      
      dataEl.style.display = 'block';
      dataEl.innerHTML = fields.map((f,i)=>`
        <div class="ra-info-row">
          <div class="ra-info-left">
            <div class="ra-info-icon">${f.icon}</div>
            <div class="ra-info-content">
              <div class="ra-info-label">${f.label}</div>
              <div class="ra-info-value">${f.value || 'Not provided'}</div>
            </div>
          </div>
          <div class="ra-actions">
            <button class="ra-action" data-copy="${i}" data-tip="Copy">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="ra-action" data-write="${i}" data-tip="Write Here">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button class="ra-action" data-add="${i}" data-tip="Add to Identity">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </button>
          </div>
        </div>
      `).join('') + `
        <button class="ra-regenerate" id="raRegenerate">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
          <span>Regenerate Address</span>
        </button>
      `;

      // Event listeners for actions
      dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-copy');
          navigator.clipboard.writeText(fields[idx].value||'');
          showNotification('Copied to clipboard');
        });
      });
      
      dataEl.querySelectorAll('[data-write]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          const idx=btn.getAttribute('data-write');
          const text = fields[idx].value||'';
          // Hide modal first
          modal.remove();
          raStyle.remove();
          // Show countdown and then type
          await showCountdown(3);
          await typeIntoFocusedElement(text, {speed:'normal'});
          showNotification('Address typed successfully!');
        });
      });
      
      dataEl.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const idx=btn.getAttribute('data-add');
          addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
        });
      });

      // Regenerate button
      dataEl.querySelector('#raRegenerate').addEventListener('click', async () => {
        await chrome.storage.local.remove('realAddress');
        modal.remove();
        raStyle.remove();
        showCleanRealAddressModal();
      });
    }

    // Generate function
    async function generate(){
      showLoader();
      regenBtn.disabled = true;
      regenBtn.innerHTML = '<span class="ra-spinner"></span><span>Generating...</span>';
      
      try{
        const country = modal.querySelector('#raCountry').value.trim();
        const state = modal.querySelector('#raState').value.trim();
        const city = modal.querySelector('#raCity').value.trim();
        
        const resp = await chrome.runtime.sendMessage({type:'GENERATE_REAL_ADDRESS', country, state, city});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        
        modal.querySelector('#raInputs').style.display='none';
        render(parse(resp.result));
        
        await chrome.storage.local.set({ realAddress: parse(resp.result) });
      }catch(e){
        hideLoader();
        regenBtn.disabled = false;
        regenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v7a2 2 0 0 1-2 2h-4"/><path d="M3 11l-1-1 1-1"/><path d="M18 11h3"/></svg><span>Generate</span>';
        showNotification('Failed to generate: '+e.message);
      }
    }

    // Event listener for generate button
    regenBtn.addEventListener('click', generate);

    // Check for saved data
    const saved = (await chrome.storage.local.get('realAddress')).realAddress;
    if (saved && (saved.a1 || saved.a2 || saved.zip)) {
      modal.querySelector('#raInputs').style.display='none';
      render(saved);
    }
  }

  async function showCompanyInfoModal(){
    // Remove existing modal
    const existing = document.getElementById('zepra-company-modal');
    if (existing) existing.remove();

    // Get saved company data
    const { companyInfo } = await chrome.storage.local.get('companyInfo');

    // Create standalone modal
    const modal = document.createElement('div');
    modal.id = 'zepra-company-modal';
    modal.innerHTML = `
      <div class="ci-modal-overlay">
        <div class="ci-modal-container">
          <div class="ci-modal-header">
            <div class="ci-header-content">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>
              <h3>Generate Company Info</h3>
            </div>
            <button class="ci-modal-close">&times;</button>
          </div>
          <div class="ci-modal-body">
            <div id="ciLoader" class="ci-loader">
              <div class="ci-skel-card"></div>
              <div class="ci-skel-line"></div>
              <div class="ci-skel-line"></div>
              <div class="ci-skel-line"></div>
            </div>
            <div id="ciResult" class="ci-data" style="display:none;"></div>
          </div>
        </div>
      </div>
    `;
    
    // Add unified styling for company info
    const ciStyle = document.createElement('style');
    ciStyle.textContent = `
      #zepra-company-modal {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 2147483647;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: fadeIn 0.3s ease-out;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .ci-modal-overlay {
        position: absolute !important;
        inset: 0 !important;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
      }
      
      .ci-modal-container {
        position: relative !important;
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 2px solid #4ade80;
        border-radius: 20px;
        max-width: 450px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 
          0 0 50px rgba(74, 222, 128, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      @keyframes modalSlideIn {
        from { 
          opacity: 0; 
          transform: scale(0.8) translateY(50px); 
        }
        to { 
          opacity: 1; 
          transform: scale(1) translateY(0); 
        }
      }
      
      .ci-modal-header {
        background: rgba(0, 0, 0, 0.4);
        padding: 20px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
      }
      
      .ci-header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      
      .ci-header-content svg {
        width: 24px;
        height: 24px;
        color: #4ade80;
        stroke: #4ade80;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ci-modal-header h3 {
        margin: 0;
        color: #4ade80;
        font-size: 18px;
        font-weight: bold;
        filter: drop-shadow(0 0 8px #4ade80);
      }
      
      .ci-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      .ci-modal-close:hover {
        background: rgba(74, 222, 128, 0.2);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      .ci-modal-body {
        padding: 24px;
        overflow-y: auto;
        max-height: 60vh;
      }
      
      .ci-loader{padding:1rem;}
      .ci-loader .ci-skel-card{height:80px;border-radius:0.75rem;background:#374151;animation:ciPulse 1.5s ease-in-out infinite;}
      .ci-loader .ci-skel-line{height:16px;border-radius:0.25rem;background:#374151;animation:ciPulse 1.5s ease-in-out infinite;margin-top:0.5rem;}
      @keyframes ciPulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
      .ci-data{display:flex;flex-direction:column;gap:1rem;}
      .ci-info-row{display:flex;align-items:center;justify-content:space-between;background:rgba(31,41,55,0.5);border:1px solid #374151;border-radius:0.75rem;padding:0.75rem;transition:all 0.3s;}
      .ci-info-row:hover{background:rgba(31,41,55,0.8);border-color:#4ade80;transform:translateY(-1px);}
      .ci-info-left{display:flex;align-items:center;gap:0.75rem;}
      .ci-info-icon{width:32px;height:32px;background:rgba(74,222,128,0.15);border-radius:9999px;display:flex;align-items:center;justify-content:center;}
      .ci-info-icon svg{width:18px;height:18px;color:#4ade80;stroke:#4ade80;}
      .ci-info-content{flex:1;}
      .ci-info-label{font-size:0.75rem;color:#d1d5db;margin-bottom:2px;}
      .ci-info-value{font-weight:600;color:#fff;font-size:0.875rem;}
      .ci-actions{display:flex;gap:0.25rem;}
      .ci-action{position:relative;background:transparent;border:none;color:#e2e8f0;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;}
      .ci-action:hover{background:rgba(74,222,128,0.15);transform:scale(1.1);}
      .ci-action svg{width:14px;height:14px;}
      .ci-action::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translate(-50%,-8px);background:rgba(0,0,0,0.9);color:#fff;padding:4px 8px;border-radius:6px;font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:1000;}
      .ci-action:hover::after{opacity:1;}
      .ci-regenerate{width:100%;background:#4ade80;color:#0b1b13;font-weight:600;border:none;border-radius:0.75rem;padding:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.5rem;transition:all 0.3s;margin-top:1rem;}
      .ci-regenerate:hover{background:#22d3ee;transform:translateY(-2px);box-shadow:0 8px 25px rgba(34,211,238,0.4);}
      .ci-regenerate svg{width:16px;height:16px;}
      .ci-spinner{width:16px;height:16px;border:2px solid rgba(11,27,19,0.2);border-top-color:#0b1b13;border-radius:50%;animation:spin 1s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `;
    document.head.appendChild(ciStyle);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.ci-modal-close').addEventListener('click', () => {
      modal.remove();
      ciStyle.remove();
    });
    
    modal.querySelector('.ci-modal-overlay').addEventListener('click', (e) => {
      if (e.target === modal.querySelector('.ci-modal-overlay')) {
        modal.remove();
        ciStyle.remove();
      }
    });
    const loader = modal.querySelector('#ciLoader');
    const dataEl = modal.querySelector('#ciResult');
    
    function showLoader(){
      loader.style.display = 'block';
      dataEl.style.display = 'none';
    }
    
    function hideLoader(){
      loader.style.display = 'none';
    }
    
    function render(data){
      try{
        const fields = [
          {label:'Company Name', value:data.companyName, key:'companyName', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>`},
          {label:'Industry', value:data.companyIndustry, key:'companyIndustry', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`},
          {label:'Company Size', value:data.companySize, key:'companySize', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m22 21-3-3 3-3"/><path d="M16 8h.01"/></svg>`},
          {label:'Annual Revenue', value:data.companyAnnualRevenue, key:'companyAnnualRevenue', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`},
          {label:'Website', value:data.companyWebsite, key:'companyWebsite', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`},
          {label:'Address', value:data.companyAddress, key:'companyAddress', icon:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`}
        ];
        
        hideLoader();
        dataEl.innerHTML = fields.map((f,i)=>`
          <div class="ci-info-row">
            <div class="ci-info-left">
              <div class="ci-info-icon">${f.icon}</div>
              <div class="ci-info-content">
                <div class="ci-info-label">${f.label}</div>
                <div class="ci-info-value">${f.value || 'Not provided'}</div>
              </div>
            </div>
            <div class="ci-actions">
              <button class="ci-action" data-copy="${i}" data-tip="Copy">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button class="ci-action" data-write="${i}" data-tip="Write Here">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
              <button class="ci-action" data-add="${i}" data-tip="Add to Identity">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </button>
            </div>
          </div>
        `).join('');
        
        // Add regenerate button
        dataEl.innerHTML += `
          <button class="ci-regenerate" id="ciRegenerate">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"/><path d="M21 12A9 9 0 0 0 6 5.3L3 8"/><path d="M21 22v-6h-6"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/></svg>
            <span>Regenerate Company</span>
          </button>
        `;
        
        dataEl.style.display = 'block';
        
        // Event listeners for actions
        dataEl.querySelectorAll('[data-copy]').forEach(btn=>{
          btn.addEventListener('click',()=>{
            const idx=btn.getAttribute('data-copy');
            navigator.clipboard.writeText(fields[idx].value||'');
            showNotification('Copied to clipboard');
          });
        });
        
        dataEl.querySelectorAll('[data-write]').forEach(btn=>{
          btn.addEventListener('click', async ()=>{
            const idx=btn.getAttribute('data-write');
            const text = fields[idx].value||'';
            // Hide modal first
            modal.remove();
            ciStyle.remove();
            // Show countdown and then type
            await showCountdown(3);
            await typeIntoFocusedElement(text, {speed:'normal'});
            showNotification('Company info typed successfully!');
          });
        });
        
        dataEl.querySelectorAll('[data-add]').forEach(btn=>{
          btn.addEventListener('click',()=>{
            const idx=btn.getAttribute('data-add');
            addFieldToIdentity(btn, fields[idx].value, fields[idx].key);
          });
        });
        
        // Regenerate button event
        dataEl.querySelector('#ciRegenerate')?.addEventListener('click', async () => {
          await chrome.storage.local.remove('companyInfo');
          modal.remove();
          ciStyle.remove();
          showCompanyInfoModal();
        });
        
      }catch(e){
        hideLoader();
        dataEl.style.display = 'block';
        if(e.message === 'parse') {
          dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: AI provided an invalid response format.</div>';
        } else {
          dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: Could not connect to the AI service. Please check your API key and network connection.</div>';
        }
      }
    }
    
    async function generate(){
      showLoader();
      try{
        const resp = await chrome.runtime.sendMessage({type:'GENERATE_COMPANY'});
        if(!resp?.ok) throw new Error(resp?.error||'Failed');
        
        let data;
        try {
          data = JSON.parse(resp.result);
        } catch (e) {
          throw new Error('parse');
        }
        
        // Save generated data
        await chrome.storage.local.set({ companyInfo: data });
        render(data);
      }catch(e){
        hideLoader();
        dataEl.style.display = 'block';
        if(e.message === 'parse') {
          dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: AI provided an invalid response format.</div>';
        } else {
          dataEl.innerHTML = '<div style="text-align:center;color:#f43f5e;padding:2rem;">Error: Could not connect to the AI service. Please check your API key and network connection.</div>';
        }
      }
    }
    
    // Check for saved data first, otherwise generate new data
    if(companyInfo){
      render(companyInfo);
    } else {
      generate();
    }
  }

  function showLastAnswerModal(answer) {
    const text = (answer || '').trim();
    if (!text) { showNotification('No last answer available'); return; }
    const modal = createStyledModal('Last Answer', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <div id="lastAnswerText" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-bottom: 20px; max-height: 200px; overflow-y: auto; color: #e2e8f0;">${text}</div>
        <div id="lastAnswerCountdown" style="display:none; text-align:center; font-size:24px; font-weight:bold; color:#39ff14; margin-bottom:20px;">3</div>
        <div id="lastAnswerBtns" style="display: flex; justify-content: center; gap: 10px;">
          <button id="lastAnswerType" style="background: linear-gradient(45deg, #4ecdc4, #44a08d); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Start Typing</button>
          <button id="lastAnswerCopy" style="background: linear-gradient(45deg, #ff6b6b, #feca57); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Manual Entry</button>
        </div>
      </div>
    `);

    setTimeout(() => {
      document.getElementById('lastAnswerType')?.addEventListener('click', async () => {
        const txt = document.getElementById('lastAnswerText');
        const cd = document.getElementById('lastAnswerCountdown');
        const btns = document.getElementById('lastAnswerBtns');
        if (txt) txt.style.display = 'none';
        if (btns) btns.style.display = 'none';
        if (cd) {
          cd.style.display = 'block';
          let count = 3;
          cd.textContent = count;
          const timer = setInterval(() => {
            count--;
            if (count > 0) {
              cd.textContent = count;
            } else {
              clearInterval(timer);
              const m = document.getElementById('zepra-styled-modal');
              if (m) m.remove();
              typeAnswer(text, { skipCountdown: true });
            }
          }, 1000);
        }
      });
      document.getElementById('lastAnswerCopy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(text);
        const m = document.getElementById('zepra-styled-modal'); if (m) m.remove();
        showNotification('Answer copied to clipboard');
      });
    }, 100);
  }

  function showNewSurveyModal() {
    navigator.clipboard.readText().then(clipboardText => {
      const modal = createStyledModal('New Survey', `
        <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
          <p style="color: #e2e8f0; margin-bottom: 15px;">The text in your clipboard will be typed in human-like manner:</p>
          <div id="newSurveyText" style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin: 15px 0; max-height: 150px; overflow-y: auto;">
            <pre style="color: #94a3b8; white-space: pre-wrap; font-size: 14px; margin: 0;">${clipboardText || 'No text in clipboard'}</pre>
          </div>
          <div id="newSurveyCountdown" style="display:none; text-align:center; font-size:24px; font-weight:bold; color:#39ff14; margin-bottom:20px;">3</div>
          <div id="newSurveyBtns" style="display: flex; justify-content: center; gap: 10px; margin-top: 20px;">
            <button id="writeNowBtn" style="background: linear-gradient(45deg, #4ecdc4, #44a08d); border: none; color: white; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 14px;">Start Typing</button>
            <button id="manualEntryBtn" style="background: linear-gradient(45deg, #ff6b6b, #feca57); border: none; color: white; padding: 12px 24px; border-radius: 25px; cursor: pointer; font-weight: bold; font-size: 14px;">Manual Entry</button>
          </div>
        </div>
      `, () => {
        // Clear new survey context
        chrome.runtime.sendMessage({ type: 'NEW_SURVEY_CONTEXT' });
      });

      // Add event listener for Write Now button
      setTimeout(() => {
        const writeBtn = document.getElementById('writeNowBtn');
        const manualBtn = document.getElementById('manualEntryBtn');
        const txt = document.getElementById('newSurveyText');
        const cd = document.getElementById('newSurveyCountdown');
        const btns = document.getElementById('newSurveyBtns');
        if (writeBtn) {
          writeBtn.addEventListener('click', () => {
            if (txt) txt.style.display = 'none';
            if (btns) btns.style.display = 'none';
            if (cd) {
              cd.style.display = 'block';
              let count = 3; cd.textContent = count;
              const interval = setInterval(() => {
                count--;
                if (count > 0) {
                  cd.textContent = count;
                } else {
                  clearInterval(interval);
                  const m = document.getElementById('zepra-styled-modal');
                  if (m) m.remove();
                  typeAnswer(clipboardText, { skipCountdown: true });
                }
              }, 1000);
            }
          });
        }
        if (manualBtn) {
          manualBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(clipboardText || '');
            const m = document.getElementById('zepra-styled-modal'); if (m) m.remove();
            showNotification('Answer copied to clipboard');
          });
        }
      }, 100);
    }).catch(() => {
      showNotification('Could not access clipboard');
    });
  }

  function startOCRCapture() {
    showOverlayAndSelect().then(async (rect) => {
      if (!rect) return;
      try {
        const { ocrLang = 'eng' } = await chrome.storage.local.get('ocrLang');
        const response = await chrome.runtime.sendMessage({
          type: 'CAPTURE_AND_OCR',
          rect: rect,
          tabId: await getTabId(),
          ocrLang
        });
        if (response?.ok) {
          showOCRResultModal(response.text);
        } else {
          showNotification('OCR failed: ' + (response?.error || 'Unknown error'));
        }
      } catch (e) {
        showNotification('OCR error: ' + e.message);
      }
    });
  }

  async function startFullPageOCR() {
    try {
      showNotification('Starting full page OCR...');
      const { ocrLang = 'eng' } = await chrome.storage.local.get('ocrLang');
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_FULL_PAGE_OCR',
        tabId: await getTabId(),
        ocrLang
      });
      if (response?.ok) {
        showOCRResultModal(response.text);
      } else {
        showNotification('OCR failed: ' + (response?.error || 'Unknown error'));
      }
    } catch (e) {
      showNotification('OCR error: ' + e.message);
    }
  }

  function showOCRResultModal(extractedText) {
    const modal = createStyledModal('OCR Result', `
      <div style="background: linear-gradient(120deg, #120f12 80%, #0a0f17 100%); padding: 20px; border-radius: 10px; margin: 10px 0;">
        <p style="color: #e2e8f0; margin-bottom: 15px;">Extracted Text:</p>
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin: 15px 0; max-height: 300px; overflow-y: auto;">
          <pre style="color: #94a3b8; white-space: pre-wrap; font-size: 14px; margin: 0;">${extractedText}</pre>
        </div>
        <div style="display: flex; justify-content: center; gap: 10px; margin-top: 20px;">
          <button id="sendToAI" style="background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Send to AI</button>
          <button id="retakeOCR" style="background: linear-gradient(45deg, #feca57, #ff9ff3); border: none; color: white; padding: 10px 20px; border-radius: 25px; cursor: pointer; font-weight: bold;">Retake</button>
        </div>
      </div>
    `);

    // Add event listeners
    setTimeout(() => {
      const sendBtn = document.getElementById('sendToAI');
      const retakeBtn = document.getElementById('retakeOCR');
      
      if (sendBtn) {
        sendBtn.addEventListener('click', () => {
          const modal = document.getElementById('zepra-styled-modal');
          if (modal) modal.remove();
          createRainbowModal(extractedText);
        });
      }
      
      if (retakeBtn) {
        retakeBtn.addEventListener('click', () => {
          const modal = document.getElementById('zepra-styled-modal');
          if (modal) modal.remove();
          startOCRCapture();
        });
      }
    }, 100);
  }

  function createStyledModal(title, content, onClose) {
    // Remove existing modal
    const existing = document.getElementById('zepra-styled-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'zepra-styled-modal';
    modal.innerHTML = `
      <div class="styled-modal-content">
        <div class="styled-modal-header">
          <h3>${title}</h3>
          <button class="styled-modal-close">&times;</button>
        </div>
        <div class="styled-modal-body">
          ${content}
        </div>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .styled-modal-content {
        background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
        border-radius: 15px;
        padding: 0;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        border: 3px solid #39ff14;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      }
      
      .styled-modal-header {
        background: rgba(0,0,0,0.2);
        padding: 15px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #292d33;
      }
      
      .styled-modal-header h3 {
        margin: 0;
        color: #39ff14;
        font-size: 18px;
        font-weight: bold;
      }
      
      .styled-modal-close {
        background: none;
        border: none;
        color: #e2e8f0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .styled-modal-close:hover {
        background: rgba(255,255,255,0.2);
      }
      
      .styled-modal-body {
        padding: 20px;
        color: #e2e8f0;
        overflow-y: auto;
        max-height: 60vh;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    // Event listeners
    modal.querySelector('.styled-modal-close').addEventListener('click', () => {
      modal.remove();
      style.remove();
      if (onClose) onClose();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        style.remove();
        if (onClose) onClose();
      }
    });

    return modal;
  }

  function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #23272b 0%, #120f12 100%);
      color: #e2e8f0;
      padding: 15px 20px;
      border-radius: 10px;
      box-shadow: 0 5px 20px rgba(0,0,0,0.3);
      z-index: 2147483649;
      font-size: 14px;
      white-space: pre-line;
      text-align: center;
      animation: slideDown 0.3s ease-out;
      border: 2px solid #39ff14;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideUp 0.3s ease-out forwards';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  async function createRainbowModal(selectedText, customPromptId = null) {
    if (STATE.modal) return;

    const { showReasoning = false } = await chrome.storage.local.get('showReasoning');

    const modal = document.createElement('div');
    modal.id = 'zepra-modal';
    modal.innerHTML = `
      <div class="za-modal">
        <header class="za-header">
          <h2>Zepra Answer</h2>
          <button class="modal-close">×</button>
        </header>
        <main class="za-body">
          <div class="za-question-box">${selectedText}</div>
          <div class="answer-container${showReasoning ? ' split' : ''}">
            <div class="loading"></div>
            ${showReasoning ? `
            <div class="split-pane" style="display:none;">
              <div class="pane-card answer-pane">
                <div class="pane-header">
                  <div class="pane-title">Answer</div>
                  <button class="pane-copy btn-copy-answer" type="button">Copy</button>
                </div>
                <div class="pane-body">
                  <div class="pane-text answer-text"></div>
                </div>
              </div>
              <div class="pane-card reason-pane">
                <div class="pane-header">
                  <div class="pane-title">Reason</div>
                  <button class="pane-copy btn-copy-reason" type="button">Copy</button>
                </div>
                <div class="pane-body">
                  <div class="pane-text reason-text"></div>
                </div>
              </div>
            </div>
            ` : `
            <div class="answer-text" style="display:none;"></div>
            `}
          </div>
        </main>
        <footer class="za-footer">
          <div class="modal-actions" style="display:none;">
            <button class="btn-write-here action-btn" data-color="cyan">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
                <path d="M16 8 2 22" />
                <path d="M17.5 15H9" />
              </svg>
              <span>Write Here</span>
            </button>
            <button class="btn-write-all action-btn" data-color="gray">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
                <path d="M16 8 2 22" />
                <path d="M17.5 15H9" />
              </svg>
              <span>Write All</span>
            </button>
            ${showReasoning ? '' : `<button class="btn-copy action-btn" data-color="pink">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <span>Copy</span>
            </button>`}
            <button class="btn-humanizer action-btn" data-color="teal">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 4V2" />
                <path d="M15 16v-2" />
                <path d="M8 9h2" />
                <path d="M20 9h2" />
                <path d="M17.8 11.8 19 13" />
                <path d="M15 9h.01" />
                <path d="M17.8 6.2 19 5" />
                <path d="m3 21 9-9" />
                <path d="M12.2 6.2 11 5" />
              </svg>
              <span>AI Humanizer</span>
            </button>
            <button class="btn-use-prompt action-btn" data-color="yellow">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
              </svg>
              <span>Use Custom Prompt</span>
            </button>
            <button class="btn-ask action-btn" data-color="purple">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <path d="M12 17h.01"/>
              </svg>
              <span>Ask</span>
            </button>
          </div>
        </footer>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .answer-container.split .split-pane {
        display:grid;
        gap:1rem;
        grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
      }

      .answer-container.split .pane-card {
        position:relative;
        display:flex;
        flex-direction:column;
        gap:0.75rem;
        padding:1.15rem;
        min-height:200px;
        border-radius:1rem;
        border:1px solid rgba(148,163,184,0.22);
        background:linear-gradient(165deg, rgba(12,18,32,0.94), rgba(17,24,39,0.82));
        box-shadow:0 24px 45px -35px rgba(15,23,42,0.95), 0 0 0 1px rgba(15,23,42,0.6);
        backdrop-filter:blur(12px);
        overflow:hidden;
      }

      .answer-container.split .pane-card::before {
        content:'';
        position:absolute;
        inset:-1px;
        border-radius:inherit;
        background:radial-gradient(circle at 20% -10%, rgba(59,130,246,0.18), transparent 60%);
        opacity:0.85;
        pointer-events:none;
        z-index:0;
      }

      .answer-container.split .answer-pane::before {
        background:radial-gradient(circle at 20% -10%, rgba(45,212,191,0.3), transparent 60%);
      }

      .answer-container.split .reason-pane::before {
        background:radial-gradient(circle at 20% -10%, rgba(250,204,21,0.32), rgba(244,114,182,0.22) 55%, transparent 80%);
      }

      .answer-container.split .pane-card > * {
        position:relative;
        z-index:1;
      }

      .answer-container.split .answer-pane {
        border-color:rgba(45,212,191,0.35);
        box-shadow:0 24px 40px -32px rgba(20,184,166,0.55), 0 0 0 1px rgba(20,184,166,0.3);
      }

      .answer-container.split .reason-pane {
        border-color:rgba(244,114,182,0.4);
        background:linear-gradient(170deg, rgba(23,16,32,0.95), rgba(27,20,35,0.82));
        box-shadow:0 24px 40px -32px rgba(236,72,153,0.55), 0 0 0 1px rgba(236,72,153,0.28);
      }

      .answer-container.split .pane-header {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:0.75rem;
        padding-bottom:0.5rem;
        border-bottom:1px solid rgba(148,163,184,0.18);
        flex-wrap:wrap;
      }

      .answer-container.split .pane-title {
        margin:0;
        font-weight:700;
        font-size:0.85rem;
        letter-spacing:0.08em;
        text-transform:uppercase;
        color:#bae6fd;
        line-height:1.1;
      }

      .answer-container.split .answer-pane .pane-title {
        color:#5eead4;
        text-shadow:0 0 12px rgba(94,234,212,0.35);
      }

      .answer-container.split .reason-pane .pane-title {
        color:#f9a8d4;
        text-shadow:0 0 12px rgba(244,114,182,0.35);
      }

      .answer-container.split .answer-pane .pane-header {
        border-color:rgba(45,212,191,0.2);
      }

      .answer-container.split .reason-pane .pane-header {
        border-color:rgba(244,114,182,0.24);
      }

      .answer-container.split .pane-body {
        flex:1;
        padding:0.9rem;
        border-radius:0.85rem;
        background:linear-gradient(160deg, rgba(10,16,28,0.85), rgba(15,23,42,0.7));
        border:1px solid rgba(148,163,184,0.18);
        box-shadow:inset 0 0 0 1px rgba(15,23,42,0.4);
        overflow-y:auto;
        max-height:min(300px,40vh);
      }

      .answer-container.split .answer-pane .pane-body {
        border-color:rgba(45,212,191,0.28);
        box-shadow:inset 0 0 0 1px rgba(13,148,136,0.3);
      }

      .answer-container.split .reason-pane .pane-body {
        border-color:rgba(244,114,182,0.3);
        box-shadow:inset 0 0 0 1px rgba(244,114,182,0.25);
        background:linear-gradient(160deg, rgba(23,16,32,0.92), rgba(27,20,35,0.82));
      }

      .answer-container.split .pane-body::-webkit-scrollbar {
        width:6px;
      }

      .answer-container.split .pane-body::-webkit-scrollbar-track {
        background:transparent;
      }

      .answer-container.split .answer-pane .pane-body::-webkit-scrollbar-thumb {
        background:rgba(45,212,191,0.45);
      }

      .answer-container.split .reason-pane .pane-body::-webkit-scrollbar-thumb {
        background:rgba(244,114,182,0.55);
      }

      .answer-container.split .pane-text {
        color:#f8fafc;
        font-size:0.95rem;
        line-height:1.6;
        white-space:pre-wrap;
        word-break:break-word;
        text-align:start;
        unicode-bidi:plaintext;
      }

      .answer-container.split .pane-copy {
        border:none;
        border-radius:999px;
        padding:0.4rem 0.95rem;
        font-size:0.7rem;
        letter-spacing:0.08em;
        text-transform:uppercase;
        font-weight:600;
        cursor:pointer;
        transition:transform .2s ease, box-shadow .2s ease, background .2s ease;
        color:#f8fafc;
        background:rgba(148,163,184,0.24);
        flex-shrink:0;
      }

      .answer-container.split .pane-copy:hover {
        transform:translateY(-1px);
      }

      .answer-container.split .pane-copy:focus-visible {
        outline:2px solid rgba(250,204,21,0.6);
        outline-offset:2px;
      }

      .answer-container.split .answer-pane .pane-copy {
        background:rgba(45,212,191,0.22);
        color:#5eead4;
        box-shadow:0 10px 25px -20px rgba(20,184,166,0.8), 0 0 0 1px rgba(45,212,191,0.35);
      }

      .answer-container.split .answer-pane .pane-copy:hover {
        background:rgba(45,212,191,0.32);
      }

      .answer-container.split .reason-pane .pane-copy {
        background:rgba(244,114,182,0.22);
        color:#f9a8d4;
        box-shadow:0 10px 25px -20px rgba(236,72,153,0.8), 0 0 0 1px rgba(244,114,182,0.35);
      }

      .answer-container.split .reason-pane .pane-copy:hover {
        background:rgba(244,114,182,0.32);
      }

      .za-modal {
        background-color: rgba(17,24,39,0.8);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(244,63,94,0.2);
        box-shadow: 0 0 30px rgba(244,63,94,0.1);
        border-radius: 1rem;
        width: 90%;
        max-width: 600px;
        max-height: 85vh;
        display:flex;
        flex-direction:column;
        overflow:hidden;
      }

      .za-header,
      .za-footer {
        padding: 1rem 1.25rem;
        display:flex;
        align-items:center;
        justify-content:space-between;
        border-bottom:1px solid rgba(244,63,94,0.2);
      }

      .za-footer {
        border-bottom:none;
        border-top:1px solid rgba(244,63,94,0.2);
      }

      .za-header h2 {
        color: #4ade80;
        margin:0;
        font-size:1.25rem;
        text-shadow:0 0 8px #4ade80;
      }

      .modal-close {
        background:none;
        border:none;
        color:#e2e8f0;
        font-size:1.25rem;
        width:2rem;
        height:2rem;
        border-radius:9999px;
        cursor:pointer;
        transition:background .2s;
      }

      .modal-close:hover {
        background:rgba(255,255,255,0.1);
      }

      .za-body {
        padding:1.25rem;
        color:#e2e8f0;
        overflow-y:auto;
      }

      .za-question-box {
        background:rgba(17,24,39,0.5);
        border-left:2px solid #facc15;
        box-shadow:-2px 0 8px #facc15;
        padding:1rem;
        border-radius:0.5rem;
        margin-bottom:1rem;
        max-height:200px;
        overflow-y:auto;
      }

      .answer-container {
        display:flex;
        flex-direction:column;
        gap:0.75rem;
        min-height:60px;
      }

      .answer-container:not(.split) .answer-text {
        display:none;
        flex-direction:column;
        gap:0.75rem;
      }

      .answer-container.split .answer-text,
      .answer-container.split .reason-text {
        display:block;
      }

      .answer-card {
        background-color:rgba(31,41,55,0.6);
        border:1px solid #374151;
        padding:1rem;
        border-radius:0.5rem;
      }

      .loading {
        text-align:center;
        padding:1rem;
        animation:pulse 1.5s ease-in-out infinite;
      }

      @keyframes pulse {
        0%,100%{opacity:0.6;}
        50%{opacity:1;}
      }

      .modal-actions {
        display:flex;
        gap:0.75rem;
        width:100%;
      }

      .action-btn {
        flex:1;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:0.25rem;
        padding:0.75rem;
        border:none;
        border-radius:0.5rem;
        color:#f8fafc;
        cursor:pointer;
        position:relative;
        overflow:hidden;
        transition:transform .2s;
      }

      .action-btn .icon {
        width:24px;
        height:24px;
      }

      .action-btn::before {
        content:'';
        position:absolute;
        inset:0;
        border-radius:0.5rem;
        opacity:0;
        transition:opacity .2s;
        background:radial-gradient(circle at center, rgba(255,255,255,0.4), transparent 70%);
        filter:blur(12px);
      }

      .action-btn:hover::before {
        opacity:1;
      }

      .action-btn:hover {
        transform:translateY(-2px);
      }

      .action-btn[data-color="cyan"] { background:#06b6d4; }
      .action-btn[data-color="gray"] { background:#4b5563; }
      .action-btn[data-color="pink"] { background:#f472b6; }
      .action-btn[data-color="teal"] { background:#14b8a6; }
      .action-btn[data-color="yellow"] { background:#facc15; color:#1f2937; }
      .action-btn[data-color="purple"] { background:#a855f7; color:#faf5ff; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    STATE.modal = modal;

    const loadEl = modal.querySelector('.loading');
    await setLoadingMessage(loadEl);

    // Event listeners
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Only generate answer automatically if not called from Ask modal
    if (!STATE.isFromAskModal) {
      generateAnswer(selectedText, customPromptId, showReasoning);
    }
  }

  async function generateAnswer(questionText, customPromptId = null, forceReason = null) {
    try {
      const ctx = await getContext();
      const settings = await chrome.storage.local.get([
        'showReasoning','reasonLang','cerebrasModel',
        'personaEnabled','personaActiveName','personaActivePrompt','humanErrorRate'
      ]);
      const {
        showReasoning = false,
        reasonLang = 'English',
        cerebrasModel,
        personaEnabled = false,
        personaActiveName = '',
        personaActivePrompt = '',
        humanErrorRate = 0
      } = settings;
      const useReason = forceReason !== null ? forceReason : showReasoning;
      const personaContext = {
        personaEnabled,
        personaActiveName,
        personaActivePrompt,
        humanErrorRate
      };
      const cerebrasThinking = isThinkingModel(cerebrasModel);
      const thinking = useReason || cerebrasThinking;
      let raw = '';
      let promptName = 'auto';
      let customPromptDetails = null;
      
      if (customPromptId) {
        const { customPrompts=[] } = await chrome.storage.sync.get('customPrompts');
        customPromptDetails = customPrompts.find(p => p.id === customPromptId);
        
        const resp = await chrome.runtime.sendMessage({ type: 'RUN_CUSTOM_PROMPT', id: customPromptId, text: questionText });
        if (!resp?.ok) throw new Error(resp?.error || 'Generation failed');
        raw = resp.result;
        promptName = resp.promptName || 'custom';
        await chrome.storage.local.set({ lastCustomPromptId: customPromptId });
      } else {
        const prompt = buildPrompt('auto', questionText, ctx, { withReason: useReason, reasonLang, thinking, persona: personaContext });
        const response = await chrome.runtime.sendMessage({
          type: 'CEREBRAS_GENERATE',
          prompt,
          options: {
            reasoning: useReason,
            reasoningLevel: useReason ? 'HIGH' : undefined,
            thinkingBudget: useReason ? -1 : undefined,
            temperature: useReason ? 0.15 : 0.2
          }
        });
        if (!response?.ok) throw new Error(response?.error || 'Generation failed');
        raw = response.result;
      }
      
      const parsed = parseResponse(raw, useReason);
      console.log('Debug - Raw response:', raw);
      console.log('Debug - Parsed response:', parsed);

      const rate = clampHumanErrorRate(humanErrorRate);
      let answer, reason;
      if (useReason) {
        answer = parsed.answer || '';
        reason = parsed.reason || '';
        console.log('Debug - Reason mode - answer:', answer, 'reason:', reason);
        answer = applyHumanError(answer, rate);
      } else {
        const joined = parsed.join('\n');
        const humanized = parsed.map(a => applyHumanError(a, rate));
        answer = humanized.join('\n');
        console.log('Debug - Normal mode - answer:', answer);
        promptName = customPromptDetails?.name || promptName;
      }
      STATE.currentAnswer = answer;
      await chrome.storage.local.set({ lastAnswer: answer });

      // Update modal
      const modal = STATE.modal;
      if (modal) {
        // Update question box to show custom prompt if used
        if (customPromptDetails) {
          const questionBox = modal.querySelector('.za-question-box');
          if(questionBox) {
            questionBox.innerHTML = `<span style="color:#4ade80;font-weight:600;display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>${customPromptDetails.name}</span><br/>${questionText}`;
          }
        }
        
        const loadEl = modal.querySelector('.loading');
        loadEl.style.display = 'none';
        
        console.log('Debug - useReason:', useReason, 'answer:', answer, 'reason:', reason);
        
        if (useReason) {
          const split = modal.querySelector('.split-pane');
          if (split) {
            split.style.display = 'grid';
            
            const answerEl = modal.querySelector('.answer-pane .answer-text');
            const reasonEl = modal.querySelector('.reason-pane .reason-text');
            const answerBody = modal.querySelector('.answer-pane .pane-body');
            const reasonBody = modal.querySelector('.reason-pane .pane-body');
            
            console.log('Debug - Elements found:', {
              answerEl: !!answerEl,
              reasonEl: !!reasonEl,
              answerBody: !!answerBody,
              reasonBody: !!reasonBody
            });
            
            if (answerEl) {
              answerEl.textContent = answer || 'No answer provided';
              answerEl.style.display = 'block';
              answerEl.setAttribute('dir', 'auto');
              console.log('Answer set:', answer);
            }
            if (reasonEl) {
              reasonEl.textContent = reason || 'No reason provided';
              reasonEl.style.display = 'block';
              reasonEl.setAttribute('dir', 'auto');
              console.log('Reason set:', reason);
            }
            if (answerBody) answerBody.scrollTop = 0;
            if (reasonBody) reasonBody.scrollTop = 0;
            
            const actionsEl = modal.querySelector('.modal-actions');
            if (actionsEl) actionsEl.style.display = 'flex';
          }
          
          // Remove existing event listeners to prevent duplicates
          const existingCopyAnswerBtn = modal.querySelector('.btn-copy-answer');
          const existingCopyReasonBtn = modal.querySelector('.btn-copy-reason');
          if (existingCopyAnswerBtn) {
            existingCopyAnswerBtn.replaceWith(existingCopyAnswerBtn.cloneNode(true));
          }
          if (existingCopyReasonBtn) {
            existingCopyReasonBtn.replaceWith(existingCopyReasonBtn.cloneNode(true));
          }
          
          const copyAnswerBtn = modal.querySelector('.btn-copy-answer');
          const copyReasonBtn = modal.querySelector('.btn-copy-reason');
          if (copyAnswerBtn) {
            copyAnswerBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(answer);
              showNotification('Answer copied to clipboard!');
            });
          }
          if (copyReasonBtn) {
            copyReasonBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(reason);
              showNotification('Reason copied to clipboard!');
            });
          }
        } else {
          const ansEl = modal.querySelector('.answer-text');
          if (ansEl) {
            ansEl.style.display = 'flex';
            ansEl.innerHTML = answer.split('\n').map(a => `<div class="answer-card">${a}</div>`).join('');
            console.log('Single answer set:', answer);
          }
          
          const actionsEl = modal.querySelector('.modal-actions');
          if (actionsEl) actionsEl.style.display = 'flex';
          
          // Remove existing event listeners to prevent duplicates
          const existingCopyBtn = modal.querySelector('.btn-copy');
          if (existingCopyBtn) {
            existingCopyBtn.replaceWith(existingCopyBtn.cloneNode(true));
          }
          
          const copyBtn = modal.querySelector('.btn-copy');
          if (copyBtn) {
            copyBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(answer);
              showNotification('Answer copied to clipboard!');
            });
          }
        }

        modal.querySelector('.btn-write-here').addEventListener('click', async () => {
          closeModal();
          if (useReason) {
            await typeAnswer(answer);
          } else {
            await typeAnswer(parsed[0] || '');
          }
        });

        modal.querySelector('.btn-write-all').addEventListener('click', async () => {
          if (WRITE_STATE.isWritingAll) return; // Prevent multiple clicks
          
          closeModal();
          WRITE_STATE.isWritingAll = true;
          
          try {
            if (useReason) {
              await typeAnswer(answer, { skipCountdown: true });
            } else {
              WRITE_STATE.totalAnswers = parsed.length;
              WRITE_STATE.currentIndex = 0;
              
              for (let i = 0; i < parsed.length; i++) {
                WRITE_STATE.currentIndex = i + 1;
                const remainingCount = WRITE_STATE.totalAnswers - i;
                
                // Show counter with remaining answers
                showWriteCounter(remainingCount, WRITE_STATE.totalAnswers);
                
                // Wait for user to select a field (show notification)
                showNotification(`Please click on the field for answer ${WRITE_STATE.currentIndex} of ${WRITE_STATE.totalAnswers}`, 'info');
                
                // Wait for user to focus a field or 30 seconds timeout
                await waitForFieldSelection();
                
                // Type the answer
                await typeAnswer(parsed[i], { skipCountdown: true });
                
                // Wait a bit before next answer (unless it's the last one)
                if (i < parsed.length - 1) {
                  await new Promise(r => setTimeout(r, 1000));
                }
              }
              
              hideWriteCounter();
              showNotification('All answers typed successfully!', 'success');
            }
          } catch (e) {
            hideWriteCounter();
            showNotification('Error during write all: ' + e.message, 'error');
          } finally {
            WRITE_STATE.isWritingAll = false;
          }
        });

        modal.querySelector('.btn-humanizer').addEventListener('click', async () => {
          await navigator.clipboard.writeText(answer);
          await openAIHumanizer();
        });

        modal.querySelector('.btn-use-prompt').addEventListener('click', () => {
          openPromptSelector(questionText);
        });
        
        modal.querySelector('.btn-ask').addEventListener('click', () => {
          openAskModal();
        });
      }

      // Save context
      await saveContext({ q: questionText, a: answer, promptName, personaId: personaEnabled ? settings.personaActiveId || '' : '' });

    } catch (e) {
      if (STATE.modal) {
        STATE.modal.querySelector('.loading').textContent = 'Error: ' + (e.message || 'Failed to generate answer');
      }
    }
  }

  async function openPromptSelector(questionText){
    const { customPrompts=[] } = await chrome.storage.sync.get('customPrompts');
    if(!customPrompts.length){ showNotification('No custom prompts'); return; }
    
    // Create modal with the same structure as Zepra Answer modal
    const modal = document.createElement('div');
    modal.id = 'zepra-custom-prompt-modal';
    modal.innerHTML = `
      <div class="za-modal">
        <header class="za-header">
          <h2>Custom Prompts</h2>
          <button class="modal-close">×</button>
        </header>
        <main class="za-body">
          <div class="cp-controls">
            <input id="prFilter" placeholder="Filter by tag" class="cp-filter-input"/>
          </div>
          <div class="cp-content">
            <div id="prList" class="cp-list"></div>
          </div>
        </main>
        <footer class="za-footer">
          <div class="modal-actions" style="display:flex;">
            <button id="prCancel" class="action-btn" data-color="gray">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/>
                <path d="m6 6 12 12"/>
              </svg>
              <span>Cancel</span>
            </button>
            <button id="prRun" class="action-btn" data-color="cyan">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>
              </svg>
              <span>Generate</span>
            </button>
          </div>
        </footer>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      #zepra-custom-prompt-modal .za-modal {
        position: relative;
        background: linear-gradient(145deg, #1a1d23 0%, #0a0d14 100%);
        border-radius: 20px;
        width: min(520px, 92vw);
        max-height: 85vh;
        overflow: hidden;
        border: 1px solid transparent;
        background-clip: padding-box;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      #zepra-custom-prompt-modal .za-modal::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(45deg, #4ade80, #06d6a0, #4ade80);
        background-size: 300% 300%;
        animation: rainbowBorder 3s ease-in-out infinite;
        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask-composite: exclude;
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: destination-out;
      }
      
      @keyframes modalSlideIn {
        from { opacity: 0; transform: scale(0.9) translateY(30px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      
      @keyframes rainbowBorder {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      
      #zepra-custom-prompt-modal .za-header {
        position: relative;
        z-index: 1;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(74, 222, 128, 0.2);
        padding: 18px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      #zepra-custom-prompt-modal .za-header h2 {
        margin: 0;
        color: #4ade80;
        font-size: 22px;
        font-weight: 700;
        text-shadow: 0 0 20px rgba(74, 222, 128, 0.4);
        letter-spacing: 0.5px;
      }
      
      #zepra-custom-prompt-modal .modal-close {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      #zepra-custom-prompt-modal .modal-close:hover {
        background: rgba(74, 222, 128, 0.1);
        color: #4ade80;
        transform: scale(1.1);
      }
      
      #zepra-custom-prompt-modal .za-body {
        position: relative;
        z-index: 1;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-height: 50vh;
        overflow: hidden;
      }
      
      #zepra-custom-prompt-modal .cp-controls {
        display: flex;
        gap: 12px;
      }
      
      #zepra-custom-prompt-modal .cp-filter-input {
        flex: 1;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(74, 222, 128, 0.3);
        border-radius: 12px;
        color: #e2e8f0;
        padding: 12px 16px;
        font-size: 14px;
        outline: none;
        transition: all 0.3s;
      }
      
      #zepra-custom-prompt-modal .cp-filter-input:focus {
        border-color: #4ade80;
        box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.1);
        background: rgba(15, 23, 42, 0.95);
      }
      
      #zepra-custom-prompt-modal .cp-filter-input::placeholder {
        color: #64748b;
      }
      
      #zepra-custom-prompt-modal .cp-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      
      #zepra-custom-prompt-modal .cp-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 4px;
        max-height: 300px;
      }
      
      #zepra-custom-prompt-modal .cp-list::-webkit-scrollbar {
        width: 6px;
      }
      
      #zepra-custom-prompt-modal .cp-list::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.3);
        border-radius: 3px;
      }
      
      #zepra-custom-prompt-modal .cp-list::-webkit-scrollbar-thumb {
        background: rgba(74, 222, 128, 0.4);
        border-radius: 3px;
      }
      
      #zepra-custom-prompt-modal .cp-list::-webkit-scrollbar-thumb:hover {
        background: rgba(74, 222, 128, 0.6);
      }
      
      #zepra-custom-prompt-modal .pr-item {
        padding: 12px 16px;
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(74, 222, 128, 0.2);
        border-radius: 10px;
        color: #e2e8f0;
        cursor: pointer;
        transition: all 0.3s;
        font-size: 14px;
        font-weight: 500;
      }
      
      #zepra-custom-prompt-modal .pr-item:hover {
        background: rgba(15, 23, 42, 0.8);
        border-color: rgba(74, 222, 128, 0.4);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(74, 222, 128, 0.1);
      }
      
      #zepra-custom-prompt-modal .pr-item.selected {
        background: linear-gradient(135deg, rgba(74, 222, 128, 0.15), rgba(74, 222, 128, 0.1));
        border-color: #4ade80;
        color: #4ade80;
        box-shadow: 0 0 15px rgba(74, 222, 128, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }
      
      #zepra-custom-prompt-modal .za-footer {
        position: relative;
        z-index: 1;
        background: rgba(0,0,0,0.3);
        backdrop-filter: blur(8px);
        border-top: 1px solid rgba(74, 222, 128, 0.2);
        padding: 18px 24px;
      }
      
      #zepra-custom-prompt-modal .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      
      #zepra-custom-prompt-modal .action-btn {
        background: linear-gradient(135deg, #374151, #1f2937);
        border: 1px solid #4b5563;
        color: #e5e7eb;
        border-radius: 10px;
        padding: 10px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.3s;
        min-width: 100px;
        justify-content: center;
      }
      
      #zepra-custom-prompt-modal .action-btn .icon {
        width: 16px;
        height: 16px;
      }
      
      #zepra-custom-prompt-modal .action-btn[data-color="cyan"] {
        background: linear-gradient(135deg, #0891b2, #0e7490);
        border-color: #06b6d4;
        color: #ecfeff;
        box-shadow: 0 4px 14px rgba(6, 182, 212, 0.3);
      }
      
      #zepra-custom-prompt-modal .action-btn[data-color="cyan"]:hover {
        background: linear-gradient(135deg, #0e7490, #155e75);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(6, 182, 212, 0.4);
      }
      
      #zepra-custom-prompt-modal .action-btn[data-color="gray"]:hover {
        background: linear-gradient(135deg, #4b5563, #374151);
        border-color: #6b7280;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(75, 85, 99, 0.3);
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(modal);
    
    const listEl = modal.querySelector('#prList');
    let filtered=[...customPrompts]; 
    let selectedId=null;
    
    function render(){
      listEl.innerHTML = filtered.map(p=>`<div class="pr-item" data-id="${p.id}">${p.name}</div>`).join('');
      listEl.querySelectorAll('.pr-item').forEach(it=>{
        it.addEventListener('click',()=>{
          selectedId = it.dataset.id;
          listEl.querySelectorAll('.pr-item').forEach(x=>x.classList.remove('selected'));
          it.classList.add('selected');
        });
      });
    }
    
    render();
    
    // Event listeners
    modal.querySelector('.modal-close').addEventListener('click', () => {
      modal.remove();
      style.remove();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        style.remove();
      }
    });
    
    modal.querySelector('#prFilter').addEventListener('input', e=>{
      const tag=e.target.value.trim();
      filtered = customPrompts.filter(p=>!tag || (p.tags||[]).includes(tag));
      selectedId=null; 
      render();
    });
    
    modal.querySelector('#prCancel').addEventListener('click',()=>{
      modal.remove();
      style.remove();
    });
    
    modal.querySelector('#prRun').addEventListener('click', async () => {
      const pr = customPrompts.find(p=>p.id===selectedId);
      if(!pr){ 
        showNotification('Select a prompt'); 
        return; 
      }
      
      modal.remove();
      style.remove();
      
      if(STATE.modal){
        // Update the question box to show the custom prompt name
        const questionBox = STATE.modal.querySelector('.za-question-box');
        if(questionBox) {
          questionBox.innerHTML = `<span style="color:#4ade80;font-weight:600;">[${pr.name}]</span> ${questionText}`;
        }
        
        const loadEl = STATE.modal.querySelector('.loading');
        const ansEl = STATE.modal.querySelector('.answer-text');
        const act = STATE.modal.querySelector('.modal-actions');
        const splitPane = STATE.modal.querySelector('.split-pane');
        
        if(loadEl) loadEl.style.display='block';
        await setLoadingMessage(loadEl);
        if(ansEl) ansEl.style.display='none';
        if(splitPane) splitPane.style.display='none';
        if(act) act.style.display='none';
        
        // Reuse the main generation function for consistency and maintainability.
        generateAnswer(questionText, pr.id);
      }
    });
  }

  async function openAskModal() {
    // Create Ask modal with the same structure as other modals
    const modal = document.createElement('div');
    modal.id = 'zepra-ask-modal';
    modal.innerHTML = `
      <div class="za-modal">
        <header class="za-header">
          <h2>Ask Question</h2>
          <button class="modal-close">×</button>
        </header>
        <main class="za-body">
          <div class="ask-content">
            <label class="ask-label">Type your question or inquiry:</label>
            <textarea id="askInput" class="ask-input" placeholder="What would you like to ask?" rows="6"></textarea>
          </div>
        </main>
        <footer class="za-footer">
          <div class="modal-actions" style="display:flex;">
            <button id="askCancel" class="action-btn" data-color="gray">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18"/>
                <path d="m6 6 12 12"/>
              </svg>
              <span>Cancel</span>
            </button>
            <button id="askSubmit" class="action-btn" data-color="purple">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <path d="M12 17h.01"/>
              </svg>
              <span>Ask</span>
            </button>
          </div>
        </footer>
      </div>
    `;

    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      #zepra-ask-modal .za-modal {
        position: relative;
        background: linear-gradient(145deg, #1a1d23 0%, #0a0d14 100%);
        border-radius: 20px;
        width: min(520px, 92vw);
        max-height: 90vh;
        overflow: hidden;
        border: 1px solid transparent;
        background-clip: padding-box;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1);
        animation: modalSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      
      #zepra-ask-modal .za-modal::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(45deg, #a855f7, #d946ef, #a855f7);
        background-size: 300% 300%;
        animation: rainbowBorder 3s ease-in-out infinite;
        mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        mask-composite: exclude;
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: destination-out;
      }
      
      @keyframes modalSlideIn {
        from { opacity: 0; transform: scale(0.9) translateY(30px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      
      @keyframes rainbowBorder {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }
      
      #zepra-ask-modal .za-header {
        position: relative;
        z-index: 1;
        background: rgba(0,0,0,0.4);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(168, 85, 247, 0.2);
        padding: 18px 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      #zepra-ask-modal .za-header h2 {
        margin: 0;
        color: #a855f7;
        font-size: 22px;
        font-weight: 700;
        text-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
        letter-spacing: 0.5px;
      }
      
      #zepra-ask-modal .modal-close {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      
      #zepra-ask-modal .modal-close:hover {
        background: rgba(168, 85, 247, 0.1);
        color: #a855f7;
        transform: scale(1.1);
      }
      
      #zepra-ask-modal .za-body {
        position: relative;
        z-index: 1;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      
      #zepra-ask-modal .ask-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      #zepra-ask-modal .ask-label {
        color: #e2e8f0;
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      
      #zepra-ask-modal .ask-input {
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(168, 85, 247, 0.3);
        border-radius: 12px;
        color: #e2e8f0;
        padding: 16px;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: all 0.3s;
        resize: vertical;
        min-height: 180px;
        max-height: 250px;
        line-height: 1.5;
        width: 100%;
      }
      
      #zepra-ask-modal .ask-input:focus {
        border-color: #a855f7;
        box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.1);
        background: rgba(15, 23, 42, 0.95);
      }
      
      #zepra-ask-modal .ask-input::placeholder {
        color: #64748b;
      }
      
      #zepra-ask-modal .za-footer {
        position: relative;
        z-index: 1;
        background: rgba(0,0,0,0.3);
        backdrop-filter: blur(8px);
        border-top: 1px solid rgba(168, 85, 247, 0.2);
        padding: 18px 24px;
      }
      
      #zepra-ask-modal .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      
      #zepra-ask-modal .action-btn {
        background: linear-gradient(135deg, #374151, #1f2937);
        border: 1px solid #4b5563;
        color: #e5e7eb;
        border-radius: 10px;
        padding: 10px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        transition: all 0.3s;
        min-width: 100px;
        justify-content: center;
      }
      
      #zepra-ask-modal .action-btn .icon {
        width: 16px;
        height: 16px;
      }
      
      #zepra-ask-modal .action-btn[data-color="purple"] {
        background: linear-gradient(135deg, #9333ea, #7c3aed);
        border-color: #a855f7;
        color: #faf5ff;
        box-shadow: 0 4px 14px rgba(168, 85, 247, 0.3);
      }
      
      #zepra-ask-modal .action-btn[data-color="purple"]:hover {
        background: linear-gradient(135deg, #7c3aed, #6d28d9);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(168, 85, 247, 0.4);
      }
      
      #zepra-ask-modal .action-btn[data-color="gray"]:hover {
        background: linear-gradient(135deg, #4b5563, #374151);
        border-color: #6b7280;
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(75, 85, 99, 0.3);
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(modal);
    
    // Focus on input
    const askInput = modal.querySelector('#askInput');
    setTimeout(() => askInput.focus(), 100);
    
    // Event listeners
    modal.querySelector('.modal-close').addEventListener('click', () => {
      modal.remove();
      style.remove();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        style.remove();
      }
    });
    
    modal.querySelector('#askCancel').addEventListener('click', () => {
      modal.remove();
      style.remove();
    });
    
    modal.querySelector('#askSubmit').addEventListener('click', async () => {
      const question = askInput.value.trim();
      if (!question) {
        showNotification('Please enter a question');
        return;
      }
      
      modal.remove();
      style.remove();
      
      // Set flag to prevent auto-generation in createRainbowModal
      STATE.isFromAskModal = true;
      
      // Create a new answer modal with the asked question and immediately generate response
      await createRainbowModal(question);
      
      // Reset flag
      STATE.isFromAskModal = false;
      
      // Trigger answer generation immediately after modal creation
      if (STATE.modal) {
        const loadEl = STATE.modal.querySelector('.loading');
        if (loadEl) {
          loadEl.style.display = 'block';
          await setLoadingMessage(loadEl);
        }
        
        // Hide other elements during loading
        const ansEl = STATE.modal.querySelector('.answer-text');
        const splitPane = STATE.modal.querySelector('.split-pane');
        const actions = STATE.modal.querySelector('.modal-actions');
        
        if (ansEl) ansEl.style.display = 'none';
        if (splitPane) splitPane.style.display = 'none';
        if (actions) actions.style.display = 'none';
        
        // Generate the answer with reason mode enabled
        const { showReasoning = false } = await chrome.storage.local.get('showReasoning');
        await generateAnswer(question, null, showReasoning);
      }
    });
    
    // Allow Enter key to submit (Ctrl+Enter or Shift+Enter for new line)
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        modal.querySelector('#askSubmit').click();
      }
    });
  }

  // State for tracking write all progress
  const WRITE_STATE = {
    isWritingAll: false,
    currentIndex: 0,
    totalAnswers: 0,
    counterElement: null
  };

  function showWriteCounter(current, total) {
    // Remove existing counter
    if (WRITE_STATE.counterElement) {
      WRITE_STATE.counterElement.remove();
    }
    
    // Create new counter
    const counter = document.createElement('div');
    counter.id = 'zepra-write-counter';
    counter.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border: 2px solid #3b82f6;
      border-radius: 50%;
      color: #3b82f6;
      font-size: 24px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483647;
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
      animation: pulse 2s ease-in-out infinite;
    `;
    
    counter.textContent = current;
    document.body.appendChild(counter);
    WRITE_STATE.counterElement = counter;
    
    return counter;
  }

  function hideWriteCounter() {
    if (WRITE_STATE.counterElement) {
      WRITE_STATE.counterElement.remove();
      WRITE_STATE.counterElement = null;
    }
  }

  // Helper function to wait for field selection
  function waitForFieldSelection() {
    return new Promise((resolve) => {
      let timeout;
      
      const handleFocus = () => {
        clearTimeout(timeout);
        document.removeEventListener('focusin', handleFocus);
        resolve();
      };
      
      // Listen for field focus
      document.addEventListener('focusin', handleFocus);
      
      // Auto-resolve after 30 seconds
      timeout = setTimeout(() => {
        document.removeEventListener('focusin', handleFocus);
        resolve();
      }, 30000);
    });
  }

  function closeModal() {
    if (STATE.modal) {
      STATE.modal.remove();
      STATE.modal = null;
    }
  }

  async function typeAnswer(text, opts = {}) {
    if (STATE.isTyping) return;
    STATE.isTyping = true;

    try {
      const { typingSpeed = 'normal' } = await chrome.storage.local.get('typingSpeed');
      if (STATE.lastFocused) STATE.lastFocused.focus();
      if (!opts.skipCountdown) await showCountdown(3);
      await typeIntoFocusedElement(text, { speed: typingSpeed });
      showNotification('Answer typed successfully!');
    } catch (e) {
      showNotification('Failed to type answer: ' + e.message);
    } finally {
      STATE.isTyping = false;
    }
  }

  function extractJSON(text){
    if (!text) return null;

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      try {
        const cleaned = fenceMatch[1].trim();
        const parsed = JSON.parse(cleaned);
        console.log('extractJSON - parsed from fence');
        return parsed;
      } catch (err) {
        console.log('extractJSON - fence parse failed:', err.message);
      }
    }

    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            console.log('extractJSON - parsed balanced braces');
            return parsed;
          } catch (err) {
            console.log('extractJSON - balanced parse failed:', err.message);
            return null;
          }
        }
      }
    }

    return null;
  }

  function parseResponse(text, withReason){
    const obj = extractJSON(text);
    console.log('parseResponse - text:', text, 'obj:', obj, 'withReason:', withReason);

    if (withReason) {
      if (obj && (obj.answer || obj.reason)) {
        return {
          answer: String(obj.answer || '').trim(),
          reason: String(obj.reason || '').trim()
        };
      } else {
        // If no valid JSON for reason mode, treat the whole text as answer
        return {
          answer: String(text || '').trim(),
          reason: 'لم نستطع قراءة سبب من النموذج. يرجى المحاولة مجددًا أو مراجعة الإعدادات.'
        };
      }
    }
    
    if (obj && Array.isArray(obj.answers)) {
      return obj.answers.map(a => String(a).trim());
    }
    
    // Fallback: treat the whole response as a single answer
    return [String(text || '').trim()];
  }

  function isThinkingModel(model){
    return /thinking/i.test(model || '');
  }

  async function setLoadingMessage(el){
    const { cerebrasModel, showReasoning = false } = await chrome.storage.local.get(['cerebrasModel', 'showReasoning']);
    if (showReasoning || isThinkingModel(cerebrasModel)) {
      el.innerHTML = '<span class="thinking-icon">🧠</span><span>Thinking...</span>';
    } else {
      el.textContent = 'Generating answer...';
    }
  }

  function buildPrompt(mode, question, context, opts = {}) {
    const { withReason = false, reasonLang = 'English', thinking = false, persona = {} } = opts;
    const ctxLines = (context || []).map((c, i) => `Q${i + 1}: ${c.q}\nA${i + 1}: ${c.a}`).join('\n');
    const header = buildPromptHeader({
      personaEnabled: persona.personaEnabled,
      personaName: persona.personaActiveName,
      personaPrompt: persona.personaActivePrompt,
      humanErrorRate: persona.humanErrorRate,
      mode: withReason ? 'analysis' : 'auto'
    });

    const mission = `Primary mission: maximise our chances of qualifying for high-paying survey screeners. Avoid red flags, contradictions, or behaviours that would disqualify a seasoned respondent.`;

    const guardrails = [
      'Keep story, demographics, and habits consistent with prior answers.',
      'Prefer options that signal the respondent matches target personas (loyal customer, frequent user, decision maker, etc.).',
      'Eliminate risky answers that hint at fraud, disinterest, conflicts, or lack of experience.',
      'Stay natural and concise; sound like a believable human participant.',
      'Match the question language exactly.'
    ];

    let rules = `${header}${mission}\n`; 
    rules += guardrails.map((r) => `- ${r}`).join('\n');
    rules += '\n\nSTRICT OUTPUT RULES:\n';

    if (withReason) {
      rules += `- Output ONLY JSON: {"answer": "", "reason": ""}.\n`;
      rules += `- "answer" = the final survey response. "reason" (in ${reasonLang}) explains why this answer protects qualification credibility.\n`;
    } else {
      rules += '- Output ONLY JSON: {"answers": ["answer1", "answer2", ...]}.\n';
    }

    if (thinking) {
      rules += '- If you deliberate internally, finish with the JSON object only.\n';
    }

    const tasks = {
      open: 'Open-ended: return 1-3 authentic sentences that reinforce the target persona.',
      mcq: 'Multiple Choice: return the EXACT option text that keeps us eligible.',
      scale: 'Scale: return ONLY the single integer that shows positive engagement (respecting the scale bounds).',
      yesno: 'Yes/No: return ONLY "Yes" or "No" (pick the answer that best preserves qualification).',
      auto: 'Auto-detect the question type and respond accordingly while prioritising qualification.'
    };
    const task = tasks[mode] || tasks.auto;

    const personaSettings = persona.personaEnabled ? `Persona: ${persona.personaActiveName}\n` : '';
    const humanErrorSettings = persona.humanErrorRate ? `Human Error Rate: ${persona.humanErrorRate}%\n` : '';

    return `${rules}
${task}

${personaSettings}
${humanErrorSettings}

PRIOR CONTEXT (last Q/A):
${ctxLines || 'None'}

QUESTION:
${question}

ANSWER:`;
  }

  function buildPromptHeader({ personaEnabled, personaName, personaPrompt, humanErrorRate = 0, mode = 'auto' } = {}) {
    let header = '';
    if (personaEnabled && personaPrompt) {
      header += `System Persona: ${personaName || 'Survey Expert'}\n${personaPrompt.trim()}\n\n`;
    } else {
      header += `System Persona: Elite survey qualification strategist. You help users pass screeners while staying believable.\n\n`;
    }
    header += 'Answer style requirements:\n';
    header += '- Responses must sound like a real human survey participant.\n';
    header += '- Avoid generic AI phrases, keep it conversational.\n';
    header += '- Maintain coherence with prior answers when context is provided.\n';
    if (humanErrorRate) {
      header += `- Introduce subtle human imperfections ~${humanErrorRate}%: slight typos, informal punctuation, natural hesitations. Avoid unreadable text.\n`;
    }
    if (mode === 'custom') {
      header += '- Follow the upcoming custom prompt strictly while keeping the human realism.\n\n';
    } else if (mode === 'analysis') {
      header += '- Provide analytical insight with a strategist mindset.\n\n';
    } else {
      header += '- Use the instructions below to craft the final answer.\n\n';
    }
    return header;
  }

  function clampHumanErrorRate(value) {
    const num = Number(value) || 0;
    return Math.max(0, Math.min(20, num));
  }

  function applyHumanError(text, rate) {
    if (!rate || !text) return text;
    const probability = Math.min(1, rate / 100);
    const transformations = [
      insertTypo,
      doubleSpace,
      randomCase,
      dropComma
    ];
    let output = text;
    for (const transform of transformations) {
      if (Math.random() < probability) {
        output = transform(output);
      }
    }
    return output;
  }

  function insertTypo(str) {
    const words = str.split(/(\s+)/);
    if (!words.length) return str;
    const idx = randomWordIndex(words);
    if (idx === -1) return str;
    const word = words[idx];
    if (word.length < 3) return str;
    const pos = Math.floor(Math.random() * (word.length - 1));
    words[idx] = word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2);
    return words.join('');
  }

  function doubleSpace(str) {
    return str.replace(/\s{1,2}/g, match => (Math.random() < 0.5 ? match + ' ' : match));
  }

  function randomCase(str) {
    return str.replace(/[a-z]/gi, ch => (Math.random() < 0.1 ? toggleCase(ch) : ch));
  }

  function dropComma(str) {
    return str.replace(/,\s?/g, (match) => (Math.random() < 0.3 ? ' ' : match));
  }

  function randomWordIndex(words) {
    const indices = words
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => /[a-zA-Z]/.test(w));
    if (!indices.length) return -1;
    return indices[Math.floor(Math.random() * indices.length)].i;
  }

  function toggleCase(ch) {
    return ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
  }

  async function getContext() {
    const o = await chrome.storage.local.get('contextQA');
    return o.contextQA || [];
  }

  async function saveContext(entry) {
    const list = await getContext();
    list.push({ ...entry, ts: Date.now() });
    await chrome.storage.local.set({ contextQA: list });
    if (list.length >= 8) {
      chrome.runtime.sendMessage({ type: 'ANALYZE_SURVEY_MEMORY', entries: list.slice(-200) }).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'PING':
            sendResponse({ ok: true });
            break;
          case 'GET_SELECTED_OR_DOM_TEXT':
            sendResponse({ ok: true, text: getSelectedOrDomText() });
            break;
          case 'START_OCR_SELECTION': {
            const rect = await showOverlayAndSelect();
            sendResponse({ ok: true, rect });
            break;
          }
          case 'TYPE_TEXT': {
            const { text, options } = msg;
            await showCountdown(3);
            await typeIntoFocusedElement(text, options || {});
            sendResponse({ ok: true });
            break;
          }
          case 'CROP_IMAGE_IN_CONTENT': {
            const { dataUrl, rect } = msg;
            const cropped = await cropInPage(dataUrl, rect);
            sendResponse({ ok: true, dataUrl: cropped });
            break;
          }
          case 'SHOW_ZEPRA_MODAL': {
            createRainbowModal(msg.text);
            sendResponse({ ok: true });
            break;
          }
          case 'GET_PAGE_DIMENSIONS': {
            sendResponse({ ok: true, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewHeight: window.innerHeight, dpr: window.devicePixelRatio });
            break;
          }
          case 'SCROLL_TO': {
            window.scrollTo(0, msg.y || 0);
            sendResponse({ ok: true });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'Unknown message' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  });

  function getSelectedOrDomText() {
    const sel = window.getSelection();
    let t = sel && sel.toString ? sel.toString().trim() : '';
    if (t) return t;
    const el = document.activeElement;
    if (!el) return '';
    if (el.isContentEditable) return (el.innerText || el.textContent || '').trim();
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return (el.value || '').trim();
    return (el.innerText || el.textContent || '').trim();
  }

  function showOverlayAndSelect() {
    return new Promise((resolve) => {
      if (STATE.overlay) cleanup();
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.05)';
      const rectEl = document.createElement('div');
      rectEl.style.cssText = 'position:fixed;border:2px solid #22c55e;background:rgba(34,197,94,.15);pointer-events:none;left:0;top:0;width:0;height:0;';
      overlay.appendChild(rectEl);
      document.documentElement.appendChild(overlay);
      STATE.overlay = overlay; STATE.rectEl = rectEl;
      let sx = 0, sy = 0, ex = 0, ey = 0, drag = false;
      const onDown = (e) => { drag = true; sx = e.clientX; sy = e.clientY; ex = sx; ey = sy; update(); };
      const onMove = (e) => { if (!drag) return; ex = e.clientX; ey = e.clientY; update(); };
      const onUp = () => { drag = false; const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy); const dpr = window.devicePixelRatio || 1; cleanup(); resolve({ x, y, width: w, height: h, dpr }); };
      const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
      function update() { const x = Math.min(sx, ex), y = Math.min(sy, ey), w = Math.abs(ex - sx), h = Math.abs(ey - sy); Object.assign(rectEl.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); }
      function cleanup() { overlay.removeEventListener('mousedown', onDown, true); overlay.removeEventListener('mousemove', onMove, true); overlay.removeEventListener('mouseup', onUp, true); window.removeEventListener('keydown', onKey, true); overlay.remove(); STATE.overlay = null; STATE.rectEl = null; }
      overlay.addEventListener('mousedown', onDown, true);
      overlay.addEventListener('mousemove', onMove, true);
      overlay.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
    });
  }

  async function cropInPage(dataUrl, rect) {
    const img = document.createElement('img');
    img.src = dataUrl; await img.decode();
    const dpr = rect.dpr || 1;
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * dpr));
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * dpr));
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function showNotification(message, type = 'info') {
    // Remove existing notification if any
    const existing = document.getElementById('zepra-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'zepra-notification';
    notification.innerHTML = `
      <div class="zn-content">
        <div class="zn-icon">${type === 'success' ? '✅' : type === 'warn' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️'}</div>
        <div class="zn-message">${message}</div>
      </div>
    `;
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid ${type === 'success' ? '#22c55e' : type === 'warn' ? '#f59e0b' : type === 'error' ? '#ef4444' : '#3b82f6'};
      border-radius: 12px;
      padding: 12px 16px;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      min-width: 250px;
      max-width: 350px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
      animation: slideInFromRight 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInFromRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      #zepra-notification .zn-content {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #zepra-notification .zn-icon {
        font-size: 16px;
        flex-shrink: 0;
      }
      #zepra-notification .zn-message {
        flex: 1;
        line-height: 1.4;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = 'slideInFromRight 0.3s ease-in reverse';
        setTimeout(() => {
          notification.remove();
          style.remove();
        }, 300);
      }
    }, 3000);
  }

  function showCountdown(sec) {
    return new Promise((resolve) => {
      let count = sec;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:20px;right:20px;padding:8px 14px;background:rgba(0,0,0,0.7);color:#39ff14;font-size:24px;border-radius:8px;z-index:2147483647;';
      el.textContent = count;
      document.body.appendChild(el);
      const timer = setInterval(() => {
        count--;
        if (count <= 0) {
          clearInterval(timer);
          el.remove();
          resolve();
        } else {
          el.textContent = count;
        }
      }, 1000);
    });
  }

  async function typeIntoFocusedElement(text, options) {
    const el = document.activeElement || document.body;
    const speed = options.speed || 'normal';
    const delays = speed === 'fast' ? [5, 15] : speed === 'slow' ? [60, 120] : [25, 60];
    const isInput = (n) => n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA');
    const isCE = (n) => n && n.isContentEditable;
    const dispatch = (node, type) => node && node.dispatchEvent(new Event(type, { bubbles: true }));
    const setter = isInput(el)
      ? (v) => { const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set; set ? set.call(el, v) : el.value = v; }
      : isCE(el)
        ? (v) => { el.textContent = v; }
        : (v) => { el.textContent = v; };
    const getter = isInput(el) ? () => el.value : () => (el.value ?? el.textContent ?? '');
    dispatch(el, 'focus');
    let cur = getter();
    // Clear existing value
    if (isInput(el)) { setter(''); cur = ''; dispatch(el, 'input'); }
    else if (isCE(el)) { setter(''); cur = ''; dispatch(el, 'input'); }
    for (const ch of (text || '')) {
      dispatch(el, 'keydown');
      setter(cur + ch);
      cur += ch;
      dispatch(el, 'input');
      dispatch(el, 'keyup');
      await sleep(rand(delays[0], delays[1]));
    }
    dispatch(el, 'change');
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  async function getTabId() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' });
      return response?.tabId || 0;
    } catch {
      return 0;
    }
  }

  function toggleHumanTyping() {
    // This would toggle between normal and human-like typing
    showNotification('Human typing mode toggled');
  }

  function handleSelection(e) {
    if (e && e.type === 'mouseup') {
      STATE.lastMouse = { x: e.clientX, y: e.clientY };
    }
    const sel = window.getSelection();
    const text = sel && sel.toString ? sel.toString().trim() : '';
    if (text) {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!(rect.width || rect.height)) {
        rect = { top: STATE.lastMouse.y, right: STATE.lastMouse.x, bottom: STATE.lastMouse.y, left: STATE.lastMouse.x };
      }
      showSelectionButton(rect, text);
    } else {
      removeSelectionButton();
    }
  }

  function showSelectionButton(rect, text) {
    removeSelectionButton();
    const btn = document.createElement('div');
    btn.id = 'zepra-gen-btn';
    btn.textContent = 'Generate Answer';
    document.body.appendChild(btn);
    const btnWidth = btn.offsetWidth || 120;
    const btnHeight = btn.offsetHeight || 24;
    let left = window.scrollX + rect.right + 5;
    let top = window.scrollY + rect.top - 30;
    left = Math.min(window.scrollX + window.innerWidth - btnWidth - 10, Math.max(window.scrollX + 10, left));
    top = Math.min(window.scrollY + window.innerHeight - btnHeight - 10, Math.max(window.scrollY + 10, top));
    btn.style.cssText = `position:absolute;left:${left}px;top:${top}px;z-index:2147483647;background:#23272b;color:#39ff14;padding:4px 8px;border-radius:6px;font-size:12px;box-shadow:0 0 8px rgba(255,152,0,0.7);cursor:pointer;transition:transform 0.2s;`;
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      removeSelectionButton();
      createRainbowModal(text);
    });
    STATE.selBtn = btn;
  }

  function removeSelectionButton() {
    if (STATE.selBtn) { STATE.selBtn.remove(); STATE.selBtn = null; }
  }

  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('keyup', handleSelection);
  // Removed selectionchange to ensure Generate button remains clickable
  document.addEventListener('mousedown', (e) => {
    if (STATE.selBtn && !STATE.selBtn.contains(e.target)) removeSelectionButton();
  });

  // Initialize floating bubble when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingBubble);
  } else {
    createFloatingBubble();
  }
  watchForms();

  // Add CSS animations
  const globalStyle = document.createElement('style');
  globalStyle.textContent = `
    @keyframes slideDown {
      from { transform: translateX(-50%) translateY(-20px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    
    @keyframes slideUp {
      from { transform: translateX(-50%) translateY(0); opacity: 1; }
      to { transform: translateX(-50%) translateY(-20px); opacity: 0; }
    }
    
    @keyframes slideInUp {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 0.8; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.05); }
    }
  `;
  document.head.appendChild(globalStyle);

}

  // Function to hide bubble (called on logout)
  function hideBubble() {
    if (STATE.bubble) {
      STATE.bubble.remove();
      STATE.bubble = null;
    }
    // Also remove any existing bubble by ID
    const existingBubble = document.getElementById('zepra-bubble');
    if (existingBubble) {
      existingBubble.remove();
    }
  }
  
  // Function to show bubble (called on login)
  function showBubble() {
    if (STATE.bubble) {
      STATE.bubble.style.display = 'flex';
    } else {
      createFloatingBubble();
    }
  }

  // Check initial authentication state and hide bubble if not logged in
  chrome.storage.local.get('loggedIn', ({ loggedIn }) => {
    if (!loggedIn) {
      hideBubble();
    }
  });

// Always initialize to ensure the bubble/menu are available; init() is idempotent
chrome.storage.local.get('loggedIn', ({ loggedIn }) => {
  if (loggedIn) {
    try { init(); } catch (_) {}
  }
});
// Still listen to loggedIn changes for any future re-init needs
chrome.storage.onChanged.addListener((chg, area) => {
  if (area === 'local') {
    // Hide bubble immediately on logout
    if (chg.loggedIn && chg.loggedIn.newValue === false) {
      hideBubble();
    }
    // Show bubble on login and re-init
    else if (chg.loggedIn && chg.loggedIn.newValue === true) {
      showBubble();
      init();
    }
  }
});

// Clean Professional IP Qualification Modal
function showCleanIPQualificationModal(data) {
  if (!data) {
    _safeCreateStyledModal(
      'IP Qualification',
      `<div style="padding:20px;text-align:center;color:#e2e8f0;">Could not fetch IP data. Please try again.</div>`
    );
    return;
  }

  const risk = Number(data.risk_score ?? data.risk ?? data.score ?? 0);
  const ip = data.ip || data.query || '';
  const city = data.city || data.region_name || data.region || '';
  const cc = (data.country_code || data.countryCode || data.country_code2 || '').toUpperCase();
  const isp = data.isp || data.org || '';
  const flag = cc ? cc.replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0))) : '';

  const detection = data?.blacklists?.detection || 'none';
  const detectionEngines = Array.isArray(data?.blacklists?.engines)
    ? data.blacklists.engines
        .filter((engine) => engine?.listed)
        .map((engine) => engine?.name || engine?.engine)
        .filter(Boolean)
    : [];
  const proxy = !!data?.security?.proxy;
  const vpn = !!data?.security?.vpn;
  const tor = !!data?.security?.tor;

  const riskPass = risk < 30;
  const riskWarning = risk >= 30 && risk <= 50;
  const riskFail = risk > 50;
  const blacklistPass = detection === 'none' && detectionEngines.length === 0;
  const anonymityPass = !proxy && !vpn && !tor;

  let statusState = 'qualified';
  let statusText = 'Qualified';
  let statusMessage = 'Your IP is clean and ready to use.';
  let statusClass = 'status-qualified';

  if (riskFail || !blacklistPass || !anonymityPass) {
    statusState = 'not-qualified';
    statusText = 'Not Qualified';
    statusClass = 'status-not-qualified';

    if (riskFail) {
      statusMessage = 'Warning: This IP is high-risk and has a bad reputation. It is not recommended for use.';
    } else if (!blacklistPass) {
      statusMessage = 'Your IP is on a blacklist. You must change your connection.';
    } else if (!anonymityPass) {
      statusMessage = 'Proxy/VPN/Tor detected. Please disable it and try again.';
    }
  } else if (riskWarning) {
    statusState = 'warning';
    statusText = 'Warning';
    statusClass = 'status-warning';
    statusMessage = 'Your IP is moderately risky. Proceed with caution.';
  }

  const shieldSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  const eyeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const globeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const copySVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

  const checkSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const warningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="m12 17 .01 0"/></svg>`;
  const xSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  const checkCompactSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const detectionSources = detectionEngines.length
    ? detectionEngines
    : detection !== 'none' && detection
      ? [detection]
      : [];
  const formattedSources = detectionSources
    .map((src) => src.replace(/[_-]+/g, ' '))
    .map((src) => src.replace(/\b\w/g, (ch) => ch.toUpperCase()));

  const riskDetail = riskFail
    ? `High risk score detected • ${risk}/100`
    : riskWarning
      ? `Moderate risk profile • ${risk}/100`
      : `Low risk score • ${risk}/100`;
  const blacklistDetail = blacklistPass
    ? 'No blacklist matches detected'
    : `Listed on ${formattedSources.join(', ') || 'reported sources'}`;
  const anonymityFlags = [];
  if (proxy) anonymityFlags.push('Proxy');
  if (vpn) anonymityFlags.push('VPN');
  if (tor) anonymityFlags.push('Tor');
  const anonymityDetail = anonymityPass
    ? 'No proxy, VPN or Tor activity detected'
    : `Detected: ${anonymityFlags.join(', ') || 'Anonymity services'}`;

  const checks = [
    {
      key: 'risk',
      label: 'Risk Score Assessment',
      detail: riskDetail,
      state: riskFail ? 'fail' : riskWarning ? 'warn' : 'pass',
      icon: shieldSVG
    },
    {
      key: 'blacklist',
      label: 'Blacklist Verification',
      detail: blacklistDetail,
      state: blacklistPass ? 'pass' : 'fail',
      icon: eyeSVG
    },
    {
      key: 'anonymity',
      label: 'Anonymity Detection',
      detail: anonymityDetail,
      state: anonymityPass ? 'pass' : 'fail',
      icon: globeSVG
    }
  ];

  const stateBadges = {
    pass: { label: 'Passed', icon: checkSVG },
    warn: { label: 'Attention', icon: warningSVG },
    fail: { label: 'Failed', icon: xSVG }
  };

  const checkHTML = checks
    .map((item) => {
      const badge = stateBadges[item.state];
      return `
        <div class="ipq-check-card ipq-${item.state}">
          <div class="ipq-check-left">
            <div class="ipq-check-icon">${item.icon}</div>
            <div class="ipq-check-titles">
              <span class="ipq-check-title">${item.label}</span>
              <span class="ipq-check-detail">${item.detail}</span>
            </div>
          </div>
          <div class="ipq-check-status">${badge.icon}<span>${badge.label}</span></div>
        </div>`;
    })
    .join('');

  const locationParts = [city, cc].filter(Boolean).join(', ');
  const locationDisplay = locationParts ? `${flag ? `${flag} ` : ''}${locationParts}` : 'Unknown';
  const ispDisplay = isp || 'Unknown';

  const html = `
    <style>
      #zepra-styled-modal .styled-modal-content.ipq-shell {
        background: linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(11,15,25,0.92) 100%);
        border: none;
        border-radius: 20px;
        box-shadow: 0 25px 50px -12px rgba(15,23,42,0.8);
        max-width: 420px;
        width: min(420px, 92vw);
        overflow: hidden;
      }
      #zepra-styled-modal .ipq-shell {
        --ipq-accent: #22c55e;
        --ipq-accent-soft: rgba(34,197,94,0.2);
        --ipq-accent-strong: rgba(34,197,94,0.35);
      }
      #zepra-styled-modal .ipq-shell.status-warning {
        --ipq-accent: #f59e0b;
        --ipq-accent-soft: rgba(245,158,11,0.18);
        --ipq-accent-strong: rgba(245,158,11,0.32);
      }
      #zepra-styled-modal .ipq-shell.status-not-qualified {
        --ipq-accent: #ef4444;
        --ipq-accent-soft: rgba(239,68,68,0.18);
        --ipq-accent-strong: rgba(239,68,68,0.32);
      }
      #zepra-styled-modal .ipq-shell .styled-modal-header {
        background: linear-gradient(90deg, rgba(148,163,184,0.14), rgba(148,163,184,0));
        border-bottom: 1px solid rgba(148,163,184,0.18);
        padding: 18px 22px;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-header h3 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        color: #f8fafc;
        font-size: 17px;
        font-weight: 700;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-header svg {
        width: 22px;
        height: 22px;
        stroke: var(--ipq-accent);
        color: var(--ipq-accent);
      }
      #zepra-styled-modal .ipq-shell .styled-modal-close {
        color: #94a3b8;
        border-radius: 10px;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-close:hover {
        background: rgba(148,163,184,0.16);
        color: #e2e8f0;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-body {
        padding: 1.5rem;
        background: radial-gradient(circle at top, rgba(30,41,59,0.65), rgba(15,23,42,0.92));
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-height: 65vh;
        overflow-y: auto;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-body::-webkit-scrollbar {
        width: 6px;
      }
      #zepra-styled-modal .ipq-shell .styled-modal-body::-webkit-scrollbar-thumb {
        background: rgba(148,163,184,0.35);
        border-radius: 999px;
      }
      .ipq-status-card {
        background: rgba(15,23,42,0.55);
        border: 1px solid rgba(148,163,184,0.2);
        border-radius: 1rem;
        padding: 1.2rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        box-shadow: inset 0 0 0 1px rgba(15,23,42,0.35);
      }
      .ipq-status-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .ipq-status-head {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        min-width: 0;
      }
      .ipq-status-label {
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.14em;
        font-weight: 600;
        color: var(--ipq-accent);
      }
      .ipq-status-message {
        margin: 0;
        color: #e2e8f0;
        font-size: 0.92rem;
        line-height: 1.45;
      }
      .ipq-risk-block {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.25rem;
        min-width: 0;
      }
      .ipq-risk-caption {
        font-size: 0.72rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .ipq-risk-value {
        font-size: 2.6rem;
        font-weight: 700;
        color: var(--ipq-accent);
        font-family: 'Fira Code', 'SFMono-Regular', Menlo, Consolas, monospace;
        line-height: 1;
      }
      .ipq-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 0.75rem;
      }
      .ipq-meta-card {
        background: rgba(15,23,42,0.5);
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 0.9rem;
        padding: 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-width: 0;
      }
      .ipq-meta-card.ipq-span {
        grid-column: span 2;
      }
      .ipq-meta-label {
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .ipq-meta-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .ipq-meta-value {
        color: #f8fafc;
        font-weight: 600;
        word-break: break-word;
      }
      .ipq-ip-value {
        font-family: 'Fira Code', 'SFMono-Regular', Menlo, Consolas, monospace;
        font-size: 1.1rem;
        color: var(--ipq-accent);
      }
      .ipq-copy-btn {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.75rem;
        background: rgba(148,163,184,0.12);
        border: 1px solid rgba(148,163,184,0.28);
        color: #e2e8f0;
        padding: 0.35rem 0.6rem;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .ipq-copy-btn:hover {
        background: rgba(148,163,184,0.24);
      }
      .ipq-copy-btn svg {
        width: 14px;
        height: 14px;
      }
      .ipq-copy-btn.copied {
        background: var(--ipq-accent-soft);
        border-color: var(--ipq-accent);
        color: var(--ipq-accent);
      }
      .ipq-copy-btn.error {
        background: rgba(239,68,68,0.18);
        border-color: rgba(239,68,68,0.4);
        color: #f87171;
      }
      .ipq-check-grid {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .ipq-check-card {
        background: rgba(15,23,42,0.48);
        border: 1px solid rgba(148,163,184,0.16);
        border-radius: 0.9rem;
        padding: 0.95rem 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        min-width: 0;
      }
      .ipq-check-left {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        min-width: 0;
      }
      .ipq-check-icon {
        width: 34px;
        height: 34px;
        border-radius: 0.8rem;
        background: rgba(148,163,184,0.12);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .ipq-check-icon svg {
        width: 18px;
        height: 18px;
        stroke-width: 2;
      }
      .ipq-check-titles {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
      }
      .ipq-check-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #f8fafc;
      }
      .ipq-check-detail {
        color: #94a3b8;
        font-size: 0.82rem;
        line-height: 1.35;
      }
      .ipq-check-status {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-weight: 600;
        font-size: 0.85rem;
        flex-shrink: 0;
      }
      .ipq-check-status svg {
        width: 18px;
        height: 18px;
      }
      .ipq-check-card.ipq-pass .ipq-check-icon {
        background: var(--ipq-accent-soft);
        color: var(--ipq-accent);
      }
      .ipq-check-card.ipq-pass .ipq-check-status {
        color: var(--ipq-accent);
      }
      .ipq-check-card.ipq-warn .ipq-check-icon {
        background: rgba(245,158,11,0.18);
        color: #f59e0b;
      }
      .ipq-check-card.ipq-warn .ipq-check-status {
        color: #f59e0b;
      }
      .ipq-check-card.ipq-fail .ipq-check-icon {
        background: rgba(239,68,68,0.18);
        color: #ef4444;
      }
      .ipq-check-card.ipq-fail .ipq-check-status {
        color: #ef4444;
      }
      .ipq-footer-note {
        font-size: 0.75rem;
        color: #64748b;
        text-align: center;
      }
      @media (max-width: 520px) {
        #zepra-styled-modal .ipq-shell .styled-modal-body {
          padding: 1.25rem;
        }
        .ipq-status-top {
          flex-direction: column;
          align-items: flex-start;
        }
        .ipq-risk-block {
          align-items: flex-start;
        }
        .ipq-meta-card.ipq-span {
          grid-column: span 1;
        }
      }
    </style>
    <div class="ipq-body">
      <section class="ipq-status-card">
        <div class="ipq-status-top">
          <div class="ipq-status-head">
            <span class="ipq-status-label">${statusText.toUpperCase()}</span>
            <p class="ipq-status-message">${statusMessage}</p>
          </div>
          <div class="ipq-risk-block">
            <span class="ipq-risk-caption">Risk Score</span>
            <span class="ipq-risk-value">${risk}</span>
          </div>
        </div>
      </section>
      <section class="ipq-meta-grid">
        <div class="ipq-meta-card ipq-span">
          <div class="ipq-meta-label">IP Address</div>
          <div class="ipq-meta-row">
            <span class="ipq-meta-value ipq-ip-value">${ip || 'Unknown'}</span>
            ${ip ? `<button class="ipq-copy-btn" data-copy="${ip}">${copySVG}<span>Copy</span></button>` : ''}
          </div>
        </div>
        <div class="ipq-meta-card">
          <div class="ipq-meta-label">Location</div>
          <div class="ipq-meta-value">${locationDisplay}</div>
        </div>
        <div class="ipq-meta-card">
          <div class="ipq-meta-label">ISP</div>
          <div class="ipq-meta-value">${ispDisplay}</div>
        </div>
      </section>
      <section class="ipq-check-grid">${checkHTML}</section>
      <p class="ipq-footer-note">Scores are provided by ip-score.com and refreshed on each request.</p>
    </div>`;

  const shieldCheckSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`;
  const shieldWarningSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v6"/><path d="m12 17 .01 0"/></svg>`;
  const shieldOffSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`;

  let headerIcon = shieldCheckSVG;
  if (statusState === 'warning') headerIcon = shieldWarningSVG;
  else if (statusState === 'not-qualified') headerIcon = shieldOffSVG;

  const modal = _safeCreateStyledModal(`${headerIcon} IP Qualification`, html);
  const shell = modal.querySelector('.styled-modal-content');
  shell.classList.add('ipq-shell', statusClass);

  const copyBtn = modal.querySelector('.ipq-copy-btn');
  if (copyBtn && copyBtn.dataset.copy) {
    const original = copyBtn.innerHTML;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        copyBtn.classList.remove('error');
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = `${checkCompactSVG}<span>Copied</span>`;
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = original;
        }, 1600);
      } catch (err) {
        copyBtn.classList.remove('copied');
        copyBtn.classList.add('error');
        copyBtn.innerHTML = `<span>Copy failed</span>`;
        setTimeout(() => {
          copyBtn.classList.remove('error');
          copyBtn.innerHTML = original;
        }, 1600);
      }
    });
  }

  // Ask by Photo Modal Function
  async function openAskByPhotoModal() {
    console.log('openAskByPhotoModal function started');
    
    try {
      // Remove any existing modal first
      const existingModal = document.getElementById('zepra-ask-photo-modal');
      if (existingModal) {
        existingModal.remove();
      }
      
      console.log('Creating professional ChatGPT-style modal...');
      // Create Ask by Photo modal with professional ChatGPT-like interface
      const modal = document.createElement('div');
      modal.id = 'zepra-ask-photo-modal';
      modal.innerHTML = `
        <div class="apbp-modal">
          <header class="apbp-header">
            <div class="apbp-title">
              <svg class="apbp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
              </svg>
              <h2>Ask by Photo</h2>
            </div>
            <button class="apbp-close">×</button>
          </header>
          <main class="apbp-body">
            <div class="apbp-chat-container">
              <div class="apbp-messages" id="apbpMessages"></div>
              <div class="apbp-input-section">
                <input type="file" id="apbpFileInput" accept="image/*" style="display: none;">
                <div class="apbp-controls">
                  <button id="apbpUploadBtn" class="apbp-control-btn" title="Upload Image">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7,10 12,15 17,10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Upload Image
                  </button>
                  <button id="apbpFullScreenBtn" class="apbp-control-btn" title="Full Page Screenshot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <path d="M9 9h6v6"/>
                    </svg>
                    Full Page
                  </button>
                  <button id="apbpPartialScreenBtn" class="apbp-control-btn" title="Select Area Screenshot">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 9h6v6"/>
                      <path d="M21 3h-6l6 6V3z"/>
                      <path d="M3 21v-6h6l-6 6z"/>
                    </svg>
                    Select Area
                  </button>
                </div>
                <div class="apbp-input-container">
                  <textarea id="apbpTextInput" placeholder="Message Ask by Photo..." rows="1"></textarea>
                  <button id="apbpSendBtn" class="apbp-send-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22,2 15,22 11,13 2,9 22,2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      `;

      console.log('Setting modal styles...');
      modal.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background-color: rgba(0, 0, 0, 0.4) !important;
        backdrop-filter: blur(8px) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: fadeIn 0.2s ease-out !important;
      `;

      console.log('Adding CSS styles...');
      // Add comprehensive CSS styling
      const style = document.createElement('style');
      style.id = 'apbp-modal-styles';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes modalSlideIn {
          from { opacity: 0; transform: scale(0.98) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        
        .apbp-modal {
          position: relative;
          background: #ffffff;
          border-radius: 16px;
          width: min(768px, 95vw);
          height: min(600px, 90vh);
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          animation: modalSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          display: flex;
          flex-direction: column;
          border: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        .apbp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.1);
          background: #ffffff;
        }
        
        .apbp-title {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .apbp-icon {
          width: 20px;
          height: 20px;
          color: #10a37f;
        }
        
        .apbp-header h2 {
          margin: 0;
          color: #2d333a;
          font-size: 18px;
          font-weight: 600;
        }
        
        .apbp-close {
          background: none;
          border: none;
          color: #8e8ea0;
          font-size: 24px;
          cursor: pointer;
          border-radius: 6px;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        
        .apbp-close:hover {
          background: rgba(0, 0, 0, 0.05);
          color: #2d333a;
        }
        
        .apbp-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #ffffff;
        }
        
        .apbp-chat-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 20px;
          gap: 16px;
        }
        
        .apbp-messages {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 24px;
          min-height: 0;
        }
        
        .apbp-message {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        
        .apbp-message.user {
          flex-direction: row-reverse;
        }
        
        .apbp-message-avatar {
          width: 30px;
          height: 30px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }
        
        .apbp-message.user .apbp-message-avatar {
          background: #19c37d;
          color: white;
        }
        
        .apbp-message.ai .apbp-message-avatar {
          background: #ab68ff;
          color: white;
        }
        
        .apbp-message-content {
          flex: 1;
          min-width: 0;
        }
        
        .apbp-message.user .apbp-message-content {
          text-align: right;
        }
        
        .apbp-message-text {
          color: #2d333a;
          font-size: 15px;
          line-height: 1.6;
          margin: 0;
          word-wrap: break-word;
        }
        
        .apbp-message.user .apbp-message-text {
          background: #f4f4f4;
          padding: 12px 16px;
          border-radius: 18px;
          color: #2d333a;
          display: inline-block;
          max-width: 80%;
        }
        
        .apbp-message.ai .apbp-message-text {
          background: transparent;
          padding: 0;
        }
        
        .apbp-input-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .apbp-controls {
          display: flex;
          gap: 8px;
          justify-content: center;
          flex-wrap: wrap;
        }
        
        .apbp-control-btn {
          background: #ffffff;
          border: 1px solid #d1d5db;
          color: #374151;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          transition: all 0.15s;
          font-weight: 500;
        }
        
        .apbp-control-btn:hover {
          background: #f9fafb;
          border-color: #9ca3af;
        }
        
        .apbp-control-btn svg {
          width: 16px;
          height: 16px;
        }
        
        .apbp-input-container {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          background: #ffffff;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          padding: 12px;
          transition: border-color 0.15s;
        }
        
        .apbp-input-container:focus-within {
          border-color: #10a37f;
        }
        
        #apbpTextInput {
          flex: 1;
          background: none;
          border: none;
          color: #2d333a;
          font-size: 15px;
          line-height: 1.4;
          resize: none;
          outline: none;
          min-height: 24px;
          max-height: 120px;
          font-family: inherit;
        }
        
        #apbpTextInput::placeholder {
          color: #8e8ea0;
        }
        
        .apbp-send-btn {
          background: #10a37f;
          border: none;
          color: white;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        
        .apbp-send-btn:hover:not(:disabled) {
          background: #0d8f69;
        }
        
        .apbp-send-btn:disabled {
          background: #d1d5db;
          cursor: not-allowed;
        }
        
        .apbp-send-btn svg {
          width: 16px;
          height: 16px;
        }
        
        .apbp-messages::-webkit-scrollbar {
          width: 4px;
        }
        
        .apbp-messages::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .apbp-messages::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 2px;
        }
        
        .apbp-messages::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `;

      console.log('Appending styles and modal to document...');
      document.head.appendChild(style);
      document.body.appendChild(modal);
      
      console.log('Modal added to DOM, setting up event handlers...');
      showNotification('Ask by Photo modal opened successfully!', 'success');

      // State for current conversation
      let currentImages = [];

      // DOM elements
      const messagesContainer = modal.querySelector('#apbpMessages');
      const textInput = modal.querySelector('#apbpTextInput');
      const sendBtn = modal.querySelector('#apbpSendBtn');
      const fileInput = modal.querySelector('#apbpFileInput');
      const uploadBtn = modal.querySelector('#apbpUploadBtn');
      const fullScreenBtn = modal.querySelector('#apbpFullScreenBtn');
      const partialScreenBtn = modal.querySelector('#apbpPartialScreenBtn');
      const closeBtn = modal.querySelector('.apbp-close');

      console.log('Setting up close functionality...');
      // Close modal functionality
      const closeModal = () => {
        console.log('Closing modal...');
        modal.remove();
        style.remove();
      };

      closeBtn.addEventListener('click', closeModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });

      // Message management
      function addMessage(type, text, imageData = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `apbp-message ${type}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'apbp-message-avatar';
        avatar.textContent = type === 'user' ? 'U' : 'AI';
        
        const content = document.createElement('div');
        content.className = 'apbp-message-content';
        
        if (imageData && type === 'user') {
          const img = document.createElement('img');
          img.src = imageData;
          img.style.cssText = 'max-width: 200px; max-height: 150px; border-radius: 8px; margin-bottom: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); object-fit: cover; display: block;';
          content.appendChild(img);
        }
        
        const textElement = document.createElement('p');
        textElement.className = 'apbp-message-text';
        textElement.textContent = text;
        content.appendChild(textElement);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }

      addMessage('ai', 'Hello! I can help you analyze images and answer questions. You can upload an image, take a screenshot, or just ask me anything. How can I assist you today?');

      console.log('Setting up file upload functionality...');
      // File upload functionality
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
          showNotification('Please select an image file', 'error');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
          const imageData = e.target.result;
          currentImages.push(imageData);
          addMessage('user', 'Image uploaded successfully! What would you like to know about this image?', imageData);
          updateSendButton();
          showNotification('Image uploaded! You can now ask questions about it.', 'success');
        };
        reader.readAsDataURL(file);
      });

      // Screenshot functionality using existing OCR infrastructure
      fullScreenBtn.addEventListener('click', async () => {
        try {
          showNotification('Taking full page screenshot...', 'info');
          closeModal(); // Close modal temporarily for screenshot
          
          const response = await chrome.runtime.sendMessage({
            type: 'CAPTURE_FULL_PAGE_OCR',
            tabId: await getTabId(),
            ocrLang: 'eng'
          });
          
          if (response?.ok) {
            // Reopen modal and show success
            await openAskByPhotoModal();
            showNotification('Full page screenshot captured! You can now ask questions about it.', 'success');
          } else {
            showNotification('Screenshot failed: ' + (response?.error || 'Unknown error'), 'error');
            await openAskByPhotoModal(); // Reopen modal
          }
        } catch (e) {
          showNotification('Screenshot error: ' + e.message, 'error');
          await openAskByPhotoModal(); // Reopen modal
        }
      });

      partialScreenBtn.addEventListener('click', async () => {
        try {
          showNotification('Select area to capture...', 'info');
          closeModal(); // Close modal temporarily for screenshot
          
          const rect = await showOverlayAndSelect();
          if (!rect) {
            await openAskByPhotoModal(); // Reopen modal if cancelled
            return;
          }
          
          const response = await chrome.runtime.sendMessage({
            type: 'CAPTURE_AND_OCR',
            rect: rect,
            tabId: await getTabId(),
            ocrLang: 'eng'
          });
          
          if (response?.ok) {
            // Reopen modal and show success
            await openAskByPhotoModal();
            showNotification('Area screenshot captured! You can now ask questions about it.', 'success');
          } else {
            showNotification('Screenshot failed: ' + (response?.error || 'Unknown error'), 'error');
            await openAskByPhotoModal(); // Reopen modal
          }
        } catch (e) {
          showNotification('Screenshot error: ' + e.message, 'error');
          await openAskByPhotoModal(); // Reopen modal
        }
      });

      // Text input and send functionality
      function updateSendButton() {
        const hasText = textInput.value.trim().length > 0;
        sendBtn.disabled = !hasText; // Allow sending without images
      }

      textInput.addEventListener('input', updateSendButton);
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });
      
      sendBtn.addEventListener('click', handleSendMessage);

      function handleSendMessage() {
        const question = textInput.value.trim();
        if (!question) return;
        
        // Add user message
        addMessage('user', question);
        
        // Clear input
        textInput.value = '';
        updateSendButton();
        
        // Simulate AI response
        setTimeout(() => {
          if (currentImages.length > 0) {
            addMessage('ai', 'I can see the image you\'ve shared. The AI image analysis feature will be fully integrated in the next update. For now, I can help with text-based questions and demonstrate this professional chat interface.');
          } else {
            addMessage('ai', 'Thank you for your question! I can help with text-based queries right now. The full AI integration will be available soon. Feel free to upload an image or take a screenshot for visual analysis.');
          }
        }, 800);
      }

      // Auto-resize textarea
      textInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      // Focus on text input
      setTimeout(() => textInput.focus(), 100);
      console.log('Ask by Photo modal setup complete!');
      
    } catch (error) {
      console.error('Error in openAskByPhotoModal:', error);
      showNotification('Error creating Ask by Photo modal: ' + error.message, 'error');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
