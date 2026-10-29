const APP_VERSION = 'v4.1.4-audio-hover-tap';
const DATA_URL = `data/diccionario_mixe_dataset.json?v=${APP_VERSION}`;
const AUDIO_MANIFEST_URL = `data/audio_manifest.json?v=${APP_VERSION}`;
const GENERAL_CATEGORY = 'vocabulario_general';

const state = {
  entries: [],
  metadata: {},
  query: '',
  category: 'all',
  audio: 'all',
  letter: 'all',
  viewMode: 'list',
  flashcardIndex: 0,
  flashcardRevealed: false,
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

const prettyCategory = (cat) => (cat || 'sin_categoria').replaceAll('_', ' ');

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
      source_categories: Array.isArray(entry.source_categories) ? entry.source_categories : [entry.categoria || GENERAL_CATEGORY],
      dedupe_count: entry.dedupe_count || 1,
      nota: entry.nota || '',
      audio_status: entry.audio_status || 'pendiente'
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

  if (mode === 'ayuuk-exact') {
    return normalizeWord(entry.ayuuk) === qWord;
  }

  if (mode === 'espanol-exact') {
    return matchesEspanolExact(entry, qText);
  }

  return matchesPartial(entry, qText, qWord);
}

function getSearchMode(entries, qText, qWord) {
  if (!qText) return 'all';

  if (entries.some((entry) => normalizeWord(entry.ayuuk) === qWord)) {
    return 'ayuuk-exact';
  }

  if (entries.some((entry) => matchesEspanolExact(entry, qText))) {
    return 'espanol-exact';
  }

  return 'partial';
}

function normalizeAudioKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'ʼ´‘`]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function normalizeLetterKey(value) {
  return normalizeAudioKey(value).charAt(0).toUpperCase();
}

function resetLetterFilter() {
  state.letter = 'all';
  document.querySelectorAll('.letter').forEach((item) => {
    item.classList.toggle('active', item.dataset.letter === 'all');
  });
}

function resetCategoryFilter() {
  state.category = 'all';
  const select = $('categorySelect');
  if (select) select.value = 'all';
  updateCategoryPills();
}

function resetAudioFilter() {
  state.audio = 'all';
  const select = $('audioSelect');
  if (select) select.value = 'all';
}

function clearSearchInput() {
  state.query = '';
  const input = $('searchInput');
  if (input) input.value = '';
}

function isRealAudio(audio) {
  return Boolean(
    audio
    && (
      audio.status === 'real'
      || audio.status === 'available'
      || audio.status === 'disponible'
      || audio.exists === true
    )
  );
}

function getAudioInfo(entry, audioManifest = {}) {
  const candidates = [
    entry.slug,
    normalizeAudioKey(entry.slug),
    entry.audio_file,
    normalizeAudioKey(entry.audio_file),
    entry.audio_path,
    normalizeAudioKey(entry.audio_path),
    String(entry.id),
    normalizeAudioKey(entry.ayuuk)
  ].filter(Boolean);

  for (const key of candidates) {
    const audio = audioManifest[key] || audioManifest[normalizeAudioKey(key)];
    if (isRealAudio(audio)) {
      return {
        isReal: true,
        file: audio.file || entry.audio_path,
        voz: audio.voz || '',
        manifestKey: key,
        source: 'manifest'
      };
    }
  }

  return {
    isReal: false,
    file: entry.audio_path,
    manifestKey: null,
    source: 'pending'
  };
}

function hasAudio(entry) {
  return getAudioInfo(entry, state.audioManifest).isReal;
}

function audioPath(entry) {
  const info = getAudioInfo(entry, state.audioManifest);
  return info.file || entry.audio_path || `audio/${entry.audio_file}`;
}

let currentAudio = null;
let currentAudioKey = null;

function canAutoPlayFromPointer() {
  return window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
}

function playEntryAudio(entry, audioManifest) {
  const audioInfo = getAudioInfo(entry, audioManifest);

  if (!audioInfo.isReal || !audioInfo.file) return;

  const nextKey = audioInfo.file;

  if (currentAudio && currentAudioKey !== nextKey) {
    stopCurrentAudio();
  }

  if (!currentAudio || currentAudioKey !== nextKey) {
    currentAudio = new Audio(audioInfo.file);
    currentAudioKey = nextKey;
  }

  currentAudio.currentTime = 0;

  currentAudio.play().catch(() => {
    // Browser autoplay policy may block until first user interaction.
  });
}

function bindCardAudio(card, entry) {
  const audioInfo = getAudioInfo(entry, state.audioManifest);
  if (!audioInfo.isReal) return;

  card.addEventListener('pointerenter', () => {
    if (canAutoPlayFromPointer()) playEntryAudio(entry, state.audioManifest);
  });

  card.addEventListener('click', () => {
    if (!canAutoPlayFromPointer()) playEntryAudio(entry, state.audioManifest);
  });
}

function syncFilterControls() {
  const categorySelect = $('categorySelect');
  const audioSelect = $('audioSelect');
  if (categorySelect) categorySelect.value = state.category;
  if (audioSelect) audioSelect.value = state.audio;
  updateCategoryPills();
  document.querySelectorAll('.letter').forEach((item) => {
    item.classList.toggle('active', item.dataset.letter === state.letter);
  });
  const controls = $('controls');
  if (controls) controls.classList.toggle('is-searching', Boolean(state.query.trim()));
}

function applyBaseFilters(entries) {
  return entries.filter((entry) => {
    const matchCategory = state.category === 'all' || entry.categoria === state.category;
    const first = normalizeLetterKey(entry.ayuuk);
    const matchLetter = state.letter === 'all' || first === state.letter;
    const audioAvailable = hasAudio(entry);
    const matchAudio = state.audio === 'all'
      || (state.audio === 'available' && audioAvailable)
      || (state.audio === 'missing' && !audioAvailable);

    return matchCategory && matchLetter && matchAudio;
  });
}

function applyAudioFilter(entries) {
  if (state.audio === 'all') return entries;

  return entries.filter((entry) => {
    const audioAvailable = hasAudio(entry);
    return (state.audio === 'available' && audioAvailable)
      || (state.audio === 'missing' && !audioAvailable);
  });
}

function filteredEntries() {
  const qText = normalizeText(state.query);
  const qWord = normalizeWord(state.query);

  // La búsqueda es global: no debe quedarse pegada a una categoría, letra o filtro de audio anterior.
  if (qText) {
    const searchMode = getSearchMode(state.entries, qText, qWord);
    return applyAudioFilter(state.entries.filter((entry) => matchesQuery(entry, qText, qWord, searchMode)));
  }

  return applyBaseFilters(state.entries);
}

function categoryCounts(entries = state.entries) {
  const counts = new Map();
  for (const entry of entries) {
    const cat = entry.categoria || GENERAL_CATEGORY;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => prettyCategory(a[0]).localeCompare(prettyCategory(b[0]), 'es'));
}

async function bootstrap() {
  let datasetLoaded = false;

  try {
    const dataRes = await fetch(DATA_URL, { cache: 'no-store' });
    if (!dataRes.ok) {
      throw new Error(`No se pudo cargar el dataset (${dataRes.status})`);
    }

    const data = await dataRes.json();
    state.metadata = data.metadata || {};
    state.entries = prepareEntries(data.entries || data);
    datasetLoaded = true;
  } catch (error) {
    console.error(error);
    $('stats').textContent = 'No se pudo cargar el dataset';
    $('metaStats').textContent = '';
    $('results').innerHTML = `<div class="empty">No pudimos cargar <code>${escapeHtml(DATA_URL)}</code>. Verifica que el archivo exista y vuelve a intentar.</div>`;
    return;
  }

  state.audioManifest = await loadAudioManifest();

  const totalEntries = state.metadata.total_entries || state.entries.length;
  const datasetVersion = state.metadata.version || APP_VERSION;
  const rawEntries = state.metadata.raw_entries || state.entries.length;
  const uniqueEntries = state.metadata.unique_entries || state.entries.length;

  $('stats').textContent = `${uniqueEntries.toLocaleString('es-MX')} palabras en el diccionario`;
  $('metaStats').innerHTML = `
    <span>Versión ${escapeHtml(datasetVersion)}</span>
    <span>${totalEntries.toLocaleString('es-MX')} entradas totales</span>
    <span>${rawEntries.toLocaleString('es-MX')} registros fuente</span>
    ${state.manifestLoaded ? '' : '<span>Audio manifest no disponible</span>'}
  `;

  if (!datasetLoaded || state.entries.length === 0) {
    $('results').innerHTML = '<div class="empty">El dataset está vacío o no contiene entradas válidas.</div>';
    return;
  }

  buildCategories();
  buildCategoryStats();
  buildAlphabet();
  bindEvents();
  syncFilterControls();
  render();
}

async function loadAudioManifest() {
  try {
    const res = await fetch(AUDIO_MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) {
      state.manifestLoaded = false;
      return {};
    }

    const manifest = await res.json();
    state.manifestLoaded = true;

    if (Array.isArray(manifest.files)) {
      const legacy = {};
      for (const file of manifest.files) {
        const slug = file.replace(/\.mp3$/i, '');
        legacy[slug] = {
          file: file.startsWith('audio/') ? file : `audio/${file}`,
          status: 'disponible'
        };
      }
      return legacy;
    }

    return manifest && typeof manifest === 'object' ? manifest : {};
  } catch (error) {
    console.warn('Audio manifest no disponible:', error);
    state.manifestLoaded = false;
    return {};
  }
}

function buildCategories() {
  const select = $('categorySelect');
  select.innerHTML = `<option value="all">Todas (${state.entries.length.toLocaleString('es-MX')})</option>`;

  for (const [cat, count] of categoryCounts()) {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = `${prettyCategory(cat)} (${count.toLocaleString('es-MX')})`;
    select.appendChild(option);
  }
}

function buildCategoryStats() {
  const container = $('categoryStats');
  const counts = categoryCounts();
  const total = state.entries.length;

  container.innerHTML = `
    <button class="category-pill ${state.category === 'all' ? 'active' : ''}" type="button" data-category="all">
      <span>Todas</span>
      <strong>${total.toLocaleString('es-MX')}</strong>
    </button>
  ` + counts.map(([cat, count]) => `
    <button class="category-pill ${state.category === cat ? 'active' : ''}" type="button" data-category="${escapeHtml(cat)}">
      <span>${escapeHtml(prettyCategory(cat))}</span>
      <strong>${count.toLocaleString('es-MX')}</strong>
    </button>
  `).join('');

  container.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.category = button.dataset.category;
      $('categorySelect').value = state.category;
      clearSearchInput();
      resetLetterFilter();
      resetAudioFilter();
      state.flashcardIndex = 0;
      state.flashcardRevealed = false;
      syncFilterControls();
      render();
    });
  });
}

function updateCategoryPills() {
  document.querySelectorAll('.category-pill').forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.category === state.category);
  });
}

function buildAlphabet() {
  const letters = ['Todas', ...new Set(state.entries.map((entry) => normalizeLetterKey(entry.ayuuk)).filter(Boolean))]
    .sort((a, b) => (a === 'Todas' ? -1 : b === 'Todas' ? 1 : a.localeCompare(b, 'es')));

  $('alphabet').innerHTML = letters.map((letter) => `
    <button class="letter ${letter === 'Todas' ? 'active' : ''}" type="button" data-letter="${letter === 'Todas' ? 'all' : letter}">${letter}</button>
  `).join('');

  $('alphabet').addEventListener('click', (event) => {
    const button = event.target.closest('.letter');
    if (!button) return;
    state.letter = button.dataset.letter;
    clearSearchInput();
    resetAudioFilter();
    state.flashcardIndex = 0;
    state.flashcardRevealed = false;
    syncFilterControls();
    render();
  });
}

function bindEvents() {
  const onSearchChange = (event) => {
    state.query = event.target.value;

    if (state.query.trim()) {
      // Search is intentionally global: writing in the search box clears category, letter and audio filters.
      state.category = 'all';
      state.letter = 'all';
      state.audio = 'all';
    }

    state.flashcardIndex = 0;
    state.flashcardRevealed = false;
    syncFilterControls();
    render();
  };

  ['input', 'keyup', 'search', 'change'].forEach((eventName) => {
    $('searchInput').addEventListener(eventName, onSearchChange);
  });

  $('categorySelect').addEventListener('change', (event) => {
    state.category = event.target.value;
    clearSearchInput();
    resetLetterFilter();
    resetAudioFilter();
    state.flashcardIndex = 0;
    state.flashcardRevealed = false;
    syncFilterControls();
    render();
  });

  $('audioSelect').addEventListener('change', (event) => {
    state.audio = event.target.value;
    state.flashcardIndex = 0;
    state.flashcardRevealed = false;
    syncFilterControls();
    render();
  });

  $('listModeBtn').addEventListener('click', () => setViewMode('list'));
  $('flashcardModeBtn').addEventListener('click', () => setViewMode('flashcards'));
  $('revealBtn').addEventListener('click', revealFlashcard);
  $('nextCardBtn').addEventListener('click', nextFlashcard);
}

function setViewMode(mode) {
  state.viewMode = mode;
  state.flashcardIndex = 0;
  state.flashcardRevealed = false;
  $('listModeBtn').classList.toggle('active', mode === 'list');
  $('flashcardModeBtn').classList.toggle('active', mode === 'flashcards');
  $('results').classList.toggle('hidden', mode === 'flashcards');
  $('flashcardPanel').classList.toggle('hidden', mode !== 'flashcards');
  $('alphabet').classList.toggle('hidden', mode === 'flashcards');
  $('resultsTitle').textContent = mode === 'flashcards' ? 'Modo tarjetas' : 'Resultados';
  render();
}

function render() {
  const entries = filteredEntries();
  $('resultCount').textContent = `${entries.length.toLocaleString('es-MX')} resultado(s)`;

  if (state.viewMode === 'flashcards') {
    renderFlashcards(entries);
    return;
  }

  renderList(entries);
}

function renderList(entries) {
  const max = 120;

  if (entries.length === 0) {
    const label = state.query.trim() ? `“${escapeHtml(state.query.trim())}”` : 'la búsqueda actual';
    $('results').innerHTML = `<div class="empty">No existe ${label} en el diccionario cargado. Revisa acentos, apóstrofes o prueba otra categoría.</div>`;
    return;
  }

  const visibleEntries = entries.slice(0, max);
  $('results').innerHTML = visibleEntries.map(cardTemplate).join('')
    + (entries.length > max ? `<div class="empty">Mostrando ${max} de ${entries.length}. Usa búsqueda o filtros para acotar más.</div>` : '');

  $('results').querySelectorAll('.card').forEach((card, index) => {
    bindCardAudio(card, visibleEntries[index]);
  });
}

function renderFlashcards(entries) {
  if (entries.length === 0) {
    $('flashcardFront').textContent = 'Sin tarjetas';
    $('flashcardBack').textContent = '';
    $('flashcardBack').classList.add('hidden');
    $('flashcardMeta').textContent = 'No hay entradas para la categoría o búsqueda actual.';
    $('revealBtn').disabled = true;
    $('nextCardBtn').disabled = true;
    return;
  }

  if (state.flashcardIndex >= entries.length) {
    state.flashcardIndex = 0;
  }

  const entry = entries[state.flashcardIndex];
  const audioInfo = getAudioInfo(entry, state.audioManifest);
  const flashcard = $('flashcard');
  const freshFlashcard = flashcard.cloneNode(true);

  freshFlashcard.classList.toggle('has-audio', audioInfo.isReal);
  flashcard.replaceWith(freshFlashcard);

  $('flashcardFront').textContent = entry.ayuuk;
  $('flashcardBack').innerHTML = `
    <div class="flashcard__answer">${escapeHtml(entry.espanol)}</div>
    <div class="flashcard__category">${escapeHtml(prettyCategory(entry.categoria))}</div>
  `;
  $('flashcardBack').classList.toggle('hidden', !state.flashcardRevealed);
  $('revealBtn').disabled = false;
  $('nextCardBtn').disabled = false;
  $('revealBtn').textContent = state.flashcardRevealed ? 'Ocultar respuesta' : 'Mostrar respuesta';
  $('flashcardMeta').innerHTML = `
    Tarjeta ${state.flashcardIndex + 1} de ${entries.length}
    ${audioInfo.isReal ? '<span class="audio-icon audio-icon--inline" aria-hidden="true">🔊</span>' : ' · <span class="badge missing">Sin audio todavía</span>'}
  `;

  if (audioInfo.isReal) {
    bindCardAudio($('flashcard'), entry);
  }
}

function revealFlashcard() {
  state.flashcardRevealed = !state.flashcardRevealed;
  renderFlashcards(filteredEntries());
}

function nextFlashcard() {
  const entries = filteredEntries();
  if (!entries.length) return;
  state.flashcardIndex = (state.flashcardIndex + 1) % entries.length;
  state.flashcardRevealed = false;
  renderFlashcards(entries);
}

function cardTemplate(entry) {
  const audioInfo = getAudioInfo(entry, state.audioManifest);
  const categorySlug = normalizeAudioKey(entry.categoria || GENERAL_CATEGORY);
  const audioControl = audioInfo.isReal
    ? `<span class="audio-icon" aria-hidden="true">🔊</span>${audioInfo.voz ? `<span class="voice">Voz: ${escapeHtml(audioInfo.voz)}</span>` : ''}`
    : '<span class="badge missing">Sin audio todavía</span>';
  const note = entry.nota
    ? `<div class="note">Nota: ${escapeHtml(entry.nota)}</div>`
    : '';

  return `<article class="card category-${escapeHtml(categorySlug)}${audioInfo.isReal ? ' has-audio' : ' no-audio'}">
    <div class="card__top">
      <div>
        <div class="word">${escapeHtml(entry.ayuuk)}</div>
        <div class="meaning">${escapeHtml(entry.espanol)}</div>
      </div>
    </div>
    <div class="audioRow">
      ${audioControl}
    </div>
    ${note}
  </article>`;
}

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

bootstrap();
