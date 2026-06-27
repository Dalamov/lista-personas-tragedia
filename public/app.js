const STORAGE_KEY = 'registro-personas-tragedia';
const SEED_DATA_URL = '/data/registro.json';
const API_BASE = window.location.origin;
const UPLOAD_ENABLED = false;

const state = {
  people: [],
  queue: [],
  processing: false,
  aiEnabled: false,
  reviewBatchHospital: '',
};

const els = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  hospital: document.getElementById('hospital'),
  previewArea: document.getElementById('previewArea'),
  progressArea: document.getElementById('progressArea'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  reviewArea: document.getElementById('reviewArea'),
  reviewList: document.getElementById('reviewList'),
  skipBtn: document.getElementById('skipBtn'),
  addBtn: document.getElementById('addBtn'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  totalCount: document.getElementById('totalCount'),
  resultsList: document.getElementById('resultsList'),
  exportBtn: document.getElementById('exportBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  addNameFieldBtn: document.getElementById('addNameFieldBtn'),
  modeBadge: document.getElementById('modeBadge'),
  setupBanner: document.getElementById('setupBanner'),
  textListInput: document.getElementById('textListInput'),
  parseTextListBtn: document.getElementById('parseTextListBtn'),
};

const HOSPITAL_HEADER_PATTERNS = [
  { pattern: /hospital\s+universitario\s+de\s+caracas/i, label: 'Hospital Universitario de Caracas' },
  { pattern: /hospital\s+domingo\s+luciani/i, label: 'Hospital Domingo Luciani' },
  { pattern: /hospital\s+p[eé]rez\s+carre[nñ]o/i, label: 'Hospital Pérez Carreño' },
  { pattern: /cruz\s+roja/i, label: 'Cruz Roja' },
  { pattern: /perif[eé]rico\s+de\s+catia/i, label: 'Periférico de Catia' },
];

function loadPeople() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    state.people = saved ? JSON.parse(saved) : [];
  } catch {
    state.people = [];
  }
}

function savePeople() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.people));
}

async function loadSeedData() {
  try {
    const response = await fetch(SEED_DATA_URL);
    if (!response.ok) return;
    const seed = await response.json();
    if (!Array.isArray(seed) || !seed.length) return;

    const map = new Map();
    for (const person of seed) {
      const key = normalizeText(person.name);
      if (key.length >= 4) map.set(key, person);
    }
    for (const person of state.people) {
      const key = normalizeText(person.name);
      if (!map.has(key)) map.set(key, person);
      else if (!map.get(key).hospital && person.hospital) map.set(key, person);
    }
    state.people = Array.from(map.values());
    if (UPLOAD_ENABLED) savePeople();
  } catch (err) {
    console.warn('No se pudo cargar registro base:', err);
  }
}

function normalizeText(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeName(name) {
  return name.replace(/\s+/g, ' ').trim().split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function detectHospitalHeader(line) {
  for (const { pattern, label } of HOSPITAL_HEADER_PATTERNS) {
    if (pattern.test(normalizeText(line)) || pattern.test(line)) return label;
  }
  if (/^hospital\s+/i.test(line) && line.length < 80) {
    return normalizeName(line.replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
  }
  return '';
}

function extractLocationFromText(text) {
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const header = detectHospitalHeader(line);
    if (header) return header;
  }
  return '';
}

function applyHospitalPriority(entries, userHospital, imageFallback = '') {
  const primary = userHospital.trim();
  const fallback = imageFallback.trim();
  if (primary) {
    return entries.map((e) => ({ name: e.name, hospital: primary }));
  }
  return entries.map((e) => ({
    name: e.name,
    hospital: e.hospital || fallback || '',
  }));
}

function extractNamesFromText(text) {
  const entries = [];
  const seen = new Set();
  let currentHospital = '';

  const addEntry = (name, hospital) => {
    const normalized = normalizeName(name);
    const key = normalizeText(normalized);
    if (key.length < 4 || seen.has(key)) return;
    seen.add(key);
    entries.push({ name: normalized, hospital: hospital || '' });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = detectHospitalHeader(line);
    if (header) { currentHospital = header; continue; }

    let cleaned = line.replace(/^\d+[\).\-\s]+/, '').replace(/^[•\-–—]\s*/, '');
    cleaned = cleaned.replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    const words = cleaned.split(' ').filter(Boolean);
    if (words.length >= 2 && words.length <= 5) {
      addEntry(words.join(' '), currentHospital);
    }
  }
  return entries;
}

function personExists(name) {
  return state.people.some((p) => normalizeText(p.name) === normalizeText(name));
}

function addPerson(name, hospital) {
  const normalized = normalizeName(name);
  if (!normalized || personExists(normalized)) return false;
  state.people.unshift({
    id: crypto.randomUUID(),
    name: normalized,
    hospital: hospital || 'Sin ubicación indicada',
    addedAt: new Date().toISOString(),
  });
  return true;
}

function renderResults(filter = '') {
  const query = normalizeText(filter);
  let filtered = query ? state.people.filter((p) => normalizeText(p.name).includes(query)) : state.people;

  els.totalCount.textContent = `${state.people.length} persona${state.people.length === 1 ? '' : 's'}`;

  if (!state.people.length) {
    els.resultsList.innerHTML = UPLOAD_ENABLED
      ? '<p class="empty-state">No hay personas registradas. Suba una lista para comenzar.</p>'
      : '<p class="empty-state">No hay personas en el registro.</p>';
    return;
  }
  if (!filtered.length) {
    els.resultsList.innerHTML = `<p class="no-results">No se encontraron resultados para "<strong>${escapeHtml(filter)}</strong>"</p>`;
    return;
  }

  els.resultsList.innerHTML = filtered.map((person) => {
    const date = person.addedAt
      ? new Date(person.addedAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    const deleteBtn = UPLOAD_ENABLED
      ? `<button type="button" class="btn-remove" data-delete="${person.id}" title="Eliminar">✕</button>`
      : '';
    return `
      <article class="person-card">
        <div class="person-info">
          <div class="person-name">${highlightMatch(person.name, filter)}</div>
          <div class="person-meta">
            <span>${escapeHtml(person.hospital)}</span>
            ${date ? `<span>Agregado ${date}</span>` : ''}
          </div>
        </div>
        ${deleteBtn}
      </article>`;
  }).join('');
}

function highlightMatch(name, filter) {
  if (!filter.trim()) return escapeHtml(name);
  const query = normalizeText(filter);
  const idx = normalizeText(name).indexOf(query);
  if (idx === -1) return escapeHtml(name);
  return `${escapeHtml(name.slice(0, idx))}<mark>${escapeHtml(name.slice(idx, idx + filter.trim().length))}</mark>${escapeHtml(name.slice(idx + filter.trim().length))}`;
}

function showReview(entries, sourceCount = 1) {
  const batchHospital = els.hospital.value.trim();
  state.reviewBatchHospital = batchHospital;
  const list = entries.length ? entries : [{ name: '', hospital: batchHospital }];

  const title = els.reviewArea.querySelector('h3');
  if (title) {
    const label = sourceCount > 0 ? `${list.length} nombres` : 'lista escrita';
    title.textContent = `Revise los nombres detectados (${label})`;
  }

  els.reviewList.innerHTML = list.map((entry, i) => {
    const hospital = batchHospital || entry.hospital || '';
    return `
      <div class="review-item">
        <div class="review-fields">
          <input type="text" value="${escapeHtml(entry.name)}" data-index="${i}" data-hospital="${escapeHtml(hospital)}" placeholder="Nombre y apellido">
          ${hospital ? `<span class="review-hospital">${escapeHtml(hospital)}</span>` : ''}
        </div>
        <button type="button" class="btn-remove" data-remove="${i}" title="Quitar">✕</button>
      </div>`;
  }).join('');
  els.reviewArea.classList.remove('hidden');
}

function hideReview() {
  els.reviewArea.classList.add('hidden');
}

function showProgressError(msg) {
  els.progressArea.classList.remove('hidden');
  els.progressFill.style.width = '0%';
  els.progressText.textContent = msg;
  setTimeout(() => els.progressArea.classList.add('hidden'), 6000);
}

async function checkAiAvailability() {
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.aiEnabled);
  } catch {
    return false;
  }
}

function updateModeBadge() {
  if (!els.modeBadge) return;
  if (state.aiEnabled) {
    els.modeBadge.textContent = 'Lectura con IA';
    els.modeBadge.className = 'mode-badge mode-badge-ai';
  } else {
    els.modeBadge.textContent = 'Lectura local';
    els.modeBadge.className = 'mode-badge mode-badge-local';
  }
}

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isAcceptedFile(file) {
  if (file.type.startsWith('image/')) return true;
  if (isPdfFile(file)) return true;
  return /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
}

async function pdfToImages(file, onProgress) {
  if (!window.pdfjsLib) throw new Error('Lector PDF no disponible.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const maxPages = 25;
  const total = Math.min(pdf.numPages, maxPages);
  const pages = [];

  for (let n = 1; n <= total; n++) {
    onProgress?.(`Convirtiendo PDF: página ${n} de ${total}...`);
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      name: `${file.name} (pág. ${n})`,
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      previewUrl: canvas.toDataURL('image/jpeg', 0.5),
    });
  }
  return pages;
}

async function expandUploads(files, onProgress) {
  const items = [];
  for (const file of files) {
    if (isPdfFile(file)) {
      items.push(...await pdfToImages(file, onProgress));
    } else {
      items.push({ name: file.name, file, previewUrl: URL.createObjectURL(file) });
    }
  }
  return items;
}

async function prepareImageDataUrl(source) {
  if (source.dataUrl) return source.dataUrl;
  const dataUrl = await readFileAsDataURL(source.file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, 2400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error(`No se pudo leer "${source.name}".`));
    img.src = dataUrl;
  });
}

async function extractWithAI(imageDataUrl, userHospital, onProgress) {
  onProgress('Analizando con IA... (1-2 min)');
  const res = await fetch(`${API_BASE}/api/extract-names`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageDataUrl, defaultHospital: userHospital }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de IA');
  return (data.entries || []).map((e) => ({
    name: normalizeName(e.name),
    hospital: e.hospital || '',
  }));
}

async function extractWithOcr(imageDataUrl, userHospital, onProgress) {
  const processed = await preprocessForOcr(imageDataUrl);
  const result = await Tesseract.recognize(processed, 'spa', {
    tessedit_pageseg_mode: '6',
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(`Leyendo texto... ${Math.round((m.progress || 0) * 100)}%`);
      }
    },
  });
  const text = result.data.text || '';
  return applyHospitalPriority(
    extractNamesFromText(text),
    userHospital,
    extractLocationFromText(text),
  );
}

async function extractFromSource(source, userHospital, onProgress) {
  onProgress('Preparando imagen...');
  const imageDataUrl = await prepareImageDataUrl(source);

  if (state.aiEnabled) {
    try {
      const raw = await extractWithAI(imageDataUrl, userHospital, onProgress);
      const fallback = raw.find((e) => e.hospital)?.hospital || '';
      return applyHospitalPriority(raw, userHospital, fallback);
    } catch (err) {
      console.warn('IA falló:', err.message);
      onProgress(`IA: ${err.message}. Usando lectura local...`);
    }
  }
  return extractWithOcr(imageDataUrl, userHospital, onProgress);
}

async function preprocessForOcr(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(3, Math.max(2, 2400 / Math.max(img.width, img.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function mergeEntries(existing, incoming) {
  const map = new Map(existing.map((e) => [normalizeText(e.name), e]));
  for (const entry of incoming) {
    const key = normalizeText(entry.name);
    if (key.length < 4) continue;
    if (!map.has(key)) map.set(key, entry);
    else if (!map.get(key).hospital && entry.hospital) map.set(key, entry);
  }
  return Array.from(map.values());
}

function updatePreview(items) {
  if (!items.length) {
    els.previewArea.classList.add('hidden');
    els.previewArea.innerHTML = '';
    return;
  }
  els.previewArea.classList.remove('hidden');
  els.previewArea.innerHTML = items.map((item) => {
    const src = item.previewUrl || '';
    return src ? `<img src="${src}" alt="${escapeHtml(item.name)}" loading="lazy">` : `<div class="preview-file">${escapeHtml(item.name)}</div>`;
  }).join('');
}

async function processQueue(items) {
  if (state.processing || !items.length) return;
  state.processing = true;

  const userHospital = els.hospital.value.trim();
  let allEntries = [];
  let lastError = '';
  let failed = 0;

  els.progressArea.classList.remove('hidden');
  state.aiEnabled = await checkAiAvailability();
  updateModeBadge();

  for (let i = 0; i < items.length; i++) {
    els.progressText.textContent = `Procesando ${i + 1} de ${items.length}: ${items[i].name}`;
    try {
      const extracted = await extractFromSource(items[i], userHospital, (msg) => {
        els.progressText.textContent = items.length > 1 ? `${msg} (${i + 1}/${items.length})` : msg;
      });
      allEntries = mergeEntries(allEntries, extracted);
      if (!extracted.length) lastError = `No se detectaron nombres en ${items[i].name}.`;
    } catch (err) {
      failed++;
      lastError = err.message;
    }
  }

  state.processing = false;
  els.progressArea.classList.add('hidden');

  if (failed === items.length) {
    showProgressError(lastError || 'No se pudieron procesar los archivos.');
    return;
  }
  if (!allEntries.length) {
    showProgressError(lastError || 'No se detectaron nombres.');
    return;
  }

  showReview(allEntries, items.length);
  setupReviewActions(userHospital, items.length);
}

function setupReviewActions(batchHospital, count) {
  els.addBtn.onclick = () => {
    let added = 0;
    els.reviewList.querySelectorAll('input').forEach((input) => {
      const name = input.value.trim();
      const hospital = batchHospital || input.dataset.hospital || 'Sin ubicación indicada';
      if (name && addPerson(name, hospital)) added++;
    });
    savePeople();
    renderResults(els.searchInput.value);
    hideReview();
    if (added > 0) {
      els.progressArea.classList.remove('hidden');
      els.progressText.textContent = `Se agregaron ${added} persona${added === 1 ? '' : 's'}.`;
      els.progressFill.style.width = '100%';
      setTimeout(() => els.progressArea.classList.add('hidden'), 2000);
    }
  };
  els.skipBtn.onclick = hideReview;
}

function handleTextList() {
  if (state.processing) return;
  const text = els.textListInput?.value.trim();
  if (!text) { showProgressError('Escriba o pegue al menos un nombre.'); return; }

  const userHospital = els.hospital.value.trim();
  const entries = applyHospitalPriority(
    extractNamesFromText(text),
    userHospital,
    extractLocationFromText(text),
  );
  if (!entries.length) { showProgressError('No se detectaron nombres en el texto.'); return; }

  showReview(entries, 0);
  setupReviewActions(userHospital, 0);
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(isAcceptedFile);
  if (!files.length) { showProgressError('Seleccione imagen (JPG, PNG, WebP) o PDF.'); return; }
  if (state.processing) { showProgressError('Espere a que termine el procesamiento.'); return; }

  state.processing = true;
  els.progressArea.classList.remove('hidden');
  els.progressText.textContent = 'Preparando archivos...';

  try {
    const items = await expandUploads(files, (msg) => { els.progressText.textContent = msg; });
    updatePreview(items);
    state.processing = false;
    await processQueue(items);
  } catch (err) {
    state.processing = false;
    showProgressError(err.message);
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function exportList() {
  if (!state.people.length) { alert('No hay personas para exportar.'); return; }
  const lines = ['Nombre,Hospital,Fecha'];
  state.people.forEach((p) => {
    lines.push(`"${p.name.replace(/"/g, '""')}","${p.hospital.replace(/"/g, '""')}","${new Date(p.addedAt).toLocaleString('es')}"`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `registro-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function configurePublicMode() {
  document.querySelector('.upload-section')?.classList.add('hidden');
  document.querySelector('.toolbar')?.classList.add('hidden');
}

function initEvents() {
  if (UPLOAD_ENABLED) {
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    els.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropzone.classList.add('dragover'); });
    els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
    els.dropzone.addEventListener('drop', (e) => { e.preventDefault(); els.dropzone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    els.parseTextListBtn?.addEventListener('click', handleTextList);

    els.addNameFieldBtn?.addEventListener('click', () => {
      const h = state.reviewBatchHospital || els.hospital.value.trim();
      const div = document.createElement('div');
      div.className = 'review-item';
      div.innerHTML = `
        <div class="review-fields">
          <input type="text" value="" data-hospital="${escapeHtml(h)}" placeholder="Nombre y apellido">
          ${h ? `<span class="review-hospital">${escapeHtml(h)}</span>` : ''}
        </div>
        <button type="button" class="btn-remove" title="Quitar">✕</button>`;
      div.querySelector('.btn-remove').onclick = () => div.remove();
      els.reviewList.appendChild(div);
      div.querySelector('input').focus();
    });

    els.reviewList.addEventListener('click', (e) => {
      if (e.target.dataset.remove !== undefined) {
        const items = els.reviewList.querySelectorAll('.review-item');
        if (items.length > 1) items[e.target.dataset.remove]?.remove();
      }
    });
  }

  els.searchInput.addEventListener('input', (e) => renderResults(e.target.value));
  els.clearSearch.addEventListener('click', () => { els.searchInput.value = ''; renderResults(); els.searchInput.focus(); });

  if (UPLOAD_ENABLED) {
    els.exportBtn?.addEventListener('click', exportList);
    els.clearAllBtn?.addEventListener('click', () => {
      if (!state.people.length) return;
      if (confirm('¿Vaciar todo el registro?')) { state.people = []; savePeople(); renderResults(); }
    });
    els.resultsList.addEventListener('click', (e) => {
      const id = e.target.dataset.delete;
      if (!id) return;
      if (confirm('¿Eliminar esta persona?')) {
        state.people = state.people.filter((p) => p.id !== id);
        savePeople();
        renderResults(els.searchInput.value);
      }
    });
  }
}

async function bootstrap() {
  if (!UPLOAD_ENABLED) configurePublicMode();
  loadPeople();
  initEvents();
  await loadSeedData();
  if (UPLOAD_ENABLED) {
    state.aiEnabled = await checkAiAvailability();
    updateModeBadge();
  }
  renderResults();
}

bootstrap();
