import ForceGraph from 'force-graph';
import { compile, soleTag, loadSaved, save, clearSaved } from './groups.js';

const DEFAULT_COLOR = '#8a8f98';
const HOME_COLOR = '#f5c542';
const $ = (id) => document.getElementById(id);

const vault = await fetch('/vault.json').then((r) => r.json());
const byId = new Map(vault.notes.map((n) => [n.id, n]));

// ---- graph data ----------------------------------------------------------------------
const neighbors = new Map(vault.notes.map((n) => [n.id, new Set()]));
for (const l of vault.links) {
  neighbors.get(l.source).add(l.target);
  neighbors.get(l.target).add(l.source);
}
const nodes = vault.notes.map((n) => ({ id: n.id, note: n, degree: neighbors.get(n.id).size }));
const links = vault.links.map((l) => ({ ...l }));
const nodeById = new Map(nodes.map((n) => [n.id, n]));
// force-graph swaps link endpoints from ids to node objects once the simulation starts.
const end = (x) => (typeof x === 'object' ? x : nodeById.get(x));
const radius = (node) => 2.2 + Math.sqrt(node.degree) * 1.15;

// ---- colour groups (editable by the viewer, saved in their browser) -------------------
let groupSeq = 0;
const makeGroup = ({ query, color }) => ({ id: 'g' + groupSeq++, query, color, match: compile(query) });
let groups = (loadSaved() ?? vault.groups).map(makeGroup);
const groupCounts = new Map();

/** First matching group wins, as in Obsidian. */
function assignGroups() {
  groupCounts.clear();
  for (const n of vault.notes) {
    n.group = groups.find((g) => g.match(n))?.id ?? null;
    const k = n.group ?? '__none';
    groupCounts.set(k, (groupCounts.get(k) ?? 0) + 1);
  }
}
assignGroups();

const groupById = (id) => groups.find((g) => g.id === id);
const colorOf = (n) => (n.id === vault.home ? HOME_COLOR : groupById(n.note.group)?.color ?? DEFAULT_COLOR);
const tagColor = (tag) => groups.find((g) => soleTag(g.query) === tag.toLowerCase())?.color;

// ---- state ---------------------------------------------------------------------------
const state = {
  selected: null,   // id of the open note
  hovered: null,    // id under the pointer
  hiddenGroups: new Set(),
  hidePeriphery: false,
  labels: true,
};

const isHidden = (n) =>
  state.hiddenGroups.has(n.note.group ?? '__none') || (state.hidePeriphery && n.note.tags.includes('periphery'));

function focusSet() {
  const id = state.hovered ?? state.selected;
  if (!id) return null;
  return new Set([id, ...neighbors.get(id)]);
}

// ---- render --------------------------------------------------------------------------
const css = getComputedStyle(document.documentElement);
const theme = {
  link: css.getPropertyValue('--edge').trim(),
  linkHi: css.getPropertyValue('--edge-hi').trim(),
  label: css.getPropertyValue('--label').trim(),
  bg: css.getPropertyValue('--bg').trim(),
};

const graph = new ForceGraph($('graph'))
  .backgroundColor(theme.bg)
  .graphData({ nodes, links })
  .nodeId('id')
  .nodeVal((n) => radius(n) ** 2)
  .nodeRelSize(1)
  .nodeLabel(() => '')
  .nodeVisibility((n) => !isHidden(n))
  .linkVisibility((l) => !isHidden(end(l.source)) && !isHidden(end(l.target)))
  .linkColor((l) => {
    const f = focusSet();
    if (!f) return theme.link;
    const hot = [end(l.source).id, end(l.target).id].includes(state.hovered ?? state.selected);
    return hot ? theme.linkHi : 'rgba(128,128,128,0.06)';
  })
  .linkWidth((l) => {
    const id = state.hovered ?? state.selected;
    return id && (end(l.source).id === id || end(l.target).id === id) ? 1.4 : 0.6;
  })
  .nodeCanvasObject((n, ctx, scale) => {
    const f = focusSet();
    const dim = f && !f.has(n.id);
    const r = radius(n);
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = colorOf(n);
    ctx.fill();
    if (n.id === state.selected) {
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = theme.label;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 2.5 / scale + 1, 0, 2 * Math.PI);
      ctx.stroke();
    }
    // Labels fade in with zoom, like Obsidian; focused nodes and hubs always show theirs.
    const emphasised = f?.has(n.id);
    const zoomAlpha = Math.min(1, Math.max(0, (scale - 0.9) / 0.8));
    let alpha = state.labels ? zoomAlpha : 0;
    if (emphasised) alpha = 1;
    else if (state.labels && n.degree >= 25) alpha = Math.max(alpha, 0.85);
    if (dim) alpha *= 0.2;
    if (alpha > 0.02) {
      const size = Math.max(11 / scale, r * 0.55);
      ctx.font = `${n.id === (state.hovered ?? state.selected) ? 600 : 400} ${size}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = theme.bg;
      ctx.strokeText(n.id, n.x, n.y + r + 2 / scale);
      ctx.fillStyle = theme.label;
      ctx.fillText(n.id, n.x, n.y + r + 2 / scale);
    }
    ctx.globalAlpha = 1;
  })
  // force-graph finds the node under the pointer by reading pixel colours back from a hidden
  // canvas. Browsers with fingerprinting protection (Brave, Safari, Firefox RFP) add noise to
  // those reads, which silently breaks hover and click. Hit-testing is done geometrically below.
  .enablePointerInteraction(false)
  .warmupTicks(120) // lay out before the first frame so the camera has real positions to aim at
  .cooldownTicks(150)
  .d3VelocityDecay(0.3);

graph.d3Force('charge').strength(-90).distanceMax(600);
graph.d3Force('link').distance(45);

let fitted = false;
graph.onEngineStop(() => {
  if (fitted) return;
  fitted = true;
  graph.zoomToFit(state.selected ? 0 : 600, 60);
  if (state.selected) centerOn(state.selected);
});

const resize = () => graph.width(innerWidth).height(innerHeight);
addEventListener('resize', resize);
resize();

// ---- pointer: hover + click ----------------------------------------------------------
const CLICK_TOLERANCE_PX = 5;

function nodeAt(clientX, clientY) {
  const p = graph.screen2GraphCoords(clientX, clientY);
  const slop = 4 / graph.zoom(); // a few screen pixels of forgiveness around small nodes
  let best = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (isHidden(n)) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= radius(n) + slop && d < bestDist) { best = n; bestDist = d; }
  }
  return best;
}

function setHovered(id) {
  if (id === state.hovered) return;
  state.hovered = id;
  $('graph').style.cursor = id ? 'pointer' : '';
  refresh();
}

const canvasEl = $('graph');
const pointers = new Map(); // pointerId -> down position; >1 means pinch, never a click
let multiTouch = false;

canvasEl.addEventListener('pointermove', (e) => {
  if (pointers.size || e.pointerType !== 'mouse') return; // panning, or touch (no hover)
  setHovered(nodeAt(e.clientX, e.clientY)?.id ?? null);
});
canvasEl.addEventListener('pointerleave', () => setHovered(null));
canvasEl.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size > 1) multiTouch = true;
}, true);
const endPointer = (e) => {
  const start = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  const wasMulti = multiTouch;
  if (!pointers.size) multiTouch = false;
  if (e.type !== 'pointerup' || !start || wasMulti || e.button !== 0) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE_PX) return; // a pan
  const n = nodeAt(e.clientX, e.clientY);
  if (n) navigate(n.id);
  else if (state.selected) navigate(null);
};
// Capture phase: d3-zoom handles these on the canvas and may stop them reaching us otherwise.
canvasEl.addEventListener('pointerup', endPointer, true);
canvasEl.addEventListener('pointercancel', endPointer, true);

// ---- note panel ----------------------------------------------------------------------
const panel = $('panel');

function wikilink(id) {
  const a = document.createElement('a');
  a.href = '#/' + encodeURIComponent(id);
  a.className = 'wikilink';
  a.textContent = id;
  a.style.setProperty('--dot', colorOf({ id, note: byId.get(id) }));
  return a;
}

function showNote(id) {
  const n = byId.get(id);
  $('note-title').textContent = n.id;
  $('note-role').textContent = n.role ?? '';
  $('note-role').hidden = !n.role;

  const chips = $('note-tags');
  chips.replaceChildren(
    ...n.tags.map((t) => {
      const s = document.createElement('span');
      s.className = 'chip';
      s.textContent = '#' + t;
      const c = tagColor(t);
      if (c) s.style.setProperty('--dot', c);
      return s;
    }),
  );
  if (n.link) {
    const s = document.createElement('span');
    s.className = 'chip link-' + n.link;
    s.textContent = 'link: ' + n.link;
    s.title = { direct: 'Employment, investment, contract, or founding relationship',
      indirect: 'Real but mediated: co-investor, regulator, policy counterpart, adversary',
      ambient: 'Shares an information ecosystem and nothing else' }[n.link] ?? '';
    chips.append(s);
  }

  $('note-body').innerHTML = n.html;

  const bl = $('note-backlinks');
  bl.replaceChildren();
  if (n.backlinks.length) {
    const h = document.createElement('h2');
    h.textContent = `Linked from ${n.backlinks.length} note${n.backlinks.length === 1 ? '' : 's'}`;
    const ul = document.createElement('ul');
    for (const b of n.backlinks) {
      const li = document.createElement('li');
      li.append(wikilink(b));
      ul.append(li);
    }
    bl.append(h, ul);
  }

  panel.hidden = false;
  document.body.classList.add('panel-open');
  panel.querySelector('.panel-body').scrollTop = 0;
}

function hideNote() {
  panel.hidden = true;
  document.body.classList.remove('panel-open');
}

function centerOn(id) {
  const node = nodeById.get(id);
  if (node?.x === undefined) return;
  // Keep the node visible beside the panel on wide screens, above the sheet on phones.
  const wide = innerWidth > 820;
  const k = Math.max(graph.zoom(), 1.6);
  const offX = wide ? Math.min(460, innerWidth * 0.42) / 2 / k : 0;
  const offY = wide ? 0 : (innerHeight * 0.28) / k;
  graph.centerAt(node.x + offX, node.y + offY, 700);
  graph.zoom(k, 700);
}

// ---- routing: #/Note%20Name is a shareable link --------------------------------------
function currentId() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  return byId.has(raw) ? raw : null;
}

function navigate(id) {
  location.hash = id ? '/' + encodeURIComponent(id) : '';
}

function route() {
  const id = currentId();
  state.selected = id;
  if (id) {
    showNote(id);
    if (fitted) centerOn(id);
  } else {
    hideNote();
  }
}
addEventListener('hashchange', route);

// Wikilinks inside the panel are plain hash links; this keeps clicks from bubbling to the canvas.
panel.addEventListener('click', (e) => e.stopPropagation());
$('close').onclick = () => navigate(null);
$('back').onclick = () => history.back();
$('home').onclick = () => navigate(vault.home);

// ---- search --------------------------------------------------------------------------
const input = $('search');
const results = $('results');
let active = 0;
let matches = [];

function score(n, q) {
  const id = n.id.toLowerCase();
  if (id === q) return 100;
  if (id.startsWith(q)) return 80;
  if (id.split(/\s+/).some((w) => w.startsWith(q))) return 70;
  if (id.includes(q)) return 60;
  if (n.tags.some((t) => t.startsWith(q.replace(/^#/, '')))) return 40;
  if (n.role?.toLowerCase().includes(q)) return 30;
  if (n.text.toLowerCase().includes(q)) return 10;
  return 0;
}

function renderResults() {
  results.replaceChildren(
    ...matches.map((n, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.className = i === active ? 'active' : '';
      li.style.setProperty('--dot', colorOf({ id: n.id, note: n }));
      li.innerHTML = '<span class="name"></span><span class="sub"></span>';
      li.querySelector('.name').textContent = n.id;
      li.querySelector('.sub').textContent = n.role ?? n.tags.map((t) => '#' + t).join(' ');
      li.onmousedown = (e) => { e.preventDefault(); pick(n.id); };
      return li;
    }),
  );
  results.hidden = !matches.length;
}

function pick(id) {
  input.value = '';
  matches = [];
  renderResults();
  input.blur();
  navigate(id);
}

input.addEventListener('input', () => {
  const q = input.value.trim().toLowerCase();
  active = 0;
  matches = q
    ? vault.notes.map((n) => [n, score(n, q)]).filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || a[0].id.localeCompare(b[0].id)).slice(0, 12).map(([n]) => n)
    : [];
  renderResults();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); renderResults(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); renderResults(); e.preventDefault(); }
  else if (e.key === 'Enter' && matches[active]) pick(matches[active].id);
  else if (e.key === 'Escape') { input.value = ''; matches = []; renderResults(); input.blur(); }
});
input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 100));
input.addEventListener('focus', () => { results.hidden = !matches.length; });
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) { e.preventDefault(); input.focus(); }
  else if (e.key === 'Escape' && state.selected) navigate(null);
});

// ---- legend: show/hide groups, or edit them like Obsidian's Groups panel ------------------
const legend = $('legend');
const groupList = $('groups');
const PALETTE = ['#ff9f1a', '#e05297', '#4fc3f7', '#9ccc65', '#ffd54f', '#ba68c8', '#4db6ac', '#ff7043'];
let editing = false;

function groupChanged() {
  assignGroups();
  save(groups);
  for (const el of groupList.querySelectorAll('[data-count]')) el.textContent = groupCounts.get(el.dataset.count) ?? 0;
  refresh();
}

function viewRow({ key, label, color }) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.style.setProperty('--dot', color);
  b.innerHTML = '<span class="label"></span><span class="count"></span>';
  b.querySelector('.label').textContent = label || '(empty query)';
  b.querySelector('.count').dataset.count = key;
  b.querySelector('.count').textContent = groupCounts.get(key) ?? 0;
  const on = !state.hiddenGroups.has(key);
  b.setAttribute('aria-pressed', String(on));
  b.title = 'Show/hide ' + label;
  b.onclick = () => {
    const off = state.hiddenGroups.has(key);
    off ? state.hiddenGroups.delete(key) : state.hiddenGroups.add(key);
    b.setAttribute('aria-pressed', String(off));
    refresh();
  };
  li.append(b);
  return li;
}

function editRow(g, i) {
  const li = document.createElement('li');
  li.className = 'edit-row';
  li.innerHTML = `
    <input type="color" aria-label="Group colour" />
    <input type="text" class="query" spellcheck="false" autocomplete="off" placeholder="tag:#paypal-mafia" aria-label="Group query" />
    <span class="count"></span>
    <span class="row-tools">
      <button data-act="up" title="Move up (earlier groups win)" aria-label="Move up">↑</button>
      <button data-act="down" title="Move down" aria-label="Move down">↓</button>
      <button data-act="del" title="Delete group" aria-label="Delete group">✕</button>
    </span>`;
  const [color, query] = li.querySelectorAll('input');
  color.value = g.color;
  query.value = g.query;
  li.querySelector('.count').dataset.count = g.id;
  li.querySelector('.count').textContent = groupCounts.get(g.id) ?? 0;
  color.oninput = () => { g.color = color.value; groupChanged(); };
  query.oninput = () => { g.query = query.value; g.match = compile(g.query); groupChanged(); };
  li.querySelector('[data-act="up"]').disabled = i === 0;
  li.querySelector('[data-act="down"]').disabled = i === groups.length - 1;
  li.onclick = (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act === 'del') {
      groups.splice(i, 1);
      state.hiddenGroups.delete(g.id);
    } else {
      const j = act === 'up' ? i - 1 : i + 1;
      [groups[i], groups[j]] = [groups[j], groups[i]];
    }
    groupChanged();
    renderLegend();
  };
  return li;
}

function renderLegend() {
  legend.classList.toggle('editing', editing);
  $('legend-edit').textContent = editing ? 'Done' : 'Edit';
  $('legend-edit').setAttribute('aria-pressed', String(editing));
  for (const el of legend.querySelectorAll('.edit-only')) el.hidden = !editing;
  for (const el of legend.querySelectorAll('.view-only')) el.hidden = editing;
  if (editing) {
    groupList.replaceChildren(...groups.map(editRow));
  } else {
    const label = (q) => (soleTag(q) ? '#' + soleTag(q) : q.trim());
    const rows = groups.map((g) => viewRow({ key: g.id, label: label(g.query), color: g.color }));
    if (groupCounts.get('__none')) rows.push(viewRow({ key: '__none', label: 'other', color: DEFAULT_COLOR }));
    groupList.replaceChildren(...rows);
  }
}

$('legend-edit').onclick = () => {
  editing = !editing;
  legend.classList.remove('collapsed');
  renderLegend();
};
$('group-add').onclick = () => {
  const used = new Set(groups.map((g) => g.color.toLowerCase()));
  const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[groups.length % PALETTE.length];
  groups.push(makeGroup({ query: '', color }));
  groupChanged();
  renderLegend();
  groupList.querySelector('li:last-child .query').focus();
};
$('group-reset').onclick = () => {
  groups = vault.groups.map(makeGroup);
  state.hiddenGroups.clear();
  clearSaved();
  assignGroups();
  refresh();
  renderLegend();
};
renderLegend();

function refresh() {
  // Re-assigning the accessors makes force-graph re-evaluate visibility.
  graph.nodeVisibility(graph.nodeVisibility()).linkVisibility(graph.linkVisibility());
}

$('hide-periphery').onchange = (e) => { state.hidePeriphery = e.target.checked; refresh(); };
$('show-labels').onchange = (e) => { state.labels = e.target.checked; refresh(); };
$('fit').onclick = () => graph.zoomToFit(600, 60, (n) => !isHidden(n));

$('legend-toggle').onclick = () => {
  const collapsed = legend.classList.toggle('collapsed');
  $('legend-toggle').setAttribute('aria-expanded', String(!collapsed));
};
if (innerWidth < 640) legend.classList.add('collapsed');

// ---- boot ----------------------------------------------------------------------------
$('loading').remove();
if (!location.hash && innerWidth > 820) history.replaceState(null, '', '#/' + encodeURIComponent(vault.home));
route(); // the camera moves to a deep-linked note once the layout settles (onEngineStop)
