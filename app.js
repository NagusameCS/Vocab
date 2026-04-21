// ============================================================
// IB Study — multi-subject site
// Routing:
//   #/                      → landing (course selection)
//   #/<subject>             → subject TOC
//   #/<subject>/<id>        → topic view
// ============================================================

const SUBJECTS = {
  business: {
    title: 'Business Management',
    tag: 'IB Diploma · Business',
    sub: 'Topic summaries and self-assessment drawn from the syllabus objectives.',
    content: 'business/content.json',
    units: {
      1: 'Introduction to business management',
      2: 'Human resource management',
      3: 'Finance and accounts',
      4: 'Marketing',
      5: 'Operations management',
    },
    desc: 'Oxford IB Prepared · 5 units, 37 topics',
    source: 'IB Prepared (Lomine, 2023)',
  },
  chemistry: {
    title: 'Chemistry',
    tag: 'IB Diploma · Chemistry',
    sub: 'Core concepts from Structure and Reactivity themes with self-assessment quizzes.',
    content: 'chemistry/content.json',
    units: {
      1: 'Structure 1 · Models of the particulate nature of matter',
      2: 'Structure 2 · Models of bonding and structure',
      3: 'Structure 3 · Classification of matter',
      4: 'Reactivity 1 · What drives chemical reactions?',
      5: 'Reactivity 2 · How much, how fast, how far?',
      6: 'Reactivity 3 · What are the mechanisms of chemical change?',
    },
    desc: 'Oxford IB Prepared · Structure & Reactivity themes',
    source: 'IB Prepared (Bylikin, 2024)',
  },
  math: {
    title: 'Mathematics: Analysis and Approaches',
    tag: 'IB Diploma · Math AA',
    sub: 'Algebra, functions, geometry, statistics, and calculus with worked quiz markschemes.',
    content: 'math/content.json',
    units: {
      1: 'Number and algebra',
      2: 'Functions',
      3: 'Geometry and trigonometry',
      4: 'Statistics and probability',
      5: 'Calculus',
    },
    desc: 'Oxford IB Prepared · 5 units',
    source: 'IB Prepared (Oxford, 2021)',
  },
  physics: {
    title: 'Physics',
    tag: 'IB Diploma · Physics',
    sub: 'Themes A–E covering motion, matter, waves, fields, and nuclear/quantum physics.',
    content: 'physics/content.json',
    units: {
      1: 'A · Space, time and motion',
      2: 'B · The particulate nature of matter',
      3: 'C · Wave behaviour',
      4: 'D · Fields',
      5: 'E · Nuclear and quantum physics',
    },
    desc: 'Tim Kirk Study Guide · 5 themes',
    source: 'Study Guide (Kirk, 2023)',
  },
  dt: {
    title: 'Design & Technology',
    tag: 'IB Diploma · D&T',
    sub: 'Human factors, materials, modelling, innovation, and (HL) user-centred design.',
    content: 'dt/content.json',
    units: {
      1: 'Human factors and ergonomics',
      2: 'Resource management and sustainable production',
      3: 'Modelling',
      4: 'Raw material to final product',
      5: 'Innovation and design',
      6: 'Classic design',
      7: 'User-centred design (HL)',
      8: 'Sustainability (HL)',
      9: 'Innovation and markets (HL)',
      10: 'Commercial production (HL)',
    },
    desc: 'Metcalfe textbook · Core + HL extensions',
    source: 'IBID (Metcalfe, 2015)',
  },
};

const SUBJECT_ORDER = ['business', 'chemistry', 'math', 'physics', 'dt'];

let CURRENT_SUBJECT = null;
let DATA = [];
let BY_ID = {};
const CACHE = {};

// Global search index — built once after all subjects are prefetched.
let SEARCH_INDEX = [];
let SEARCH_READY = false;

// ============================================================
// KaTeX rendering — call after any DOM write that may contain math
// ============================================================
function renderMath(root) {
  if (!root) return;
  if (typeof window.renderMathInElement !== 'function') return;
  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$',  right: '$',  display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
  } catch (e) { /* swallow — KaTeX never blocks content */ }
}

// ============================================================
// Search — greedy substring (fast path) + Levenshtein (fuzzy)
// ============================================================
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // early exit if lengths wildly differ
  if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.7 + 2) {
    return Math.max(a.length, b.length);
  }
  let prev = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) prev[i] = i;
  let curr = new Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a.charCodeAt(i) === b.charCodeAt(j) ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j] + 1,
        prev[j + 1] + 1,
        prev[j] + cost
      );
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[b.length];
}

function scoreEntry(entry, q) {
  // q is already lowercased & trimmed
  const hay = entry.searchText; // already lowercased
  const title = entry.titleLower;
  const id = entry.idLower;

  // Tier 1: exact id match
  if (id === q) return 1000;
  // Tier 2: id prefix
  if (id.startsWith(q)) return 900 - (id.length - q.length);
  // Tier 3: title starts with query
  if (title.startsWith(q)) return 800 - (title.length - q.length) * 0.1;
  // Tier 4: title contains query
  const titleIdx = title.indexOf(q);
  if (titleIdx !== -1) return 700 - titleIdx;
  // Tier 5: full text contains query as substring (greedy)
  const hayIdx = hay.indexOf(q);
  if (hayIdx !== -1) return 500 - Math.min(hayIdx, 400) * 0.5;

  // Tier 6: Levenshtein per token against title words (only if query is >= 3 chars)
  if (q.length < 3) return -1;
  const tokens = entry.tokens;
  let best = Infinity;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    // Skip tokens whose length differs too much (cheap)
    if (Math.abs(t.length - q.length) > Math.ceil(q.length * 0.5) + 1) continue;
    const d = levenshtein(q, t);
    if (d < best) best = d;
    if (best === 0) break;
  }
  const norm = best / Math.max(q.length, 1);
  if (norm > 0.45) return -1;
  return 300 - norm * 400;
}

function firstSentence(md) {
  if (!md) return '';
  const plain = String(md).replace(/[#*_`>]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = plain.match(/^(.{0,180}?[.!?])(\s|$)/);
  return m ? m[1] : plain.slice(0, 180);
}

function tokenize(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

async function buildSearchIndex() {
  const all = [];
  for (const key of SUBJECT_ORDER) {
    const s = SUBJECTS[key];
    try {
      const res = await fetch(s.content);
      if (!res.ok) continue;
      const data = await res.json();
      if (!CACHE[key]) CACHE[key] = data;
      for (const c of data) {
        const title = c.title || '';
        const id = (c.id || '').toString();
        const objs = (c.objectives || []).join(' ');
        const snip = firstSentence(c.summary);
        const searchText = (title + ' ' + id + ' ' + objs + ' ' + snip).toLowerCase();
        all.push({
          subj: key,
          subjTitle: s.title,
          id,
          idLower: id.toLowerCase(),
          title,
          titleLower: title.toLowerCase(),
          hl: c.hl,
          unit: c.unit,
          snippet: snip,
          searchText,
          tokens: tokenize(title + ' ' + objs),
        });
      }
    } catch (e) { /* skip */ }
  }
  SEARCH_INDEX = all;
  SEARCH_READY = true;
}

function runSearch(raw) {
  const q = String(raw || '').toLowerCase().trim();
  if (!q) return [];
  if (!SEARCH_READY) return [];
  const results = [];
  for (let i = 0; i < SEARCH_INDEX.length; i++) {
    const score = scoreEntry(SEARCH_INDEX[i], q);
    if (score > 0) results.push({ entry: SEARCH_INDEX[i], score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 25);
}

function highlightMatch(text, q) {
  if (!q) return escapeHtml(text);
  const t = String(text || '');
  const lo = t.toLowerCase();
  const idx = lo.indexOf(q);
  if (idx === -1) return escapeHtml(t);
  return escapeHtml(t.slice(0, idx)) + '<mark>' + escapeHtml(t.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(t.slice(idx + q.length));
}

let SEARCH_ACTIVE_INDEX = 0;
let SEARCH_LAST_RESULTS = [];

function renderSearchResults(query) {
  const resEl = document.getElementById('search-results');
  if (!resEl) return;
  if (!query || !query.trim()) {
    resEl.innerHTML = '<div class="search-empty">Type to search topics, objectives, and vocabulary across all subjects.</div>';
    SEARCH_LAST_RESULTS = [];
    return;
  }
  if (!SEARCH_READY) {
    resEl.innerHTML = '<div class="search-empty">Building search index…</div>';
    return;
  }
  const results = runSearch(query);
  SEARCH_LAST_RESULTS = results;
  SEARCH_ACTIVE_INDEX = 0;
  if (!results.length) {
    resEl.innerHTML = '<div class="search-empty">No matches. Try a shorter query.</div>';
    return;
  }
  const q = query.toLowerCase().trim();
  resEl.innerHTML = results.map((r, i) => {
    const e = r.entry;
    return `
      <a class="search-result${i === 0 ? ' active' : ''}" data-i="${i}" href="#/${e.subj}/${encodeURIComponent(e.id)}">
        <div class="sr-top">
          <span class="sr-subj">${escapeHtml(e.subjTitle)}</span>
          <span class="sr-id">${escapeHtml(e.id)}</span>
          ${hlBadge(e.hl)}
        </div>
        <div class="sr-title">${highlightMatch(e.title, q)}</div>
        ${e.snippet ? `<div class="sr-snippet">${highlightMatch(e.snippet, q)}</div>` : ''}
      </a>
    `;
  }).join('');
  resEl.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => closeSearch());
    el.addEventListener('mousemove', () => setActiveResult(Number(el.dataset.i)));
  });
}

function setActiveResult(i) {
  const items = document.querySelectorAll('#search-results .search-result');
  if (!items.length) return;
  SEARCH_ACTIVE_INDEX = Math.max(0, Math.min(items.length - 1, i));
  items.forEach((el, idx) => el.classList.toggle('active', idx === SEARCH_ACTIVE_INDEX));
  items[SEARCH_ACTIVE_INDEX].scrollIntoView({ block: 'nearest' });
}

function openSearch() {
  const topBar = document.getElementById('top-bar');
  const inp = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const backdrop = document.getElementById('search-backdrop-inline');
  if (!topBar || !inp) return;
  topBar.classList.add('search-open');
  if (results) results.classList.remove('hidden');
  if (backdrop) backdrop.classList.remove('hidden');
  setTimeout(() => { inp.focus(); }, 420);
  renderSearchResults(inp.value);
}

function closeSearch() {
  const topBar = document.getElementById('top-bar');
  const inp = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const backdrop = document.getElementById('search-backdrop-inline');
  if (!topBar) return;
  topBar.classList.remove('search-open');
  if (results) results.classList.add('hidden');
  if (backdrop) backdrop.classList.add('hidden');
  if (inp) { inp.value = ''; inp.blur(); }
}

function initSearch() {
  const trigger = document.getElementById('search-trigger');
  const input = document.getElementById('search-input');
  const backdrop = document.getElementById('search-backdrop-inline');
  if (!trigger || !input) return;

  trigger.addEventListener('click', () => {
    const topBar = document.getElementById('top-bar');
    if (topBar && topBar.classList.contains('search-open')) { closeSearch(); } else { openSearch(); }
  });
  if (backdrop) backdrop.addEventListener('click', closeSearch);

  let debounceT;
  input.addEventListener('input', () => {
    clearTimeout(debounceT);
    const v = input.value;
    debounceT = setTimeout(() => renderSearchResults(v), 80);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveResult(SEARCH_ACTIVE_INDEX + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveResult(SEARCH_ACTIVE_INDEX - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const items = document.querySelectorAll('#search-results .search-result');
      const el = items[SEARCH_ACTIVE_INDEX];
      if (el) {
        window.location.hash = el.getAttribute('href');
        closeSearch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    // '/' to open (when not already typing in an input)
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openSearch();
    } else if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape') {
      const topBar = document.getElementById('top-bar');
      if (topBar && topBar.classList.contains('search-open')) closeSearch();
    }
  });
}

// ------- Markdown (minimal) -------
function renderMarkdown(src) {
  if (!src) return '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const inline = (t) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + items.join('') + '</ul>');
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return out.join('\n');
}

function hlBadge(hl) {
  const norm = (hl || '').toString().toLowerCase().replace(/[_ ]/g, '-');
  if (norm === 'hl') return '<span class="badge hl">HL</span>';
  if (norm === 'some-hl' || norm === 'somehl') return '<span class="badge some-hl">Some HL</span>';
  return '<span class="badge sl">SL</span>';
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------- Landing -------
function renderLanding() {
  const grid = document.getElementById('course-grid');
  grid.innerHTML = SUBJECT_ORDER.map(key => {
    const s = SUBJECTS[key];
    return `
      <a href="#/${key}" class="course-card">
        <span class="c-tag">${s.tag}</span>
        <h2>${s.title}</h2>
        <p>${s.sub}</p>
        <div class="c-meta"><span>${s.desc}</span></div>
      </a>
    `;
  }).join('');
}

// ------- Subject TOC -------
async function loadSubject(key) {
  if (CACHE[key]) { DATA = CACHE[key]; BY_ID = Object.fromEntries(DATA.map(c => [c.id, c])); return true; }
  const s = SUBJECTS[key];
  if (!s) return false;
  try {
    const res = await fetch(s.content);
    if (!res.ok) throw new Error('fetch failed');
    let data = await res.json();
    // Sort by id — handles "A.1" and "1.1" both
    data.sort((a, b) => {
      const ak = (a.id || '').toString();
      const bk = (b.id || '').toString();
      const [aLetter, aRest] = [ak.match(/^[A-Za-z]+/)?.[0] || '', ak.replace(/^[A-Za-z]+/, '')];
      const [bLetter, bRest] = [bk.match(/^[A-Za-z]+/)?.[0] || '', bk.replace(/^[A-Za-z]+/, '')];
      if (aLetter !== bLetter) return aLetter.localeCompare(bLetter);
      const [a1, a2] = aRest.split('.').map(n => Number(n) || 0);
      const [b1, b2] = bRest.split('.').map(n => Number(n) || 0);
      return a1 - b1 || a2 - b2;
    });
    CACHE[key] = data;
    DATA = data;
    BY_ID = Object.fromEntries(DATA.map(c => [c.id, c]));
    return true;
  } catch (e) {
    console.error(e);
    CACHE[key] = [];
    DATA = [];
    BY_ID = {};
    return false;
  }
}

function renderSubjectTOC(key) {
  const s = SUBJECTS[key];
  document.getElementById('s-tag').textContent = s.tag;
  document.getElementById('s-title').textContent = s.title;
  document.getElementById('s-sub').textContent = s.sub;

  const grid = document.getElementById('toc-grid');
  if (!DATA.length) {
    grid.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">Content not yet available for this subject.</p>`;
    return;
  }
  // Group by unit preserving sorted order
  const unitMap = {};
  DATA.forEach(c => {
    const u = c.unit;
    if (!unitMap[u]) unitMap[u] = [];
    unitMap[u].push(c);
  });
  const unitKeys = Object.keys(unitMap).sort((a, b) => Number(a) - Number(b));
  grid.innerHTML = unitKeys.map(u => {
    const items = unitMap[u];
    const unitTitle = s.units[u] || `Unit ${u}`;
    const subs = items.map(c => `
      <li class="sub-item" data-id="${escapeHtml(c.id)}" tabindex="0" role="link">
        <span class="sub-num">${escapeHtml(c.id)}</span>
        <span class="sub-title">${escapeHtml(c.title)}</span>
        ${hlBadge(c.hl)}
      </li>
    `).join('');
    return `
      <section class="unit">
        <div class="unit-head">
          <span class="unit-num">Unit ${u}</span>
          <h2 class="unit-title">${escapeHtml(unitTitle)}</h2>
          <span class="unit-hl">${items.length} topics</span>
        </div>
        <ul class="sub-list">${subs}</ul>
      </section>
    `;
  }).join('');
  grid.querySelectorAll('.sub-item').forEach(el => {
    el.addEventListener('click', () => { window.location.hash = '#/' + key + '/' + el.dataset.id; });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.location.hash = '#/' + key + '/' + el.dataset.id;
      }
    });
  });
}

// ------- Topic -------
function renderTopic(key, id) {
  const c = BY_ID[id];
  if (!c) { window.location.hash = '#/' + key; return; }

  document.getElementById('t-id').textContent = `${c.id} · ${SUBJECTS[key].title}`;
  const hlEl = document.getElementById('t-hl');
  hlEl.outerHTML = hlBadge(c.hl).replace('<span class="badge', '<span id="t-hl" class="badge');
  document.getElementById('t-title').textContent = c.title;

  const summaryEl = document.getElementById('t-summary');
  summaryEl.innerHTML = renderMarkdown(c.summary || '');
  renderMath(summaryEl);

  const objList = document.getElementById('t-objectives');
  objList.innerHTML = (c.objectives || []).map(o => `<li>${escapeHtml(o)}</li>`).join('');
  renderMath(objList);

  const quizEl = document.getElementById('t-quiz');
  quizEl.innerHTML = (c.quiz || []).map((q, i) => `
    <div class="q">
      <div class="q-num">Question ${String(i + 1).padStart(2, '0')}</div>
      <p class="q-text">${escapeHtml(q.question)}</p>
      <button class="q-toggle" data-i="${i}">Show markscheme</button>
      <div class="q-mark" data-i="${i}">
        <span class="label">Markscheme</span>
        ${renderMarkdown(q.markscheme)}
      </div>
    </div>
  `).join('');
  quizEl.querySelectorAll('.q-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.i;
      const m = quizEl.querySelector(`.q-mark[data-i="${i}"]`);
      const open = m.classList.toggle('open');
      btn.textContent = open ? 'Hide markscheme' : 'Show markscheme';
      if (open) renderMath(m);
    });
  });
  // Render math across all question text up-front (markschemes on demand)
  renderMath(quizEl);

  const revealAll = document.getElementById('reveal-all');
  let allOpen = false;
  revealAll.onclick = () => {
    allOpen = !allOpen;
    quizEl.querySelectorAll('.q-mark').forEach(m => {
      m.classList.toggle('open', allOpen);
      if (allOpen) renderMath(m);
    });
    quizEl.querySelectorAll('.q-toggle').forEach(b => b.textContent = allOpen ? 'Hide markscheme' : 'Show markscheme');
    revealAll.textContent = allOpen ? 'Hide all markschemes' : 'Reveal all markschemes';
  };
  revealAll.textContent = 'Reveal all markschemes';

  // Pager
  const idx = DATA.findIndex(x => x.id === id);
  const prev = DATA[idx - 1];
  const next = DATA[idx + 1];
  const prevLink = document.getElementById('prev-link');
  const nextLink = document.getElementById('next-link');
  const tocLink = document.getElementById('toc-link');
  tocLink.href = '#/' + key;
  tocLink.textContent = 'Contents';
  if (prev) {
    prevLink.href = '#/' + key + '/' + prev.id;
    prevLink.textContent = `← ${prev.id} ${prev.title}`;
    prevLink.classList.remove('disabled');
  } else {
    prevLink.href = '#/' + key;
    prevLink.textContent = '← Contents';
  }
  if (next) {
    nextLink.href = '#/' + key + '/' + next.id;
    nextLink.textContent = `${next.id} ${next.title} →`;
    nextLink.classList.remove('disabled');
  } else {
    nextLink.href = '#/' + key;
    nextLink.textContent = 'Contents →';
  }

  const back = document.getElementById('back-toc');
  back.onclick = () => { window.location.hash = '#/' + key; };

  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ------- Crumbs -------
function renderCrumbs(parts) {
  const el = document.getElementById('crumbs');
  if (!parts || !parts.length) { el.innerHTML = ''; return; }
  el.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    if (p.href && !isLast) return `<a href="${p.href}">${escapeHtml(p.label)}</a>`;
    return `<a class="active">${escapeHtml(p.label)}</a>`;
  }).join('<span class="sep">·</span>');
}

// ------- Routing -------
function show(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}

async function route() {
  const h = window.location.hash || '#/';
  // #/<subject>/<id>
  const topicMatch = h.match(/^#\/([a-z]+)\/(.+)$/);
  if (topicMatch) {
    const [, key, id] = topicMatch;
    if (!SUBJECTS[key]) { window.location.hash = '#/'; return; }
    CURRENT_SUBJECT = key;
    await loadSubject(key);
    show('topic');
    renderTopic(key, id);
    renderCrumbs([
      { label: 'Subjects', href: '#/' },
      { label: SUBJECTS[key].title, href: '#/' + key },
      { label: id, href: null },
    ]);
    return;
  }
  // #/<subject>
  const subjectMatch = h.match(/^#\/([a-z]+)\/?$/);
  if (subjectMatch) {
    const key = subjectMatch[1];
    if (!SUBJECTS[key]) { window.location.hash = '#/'; return; }
    CURRENT_SUBJECT = key;
    await loadSubject(key);
    show('toc');
    renderSubjectTOC(key);
    renderCrumbs([
      { label: 'Subjects', href: '#/' },
      { label: SUBJECTS[key].title, href: null },
    ]);
    window.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }
  // Landing
  CURRENT_SUBJECT = null;
  show('landing');
  renderCrumbs([]);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================================================
// HERO ORBIT — ripped from nagusamecs.github.io initOrbitSocials
// SIMPLIFIED: kept cursor-proximity slowdown + 3D depth scale/opacity
// REMOVED: scroll-progress (flyT), docked-mode toggling, dock positioning
// ============================================================
function initOrbitSocials() {
  const container = document.getElementById('orbit-socials');
  if (!container) return;

  // Mobile: CSS handles inline layout, skip orbit
  if (window.innerWidth <= 768) return;

  const btns = Array.from(container.querySelectorAll('.orbit-btn'));
  const count = btns.length;
  const wrapper = container.closest('.avatar-orbit-wrapper');
  if (!wrapper) return;

  const BASE_SPEED = 0.0007;
  const MIN_SPEED = 0.00012;
  const SLOW_RADIUS = 200;
  const RADIUS_X = 90;
  const RADIUS_Y = 16;
  const SCALE_FRONT = 1.05;
  const SCALE_BACK = 0.6;
  const OPACITY_FRONT = 1.0;
  const OPACITY_BACK = 0.35;
  const BTN_SIZE = 32;

  let orbitAngle = 0;
  let lastTime = performance.now();

  let mouseX = -9999, mouseY = -9999;
  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  document.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });

  function animate(now) {
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    const wr = wrapper.getBoundingClientRect();
    const wrapCX = wr.left + wr.width / 2;
    const wrapCY = wr.top + wr.height / 2;
    const cursorDist = Math.hypot(mouseX - wrapCX, mouseY - wrapCY);
    const rawProximity = Math.max(0, Math.min(1, 1 - cursorDist / SLOW_RADIUS));
    const proximity = rawProximity * rawProximity * rawProximity;
    const speed = BASE_SPEED + (MIN_SPEED - BASE_SPEED) * proximity;
    orbitAngle += speed * dt;

    const cx = wr.left + wr.width / 2;
    const cy = wr.top + wr.height / 2;
    const halfBtn = BTN_SIZE / 2;

    btns.forEach((btn, i) => {
      const baseAngle = (2 * Math.PI * i) / count;
      const angle = baseAngle + orbitAngle;

      const x = cx + RADIUS_X * Math.cos(angle) - halfBtn;
      const y = cy + RADIUS_Y * Math.sin(angle) - halfBtn;

      const depth = Math.sin(angle);
      const scale = SCALE_BACK + (SCALE_FRONT - SCALE_BACK) * (depth + 1) / 2;
      const opacity = OPACITY_BACK + (OPACITY_FRONT - OPACITY_BACK) * (depth + 1) / 2;

      btn.style.position = 'fixed';
      btn.style.left = x + 'px';
      btn.style.top = y + 'px';
      btn.style.transform = 'scale(' + scale.toFixed(3) + ')';
      btn.style.opacity = opacity.toFixed(3);
      btn.style.zIndex = depth > 0 ? 3 : 0;
    });

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}

// ------- Init -------
function init() {
  renderLanding();
  window.addEventListener('hashchange', route);
  route();
  setTimeout(initOrbitSocials, 400);
  initSearch();
  // Build search index in background after first paint
  setTimeout(() => { buildSearchIndex(); }, 200);
  // Reinit orbit on resize (handle mobile <-> desktop)
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      // Clear any fixed positioning set by JS
      document.querySelectorAll('#orbit-socials .orbit-btn').forEach(b => {
        b.style.cssText = '';
      });
      initOrbitSocials();
    }, 200);
  });
}

init();
