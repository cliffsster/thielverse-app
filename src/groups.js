// Colour groups, matched with a subset of Obsidian's search syntax:
//   tag:#person  #person      note has the tag (or a nested tag under it, e.g. #person/x)
//   path:People  file:Thiel   folder path / file name contains
//   [role:ceo]   [link:direct] frontmatter property contains
//   palantir     "paypal mafia"   name or note text contains
//   -term        a OR b        negation; space-separated terms must all match
// As in Obsidian, the first group whose query matches a note decides its colour.

const TOKEN = /-?(?:\[[^\]]*\]|[a-z]+:"[^"]*"|"[^"]*"|\S+)/gi;
const unquote = (s) => s.replace(/^"(.*)"$/, '$1').toLowerCase();

function termMatcher(raw) {
  const neg = raw.startsWith('-') && raw.length > 1;
  const t = neg ? raw.slice(1) : raw;
  let test;
  let m;
  if ((m = t.match(/^tag:#?(.+)$/i)) || (m = t.match(/^#(.+)$/))) {
    const tag = unquote(m[1]);
    test = (n) => n.tags.some((x) => { x = x.toLowerCase(); return x === tag || x.startsWith(tag + '/'); });
  } else if ((m = t.match(/^path:(.+)$/i))) {
    const v = unquote(m[1]);
    test = (n) => `${n.folder ?? ''}/${n.id}.md`.toLowerCase().includes(v);
  } else if ((m = t.match(/^file:(.+)$/i))) {
    const v = unquote(m[1]);
    test = (n) => n.id.toLowerCase().includes(v);
  } else if ((m = t.match(/^\[([^:\]]+)(?::(.*))?\]$/))) {
    const key = m[1].trim().toLowerCase();
    const v = m[2] === undefined ? null : unquote(m[2].trim());
    // Match at a word start, so [link:direct] doesn't also catch "indirect".
    const re = v && new RegExp('(^|[^a-z0-9])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    test = (n) => {
      const val = key === 'tags' ? n.tags.join(' ') : n[key];
      if (val == null || val === '') return false;
      return !re || re.test(String(val));
    };
  } else {
    const v = unquote(t);
    test = (n) => n.id.toLowerCase().includes(v) || n.text.toLowerCase().includes(v);
  }
  return neg ? (n) => !test(n) : test;
}

/** Compiles a query into a predicate over notes. Empty or blank queries match nothing. */
export function compile(query) {
  const tokens = (query ?? '').match(TOKEN) ?? [];
  const alternatives = [[]];
  for (const tok of tokens) {
    if (tok === 'OR') alternatives.push([]);
    else alternatives.at(-1).push(termMatcher(tok));
  }
  const clauses = alternatives.filter((a) => a.length);
  if (!clauses.length) return () => false;
  return (n) => clauses.some((all) => all.every((f) => f(n)));
}

/** The tag a query names, if the query is nothing but a single tag (used to colour tag chips). */
export function soleTag(query) {
  const m = (query ?? '').trim().match(/^(?:tag:#?|#)([^\s"]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

// ---- persistence (per viewer) --------------------------------------------------------
const KEY = 'thielverse.colorGroups.v1';

export function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(v) && v.every((g) => typeof g.query === 'string' && /^#[0-9a-f]{6}$/i.test(g.color))) return v;
  } catch { /* storage blocked or corrupt: use defaults */ }
  return null;
}

export function save(groups) {
  try { localStorage.setItem(KEY, JSON.stringify(groups.map(({ query, color }) => ({ query, color })))); } catch { /* ignore */ }
}

export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
