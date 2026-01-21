// background.js (MV3 service worker)
// - Cerebras chat completions
// - OCR via OCR.space
// - Public IP via ipdata with fallback services

const STRICT_JSON = 'CRITICAL: Your response MUST be ONLY the raw JSON object. Do not include any introductory text, explanations, markdown formatting like ```json```, or any text outside of the JSON structure.';

const DEFAULTS = {
  cerebrasModel: 'gpt-oss-120b',
  typingSpeed: 'normal', // fast | normal | slow
  ocrLang: 'eng',
  autofillWithAI: false, // Use AI page analysis for Autofill banner
  humanErrorRate: 0,
  personaEnabled: false,
  personaActiveId: '',
  personaActiveName: '',
  personaActivePrompt: '',
  surveyInsight: null,
};

const DEFAULT_PERSONAS = [
  {
    id: 'panel_veteran',
    name: 'Maya the Panel Veteran',
    tagline: '15 years navigating every major survey panel.',
    prompt: `You are Maya Nassar, a veteran survey panelist working full-time for top-tier platforms like Five Survey, Prime Opinion, and Swagbucks. You understand screeners, quotas, survey routing, and how to keep profiles consistent to stay in high-paying waves. You monitor contradictions, align datasets, and subtly tailor responses to satisfy targeting requirements without sounding fake. You talk like a sharp professional who relies on surveys for income.`
  },
  {
    id: 'behavior_insights_lead',
    name: 'Jonas the Behavior Insights Lead',
    tagline: 'Corporate strategist delivering persona-compatible answers.',
    prompt: `You are Jonas Patel, a behavior insights lead at a market research agency. You are constantly ghost-writing responses for high-value participants to keep them qualified on Swagbucks, Prime Opinion, and branded trackers. You instantly infer study objectives, detect red-flag answers, and craft believable survey responses that pass manual reviews. You sprinkle insider jargon sparingly and keep tone natural yet informed.`
  },
  {
    id: 'cpg_specialist',
    name: 'Layla the CPG Specialist',
    tagline: 'Consumer packaged goods guru who fits tough screeners.',
    prompt: `You are Layla Torres, a senior insights manager specializing in consumer packaged goods and retail trackers. Panels like Five Survey and Prime Opinion lean on you to keep quota-balanced respondents active. You know brand awareness, purchase frequency, and shopper missions by heart. You give realistic household stories, mention specific retailers, and align answers with CPG buyer personas.`
  },
  {
    id: 'healthcare_panel_coach',
    name: 'Dr. Amir the Healthcare Panel Coach',
    tagline: 'Guides medical surveys with qualifying expertise.',
    prompt: `You are Dr. Amir Salim, a healthcare panel coach who trains professionals to pass complex medical screeners. You contribute to Five Survey and specialist trackers. You recognise compliance red lines, realistic clinic workflows, and the nuance of professional terminology. You keep tone human, sometimes imperfect, yet always aligned with realistic clinical practice.`
  }
];

const SESSION_DURATION = 3 * 60 * 60 * 1000; // 3 hours


async function forceLogout(reason = 'Your session has expired. Please log in again.') {
  await chrome.storage.local.remove(['loggedIn', 'loginTime', 'userEmail', 'idToken', 'refreshToken', 'lastAuthCheck']);
  await chrome.storage.local.set({ logoutMsg: reason });
  updatePopup();
  updateContextMenu();
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
  } else {
    header += '- Use the instructions below to craft the final answer.\n\n';
  }
  return header;
}

function buildSurveyInsightPrompt(entries) {
  const trimmed = Array.isArray(entries) ? entries.slice(-200) : [];
  const payload = trimmed.map((item, idx) => `Q${idx + 1}: ${item.q}\nA${idx + 1}: ${item.a}`).join('\n\n');
  return `${buildPromptHeader({ personaEnabled: true, personaName: 'Survey Strategist', personaPrompt: 'You are a senior research analyst who deduces survey objectives from respondent behavior.', humanErrorRate: 0, mode: 'analysis' })}
You will receive a chronological log of survey questions and the participant answers. Analyze them to infer:
- The likely primary objective of the survey (why the study exists).
- The target persona the survey is screening for (demographics, behaviors, purchase habits, etc.).
- Key red flags or consistency checks the participant must maintain in future answers.

Respond ONLY with JSON object:
{
  "objective": "",
  "targetPersona": "",
  "keySignals": [""],
  "confidence": "low|medium|high"
}

Conversation log:
${payload}

${STRICT_JSON}`;
}

function buildPersonaGenerationPrompt(description = '') {
  return `${buildPromptHeader({ personaEnabled: false, humanErrorRate: 0, mode: 'analysis' })}
Create a survey-answering persona tailored for qualification success. Base it on this inspiration (if any): "${description}".

Respond ONLY with JSON:
{
  "id": "",
  "name": "",
  "tagline": "",
  "prompt": "",
  "domains": [""],
  "tone": ""
}

Rules:
- Provide a short memorable name (<=6 words).
- Tagline must highlight expertise in survey panels (Five Survey, Prime Opinion, Swagbucks, etc.).
- Prompt should be 3-4 paragraphs describing behavior, voice, tactics, and consistency rules.
- Domains list 3-5 niches where persona excels.
- Tone describes speech style (e.g., "Confident and data-driven").

${STRICT_JSON}`;
}

function parseJSONSafe(txt) {
  if (!txt || typeof txt !== 'string') return null;
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(txt.slice(start, end + 1));
  } catch (err) {
    return null;
  }
}

async function checkSession() {
  const { loggedIn, loginTime } = await chrome.storage.local.get(['loggedIn', 'loginTime']);
  if (!loggedIn || !loginTime) {
    await forceLogout();
    return { ok: false };
  }
  const remaining = SESSION_DURATION - (Date.now() - loginTime);
  if (remaining <= 0) {
    await forceLogout();
    return { ok: false };
  }
  return { ok: true, remaining };
}

async function updatePopup() {
  const { loggedIn } = await chrome.storage.local.get('loggedIn');
  const popup = loggedIn ? 'popup.html' : 'login.html';
  await chrome.action.setPopup({ popup });
}

async function updateContextMenu() {
  const { loggedIn } = await chrome.storage.local.get('loggedIn');
  await chrome.contextMenus.removeAll();
  if (loggedIn) {
    chrome.contextMenus.create({
      id: 'sendToZepra',
      title: 'Send to Zepra',
      contexts: ['selection'],
      documentUrlPatterns: ['<all_urls>']
    });
  }
}

updatePopup();
updateContextMenu();
checkSession();
chrome.runtime.onStartup.addListener(() => {
  updatePopup();
  updateContextMenu();
  checkSession();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.loggedIn) {
    updatePopup();
    updateContextMenu();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cur = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const toSet = {};
    for (const [k, v] of Object.entries(DEFAULTS)) if (cur[k] === undefined) toSet[k] = v;
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
    const { personas } = await chrome.storage.local.get('personas');
    if (!Array.isArray(personas)) {
      await chrome.storage.local.set({ personas: DEFAULT_PERSONAS });
    }
  } catch (e) {
    console.error('Error initializing defaults:', e);
  }
  updatePopup();
  updateContextMenu();
  checkSession();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'sendToZepra' && info.selectionText) {
    try {
      // Ensure content script is injected
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      // Wait a bit for script to load
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SHOW_ZEPRA_MODAL',
            text: info.selectionText
          });
        } catch (e) {
          console.error('Error sending message to content script:', e);
        }
      }, 100);
    } catch (e) {
      console.error('Error injecting content script:', e);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'CEREBRAS_GENERATE': {
          const result = await callGenerativeModel(message.prompt, message.options || {});
          sendResponse({ ok: true, result });
          break;
        }
        case 'CAPTURE_AND_OCR': {
          const { rect, tabId, ocrLang } = message;
          const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
          let croppedDataUrl;
          try {
            croppedDataUrl = await cropImageInWorker(dataUrl, rect);
          } catch (e) {
            const cropResp = await chrome.tabs.sendMessage(tabId, {
              type: 'CROP_IMAGE_IN_CONTENT',
              dataUrl,
              rect
            });
            if (!cropResp?.ok) throw new Error('Crop fallback failed');
            croppedDataUrl = cropResp.dataUrl;
          }
          const text = await performOCR(croppedDataUrl, ocrLang);
          sendResponse({ ok: true, text });
          break;
        }
        case 'CAPTURE_PAGE_IMAGE': {
          try {
            const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
            sendResponse({ ok: true, dataUrl });
          } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case 'CAPTURE_FULL_PAGE_OCR': {
          const { tabId, ocrLang } = message;
          const result = await captureFullPageOCR(tabId, ocrLang);
          sendResponse(result);
          break;
        }
        case 'CHECK_AUTH': {
          const res = await checkSession();
          sendResponse(res);
          break;
        }
        case 'LOGOUT': {
          await forceLogout(message.reason || 'Logged out');
          sendResponse({ ok: true });
          break;
        }
        case 'GET_PUBLIC_IP': {
          const info = await getPublicIP();
          sendResponse({ ok: true, info });
          break;
        }
        case 'GET_IP_QUALIFICATION': {
          try {
            const result = await getIPQualificationResult();
            sendResponse({ ok: true, data: result });
          } catch (err) {
            console.error('IP qualification error:', err);
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case 'TEST_IPDATA': {
          const info = await testIPData(message.key);
          sendResponse(info);
          break;
        }
        case 'SHOW_NOTIFICATION': {
          const { title, message: body } = message;
          if (title && body) {
            chrome.notifications.create('', {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title,
              message: body
            });
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'Missing fields' });
          }
          break;
        }
        case 'OPEN_CUSTOM_WEB': {
          const openerTabId = message.openerTabId || sender?.tab?.id || (await getActiveTabId());
          const { customWebSize = { width: 1000, height: 800 } } = await chrome.storage.local.get('customWebSize');
          let url = `custom_web.html?tabId=${openerTabId}`;
          if (message.initialUrl) url += `&url=${encodeURIComponent(message.initialUrl)}`;
          if (message.urls) url += `&urls=${encodeURIComponent(JSON.stringify(message.urls))}`;
          await chrome.windows.create({
            url: chrome.runtime.getURL(url),
            type: 'popup',
            width: customWebSize.width || 1000,
            height: customWebSize.height || 800
          });
          sendResponse({ ok: true });
          break;
        }
        case 'OPEN_OR_FOCUS_CUSTOM_WEB': {
          const siteUrl = message.url;
          const openerTabId = message.openerTabId || sender?.tab?.id || (await getActiveTabId());
          const { customWebSize = { width: 1000, height: 800 } } = await chrome.storage.local.get('customWebSize');
          const encoded = encodeURIComponent(siteUrl || '');
          const wins = await chrome.windows.getAll({ populate: true });
          for (const win of wins) {
            const tab = (win.tabs || []).find(t => t.url && t.url.includes('custom_web.html') && t.url.includes(`url=${encoded}`));
            if (tab) {
              await chrome.windows.update(win.id, { focused: true });
              await chrome.tabs.update(tab.id, { active: true });
              sendResponse({ ok: true, focused: true });
              return;
            }
          }
          await chrome.windows.create({
            url: chrome.runtime.getURL(`custom_web.html?tabId=${openerTabId}&url=${encoded}`),
            type: 'popup',
            width: customWebSize.width || 1000,
            height: customWebSize.height || 800
          });
          sendResponse({ ok: true, created: true });
          break;
        }
        case 'GET_TAB_ID': {
          const id = sender?.tab?.id || (await getActiveTabId());
          sendResponse({ ok: true, tabId: id });
          break;
        }
        case 'RUN_CUSTOM_PROMPT': {
          const { id, text } = message;
          const { customPrompts = [] } = await chrome.storage.sync.get('customPrompts');
          const pr = customPrompts.find(p => p.id === id);
          if (!pr) { sendResponse({ ok: false, error: 'Prompt not found' }); break; }
          const settings = await chrome.storage.local.get(['personaEnabled', 'personaActiveName', 'personaActivePrompt', 'humanErrorRate']);
          const header = buildPromptHeader({
            personaEnabled: settings.personaEnabled,
            personaName: settings.personaActiveName,
            personaPrompt: settings.personaActivePrompt,
            humanErrorRate: settings.humanErrorRate,
            mode: 'custom'
          });
          const fullPrompt = `${header}${pr.text}\n\nQuestion:\n${text}\n\nAnswer:`;
          const result = await callGenerativeModel(fullPrompt, { temperature: 0.25 });
          sendResponse({ ok: true, result, promptName: pr.name });
          break;
        }
        case 'SAVE_PERSONAS': {
          const { personas = [] } = message;
          await chrome.storage.local.set({ personas });
          sendResponse({ ok: true });
          break;
        }
        case 'GET_PERSONAS': {
          const { personas = DEFAULT_PERSONAS, personaEnabled = false, personaActiveId = '', personaActiveName = '', personaActivePrompt = '' } = await chrome.storage.local.get(['personas', 'personaEnabled', 'personaActiveId', 'personaActiveName', 'personaActivePrompt']);
          sendResponse({ ok: true, personas: Array.isArray(personas) && personas.length ? personas : DEFAULT_PERSONAS, personaEnabled, personaActiveId, personaActiveName, personaActivePrompt });
          break;
        }
        case 'SET_ACTIVE_PERSONA': {
          const { persona } = message;
          if (!persona) {
            await chrome.storage.local.set({ personaEnabled: false, personaActiveId: '', personaActiveName: '', personaActivePrompt: '' });
          } else {
            await chrome.storage.local.set({ personaEnabled: true, personaActiveId: persona.id || '', personaActiveName: persona.name || '', personaActivePrompt: persona.prompt || '' });
          }
          sendResponse({ ok: true });
          break;
        }
        case 'ANALYZE_SURVEY_MEMORY': {
          try {
            const { entries = [] } = message;
            const prompt = buildSurveyInsightPrompt(entries);
            const result = await callGenerativeModel(prompt, { temperature: 0.1 });
            const analysis = parseJSONSafe(result);
            if (analysis) {
              await chrome.storage.local.set({
                surveyInsight: {
                  analysis,
                  raw: result,
                  updatedAt: Date.now(),
                  sampleSize: Array.isArray(entries) ? entries.length : 0
                }
              });
            }
            sendResponse({ ok: true, result, analysis });
          } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case 'SURVEY_MEMORY_UPDATED': {
          sendResponse({ ok: true });
          break;
        }
        case 'GENERATE_PERSONA_PROFILE': {
          try {
            const { description = '' } = message;
            const prompt = buildPersonaGenerationPrompt(description);
            const result = await callGenerativeModel(prompt, { temperature: 0.15 });
            const persona = parseJSONSafe(result);
            if (persona) {
              if (!persona.id) persona.id = `persona_${Date.now()}`;
              if (!persona.prompt && persona.archetypePrompt) persona.prompt = persona.archetypePrompt;
            }
            sendResponse({ ok: true, result, persona });
          } catch (err) {
            sendResponse({ ok: false, error: err?.message || String(err) });
          }
          break;
        }
        case 'GENERATE_IDENTITY': {
          const { prompt } = message;
          const p = `Create a fictional persona for survey qualification based on: "${prompt}". All fields must be fully realistic with no placeholders. Set the profilePictureUrl to an empty string "" since image generation is not supported. Generate a natural email address using the persona's name and a common domain such as gmail.com, yahoo.com, or outlook.com. Create a believable password that mixes parts of the persona's name and birth year with numbers and special characters. Respond ONLY with a single JSON object containing fields: identityName, profilePictureUrl, fullName, firstName, lastName, age, email, username, password, phone, address1, address2, city, state, zipCode, country, macAddress, companyName, companyIndustry, companySize, companyAnnualRevenue, companyWebsite, companyAddress.\n${STRICT_JSON}`;
          const result = await callGenerativeModel(p, { temperature: 0.25 });
          sendResponse({ ok: true, result });
          break;
        }
        case 'GENERATE_COMPANY': {
          const p = `Generate fake but realistic company information. Respond ONLY with a JSON object containing fields: companyName, companyIndustry, companySize, companyAnnualRevenue, companyWebsite, companyAddress.\n${STRICT_JSON}`;
          const result = await callGenerativeModel(p, { temperature: 0.2 });
          sendResponse({ ok: true, result });
          break;
        }
        case 'GENERATE_FAKE_INFO': {
          const { gender, nat, force } = message;
          const data = await fetchRandomUser({ gender, nat, force });
          sendResponse({ ok: true, data });
          break;
        }
        case 'GENERATE_REAL_ADDRESS': {
          const { country = '', state = '', city = '' } = message;
          const prompt = `Generate a real mailing address based on the following details.
Country: ${country}
State/Province: ${state}
City/Zip Code: ${city}
Respond ONLY with a JSON object: {"address_1": "", "address_2": "", "zip_code": ""}
${STRICT_JSON}`;
          const result = await callGenerativeModel(prompt, { temperature: 0.2 });
          sendResponse({ ok: true, result });
          break;
        }
        case 'ANALYZE_FORM': {
          const { html = '', contextJSON = '[]', screenshot = '', identity = {} } = message;
          const identityJson = JSON.stringify(identity || {});
          const basePrompt = `You are an expert form analysis AI. Using the provided materials, return a precise JSON object mapping CSS selectors in the form to identity field keys.

Available identity field keys:
- identityName, profilePictureUrl, fullName, firstName, lastName, age, email, username, password
- phone, address1, address2, city, state, zipCode, country, macAddress
- companyName, companyIndustry, companySize, companyAnnualRevenue, companyWebsite, companyAddress

Rules:
1. Use the most specific CSS selector possible (prefer ID > name > placeholder text)
2. Only include selectors for fields that clearly match the available keys
3. Consider label text, placeholder text, name attributes, and surrounding context
4. Be conservative - only map fields you are highly confident about
5. Prioritize common form patterns and naming conventions
6. When an identity field is not available, skip that selector

FORM_HTML (truncated if huge):
${html}

FIELD_CONTEXT_JSON:
${contextJSON}

ACTIVE_IDENTITY_JSON:
${identityJson}

${STRICT_JSON}

Return format: {"#email": "email", "input[name='firstName']": "firstName"}`;

          const result = await callGenerativeModel(basePrompt, { temperature: 0.1 });
          sendResponse({ ok: true, result });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true; // async
});

async function callGenerativeModel(prompt, options = {}) {
  return callCerebras(prompt, options);
}

async function callCerebras(prompt, options = {}) {
  const { cerebrasApiKey = '', cerebrasModel } = await chrome.storage.local.get([
    'cerebrasApiKey', 'cerebrasModel'
  ]);
  if (!cerebrasApiKey) {
    const e = new Error('Missing Cerebras API key (set it in Options).');
    e.code = 401;
    throw e;
  }
  const model = cerebrasModel || DEFAULTS.cerebrasModel;
  const endpoint = 'https://api.cerebras.ai/v1/chat/completions';
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: options?.temperature ?? 0.2,
    max_completion_tokens: 1024
  };
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cerebrasApiKey}`
  };
  try {
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Cerebras error ${res.status}: ${t}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
    return sanitize(text);
  } catch (err) {
    console.error('Zepra Debug: Cerebras fetch failed:', err);
    throw err;
  }
}

async function performOCR(imageDataUrl, lang) {
  const { ocrApiKey = '', ocrLang } = await chrome.storage.local.get(['ocrApiKey', 'ocrLang']);
  const language = lang || ocrLang || DEFAULTS.ocrLang;

  const endpoint = 'https://api.ocr.space/parse/image';
  const form = new FormData();
  form.append('language', language);
  form.append('isOverlayRequired', 'false');
  form.append('base64Image', imageDataUrl);
  if (ocrApiKey) form.append('apikey', ocrApiKey);
  const res = await fetch(endpoint, { method: 'POST', body: form });
  if (res.status === 429) throw new Error('OCR rate limited (429)');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OCR error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const text = data?.ParsedResults?.[0]?.ParsedText || '';
  return sanitize(text);
}

async function captureFullPageOCR(tabId, ocrLang) {
  try {
    const dims = await chrome.scripting.executeScript({
      target: { tabId },
      function: () => ({ height: document.body.scrollHeight, viewHeight: window.innerHeight })
    });
    const shots = [];
    for (let y = 0; y < dims.result.result.value.height; y += dims.result.result.value.viewHeight) {
      await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y });
      await new Promise(r => setTimeout(r, 300));
      shots.push(await chrome.tabs.captureVisibleTab({ format: 'png' }));
    }
    await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y: 0 });
    const stitched = await stitchImages(shots);
    const text = await performOCR(stitched, ocrLang);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function stitchImages(images) {
  const bitmaps = await Promise.all(images.map(async dataUrl => {
    const blob = await (await fetch(dataUrl)).blob();
    return await createImageBitmap(blob);
  }));
  const width = Math.max(...bitmaps.map(b => b.width));
  const totalHeight = bitmaps.reduce((s, b) => s + b.height, 0);
  const canvas = new OffscreenCanvas(width, totalHeight);
  const ctx = canvas.getContext('2d');
  let y = 0;
  for (const bmp of bitmaps) {
    ctx.drawImage(bmp, 0, y);
    y += bmp.height;
  }
  const blob = await canvas.convertToBlob();
  return await blobToDataURL(blob);
}

function blobToDataURL(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function getPublicIP(noKey = false) {
  const { ipdataApiKey = '' } = noKey ? {} : await chrome.storage.local.get('ipdataApiKey');
  if (!noKey && ipdataApiKey) {
    try {
      const [base, threat, carrier, asn, tz] = await Promise.all([
        fetchJSON(`https://api.ipdata.co/?api-key=${ipdataApiKey}`),
        fetchJSON(`https://api.ipdata.co/threat?api-key=${ipdataApiKey}`),
        fetchJSON(`https://api.ipdata.co/carrier?api-key=${ipdataApiKey}`),
        fetchJSON(`https://api.ipdata.co/asn?api-key=${ipdataApiKey}`),
        fetchJSON(`https://api.ipdata.co/time_zone?api-key=${ipdataApiKey}`)
      ]);

      const { score, breakdown } = computeIpdataQualificationScore({ base, threat, asn, carrier });
      const state = deriveQualificationState(score, { threat, asn, carrier });

      return {
        source: 'ipdata',
        fetchedAt: Date.now(),
        score,
        status: state.state,
        statusMessage: state.message,
        checks: state.checks,
        breakdown,
        ip: base?.ip || '',
        country: base?.country_name || base?.country_code || 'Unknown',
        city: base?.city || 'Unknown',
        postal: base?.postal || 'Unknown',
        isp: base?.asn?.name || 'Unknown',
        timezone: tz?.time_zone?.name || 'Unknown',
        raw: base
      };
    } catch (e) {
      console.error('ipdata error:', e);
    }
  }

  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  const services = [
    {
      url: 'https://ipapi.co/json/',
      map: (d) => ({
        ip: d?.ip,
        country: d?.country_name || d?.country,
        city: d?.city,
        postal: d?.postal,
        isp: d?.org,
        timezone: d?.timezone
      })
    },
    {
      url: 'https://ipinfo.io/json',
      map: (d) => ({
        ip: d?.ip,
        country: d?.country,
        city: d?.city,
        postal: d?.postal,
        isp: d?.org,
        timezone: d?.timezone
      })
    },
    {
      url: 'https://ip-api.com/json/',
      map: (d) => ({
        ip: d?.query,
        country: d?.country,
        city: d?.city,
        postal: d?.zip,
        isp: d?.isp,
        timezone: d?.timezone
      })
    }
  ];

  for (const svc of services) {
    try {
      const res = await fetch(svc.url, { method: 'GET', headers });
      if (!res.ok) throw new Error(`IP API failed: ${res.status}`);
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const info = svc.map(data);
      if (info && info.ip) {
        return {
          ip: info.ip || 'Unknown',
          country: info.country || 'Unknown',
          city: info.city || 'Unknown',
          postal: info.postal || 'Unknown',
          timezone: info.timezone || 'Unknown',
          isp: info.isp || 'Unknown'
        };
      }
    } catch (e) {
      console.error('IP service error:', svc.url, e);
    }
  }

  // Final fallback: ipify for IP only
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    if (r.ok) {
      const d = await r.json();
      return {
        ip: d?.ip || 'Unknown',
        country: 'Unknown',
        city: 'Unknown',
        postal: 'Unknown',
        timezone: 'Unknown',
        isp: 'Unknown'
      };
    }
  } catch (e) {
    console.error('Fallback IP fetch error:', e);
  }
  throw new Error('Unable to retrieve IP information');
}

function computeIpdataQualificationScore({ base = {}, threat = {}, asn = {}, carrier = {} }) {
  let score = Number.isFinite(threat?.scores?.overall)
    ? 100 - Number(threat.scores.overall)
    : 100;

  const deductions = [];

  const apply = (amount, reason) => {
    if (amount <= 0) return;
    deductions.push({ amount, reason });
    score -= amount;
  };

  if (threat.is_threat) apply(50, 'Marked as active threat');
  if (threat.is_known_attacker) apply(35, 'Known attacker IP');
  if (threat.is_known_abuser) apply(25, 'Known abusive address');
  if (threat.is_bogon) apply(20, 'Bogon network range');
  if (threat.is_vpn) apply(18, 'VPN detected');
  if (threat.is_proxy) apply(15, 'Proxy detected');
  if (threat.is_tor) apply(22, 'Tor exit node');
  if (threat.is_datacenter) apply(18, 'Datacenter or hosting range');
  if (threat.is_anonymous) apply(12, 'Anonymous network usage');

  if (Array.isArray(threat.blocklists) && threat.blocklists.length) {
    apply(Math.min(40, threat.blocklists.length * 12), `${threat.blocklists.length} blocklist hit(s)`);
  }

  if (/hosting|datacenter|infrastructure|cdn/i.test(asn?.type || '')) {
    apply(15, `ASN classified as ${asn.type}`);
  }

  if (/mobile|cellular/i.test(carrier?.name || '')) {
    apply(5, 'Mobile carrier IP (rotating risk)');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, breakdown: deductions };
}

function deriveQualificationState(score, { threat = {}, asn = {}, carrier = {} } = {}) {
  const checks = [];

  const addCheck = (label, pass, details) => {
    checks.push({ label, pass, details });
  };

  const blocklistCount = Array.isArray(threat.blocklists) ? threat.blocklists.length : 0;

  let state = 'qualified';
  let message = 'IP appears clean and ready to use.';

  if (score > 90) {
    state = 'qualified';
    message = 'Excellent reputation. This IP is good to go.';
  } else if (score >= 60) {
    state = 'warning';
    message = 'Moderate risk detected. Use with caution and monitor activity.';
  } else {
    state = 'not-qualified';
    message = 'High risk. Change your connection before continuing.';
  }

  if (threat.is_known_attacker || threat.is_known_abuser || threat.is_threat || blocklistCount > 0) {
    state = 'not-qualified';
    message = 'Malicious reputation detected. Swap your connection immediately.';
  } else if (threat.is_vpn || threat.is_proxy || threat.is_tor || threat.is_anonymous) {
    if (state === 'qualified') {
      state = 'warning';
      message = 'Anonymity tools detected. Disable them before continuing.';
    }
  } else if (/hosting|datacenter|infrastructure|cdn/i.test(asn?.type || '')) {
    if (state === 'qualified') {
      state = 'warning';
      message = 'Hosting ASN detected. Residential connections score higher.';
    }
  }

  addCheck('Score Threshold', score >= 90, `${score}/100`);
  addCheck('VPN Detection', !threat.is_vpn, threat.is_vpn ? 'VPN detected' : 'No VPN activity');
  addCheck('Proxy Detection', !threat.is_proxy, threat.is_proxy ? 'Proxy detected' : 'No proxy detected');
  addCheck('Tor Detection', !threat.is_tor, threat.is_tor ? 'Tor exit node detected' : 'Tor not detected');
  addCheck('Known Threat Lists', !(threat.is_known_attacker || threat.is_known_abuser || threat.is_threat),
    threat.is_known_attacker || threat.is_known_abuser || threat.is_threat ? 'Flagged on threat feeds' : 'No known threat flags');
  addCheck('Blocklists', blocklistCount === 0,
    blocklistCount ? `${blocklistCount} blocklist match(es)` : 'No blocklist matches');
  addCheck('ASN Type', !/hosting|datacenter|infrastructure|cdn/i.test(asn?.type || ''),
    asn?.type ? `ASN classified as ${asn.type}` : 'Not classified as hosting');
  addCheck('Carrier Type', !/mobile|cellular/i.test(carrier?.name || ''),
    /mobile|cellular/i.test(carrier?.name || '') ? `Carrier: ${carrier.name}` : 'Not a mobile carrier');

  return { state, message, checks };
}

async function fetchRandomUser({ gender = '', nat = '', force = false } = {}) {
  const cacheKey = `fi_${gender || 'any'}_${nat || 'any'}`;
  const { fakeCache = {} } = await chrome.storage.local.get('fakeCache');
  if (!force) {
    const entry = fakeCache[cacheKey];
    if (entry && Date.now() - entry.ts < 5 * 60 * 1000) {
      return entry.data;
    }
  }

  const url = new URL('https://randomuser.me/api/');
  if (gender) url.searchParams.set('gender', gender);
  if (nat) url.searchParams.set('nat', nat);
  url.searchParams.set('noinfo', '');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`RandomUser API failed: ${res.status}`);
  const data = await res.json();
  const user = data?.results?.[0];
  if (!user) throw new Error('RandomUser returned no data');
  fakeCache[cacheKey] = { ts: Date.now(), data: user };
  await chrome.storage.local.set({ fakeCache });
  return user;
}

function sanitize(s) {
  return (s || '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replace(/[\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function cropImageInWorker(dataUrl, rect) {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('No OffscreenCanvas');
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.x * rect.dpr));
  const sy = Math.max(0, Math.round(rect.y * rect.dpr));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * rect.dpr));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * rect.dpr));
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const out = await canvas.convertToBlob({ type: 'image/png' });
  const arr = await out.arrayBuffer();
  const base64 = arrayBufferToBase64(arr);
  return `data:image/png;base64,${base64}`;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id || 0;
}
