const APP_VERSION = 'v5.1.7';
const HOVER_DELAY_MS = 350;
const DATA_URL = `data/diccionario_mixe_dataset.json?v=${APP_VERSION}`;
const AUDIO_MANIFEST_URL = `data/audio_manifest.json?v=${APP_VERSION}`;
const GENERAL_CATEGORY = 'vocabulario_general';
const PAGE_SIZE = 120;

const CATEGORY_INFO = {
  animales: { label: 'Animales', icon: '🦜' },
  insectos: { label: 'Insectos', icon: '🐞' },
  familia: { label: 'Familia', icon: '👪' },
  colores: { label: 'Colores', icon: '🎨' },
  formas_geometricas: { label: 'Formas geométricas', icon: '🔷' },
  fenomenos_naturales: { label: 'Fenómenos naturales', icon: '⛈️' },
  naturaleza: { label: 'Naturaleza', icon: '🌿' },
  numeros_1_20: { label: 'Números 1–20', icon: '🔢' },
  numeros_20_99: { label: 'Números 20–99', icon: '🔢' },
  centenas: { label: 'Centenas', icon: '💯' },
  millares: { label: 'Millares', icon: '🧮' },
  vocabulario_general: { label: 'Vocabulario general', icon: '📖' }
};

const state = {
  entries: [],
  metadata: {},
  query: '',
  category: 'all',
  audio: 'all',
  letter: 'all',
  viewMode: 'list',
  visible: PAGE_SIZE,
  flashcardIndex: 0,
  audioManifest: {},
  manifestLoaded: false
};

const $ = (id) => document.getElementById(id);

const normalizeText = (value) => (value || '')
  .toString()
  .toLowerCase()
  .normalize('NFC')
  .replace(/[’'`´]/g, "'")
  .replace(/[^a-z0-9áéíóúüñëÿ'\s]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeWord = (value) => normalizeText(value).replace(/\s+/g, '');

const prettyCategory = (cat) => CATEGORY_INFO[cat]?.label || (cat || 'sin categoría').replaceAll('_', ' ');
const categoryIcon = (cat) => CATEGORY_INFO[cat]?.icon || '📖';
const fmt = (n) => n.toLocaleString('es-MX');

function meaningParts(text) {
  return normalizeText(text)
    .split(/\s*(?:;|,|\/|\||\bo\b)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function prepareEntries(rawEntries) {
  return (rawEntries || [])
    .filter((entry) => entry && entry.ayuuk)
    .map((entry) => ({
      ...entry,
      espanol: entry.espanol || '',
      categoria: entry.categoria || GENERAL_CATEGORY,
      slug: entry.slug || normalizeWord(entry.ayuuk),
      audio_file: entry.audio_file || `${entry.slug || normalizeWord(entry.ayuuk)}.mp3`,
      audio_path: entry.audio_path || `audio/${entry.audio_file || `${entry.slug || normalizeWord(entry.ayuuk)}.mp3`}`,
      categorias_relacionadas: Array.isArray(entry.categorias_relacionadas) ? entry.categorias_relacionadas : [],
      nota: entry.nota || ''
    }));
}

function matchesEspanolExact(entry, qText) {
  const full = normalizeText(entry.espanol);
  if (full === qText) return true;
  return meaningParts(entry.espanol).includes(qText);
}

function matchesPartial(entry, qText, qWord) {
  const ayuuk = normalizeWord(entry.ayuuk);
  const espanol = normalizeText(entry.espanol);
  const categoria = normalizeText(prettyCategory(entry.categoria));
  const related = (entry.categorias_relacionadas || [])
    .map((cat) => normalizeText(prettyCategory(cat)))
    .join(' ');

  return (
    ayuuk.includes(qWord)
    || espanol.includes(qText)
    || categoria.includes(qText)
    || related.includes(qText)
  );
}

function matchesQuery(entry, qText, qWord, mode) {
  if (!qText) return true;
  if (mode === 'ayuuk-exact') return normalizeWord(entry.ayuuk) === qWord;
  if (mode === 'espanol-exact') return matchesEspanolExact(entry, qText);
  return matchesPartial(entry, qText, qWord);
}

function getSearchMode(entries, qText, qWord) {
  if (!qText) return 'all';
  if (entries.some((entry) => normalizeWord(entry.ayuuk) === qWord)) return 'ayuuk-exact';
  if (entries.some((entry) => matchesEspanolExact(entry, qText))) return 'espanol-exact';
  return 'partial';
}

function normalizeAudioKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'ʼ´‘`]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function normalizeLetterKey(value) {
  return normalizeAudioKey(value).charAt(0).toUpperCase();
}

function isRealAudio(audio) {
  return Boolean(audio && (['real', 'available', 'disponible'].includes(audio.status) || audio.exists === true));
}

// Solo por slug: buscar por la palabra normalizada quitaba la ë y mezclaba audios
// de palabras distintas (ANËË «baba» sonaba como ANEE «trueno»).
function getAudioInfo(entry, audioManifest = {}) {
  const audio = audioManifest[entry.slug];
  if (isRealAudio(audio)) {
    return { isReal: true, file: audio.file || entry.audio_path };
  }
  return { isReal: false, file: entry.audio_path };
}

const hasAudio = (entry) => getAudioInfo(entry, state.audioManifest).isReal;

/* ---------- Audio ---------- */

let currentAudio = null;
let currentAudioKey = null;
let playingEl = null;

// Con mouse: al detenerse sobre una palabra un instante, suena sola.
// La pausa evita que suenen todas al pasar el cursor por la lista.
let hoverTimer = null;
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function hoverPlay(el, getEntry) {
  if (!canHover) return;
  el.addEventListener('pointerover', (event) => {
    const target = getEntry(event);
    if (!target) return;
    const { entry, node } = target;
    if (node.dataset.hovering === '1') return;
    node.dataset.hovering = '1';
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => playEntryAudio(entry, node), HOVER_DELAY_MS);
  });
  el.addEventListener('pointerout', (event) => {
    const target = getEntry(event);
    if (!target || target.node.contains(event.relatedTarget)) return;
    delete target.node.dataset.hovering;
    clearTimeout(hoverTimer);
  });
}

function setPlaying(el) {
  if (playingEl) playingEl.classList.remove('is-playing');
  playingEl = el;
  if (el) el.classList.add('is-playing');
}

function playEntryAudio(entry, el = null) {
  const info = getAudioInfo(entry, state.audioManifest);
  if (!info.isReal || !info.file) return;

  if (currentAudio && currentAudioKey !== info.file) currentAudio.pause();
  if (!currentAudio || currentAudioKey !== info.file) {
    currentAudio = new Audio(info.file);
    currentAudioKey = info.file;
    currentAudio.addEventListener('ended', () => setPlaying(null));
    currentAudio.addEventListener('error', () => setPlaying(null));
  }
  currentAudio.currentTime = 0;
  setPlaying(el);
  currentAudio.play().catch(() => setPlaying(null));
}

/* ---------- Filtros ---------- */

function clearSearchInput() {
  state.query = '';
  $('searchInput').value = '';
}

function applyBaseFilters(entries) {
  return entries.filter((entry) => {
    const matchCategory = state.category === 'all' || entry.categoria === state.category;
    const matchLetter = state.letter === 'all' || normalizeLetterKey(entry.ayuuk) === state.letter;
    return matchCategory && matchLetter;
  });
}

function applyAudioFilter(entries) {
  if (state.audio === 'all') return entries;
  return entries.filter((entry) => (state.audio === 'available') === hasAudio(entry));
}

function filteredEntries() {
  const qText = normalizeText(state.query);
  const qWord = normalizeWord(state.query);

  // La búsqueda es global: no se queda pegada a un tema o letra anterior.
  if (qText) {
    const mode = getSearchMode(state.entries, qText, qWord);
    return applyAudioFilter(state.entries.filter((entry) => matchesQuery(entry, qText, qWord, mode)));
  }
  return applyAudioFilter(applyBaseFilters(state.entries));
}

function categoryCounts(entries = state.entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.categoria, (counts.get(entry.categoria) || 0) + 1);
  return [...counts.entries()].sort((a, b) => prettyCategory(a[0]).localeCompare(prettyCategory(b[0]), 'es'));
}

function resetPaging() {
  state.visible = PAGE_SIZE;
  state.flashcardIndex = 0;
}

function syncFilterControls() {
  document.querySelectorAll('#categoryStats .chip').forEach((chip) => {
    const on = chip.dataset.category === state.category && !state.query.trim();
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.letter').forEach((btn) => {
    const on = btn.dataset.letter === state.letter && !state.query.trim();
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const filtered = state.category !== 'all' || state.letter !== 'all' || state.audio !== 'all' || state.query.trim();
  $('clearFilters').classList.toggle('hidden', !filtered);
}

function clearAllFilters() {
  state.category = 'all';
  state.letter = 'all';
  state.audio = 'all';
  clearSearchInput();
  resetPaging();
  syncFilterControls();
  render();
}

/* ---------- Construcción ---------- */

async function loadAudioManifest() {
  try {
    const res = await fetch(AUDIO_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return {};
    const manifest = await res.json();
    state.manifestLoaded = true;
    return manifest && typeof manifest === 'object' ? manifest : {};
  } catch (error) {
    console.warn('Audio manifest no disponible:', error);
    return {};
  }
}

function renderStats() {
  const topics = new Set(state.entries.map((e) => e.categoria)).size;
  $('stats').innerHTML = `
    <div><dt>palabras</dt><dd>${fmt(state.entries.length)}</dd></div>
    <div><dt>temas</dt><dd>${fmt(topics)}</dd></div>`;
}

function buildCategoryChips() {
  const chip = (cat, label, icon, count) => `
    <button class="chip" type="button" data-category="${escapeHtml(cat)}" aria-pressed="false">
      <span class="chip__icon" aria-hidden="true">${icon}</span>
      <span>${escapeHtml(label)}</span>
      <span class="chip__count">${fmt(count)}</span>
    </button>`;

  $('categoryStats').innerHTML = chip('all', 'Todas', '✨', state.entries.length)
    + categoryCounts().map(([cat, count]) => chip(cat, prettyCategory(cat), categoryIcon(cat), count)).join('');

  $('categoryStats').addEventListener('click', (event) => {
    const button = event.target.closest('.chip');
    if (!button) return;
    // «Todas» es el único reinicio: muestra el diccionario completo sin ningún filtro.
    if (button.dataset.category === 'all') { clearAllFilters(); return; }
    state.category = button.dataset.category;
    state.letter = 'all';
    clearSearchInput();
    resetPaging();
    syncFilterControls();
    render();
  });
}

function buildAlphabet() {
  const letters = [...new Set(state.entries.map((entry) => normalizeLetterKey(entry.ayuuk)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));

  $('alphabet').innerHTML = letters.map((letter) => `<button class="letter" type="button" data-letter="${letter}">${letter}</button>`).join('');

  $('alphabet').addEventListener('click', (event) => {
    const button = event.target.closest('.letter');
    if (!button) return;
    // Tocar la letra activa la quita.
    state.letter = state.letter === button.dataset.letter ? 'all' : button.dataset.letter;
    clearSearchInput();
    resetPaging();
    syncFilterControls();
    render();
  });
}

function bindEvents() {
  $('searchInput').addEventListener('input', (event) => {
    state.query = event.target.value;
    if (state.query.trim()) {
      state.category = 'all';
      state.letter = 'all';
    }
    resetPaging();
    syncFilterControls();
    render();
  });


  $('clearFilters').addEventListener('click', clearAllFilters);
  $('listModeBtn').addEventListener('click', () => setViewMode('list'));
  $('flashcardModeBtn').addEventListener('click', () => setViewMode('flashcards'));
  $('practiceBtn').addEventListener('click', () => {
    // Practicar es escuchar: empezar solo con palabras que tienen audio.
    state.audio = 'available';
    syncFilterControls();
    setViewMode('flashcards');
    $('flashcardPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('nextCardBtn').addEventListener('click', () => stepFlashcard(1));
  $('prevCardBtn').addEventListener('click', () => stepFlashcard(-1));
  // Toda la tarjeta (no solo el botón) reproduce el audio.
  $('flashcard').addEventListener('click', () => {
    const entry = filteredEntries()[state.flashcardIndex];
    if (entry) playEntryAudio(entry, $('flashcard'));
  });

  hoverPlay($('results'), (event) => {
    const node = event.target.closest('.card.has-audio');
    const entry = node && state.entries[Number(node.dataset.index)];
    return entry ? { entry, node } : null;
  });
  hoverPlay($('flashcard'), () => {
    const entry = filteredEntries()[state.flashcardIndex];
    return entry && hasAudio(entry) ? { entry, node: $('flashcard') } : null;
  });

  $('results').addEventListener('click', (event) => {
    const card = event.target.closest('.card.has-audio');
    if (!card) return;
    const entry = state.entries[Number(card.dataset.index)];
    if (entry) playEntryAudio(entry, card);
  });

  $('results').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.card.has-audio');
    if (!card) return;
    event.preventDefault();
    card.click();
  });

  $('moreBox').addEventListener('click', (event) => {
    if (!event.target.closest('button')) return;
    state.visible += PAGE_SIZE;
    renderList(filteredEntries());
  });

  const dialog = $('helpDialog');
  $('helpBtn').addEventListener('click', () => dialog.showModal());
  $('helpClose').addEventListener('click', () => dialog.close());
  $('helpOk').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  document.addEventListener('keydown', (event) => {
    if (state.viewMode !== 'flashcards' || dialog.open) return;
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowRight') stepFlashcard(1);
    else if (event.key === 'ArrowLeft') stepFlashcard(-1);
    else if (event.key === ' ' || event.key.toLowerCase() === 'a') { event.preventDefault(); $('flashcard').click(); }
  });
}

/* ---------- Render ---------- */

function setViewMode(mode) {
  state.viewMode = mode;
  resetPaging();
  $('listModeBtn').classList.toggle('active', mode === 'list');
  $('flashcardModeBtn').classList.toggle('active', mode === 'flashcards');
  $('results').classList.toggle('hidden', mode === 'flashcards');
  $('moreBox').classList.toggle('hidden', mode === 'flashcards');
  $('flashcardPanel').classList.toggle('hidden', mode !== 'flashcards');
  render();
  if (mode === 'flashcards') playCurrentFlashcard();
}

function render() {
  // Sin título de resultados: el encabezado da los totales y cada tarjeta dice su tema.
  const entries = filteredEntries();

  if (state.viewMode === 'flashcards') renderFlashcards(entries);
  else renderList(entries);
}

function emptyMessage() {
  const q = state.query.trim();
  return q
    ? `<div class="empty">No encontramos <strong>“${escapeHtml(q)}”</strong>.<br>Revisa la ë o el apóstrofo (’), o prueba buscar en español.</div>`
    : '<div class="empty">No hay palabras con estos filtros. Prueba con <strong>Todas</strong> en Temas o en Audio.</div>';
}

function renderList(entries) {
  if (entries.length === 0) {
    $('results').innerHTML = emptyMessage();
    $('moreBox').innerHTML = '';
    return;
  }
  const visibleEntries = entries.slice(0, state.visible);
  $('results').innerHTML = visibleEntries.map(cardTemplate).join('');
  const left = entries.length - visibleEntries.length;
  $('moreBox').innerHTML = left > 0
    ? `<button class="btn btn--soft" type="button">Ver ${fmt(Math.min(left, PAGE_SIZE))} palabras más</button>`
    : '';
}

function cardTemplate(entry) {
  const info = getAudioInfo(entry, state.audioManifest);
  const catClass = `cat-${normalizeAudioKey(entry.categoria)}`;
  const index = state.entries.indexOf(entry);
  // La tarjeta misma es el control de audio: sin botón, para un diseño limpio.
  const audioAttrs = info.isReal ? ` tabindex="0" role="button" aria-label="${escapeHtml(entry.ayuuk)}, ${escapeHtml(entry.espanol)}. Escuchar"` : '';
  const pending = info.isReal ? '' : '<span class="pending"> · sin audio aún</span>';
  const note = entry.nota ? `<div class="voice">Nota: ${escapeHtml(entry.nota)}</div>` : '';

  return `<article class="card ${catClass}${info.isReal ? ' has-audio' : ''}" data-index="${index}"${audioAttrs}>
    <div class="word" lang="mir">${escapeHtml(entry.ayuuk)}</div>
    <div class="meaning">${escapeHtml(entry.espanol)}</div>
    <div class="tag">${escapeHtml(prettyCategory(entry.categoria))}${pending}</div>
    ${note}
  </article>`;
}

function renderFlashcards(entries) {
  const disabled = entries.length === 0;
  ['nextCardBtn', 'prevCardBtn', 'flashcardPlay'].forEach((id) => { $(id).disabled = disabled; });
  if (disabled) {
    $('flashcardFront').textContent = 'Sin tarjetas';
    $('flashcardBack').textContent = '';
    $('flashcardPlay').classList.add('hidden');
    $('flashcardMeta').textContent = 'No hay palabras con estos filtros.';
    return;
  }

  if (state.flashcardIndex >= entries.length) state.flashcardIndex = 0;
  const entry = entries[state.flashcardIndex];
  const info = getAudioInfo(entry, state.audioManifest);

  $('flashcard').className = `flashcard cat-${normalizeAudioKey(entry.categoria)}${info.isReal ? ' has-audio' : ''}`;
  $('flashcardFront').textContent = entry.ayuuk;
  $('flashcardPlay').classList.toggle('hidden', !info.isReal);
  $('flashcardPlay').setAttribute('aria-label', `Escuchar ${entry.ayuuk}`);
  $('flashcardBack').textContent = entry.espanol;
  $('flashcardMeta').textContent = `${fmt(state.flashcardIndex + 1)} de ${fmt(entries.length)}`;
}

function playCurrentFlashcard() {
  const entry = filteredEntries()[state.flashcardIndex];
  if (entry && hasAudio(entry)) playEntryAudio(entry, $('flashcard'));
}

function stepFlashcard(delta) {
  const entries = filteredEntries();
  if (!entries.length) return;
  state.flashcardIndex = (state.flashcardIndex + delta + entries.length) % entries.length;
  renderFlashcards(entries);
  playCurrentFlashcard();
}

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

async function bootstrap() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`No se pudo cargar el diccionario (${res.status})`);
    const data = await res.json();
    state.metadata = data.metadata || {};
    state.entries = prepareEntries(data.entries || data);
  } catch (error) {
    console.error(error);
    $('stats').innerHTML = '<div><dt>No se pudo cargar el diccionario</dt></div>';
    $('results').innerHTML = '<div class="empty">No pudimos cargar el diccionario. Revisa tu conexión y vuelve a intentar.</div>';
    return;
  }

  state.audioManifest = await loadAudioManifest();
  renderStats();
  buildCategoryChips();
  buildAlphabet();
  bindEvents();
  syncFilterControls();
  render();
}

bootstrap();
