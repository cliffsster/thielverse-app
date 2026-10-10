// Reads the Obsidian vault and writes public/vault.json: every note pre-rendered to HTML,
// plus the link graph and the default colour groups.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = path.join(ROOT, 'thielverse');
const OUT = path.join(ROOT, 'public', 'vault.json');
const HOME_NOTE = 'The Thielverse';

// ---- collect notes -------------------------------------------------------------------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

const files = walk(VAULT);
const names = new Set(files.map((f) => path.basename(f, '.md')));

// ---- markdown: wikilinks + callouts --------------------------------------------------
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// [[Target]], [[Target|Alias]], [[Target#Heading]] -> in-app link (or a dead span if unresolved)
md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false;
  const end = src.indexOf(']]', start + 2);
  if (end < 0) return false;
  const inner = src.slice(start + 2, end);
  if (!inner || inner.includes('\n')) return false;
  if (!silent) {
    const [targetPart, alias] = inner.split('|');
    const target = targetPart.split('#')[0].trim();
    const label = (alias ?? targetPart).trim();
    const resolved = names.has(target);
    const open = state.push(resolved ? 'link_open' : 'span_open', resolved ? 'a' : 'span', 1);
    if (resolved) {
      open.attrSet('href', '#/' + encodeURIComponent(target));
      open.attrSet('class', 'wikilink');
      open.attrSet('data-note', target);
    } else {
      open.attrSet('class', 'wikilink unresolved');
    }
    state.push('text', '', 0).content = label;
    state.push(resolved ? 'link_close' : 'span_close', resolved ? 'a' : 'span', -1);
  }
  state.pos = end + 2;
  return true;
});

// > [!type] Title  ->  <div class="callout" data-callout="type"><div class="callout-title">…
md.core.ruler.after('inline', 'callout', (state) => {
  const t = state.tokens;
  for (let i = 0; i < t.length; i++) {
    if (t[i].type !== 'blockquote_open') continue;
    const para = t[i + 1];
    const inline = t[i + 2];
    if (para?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
    const first = inline.children[0];
    const m = first?.type === 'text' && first.content.match(/^\[!(\w+)\][+-]?\s*(.*)$/);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    // Title runs up to the first line break; the rest of the paragraph is the body.
    const brk = inline.children.findIndex((c) => c.type === 'softbreak' || c.type === 'hardbreak');
    const titleChildren = brk < 0 ? inline.children.slice() : inline.children.slice(0, brk);
    const bodyChildren = brk < 0 ? [] : inline.children.slice(brk + 1);
    titleChildren[0] = Object.assign(Object.create(Object.getPrototypeOf(first)), first, { content: m[2] });
    const hasTitle = titleChildren.some((c) => c.content || c.type !== 'text');
    if (!hasTitle) titleChildren.splice(0, 1, Object.assign(new state.Token('text', '', 0), { content: kind[0].toUpperCase() + kind.slice(1) }));

    t[i].type = 'html_block';
    t[i].content = `<div class="callout" data-callout="${kind}">`;
    const title = new state.Token('inline', '', 0);
    title.children = titleChildren;
    const tOpen = Object.assign(new state.Token('html_block', '', 0), { content: '<div class="callout-title">' });
    const tClose = Object.assign(new state.Token('html_block', '', 0), { content: '</div><div class="callout-body">' });
    inline.children = bodyChildren;
    t.splice(i + 1, 0, tOpen, title, tClose);
    if (!bodyChildren.length) { para.hidden = true; t[i + 6].hidden = true; }
    // matching blockquote_close
    let depth = 0;
    for (let j = i + 1; j < t.length; j++) {
      if (t[j].type === 'blockquote_open') depth++;
      if (t[j].type === 'blockquote_close') {
        if (depth-- === 0) { t[j].type = 'html_block'; t[j].content = '</div></div>'; break; }
      }
    }
  }
});

// ---- build nodes + links -------------------------------------------------------------
const WIKILINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

const notes = files.map((file) => {
  const id = path.basename(file, '.md');
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  const tags = [].concat(data.tags ?? []).map((t) => String(t).replace(/^#/, ''));
  const out = new Set();
  for (const m of content.matchAll(WIKILINK)) {
    const target = m[1].trim();
    if (names.has(target) && target !== id) out.add(target);
  }
  const folder = path.relative(VAULT, path.dirname(file)) || null;
  // Plain-text excerpt for search
  const text = content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/[>#*_`|\[\]!-]/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id, folder, tags,
    role: data.role ?? null,
    link: data.link ?? null,
    out: [...out],
    html: md.render(content),
    text,
  };
});

// Obsidian's graph is undirected: one edge per linked pair.
const seen = new Set();
const links = [];
for (const n of notes) {
  for (const target of n.out) {
    const key = [n.id, target].sort().join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: n.id, target });
  }
}

const backlinks = Object.fromEntries(notes.map((n) => [n.id, []]));
for (const n of notes) for (const t of n.out) backlinks[t].push(n.id);

// ---- default colour groups ----------------------------------------------------------------
// color-groups.json (repo root) is the site's default; viewers can edit their own copy in the
// page. Without it, fall back to the vault's Obsidian graph settings.
function loadGroups() {
  const site = path.join(ROOT, 'color-groups.json');
  if (fs.existsSync(site)) return JSON.parse(fs.readFileSync(site, 'utf8'));
  try {
    const g = JSON.parse(fs.readFileSync(path.join(VAULT, '.obsidian', 'graph.json'), 'utf8'));
    return (g.colorGroups ?? []).map(({ query, color }) => ({
      query: query.trim(),
      color: '#' + color.rgb.toString(16).padStart(6, '0'),
    }));
  } catch {
    return [];
  }
}
const groups = loadGroups();

for (const n of notes) n.backlinks = backlinks[n.id].sort();

const allTags = {};
for (const n of notes) for (const t of n.tags) allTags[t] = (allTags[t] ?? 0) + 1;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ home: names.has(HOME_NOTE) ? HOME_NOTE : notes[0]?.id, groups, tags: allTags, notes, links }));
console.log(`vault.json: ${notes.length} notes, ${links.length} links, ${groups.length} colour groups`);
