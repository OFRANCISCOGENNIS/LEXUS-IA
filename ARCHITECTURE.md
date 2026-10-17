# NEXUS — Arquitetura e contratos internos

Workspace all-in-one local-first. **Sem build step**: HTML + CSS + ES modules puros,
servido estático. Dados em IndexedDB. A IA é opcional e mora fora do app: um gateway
que a própria pessoa roda (ver "Assistente de IA" no fim).

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
  time.css            módulo Tempo (planejador, timeline, cronômetro, metas, revisão)
  assistant.css       assistente de IA (conversa, composer, markdown das respostas)
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
    markdown.js       pageToMarkdown(page), pageToHtml(page) — HTML autocontido, sem rede —, blocksToMarkdown(blocks), markdownToBlocks(md)
    timetrack.js      cronômetro/sessões (ver abaixo) — vive fora da tela para contar durante a navegação
    ai.js             cliente do gateway de IA (OpenAI-compatível) — ver contrato abaixo
  modules/            um módulo por rota — default export { mount(container, params), unmount() }
```

## Rotas (hash)

`#/home` `#/page/:id` `#/db/:id` `#/daily` `#/graph` `#/settings` `#/templates`
`#/trash` `#/search/:query?` `#/time/:tab?` `#/assistant/:pageId?` — registradas em
`app.js` com import lazy.
`params.id` chega ao `mount(container, params)` já decodificado.
Em `#/time` o `params.id` é a aba (`plan` · `timeline` · `track` · `goals` · `review`);
sem aba, abre a última usada (setting `timeTab`) e o módulo corrige a URL com
`history.replaceState` — trocar de aba não empilha histórico.

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
`deletePage(id)` (→ lixeira, em cascata: move a página e todas as sub-páginas),
`pageDescendants(id)` (ids de todas as sub-páginas em qualquer profundidade),
`duplicatePage(id)`, `getOrCreateDaily(dateKey?)`,
`makeBlock(type, contentHtml, props)`, `makePage(partial)`.

Página: `{id, title, icon, cover, type:"page"|"daily", journalDate, parentId, blocks[], tags[], favorite, archived, locked, createdAt, updatedAt}` — campos extras livres (ex.: `mood`).
`parentId` aninha páginas dentro de páginas (árvore exibida na sidebar com caret de
expandir/recolher; estado persistido em `sidebarExpanded`, marcado como ephemeral no
sync). Uma página cujo `parentId` não resolve (pai excluído, é daily note, etc.) cai
como raiz automaticamente — nunca "desaparece" da sidebar. Criar sub-página: botão
＋ no hover do item na sidebar, menu "⋯" da página (sidebar e topbar do editor), ou
comando contextual no command palette.
Bloco: `{id, type, content(html), props{}, children[]}` — tipos: p h1-h4 bulleted numbered todo toggle quote callout code divider image.
Comentários por bloco: `props.comments[] = {id, text, at, resolved}` — a chave é apagada quando o último comentário some, para não inchar o documento.

Databases: `listDatabases()`, `getDatabase(id)`, `createDatabase(partial)`, `updateDatabase(id, patch)`,
`touchDatabase(id)` (rows/props mutadas in-place), `deleteDatabase(id)`, `makeDatabase(partial)`, `makeRow(db, values)`.
Database: `{id, name, icon, properties[], rows[], views[], automations[]}`.
Property: `{id, name, type, options?, targetDbId?, inversePropId?, relationPropId?, targetPropId?, agg?, formula?}` — types: `title text number select multiselect date checkbox url file formula relation rollup created updated`.
`file` guarda `{name, type, size, src(dataURL)}` (limite 5MB, fica em IndexedDB). `relation` com `inversePropId` é bidirecional: a database alvo ganha a propriedade inversa e os dois lados são espelhados por `syncInverseRelation()` ao editar ou excluir linhas.
`title` é a property fixa id="title". Select option: `{id, name, color}` (colors: gray blue green amber red purple).
Row: `{id, values: {propId: valor}, parentId?, createdAt, updatedAt}` — select guarda option.id; multiselect/relation array de ids; date "YYYY-MM-DD"; checkbox bool. `parentId` aninha sub-itens (só a view de tabela expande/recolhe; excluir o pai remove os descendentes).
View: `{id, name, type:"table"|"kanban"|"gallery"|"list"|"calendar"|"timeline", filters[], sorts[], groupBy, dateProp?, filterGroup?, startProp?, endProp?, depProp?}`.
Timeline/Gantt usa `startProp`/`endProp` (data) para barras arrastáveis/redimensionáveis e `depProp` (relação auto-referente) para conectores de dependência.
Automação: `{id, name, enabled, trigger:{type:"propChanged"|"rowCreated", propId?, toValue?}, actions:[{type:"setProp"|"notify", propId?, value?, message?}]}` — executadas 100% locais em `runAutomations()` ao editar célula, mover no kanban ou criar linha.

Versões: `snapshotPage(id)`, `listVersions(pageId)`, `restoreVersion(pageId, versionId)`.
Versões de database: `snapshotDatabase(id)`, `listDbVersions(dbId)`, `restoreDbVersion(dbId, versionId)` —
guardadas no mesmo store, com `pageId: "db:<id>"` para separar os universos sem migrar o schema.
Fórmulas: além de números/lógica, funções de data (`hoje`, `dias`, `somarDias`, `ano`, `mes`, `dia`) e de
texto (`concat`, `maiusc`, `minusc`, `tamanho`, `contem`, `substituir`, `vazio`). A validação mascara as
strings antes de checar identificadores, então acentos e vírgulas no texto não derrubam a fórmula.
Lixeira: `listTrash()`, `restoreFromTrash(trashId)`, `purgeTrash(trashId?)`.

## Módulo Tempo (js/modules/time.js + js/core/timetrack.js)

Nada de store novo: tudo vive em settings, então a sincronização opcional já cobre.

- `timeBlocks` — `{ "YYYY-MM-DD": [ {id, start:"HH:MM", end, title, color, ref?, done, routineId?, cancelled?} ] }`.
  Dias vazios são removidos na escrita. `ref` liga o bloco a uma tarefa:
  `{kind:"row", dbId, rowId, title}` ou `{kind:"block", pageId, blockId, title}` —
  concluir o bloco marca a tarefa de origem.
- `timeRoutines` — `[{id, weekday(0=segunda), start, end, title, color}]`. Rotinas são
  desenhadas como blocos "fantasma" nas semanas seguintes; arrastar, concluir ou editar
  um fantasma o **materializa** (vira bloco concreto com o mesmo `routineId`).
  "Remover só deste dia" grava um bloco `cancelled: true` — a exceção que impede o
  fantasma de voltar sem apagar a rotina.
- `timeSessions` — `[{id, label, ref?, start, end, seconds, date, manual?}]`, teto de 3000.
- `timeActive` — cronômetro em curso `{id, label, ref, startedAt}`. Guarda o **instante
  de início**, nunca um contador: o tempo é sempre recalculado do relógio, então
  recarregar a página não perde nem infla a sessão. Marcado como *ephemeral* no sync
  (um cronômetro correndo é estado do dispositivo, não do workspace).
- `timeGoals` — `[{id, title, icon, period, metric:"manual"|"hours"|"krs", target, unit, match, progress, krs:[{id,title,done}], color, archived}]`.
  `period` é `"YYYY"`, `"YYYY-MM"` ou `"YYYY-Qn"`; `periodRange()` converte em `[de, até]`.
- `timePlanRange` `{from, to}` (horas visíveis na grade) · `timeTlDays` (14/30/90) · `timeTab`.

API de `core/timetrack.js`: `activeTimer()`, `elapsedOf(t?)`, `startTimer({label, ref})`,
`stopTimer()` (descarta sessões < 5 s), `toggleTimer(opts)`, `listSessions()`,
`addSession({label,date,minutes})`, `removeSession(id)`, `sessionsBetween(de, até)`,
`totalSeconds(list)`, `byLabel(list)`, `fmtDur(seg)`, `fmtClock(seg)`.

Arrasto na grade: durante o gesto o bloco **não troca de pai no DOM** — recebe só um
`transform`. Reparentar no meio do arrasto fazia o navegador soltar o pointer capture e
o gesto morria calado ao cruzar mais de uma coluna. Blocos que se sobrepõem dividem a
largura da coluna (`overlapLayout()`), como num calendário.
Settings: `getSetting(key, fallback)`, `setSetting(key, value)`.
Busca/links: `searchAll(query,{limit})→[{kind,id,rowId?,title,icon,snippet,score,updatedAt}]`,
`pageText(p)`, `pageWordCount(p)`, `backlinksTo(pageId)`, `unlinkedMentions(pageId)`, `knowledgeGraph()→{nodes:[{id,title,icon,links}], edges:[{from,to}]}`.
Stats/backup: `workspaceStats()`, `exportWorkspace()→objeto`, `importWorkspace(data,{merge})`.

## Eventos do bus

- `pages:changed` `{type, id}` · `dbs:changed` `{type, id}` · `settings:changed` `{key, value}` · `route:changed` `{name, params}`
- `palette:open` · `capture:open` · `shortcuts:open` — sem payload
- `timer:changed` `{type:"start"|"stop"|"sessions", timer?, session?}` — cronômetro; o selo
  da topbar (shell.js) e as abas Cronômetro/Revisão ouvem para repintar
- `ai:status` `{enabled, model, baseUrl}` ou `{ok, models|error}` — emitido por `setAiConfig()` e `ping()`; o selo da navegação (shell.js) e a tela do assistente ouvem para repintar

## Convenções de UI (OBRIGATÓRIAS)

- Texto da interface em **português brasileiro**.
- Reusar classes de components.css; tokens CSS sempre (`var(--text-2)`, `var(--sp-4)`, `var(--r-md)`, `var(--ease-out)`…). Nunca cores hardcoded (exceto derivadas de tokens).
- Animações: apenas `transform`/`opacity`; entradas com `nx-pop-in`/`nx-slide-up` ou `.anim-pop/.anim-slide`; hover de cards `translateY(-2px)`+sombra (classe `.card.hoverable`); `prefers-reduced-motion` já coberto por base.css — não usar `!important` de animação.
- Tema claro E escuro devem ficar bonitos (testar `data-theme` nos dois).
- Ícones: caracteres unicode/emoji (sem libs externas).
- `h()` de utils.js para construir DOM; nunca innerHTML com dados do usuário sem `escapeHtml`.
- Overlays via `ui.js` (showMenu/showModal/toast) para consistência.

## Assistente de IA — contrato (js/core/ai.js + js/modules/assistant.js)

Regra que não muda: **o NEXUS não embute provedor de IA nem API key, e não fala com
API de terceiro.** Ele fala com UM gateway que a pessoa roda — o
[OmniRoute](https://github.com/diegosouzapw/OmniRoute) em `http://localhost:20128/v1`,
ou qualquer servidor compatível com a API da OpenAI. Quem guarda credencial de
provedor é o gateway; quem escolhe se liga é a pessoa.

- Desligado de fábrica. Config em settings `aiGateway`:
  `{enabled, baseUrl, apiKey, model, temperature}` (padrão `enabled:false`,
  `baseUrl:"http://localhost:20128/v1"`, `model:"auto"`).
- `aiReady()` guarda toda a superfície de IA: sem ele ligado, o botão ✳ do editor
  não existe, o selo da navegação fica apagado e a rota `#/assistant` só explica
  como ligar. **Nenhuma requisição nasce sozinha** — toda chamada vem de um clique.
- API: `aiConfig()`, `setAiConfig(patch)`, `aiReady()`, `listModels()`,
  `ping()` (nunca lança — devolve `{ok, models|error}`), `chat(messages, {system,
  model, temperature, signal, onToken})`, `complete(prompt, opts)`,
  `clipContext(texto, limite=12000)`, `SYSTEM_PT`.
- `chat()` pede `stream:true` e lê SSE (`data: {...}` / `data: [DONE]`), chamando
  `onToken` a cada delta; se o gateway devolver JSON em vez de stream, cai no
  caminho não-streaming sozinho. `signal` (AbortController) para o "Parar".
- Erros viram recado acionável em vez de "Failed to fetch": gateway fora do ar,
  chave recusada (401), rota errada (404), limite do provedor (429). O caso
  https→http://localhost (mixed content) é citado explicitamente, porque é o que
  trava quem abre o NEXUS publicado e roda o gateway na própria máquina.
- Resposta do modelo é **dado, não HTML**: `renderMd()` (assistant.js) escapa tudo
  antes de aplicar Markdown, então nada que venha do provedor vira elemento ativo.
- Contexto só vai quando a pessoa anexa: o conteúdo da página entra na mensagem de
  *system* via `pageToMarkdown` + `clipContext`, nunca misturado à pergunta.
- Conversa fica em settings `aiChat` (últimas 40 mensagens), neste aparelho.

## Verificação local

- `node --check <arquivo.js>` valida sintaxe (package.json tem `"type":"module"`).
- Servidor de teste roda em `http://127.0.0.1:8642` (repo root). Playwright-core em
  `/tmp/claude-0/.../scratchpad` com Chromium em `/opt/pw-browsers/chromium`.
