# The Thielverse

An interactive, shareable version of the Obsidian graph view for the `thielverse/` vault.
Click a node to read its note; wikilinks inside notes move around the graph; every note has
a shareable URL (`/#/Peter%20Thiel`).

## How it works

- `thielverse/` is the Obsidian vault, committed as-is. Edit notes in Obsidian.
- `scripts/build-data.mjs` reads the vault at build time and writes `public/vault.json`:
  every note pre-rendered to HTML (wikilinks, callouts, tables), the link graph, backlinks,
  and the default colour groups.
- `src/main.js` renders the graph with [force-graph](https://github.com/vasturiano/force-graph)
  and the note panel. No server: the whole site is static.

## Colour groups

`color-groups.json` sets the groups every visitor sees first. It uses the same query syntax as
Obsidian's graph groups, and the first matching group decides a node's colour, so order
matters. If the file is missing, the build falls back to `thielverse/.obsidian/graph.json`.

Visitors can click **Edit** in the legend to add, recolour, reorder or delete groups. Their
changes are saved in their own browser (Reset restores the defaults) and never touch the repo.

Supported queries: `tag:#person` (or `#person`), `path:People`, `file:Thiel`,
`[role:ceo]` / `[link:direct]` (frontmatter properties), plain text or `"a phrase"`,
`-term` to exclude, and `a OR b`. Space-separated terms must all match.

## Develop

```sh
npm install
npm run dev      # rebuilds vault.json, then starts Vite
npm run build    # production build into dist/
```

## Deploy (Vercel)

Import the GitHub repo in Vercel. `vercel.json` sets the build (`npm run build`) and output
(`dist`), so no settings are needed. Every push redeploys with the current vault.

## What is not committed

`thielverse/.obsidian/` is ignored except `graph.json`. The rest is per-device app state,
and the Local REST API plugin's folder holds an API key and certificates.
