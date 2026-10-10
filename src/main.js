import ForceGraph from 'force-graph';

const DEFAULT_COLOR = '#8a8f98';
const HOME_COLOR = '#f5c542';
const $ = (id) => document.getElementById(id);

const vault = await fetch('/vault.json').then((r) => r.json());
const byId = new Map(vault.notes.map((n) => [n.id, n]));
const groupColor = Object.fromEntries(vault.groups.map((g) => [g.tag, g.color]));

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
const colorOf = (n) => (n.id === vault.home ? HOME_COLOR : groupColor[n.note.group] ?? DEFAULT_COLOR);

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
  .nodePointerAreaPaint((n, color, ctx) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, radius(n) + 2, 0, 2 * Math.PI);
    ctx.fill();
  })
  .onNodeHover((n) => {
    state.hovered = n?.id ?? null;
    $('graph').style.cursor = n ? 'pointer' : '';
  })
  .onNodeClick((n) => navigate(n.id))
  .onBackgroundClick(() => { if (state.selected) navigate(null); })
  .onNodeDragEnd((n) => { n.fx = undefined; n.fy = undefined; })
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
      if (groupColor[t]) s.style.setProperty('--dot', groupColor[t]);
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
  if (e.target === input) return;
  if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) { e.preventDefault(); input.focus(); }
  else if (e.key === 'Escape' && state.selected) navigate(null);
});

// ---- legend / filters ----------------------------------------------------------------
const counts = {};
for (const n of vault.notes) counts[n.group ?? '__none'] = (counts[n.group ?? '__none'] ?? 0) + 1;
const legendItems = [...vault.groups.map((g) => ({ key: g.tag, label: '#' + g.tag, color: g.color }))];
if (counts.__none) legendItems.push({ key: '__none', label: 'other', color: DEFAULT_COLOR });

$('groups').replaceChildren(
  ...legendItems.map(({ key, label, color }) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.style.setProperty('--dot', color);
    b.innerHTML = '<span class="label"></span><span class="count"></span>';
    b.querySelector('.label').textContent = label;
    b.querySelector('.count').textContent = counts[key] ?? 0;
    b.setAttribute('aria-pressed', 'true');
    b.title = 'Show/hide ' + label;
    b.onclick = () => {
      const off = state.hiddenGroups.has(key);
      off ? state.hiddenGroups.delete(key) : state.hiddenGroups.add(key);
      b.setAttribute('aria-pressed', String(off));
      refresh();
    };
    li.append(b);
    return li;
  }),
);

function refresh() {
  // Re-assigning the accessors makes force-graph re-evaluate visibility.
  graph.nodeVisibility(graph.nodeVisibility()).linkVisibility(graph.linkVisibility());
}

$('hide-periphery').onchange = (e) => { state.hidePeriphery = e.target.checked; refresh(); };
$('show-labels').onchange = (e) => { state.labels = e.target.checked; };
$('fit').onclick = () => graph.zoomToFit(600, 60, (n) => !isHidden(n));

const legend = $('legend');
$('legend-toggle').onclick = () => {
  const collapsed = legend.classList.toggle('collapsed');
  $('legend-toggle').setAttribute('aria-expanded', String(!collapsed));
};
if (innerWidth < 640) legend.classList.add('collapsed');

// ---- boot ----------------------------------------------------------------------------
$('loading').remove();
if (!location.hash && innerWidth > 820) history.replaceState(null, '', '#/' + encodeURIComponent(vault.home));
route(); // the camera moves to a deep-linked note once the layout settles (onEngineStop)
