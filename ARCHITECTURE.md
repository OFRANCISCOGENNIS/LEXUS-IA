# NEXUS — Arquitetura e contratos internos

Workspace all-in-one com IA 100% local. **Sem build step**: HTML + CSS + ES modules puros,
servido estático. Dados em IndexedDB. IA via WebLLM/WebGPU carregada sob demanda.

## Estrutura

```
index.html            shell estático (sidebar, topbar, #view, #overlay-root, #toast-root)
css/
  tokens.css          design tokens (cores, tipografia, spacing, easing) — NÃO editar
  base.css            reset + keyframes utilitários — NÃO editar
  shell.css           sidebar/topbar/toasts — NÃO editar
  components.css      .btn .icon-btn .input .menu .modal .palette .chip .card .empty-state .switch .spinner — NÃO editar
  editor.css          editor de blocos — NÃO editar
  database.css        views de database
  assistant.css       assistente IA
  views.css           home/daily/settings/templates/trash/search/graph
js/
  app.js              boot: registra rotas lazy → js/modules/*.js
  shell.js            sidebar/tema/atalhos (exporta setTheme, toggleTheme, newPage, newDatabase, applyAppearance)
  core/
    bus.js            event bus:  bus.on(evt, fn) → unsub;  bus.emit(evt, payload)
    db.js             idb.get/getAll/getAllByIndex/put/putMany/del/clear/count(store, ...) — stores: pages, databases, versions, trash, settings, assets, embeddings, automations, aiMemory
    store.js          camada de dados (ver API abaixo)
    router.js         navigate(name, id?), registerRoute, parseHash(), currentRoute()
    ui.js             toast(msg,{type}), showMenu(anchor, items, opts), closeMenus(), showModal({title,body,footer,width})→{close,body}, confirmDialog({...})→Promise<bool>, promptDialog({...})→Promise<string|null>, emojiPicker(anchor, onPick)
    utils.js          h(tag,attrs,...children), uid, debounce, throttle, clamp, escapeHtml, stripHtml, sanitizeInline, fuzzyScore, highlightMatch, todayKey, fmtDate, fmtRelative, flip(container,mutate), positionFloating, isMac, modKey, download, countWords, readingTime
    markdown.js       pageToMarkdown(page), blocksToMarkdown(blocks), markdownToBlocks(md)
  modules/            um módulo por rota — default export { mount(container, params), unmount() }
  ai/                 engine WebLLM + worker
```

## Rotas (hash)

`#/home` `#/page/:id` `#/db/:id` `#/daily` `#/graph` `#/assistant` `#/settings`
`#/templates` `#/trash` `#/search/:query?` — registradas em `app.js` com import lazy.
`params.id` chega ao `mount(container, params)` já decodificado.

## Contrato de módulo de rota

```js
export default {
  async mount(container, params) { /* renderiza dentro de container */ },
  unmount() { /* remove listeners globais, limpa #topbar-actions se usou */ },
};
```
- `container` é um div dentro de `#view` (que rola). Use `.page-container` para conteúdo centrado.
- Ações do topbar: inserir botões em `#topbar-actions`, limpar no unmount.

## Store API (js/core/store.js)

Páginas: `listPages({includeArchived})`, `getPage(id)`, `createPage(partial)`,
`updatePage(id, patch)`, `touchPageBlocks(id)` (persistir blocos mutados in-place),
`deletePage(id)` (→ lixeira), `duplicatePage(id)`, `getOrCreateDaily(dateKey?)`,
`makeBlock(type, contentHtml, props)`, `makePage(partial)`.

Página: `{id, title, icon, cover, type:"page"|"daily", journalDate, parentId, blocks[], tags[], favorite, archived, locked, createdAt, updatedAt}` — campos extras livres (ex.: `mood`).
Bloco: `{id, type, content(html), props{}, children[]}` — tipos: p h1-h4 bulleted numbered todo toggle quote callout code divider image.

Databases: `listDatabases()`, `getDatabase(id)`, `createDatabase(partial)`, `updateDatabase(id, patch)`,
`touchDatabase(id)` (rows/props mutadas in-place), `deleteDatabase(id)`, `makeDatabase(partial)`, `makeRow(db, values)`.
Database: `{id, name, icon, properties[], rows[], views[], automations[]}`.
Property: `{id, name, type, options?, targetDbId?, relationPropId?, targetPropId?, agg?, formula?}` — types: `title text number select multiselect date checkbox url formula relation rollup`.
`title` é a property fixa id="title". Select option: `{id, name, color}` (colors: gray blue green amber red purple).
Row: `{id, values: {propId: valor}, createdAt, updatedAt}` — select guarda option.id; multiselect/relation array de ids; date "YYYY-MM-DD"; checkbox bool.
View: `{id, name, type:"table"|"kanban"|"gallery"|"list"|"calendar"|"timeline", filters[], sorts[], groupBy, dateProp?, filterGroup?, startProp?, endProp?, depProp?}`.
Timeline/Gantt usa `startProp`/`endProp` (data) para barras arrastáveis/redimensionáveis e `depProp` (relação auto-referente) para conectores de dependência.
Automação: `{id, name, enabled, trigger:{type:"propChanged"|"rowCreated", propId?, toValue?}, actions:[{type:"setProp"|"notify", propId?, value?, message?}]}` — executadas 100% locais em `runAutomations()` ao editar célula, mover no kanban ou criar linha.

Versões: `snapshotPage(id)`, `listVersions(pageId)`, `restoreVersion(pageId, versionId)`.
Lixeira: `listTrash()`, `restoreFromTrash(trashId)`, `purgeTrash(trashId?)`.
Settings: `getSetting(key, fallback)`, `setSetting(key, value)`.
Busca/links: `searchAll(query,{limit})→[{kind,id,rowId?,title,icon,snippet,score,updatedAt}]`,
`pageText(p)`, `pageWordCount(p)`, `backlinksTo(pageId)`, `unlinkedMentions(pageId)`, `knowledgeGraph()→{nodes:[{id,title,icon,links}], edges:[{from,to}]}`.
Stats/backup: `workspaceStats()`, `exportWorkspace()→objeto`, `importWorkspace(data,{merge})`.

## Eventos do bus

- `pages:changed` `{type, id}` · `dbs:changed` `{type, id}` · `settings:changed` `{key, value}` · `route:changed` `{name, params}`
- `palette:open` · `capture:open` · `shortcuts:open` — sem payload
- `ai:selection` `{text, pageId, rect, apply(novoTexto)}` — editor emite ao clicar "✳ IA" na barra de seleção; o assistente deve ouvir e abrir popover de ações
- `ai:page` `{pageId}` — botão "✳ IA" do topbar da página
- `ai:status` `{status, modelId, progress}` — engine emite mudanças de estado

## Convenções de UI (OBRIGATÓRIAS)

- Texto da interface em **português brasileiro**.
- Reusar classes de components.css; tokens CSS sempre (`var(--text-2)`, `var(--sp-4)`, `var(--r-md)`, `var(--ease-out)`…). Nunca cores hardcoded (exceto derivadas de tokens).
- Animações: apenas `transform`/`opacity`; entradas com `nx-pop-in`/`nx-slide-up` ou `.anim-pop/.anim-slide`; hover de cards `translateY(-2px)`+sombra (classe `.card.hoverable`); `prefers-reduced-motion` já coberto por base.css — não usar `!important` de animação.
- Tema claro E escuro devem ficar bonitos (testar `data-theme` nos dois).
- Ícones: caracteres unicode/emoji (sem libs externas).
- `h()` de utils.js para construir DOM; nunca innerHTML com dados do usuário sem `escapeHtml`.
- Overlays via `ui.js` (showMenu/showModal/toast) para consistência.

## IA local — restrições

- PROIBIDO: fetch para APIs de IA de terceiros, API keys, backend.
- WebLLM (`@mlc-ai/web-llm` via https://esm.run) importado **dinamicamente** só quando o usuário ativa IA; roda em Web Worker (module worker).
- Sem WebGPU → o app continua 100% funcional; recursos de IA mostram aviso elegante.
- Estado/config da IA em settings (`aiModel`, `aiPersona`, `aiMemory` via store aiMemory).

## Verificação local

- `node --check <arquivo.js>` valida sintaxe (package.json tem `"type":"module"`).
- Servidor de teste roda em `http://127.0.0.1:8642` (repo root). Playwright-core em
  `/tmp/claude-0/.../scratchpad` com Chromium em `/opt/pw-browsers/chromium`.
