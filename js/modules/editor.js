// ═══════════════ NEXUS · Editor de blocos ═══════════════
// Blocos arrastáveis, slash menu, formatação inline, wiki-links,
// backlinks, versões, modo foco. contenteditable por bloco.

import {
  getPage, updatePage, touchPageBlocks, makeBlock, listPages, createPage,
  snapshotPage, listVersions, restoreVersion, backlinksTo, unlinkedMentions,
  pageWordCount, deletePage, duplicatePage, getSetting, setSetting,
  listDatabases, getDatabase,
} from "../core/store.js";
import { bus } from "../core/bus.js";
import { navigate } from "../core/router.js";
import {
  h, uid, debounce, sanitizeInline, stripHtml, escapeHtml, fuzzyScore, flip,
  positionFloating, fmtRelative, readingTime, clamp,
} from "../core/utils.js";
import { showMenu, closeMenus, toast, showModal, emojiPicker, confirmDialog, promptDialog } from "../core/ui.js";
import { pageToMarkdown } from "../core/markdown.js";
import { hasPin, isUnlocked, setPin, verifyPin } from "../core/privacy.js";

/* ── Definições de blocos para o slash menu ── */
const BLOCK_DEFS = [
  { type: "p", icon: "¶", title: "Texto", desc: "Parágrafo simples", kw: "texto paragrafo text" },
  { type: "h1", icon: "H1", title: "Título 1", desc: "Título grande de seção", kw: "titulo heading h1" },
  { type: "h2", icon: "H2", title: "Título 2", desc: "Subtítulo de seção", kw: "titulo heading h2" },
  { type: "h3", icon: "H3", title: "Título 3", desc: "Título menor", kw: "titulo heading h3" },
  { type: "h4", icon: "H4", title: "Título 4", desc: "Título pequeno", kw: "titulo heading h4" },
  { type: "bulleted", icon: "•", title: "Lista com marcadores", desc: "Lista simples", kw: "lista bullet marcador" },
  { type: "numbered", icon: "1.", title: "Lista numerada", desc: "Lista ordenada", kw: "lista numerada ordenada" },
  { type: "todo", icon: "☑", title: "Checklist", desc: "Tarefa com checkbox", kw: "todo tarefa check" },
  { type: "toggle", icon: "▸", title: "Toggle", desc: "Conteúdo recolhível", kw: "toggle recolher dropdown" },
  { type: "quote", icon: "❝", title: "Citação", desc: "Destaque uma citação", kw: "citacao quote" },
  { type: "callout", icon: "💡", title: "Callout", desc: "Destaque com ícone e cor", kw: "callout destaque aviso" },
  { type: "code", icon: "⌗", title: "Código", desc: "Bloco de código com highlight", kw: "codigo code snippet" },
  { type: "divider", icon: "—", title: "Divisor", desc: "Linha horizontal", kw: "divisor linha separador" },
  { type: "callout", preset: "accent", icon: "ℹ", title: "Callout · Info", desc: "Destaque informativo (azul)", kw: "callout info aviso azul destaque" },
  { type: "callout", preset: "warn", icon: "⚠", title: "Callout · Atenção", desc: "Aviso de atenção (âmbar)", kw: "callout atencao aviso amarelo ambar" },
  { type: "callout", preset: "ok", icon: "✅", title: "Callout · Sucesso", desc: "Destaque de sucesso (verde)", kw: "callout sucesso verde ok" },
  { type: "callout", preset: "danger", icon: "⛔", title: "Callout · Erro", desc: "Destaque de erro (vermelho)", kw: "callout erro perigo vermelho danger" },
  { type: "table", icon: "▦", title: "Tabela", desc: "Tabela simples editável", kw: "tabela table grade planilha" },
  { type: "progress", icon: "▰", title: "Progresso", desc: "Barra de progresso ajustável", kw: "progresso progress barra percentual meta" },
  { type: "button", icon: "⬢", title: "Botão", desc: "Botão que abre página ou link", kw: "botao button link acao clique" },
  { type: "subpage", icon: "⤷", title: "Sub-página", desc: "Cria uma página filha", kw: "subpagina pagina filha nova aninhada" },
  { type: "video", icon: "🎬", title: "Vídeo", desc: "Vídeo local (upload)", kw: "video filme media clipe" },
  { type: "audio", icon: "🎧", title: "Áudio", desc: "Áudio local (upload)", kw: "audio som media musica" },
  { type: "bookmark", icon: "🔖", title: "Bookmark", desc: "Cartão de link para uma URL", kw: "bookmark link favorito url site" },
  { type: "toc", icon: "☰", title: "Sumário", desc: "Índice automático dos títulos", kw: "sumario toc indice tabela conteudo" },
  { type: "chart", icon: "📊", title: "Gráfico", desc: "Barras a partir de uma database", kw: "grafico chart barra kpi dashboard database" },
  { type: "image", icon: "🖼", title: "Imagem", desc: "Envie ou cole uma imagem", kw: "imagem foto image" },
];

const TEXTUAL = new Set(["p", "h1", "h2", "h3", "h4", "bulleted", "numbered", "todo", "quote", "callout", "toggle"]);

/* ── Estado do editor ── */
let state = null; // { page, container, blocksEl, cleanups: [] }

/* ═══════════ Utilidades de caret ═══════════ */
function caretRange() {
  const sel = getSelection();
  return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
}
function isCaretAtStart(el) {
  const r = caretRange();
  if (!r || !r.collapsed) return false;
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length === 0;
}
function isCaretAtEnd(el) {
  const r = caretRange();
  if (!r || !r.collapsed) return false;
  const post = r.cloneRange();
  post.selectNodeContents(el);
  post.setStart(r.endContainer, r.endOffset);
  return post.toString().length === 0;
}
function placeCaret(el, atStart = false) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(atStart);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function textBeforeCaret(el) {
  const r = caretRange();
  if (!r) return "";
  const pre = r.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString();
}
function splitAtCaret(el) {
  const r = caretRange();
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(r.endContainer, r.endOffset);
  const frag = after.extractContents();
  const div = document.createElement("div");
  div.appendChild(frag);
  return div.innerHTML;
}

/* ═══════════ Localização de blocos (inclui filhos de toggles) ═══════════ */
function findBlock(id, blocks = state.page.blocks, parent = null) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.id === id) return { block: b, list: blocks, index: i, parent };
    if (b.children?.length) {
      const found = findBlock(id, b.children, b);
      if (found) return found;
    }
  }
  return null;
}

function commit({ structural = false } = {}) {
  touchPageBlocks(state.page.id);
  if (structural) renderBlocks();
}

/* ═══════════ Render ═══════════ */
export default {
  async mount(container, params) {
    const page = getPage(params.id);
    if (!page) {
      container.innerHTML = `<div class="empty-state"><div class="es-icon">🗂</div>
        <div class="es-title">Página não encontrada</div>
        <div class="es-desc">Ela pode ter sido movida para a lixeira.</div></div>`;
      return;
    }
    // página privada → exige PIN nesta sessão
    if (page.private && !isUnlocked()) {
      renderLockScreen(container, page);
      return;
    }
    state = { page, container, cleanups: [], focusMode: false };
    render(container, page);
    setupTopbar(page);
    snapshotPage(page.id);
    const snapTimer = setInterval(() => snapshotPage(page.id), 180000);
    state.cleanups.push(() => clearInterval(snapTimer));
  },
  unmount() {
    hideFmtBar();
    closeMenus();
    document.body.classList.remove("focus-mode");
    document.getElementById("topbar-actions").innerHTML = "";
    state?.cleanups.forEach((fn) => fn());
    state = null;
  },
};

function render(container, page) {
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container" });

  // ── Capa (banner) ──
  if (page.cover) wrap.appendChild(renderCover(page));

  // ── Cabeçalho: ícone + título ──
  const head = h("div", { class: "page-head" });
  const iconBtn = h("button", {
    class: "page-icon-btn" + (page.icon ? "" : " empty"),
    onclick: (e) => emojiPicker(e.currentTarget, (emoji) => {
      updatePage(page.id, { icon: emoji });
      iconBtn.textContent = emoji || "☺ Adicionar ícone";
      iconBtn.classList.toggle("empty", !emoji);
    }),
  }, page.icon || "☺ Adicionar ícone");

  const title = h("h1", {
    class: "page-title",
    contenteditable: page.locked ? "false" : "true",
    "data-placeholder": "Sem título",
    spellcheck: "false",
  });
  title.textContent = page.title;
  const saveTitle = debounce(() => updatePage(page.id, { title: title.textContent.trim() }), 350);
  title.addEventListener("input", saveTitle);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const first = state.blocksEl.querySelector(".block-content");
      if (first) placeCaret(first, true);
    }
  });
  title.addEventListener("paste", interceptPlainPaste);

  const meta = h("div", { class: "page-meta" });
  updateMeta(meta, page);

  // ação para adicionar capa (aparece no hover quando ainda não há capa)
  if (!page.cover && !page.locked) {
    const addCover = h("button", { class: "page-add-cover", onclick: () => pickCover(page) }, "🖼 Adicionar capa");
    head.appendChild(addCover);
  }

  head.append(iconBtn, title, meta);
  if (!page.locked) head.appendChild(renderTags(page));
  wrap.appendChild(head);

  // ── Blocos ──
  const blocksEl = h("div", { class: "blocks" });
  state.blocksEl = blocksEl;
  state.metaEl = meta;
  wrap.appendChild(blocksEl);
  renderBlocks();

  // clique abaixo do último bloco → foca/cria parágrafo final
  wrap.addEventListener("click", (e) => {
    if (e.target !== wrap) return;
    const last = page.blocks[page.blocks.length - 1];
    if (!last || !TEXTUAL.has(last.type) || stripHtml(last.content).trim()) {
      page.blocks.push(makeBlock());
      commit({ structural: true });
    }
    const els = blocksEl.querySelectorAll(":scope > .block .block-content");
    const lastEl = els[els.length - 1];
    if (lastEl) placeCaret(lastEl, false);
  });

  // ── Backlinks ──
  const back = backlinksTo(page.id);
  const mentions = unlinkedMentions(page.id);
  if (back.length || mentions.length) {
    const bl = h("div", { class: "backlinks" });
    if (back.length) {
      bl.appendChild(h("div", { class: "backlinks-title" }, `↩ ${back.length} backlink${back.length > 1 ? "s" : ""}`));
      back.forEach((p) => bl.appendChild(h("button", {
        class: "backlink-item", onclick: () => navigate("page", p.id),
      }, h("span", {}, p.icon || "▢"), h("span", {}, p.title || "Sem título"))));
    }
    if (mentions.length) {
      bl.appendChild(h("div", { class: "backlinks-title", style: "margin-top:12px" }, "Menções não linkadas"));
      mentions.forEach((p) => bl.appendChild(h("button", {
        class: "backlink-item", onclick: () => navigate("page", p.id),
      }, h("span", {}, p.icon || "▢"), h("span", {}, p.title || "Sem título"))));
    }
    wrap.appendChild(bl);
  }

  container.appendChild(wrap);

  // seleção → barra de formatação
  const onSelChange = () => scheduleFmtBar();
  document.addEventListener("selectionchange", onSelChange);
  state.cleanups.push(() => document.removeEventListener("selectionchange", onSelChange));
}

function updateMeta(meta, page) {
  const words = pageWordCount(page);
  meta.innerHTML = "";
  meta.append(
    h("span", {}, `${words} palavras`),
    h("span", {}, `${readingTime(words)} min de leitura`),
    h("span", {}, `editado ${fmtRelative(page.updatedAt)}`),
    page.locked ? h("span", { style: "color:var(--warn)" }, "🔒 bloqueada") : ""
  );
}

function renderBlocks() {
  const { blocksEl, page } = state;
  flip(blocksEl, () => {
    blocksEl.innerHTML = "";
    if (!page.blocks.length) page.blocks.push(makeBlock());
    let num = 0;
    for (const b of page.blocks) {
      num = b.type === "numbered" ? num + 1 : 0;
      blocksEl.appendChild(renderBlock(b, { num }));
    }
  });
}

function renderBlock(block, { num = 0, inToggle = false } = {}) {
  const el = h("div", {
    class: "block",
    dataset: { blockId: block.id, type: block.type, flipId: block.id },
  });
  if (block.type === "callout") el.dataset.color = block.props?.color || "";
  if (block.type === "todo" && block.props?.checked) el.classList.add("done");

  // handle
  if (!state.page.locked && !inToggle) {
    const handle = h("div", { class: "block-handle" },
      h("button", { class: "handle-btn add", title: "Adicionar bloco abaixo", onclick: () => addBlockAfter(block.id) }, "＋"),
      h("button", { class: "handle-btn", title: "Arrastar ou clicar para opções", draggable: "true", onclick: (e) => blockMenu(e, block) }, "⠿")
    );
    setupDrag(handle.lastChild, el, block);
    el.appendChild(handle);
  }

  // prefixos por tipo
  if (block.type === "bulleted") el.appendChild(h("div", { class: "block-prefix" }, "•"));
  if (block.type === "numbered") el.appendChild(h("div", { class: "block-prefix" }, `${num || 1}.`));
  if (block.type === "todo") {
    const check = h("div", {
      class: "todo-check" + (block.props?.checked ? " checked" : ""),
      onclick: () => {
        block.props = { ...block.props, checked: !block.props?.checked };
        check.classList.toggle("checked", block.props.checked);
        el.classList.toggle("done", block.props.checked);
        commit();
      },
    }, "✓");
    el.appendChild(h("div", { class: "block-prefix" }, check));
  }
  if (block.type === "toggle") {
    const open = block.props?.open !== false;
    const arrow = h("div", {
      class: "toggle-arrow" + (open ? " open" : ""),
      onclick: () => {
        block.props = { ...block.props, open: !(block.props?.open !== false) };
        commit({ structural: true });
      },
    }, "▶");
    el.appendChild(h("div", { class: "block-prefix" }, arrow));
  }
  if (block.type === "callout") {
    el.appendChild(h("i", {
      class: "callout-icon",
      onclick: (e) => emojiPicker(e.currentTarget, (emoji) => {
        block.props = { ...block.props, icon: emoji || "💡" };
        e.target.textContent = block.props.icon;
        commit();
      }),
    }, block.props?.icon || "💡"));
  }

  // conteúdo
  if (block.type === "divider") {
    el.appendChild(h("hr"));
    el.tabIndex = -1;
  } else if (block.type === "toc") {
    el.appendChild(renderToc());
    el.tabIndex = -1;
  } else if (block.type === "chart") {
    el.appendChild(renderChart(block));
    el.tabIndex = -1;
  } else if (block.type === "table") {
    el.appendChild(renderTableBlock(block)); el.tabIndex = -1;
  } else if (block.type === "progress") {
    el.appendChild(renderProgress(block)); el.tabIndex = -1;
  } else if (block.type === "button") {
    el.appendChild(renderButton(block)); el.tabIndex = -1;
  } else if (block.type === "subpage") {
    el.appendChild(renderSubpage(block)); el.tabIndex = -1;
  } else if (block.type === "video" || block.type === "audio") {
    el.appendChild(renderMedia(block)); el.tabIndex = -1;
  } else if (block.type === "bookmark") {
    el.appendChild(renderBookmark(block)); el.tabIndex = -1;
  } else if (block.type === "image") {
    el.appendChild(renderImage(block));
  } else if (block.type === "code") {
    el.appendChild(renderCode(block));
  } else {
    const content = h("div", {
      class: "block-content",
      contenteditable: state.page.locked ? "false" : "true",
      spellcheck: "false",
      "data-placeholder": placeholderFor(block.type),
      html: sanitizeInline(block.content || ""),
    });
    bindContent(content, block);
    el.appendChild(content);
  }

  // filhos do toggle
  if (block.type === "toggle" && block.props?.open !== false) {
    const kids = h("div", { class: "toggle-children" });
    (block.children || []).forEach((c) => kids.appendChild(renderBlock(c, { inToggle: true })));
    if (!block.children?.length) {
      const empty = h("button", {
        class: "btn ghost sm", style: "margin:2px 0;color:var(--text-faint)",
        onclick: () => {
          block.children = [makeBlock()];
          commit({ structural: true });
          focusBlock(block.children[0].id, true);
        },
      }, "Adicionar conteúdo…");
      kids.appendChild(empty);
    }
    // move o conteúdo editável para uma coluna junto com os filhos
    const contentEl = el.querySelector(":scope > .block-content");
    const col = h("div", { style: "flex:1;min-width:0" });
    if (contentEl) col.appendChild(contentEl);
    col.appendChild(kids);
    el.appendChild(col);
  }

  return el;
}

function placeholderFor(type) {
  return {
    p: "Escreva algo ou digite “/” para blocos…",
    h1: "Título 1", h2: "Título 2", h3: "Título 3", h4: "Título 4",
    bulleted: "Item", numbered: "Item", todo: "Tarefa",
    quote: "Citação", callout: "Destaque algo importante", toggle: "Toggle",
  }[type] || "";
}

/* ═══════════ Conteúdo editável ═══════════ */
function bindContent(content, block) {
  const save = debounce(() => {
    block.content = sanitizeInline(content.innerHTML);
    touchPageBlocks(state.page.id);
    if (state.metaEl) updateMeta(state.metaEl, state.page);
  }, 400);

  content.addEventListener("input", () => {
    block.content = content.innerHTML;
    save();
    maybeSlashMenu(content, block);
    maybeWikiLink(content, block);
    maybeMarkdownShortcut(content, block);
  });

  content.addEventListener("keydown", (e) => onBlockKeydown(e, content, block));
  content.addEventListener("paste", (e) => onPaste(e, content, block));
  content.addEventListener("click", (e) => {
    const link = e.target.closest(".wiki-link");
    if (link) {
      e.preventDefault();
      const id = link.dataset.pageId;
      if (id && getPage(id)) navigate("page", id);
      else toast("Página não encontrada", { type: "warn" });
    }
  });
}

function onBlockKeydown(e, content, block) {
  if (slashState.open || wikiState.open) {
    if (["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) return; // menus tratam
  }

  const found = findBlock(block.id);
  if (!found) return;
  const { list, index, parent } = found;

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    // sair de lista vazia → parágrafo
    if (["bulleted", "numbered", "todo"].includes(block.type) && !stripHtml(content.innerHTML).trim()) {
      block.type = "p";
      commit({ structural: true });
      focusBlock(block.id, true);
      return;
    }
    const afterHtml = splitAtCaret(content);
    block.content = sanitizeInline(content.innerHTML);
    const keepType = ["bulleted", "numbered", "todo"].includes(block.type) ? block.type : "p";
    const nb = makeBlock(keepType, sanitizeInline(afterHtml));
    if (block.type === "todo") nb.props = {};
    list.splice(index + 1, 0, nb);
    commit({ structural: true });
    focusBlock(nb.id, true);
  }
  else if (e.key === "Backspace" && isCaretAtStart(content)) {
    e.preventDefault();
    if (block.type !== "p" && TEXTUAL.has(block.type)) {
      // primeiro backspace: volta a parágrafo
      block.type = "p";
      block.props = {};
      commit({ structural: true });
      focusBlock(block.id, true);
      return;
    }
    if (index === 0 && !parent) {
      if (list.length === 1 && !stripHtml(block.content).trim() && state.page.blocks.length === 1) return;
      return;
    }
    const prev = list[index - 1];
    if (!prev) {
      // filho de toggle na primeira posição → promove para fora
      if (parent) {
        const pFound = findBlock(parent.id);
        list.splice(index, 1);
        pFound.list.splice(pFound.index + 1, 0, block);
        commit({ structural: true });
        focusBlock(block.id, true);
      }
      return;
    }
    if (!TEXTUAL.has(prev.type)) {
      // remove bloco vazio sobre divisor/imagem
      if (!stripHtml(block.content).trim()) {
        list.splice(index, 1);
        commit({ structural: true });
        const target = list[index - 1] || list[index];
        if (target) focusBlock(target.id, false);
      }
      return;
    }
    // merge com o anterior
    const prevLen = stripHtml(prev.content).length;
    prev.content = sanitizeInline(prev.content + block.content);
    list.splice(index, 1);
    commit({ structural: true });
    const el = state.blocksEl.querySelector(`[data-block-id="${prev.id}"] .block-content`);
    if (el) placeCaretAtTextOffset(el, prevLen);
  }
  else if (e.key === "ArrowUp" && isCaretAtStart(content)) {
    e.preventDefault();
    focusAdjacent(block.id, -1);
  }
  else if (e.key === "ArrowDown" && isCaretAtEnd(content)) {
    e.preventDefault();
    focusAdjacent(block.id, +1);
  }
  else if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      if (parent) {
        const pFound = findBlock(parent.id);
        list.splice(index, 1);
        pFound.list.splice(pFound.index + 1, 0, block);
        commit({ structural: true });
        focusBlock(block.id, true);
      }
      return;
    }
    // indenta para dentro de toggle anterior
    const prev = list[index - 1];
    if (prev?.type === "toggle") {
      prev.children = prev.children || [];
      prev.children.push(block);
      list.splice(index, 1);
      prev.props = { ...prev.props, open: true };
      commit({ structural: true });
      focusBlock(block.id, true);
    }
  }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && !e.shiftKey) {
    e.preventDefault();
    const copy = structuredClone(block);
    copy.id = uid("b");
    (copy.children || []).forEach((c) => (c.id = uid("b")));
    list.splice(index + 1, 0, copy);
    commit({ structural: true });
  }
  else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowUp") {
    e.preventDefault();
    if (index > 0) { [list[index - 1], list[index]] = [list[index], list[index - 1]]; commit({ structural: true }); focusBlock(block.id, false); }
  }
  else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "ArrowDown") {
    e.preventDefault();
    if (index < list.length - 1) { [list[index + 1], list[index]] = [list[index], list[index + 1]]; commit({ structural: true }); focusBlock(block.id, false); }
  }
}

function placeCaretAtTextOffset(el, offset) {
  el.focus();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, count = 0;
  while ((node = walker.nextNode())) {
    if (count + node.length >= offset) {
      const r = document.createRange();
      r.setStart(node, offset - count);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      return;
    }
    count += node.length;
  }
  placeCaret(el, false);
}

function flatTextualIds() {
  const ids = [];
  const walk = (blocks) => blocks.forEach((b) => {
    if (TEXTUAL.has(b.type) || b.type === "code") ids.push(b.id);
    if (b.type === "toggle" && b.props?.open !== false && b.children?.length) walk(b.children);
  });
  walk(state.page.blocks);
  return ids;
}

function focusAdjacent(id, dir) {
  const ids = flatTextualIds();
  const i = ids.indexOf(id);
  const next = ids[i + dir];
  if (next) focusBlock(next, dir < 0 ? false : true);
  else if (dir < 0) document.querySelector(".page-title")?.focus();
}

function focusBlock(id, atStart = true) {
  const el = state?.blocksEl?.querySelector(`[data-block-id="${id}"] .block-content`);
  if (el) placeCaret(el, atStart);
}

function addBlockAfter(id) {
  const found = findBlock(id);
  if (!found) return;
  const nb = makeBlock();
  found.list.splice(found.index + 1, 0, nb);
  commit({ structural: true });
  focusBlock(nb.id, true);
  setTimeout(() => {
    const el = state.blocksEl.querySelector(`[data-block-id="${nb.id}"] .block-content`);
    if (el) openSlashMenu(el, nb, true);
  }, 30);
}

/* ═══════════ Colar ═══════════ */
function interceptPlainPaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  document.execCommand("insertText", false, text.replace(/\n/g, " "));
}

function onPaste(e, content, block) {
  const items = [...(e.clipboardData?.items || [])];
  const img = items.find((i) => i.type.startsWith("image/"));
  if (img) {
    e.preventDefault();
    const file = img.getAsFile();
    insertImageBlock(block, file);
    return;
  }
  const text = e.clipboardData.getData("text/plain");
  if (!text) return;
  e.preventDefault();
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.length <= 1 || block.type === "code") {
    document.execCommand("insertText", false, block.type === "code" ? text : lines.join(" "));
    return;
  }
  // multi-linha → vira múltiplos blocos
  const found = findBlock(block.id);
  document.execCommand("insertText", false, lines[0]);
  block.content = sanitizeInline(content.innerHTML);
  const newBlocks = lines.slice(1).map((l) => {
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) return makeBlock("h" + m[1].length, escapeHtml(m[2]));
    if ((m = l.match(/^[-*]\s+\[( |x)\]\s+(.*)/i))) return makeBlock("todo", escapeHtml(m[2]), { checked: m[1].toLowerCase() === "x" });
    if ((m = l.match(/^[-*]\s+(.*)/))) return makeBlock("bulleted", escapeHtml(m[1]));
    if ((m = l.match(/^\d+[.)]\s+(.*)/))) return makeBlock("numbered", escapeHtml(m[1]));
    if ((m = l.match(/^>\s?(.*)/))) return makeBlock("quote", escapeHtml(m[1]));
    return makeBlock("p", escapeHtml(l));
  });
  found.list.splice(found.index + 1, 0, ...newBlocks);
  commit({ structural: true });
  const last = newBlocks[newBlocks.length - 1];
  focusBlock(last.id, false);
}

/* ═══════════ Tela de bloqueio (PIN) ═══════════ */
function renderLockScreen(container, page) {
  container.innerHTML = "";
  const input = h("input", { class: "input", type: "password", inputmode: "numeric",
    placeholder: "PIN", style: "text-align:center;letter-spacing:6px;font-size:1.3rem;max-width:200px" });
  const msg = h("div", { style: "color:var(--danger);font-size:var(--fs-xs);height:16px" });
  const btn = h("button", { class: "btn primary" }, "Desbloquear");
  const box = h("div", { class: "lock-screen" },
    h("div", { class: "lock-icon" }, "🔒"),
    h("div", { class: "lock-title" }, page.title || "Página privada"),
    h("div", { class: "lock-desc" }, "Digite seu PIN local para ver esta página."),
    input, msg, btn);
  container.appendChild(box);
  const tryUnlock = async () => {
    if (await verifyPin(input.value)) { navigate("page", page.id); }
    else { msg.textContent = "PIN incorreto"; input.value = ""; input.focus(); }
  };
  btn.onclick = tryUnlock;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryUnlock(); });
  setTimeout(() => input.focus(), 60);
}

async function togglePrivate(page) {
  if (!page.private) {
    if (!hasPin()) {
      const pin = await promptDialog({ title: "Criar PIN", label: "Defina um PIN local (só neste dispositivo):", placeholder: "ex.: 1234" });
      if (!pin) return;
      await setPin(pin);
      toast("PIN criado 🔐");
    }
    updatePage(page.id, { private: true });
    toast("Página agora é privada");
  } else {
    updatePage(page.id, { private: false });
    toast("Privacidade removida");
  }
  navigate("page", page.id);
}

/* ═══════════ Tags da página ═══════════ */
function renderTags(page) {
  const row = h("div", { class: "page-tags" });
  const paint = () => {
    row.innerHTML = "";
    (page.tags || []).forEach((t) => {
      row.appendChild(h("span", { class: "page-tag" },
        h("span", { onclick: () => navigate("tags", t), style: "cursor:pointer" }, "#" + t),
        h("button", { class: "pt-remove", title: "Remover", onclick: () => { page.tags = page.tags.filter((x) => x !== t); updatePage(page.id, { tags: page.tags }); paint(); } }, "×")));
    });
    const addBtn = h("button", { class: "page-tag-add" }, "＋ tag");
    addBtn.onclick = () => {
      const input = h("input", { class: "page-tag-input", placeholder: "tag…" });
      row.replaceChild(input, addBtn);
      input.focus();
      const done = (save) => {
        const val = input.value.trim().replace(/^#/, "").replace(/\s+/g, "-").toLowerCase();
        if (save && val && !(page.tags || []).includes(val)) {
          page.tags = [...(page.tags || []), val];
          updatePage(page.id, { tags: page.tags });
        }
        paint();
      };
      input.onkeydown = (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
      input.onblur = () => done(true);
    };
    row.appendChild(addBtn);
  };
  paint();
  return row;
}

/* ═══════════ Capa (banner) ═══════════ */
function renderCover(page) {
  const el = h("div", { class: "page-cover" },
    h("img", { src: page.cover, alt: "" }),
    page.locked ? null : h("div", { class: "cover-actions" },
      h("button", { class: "btn sm", onclick: () => pickCover(page) }, "Trocar"),
      h("button", { class: "btn sm ghost", onclick: () => { updatePage(page.id, { cover: "" }); navigate("page", page.id); } }, "Remover"))
  );
  return el;
}
function pickCover(page) {
  const input = h("input", { type: "file", accept: "image/*", style: "display:none" });
  input.addEventListener("change", () => {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { updatePage(page.id, { cover: reader.result }); navigate("page", page.id); };
    reader.readAsDataURL(f);
  });
  document.body.appendChild(input);
  input.click();
  setTimeout(() => input.remove(), 1000);
}

/* ═══════════ Sumário automático (TOC) ═══════════ */
function renderToc() {
  const el = h("div", { class: "block-toc" });
  const build = () => {
    el.innerHTML = "";
    const headings = state.page.blocks.filter((b) => ["h1", "h2", "h3", "h4"].includes(b.type) && stripHtml(b.content).trim());
    if (!headings.length) { el.appendChild(h("div", { class: "toc-empty" }, "Sem títulos ainda — adicione H1–H4 para montar o sumário.")); return; }
    headings.forEach((b) => {
      el.appendChild(h("button", {
        class: "toc-link toc-" + b.type,
        onclick: () => {
          const target = state.blocksEl.querySelector(`[data-block-id="${b.id}"]`);
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.querySelector(".block-content") && placeCaret(target.querySelector(".block-content"), true);
        },
      }, stripHtml(b.content)));
    });
  };
  build();
  el.rebuild = build;
  return el;
}

/* ═══════════ Bloco de gráfico (a partir de uma database) ═══════════ */
function renderChart(block) {
  const wrap = h("div", { class: "block-chart", style: "flex:1;min-width:0" });
  const cfg = block.props || {};
  const db = cfg.dbId ? getDatabase(cfg.dbId) : null;
  const prop = db?.properties.find((p) => p.id === cfg.propId && p.type === "select");

  const configBar = h("div", { class: "chart-config" });
  const dbSel = h("select", { class: "input", style: "width:auto" });
  dbSel.appendChild(h("option", { value: "" }, "— database —"));
  listDatabases().forEach((d) => dbSel.appendChild(h("option", { value: d.id, selected: d.id === cfg.dbId || null }, d.name)));
  const propSel = h("select", { class: "input", style: "width:auto" });
  const fillProps = (d) => {
    propSel.innerHTML = "";
    propSel.appendChild(h("option", { value: "" }, "— agrupar por —"));
    (d?.properties || []).filter((p) => p.type === "select").forEach((p) => propSel.appendChild(h("option", { value: p.id, selected: p.id === cfg.propId || null }, p.name)));
  };
  fillProps(db);
  dbSel.onchange = () => { block.props = { ...block.props, dbId: dbSel.value, propId: "" }; commit({ structural: true }); };
  propSel.onchange = () => { block.props = { ...block.props, propId: propSel.value }; commit({ structural: true }); };
  const kindBtn = h("button", { class: "btn ghost sm", title: "Tipo",
    onclick: () => { block.props = { ...block.props, kind: (cfg.kind === "pie" ? "bar" : "pie") }; commit({ structural: true }); } },
    cfg.kind === "pie" ? "◔ Pizza" : "▮ Barras");
  configBar.append(dbSel, propSel, kindBtn);
  wrap.appendChild(configBar);

  if (!db || !prop) {
    wrap.appendChild(h("div", { class: "chart-empty" }, "Escolha uma database e uma propriedade Select para montar o gráfico."));
    return wrap;
  }

  // conta linhas por opção
  const counts = (prop.options || []).map((o) => ({ o, n: db.rows.filter((r) => r.values[prop.id] === o.id).length }));
  const none = db.rows.filter((r) => !prop.options.some((o) => o.id === r.values[prop.id])).length;
  if (none) counts.push({ o: { name: "Sem valor", color: "gray" }, n: none });
  const total = counts.reduce((a, b) => a + b.n, 0) || 1;

  wrap.appendChild(h("div", { class: "chart-title" }, `${db.name} · por ${prop.name} (${total})`));
  if (cfg.kind === "pie") wrap.appendChild(pieChart(counts, total));
  else wrap.appendChild(barChart(counts, total));
  return wrap;
}

const CHART_HSL = { gray: "215 12% 55%", slate: "215 28% 50%", blue: "214 84% 56%", green: "148 55% 46%", amber: "36 90% 52%", red: "4 74% 57%", purple: "268 60% 58%", teal: "176 62% 44%" };
const colHsl = (c) => `hsl(${CHART_HSL[c] || CHART_HSL.gray})`;

function barChart(counts, total) {
  const max = Math.max(...counts.map((c) => c.n), 1);
  const rows = h("div", { class: "chart-bars" });
  counts.forEach(({ o, n }) => {
    rows.appendChild(h("div", { class: "cb-row" },
      h("div", { class: "cb-label" }, o.name),
      h("div", { class: "cb-track" }, h("div", { class: "cb-fill", style: `width:${(n / max) * 100}%;background:${colHsl(o.color)}` })),
      h("div", { class: "cb-val" }, String(n))));
  });
  return rows;
}
function pieChart(counts, total) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 42 42"); svg.setAttribute("class", "chart-pie");
  let acc = 0;
  counts.filter((c) => c.n).forEach(({ o, n }) => {
    const frac = n / total;
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "21"); c.setAttribute("cy", "21"); c.setAttribute("r", "15.915");
    c.setAttribute("fill", "none"); c.setAttribute("stroke", colHsl(o.color)); c.setAttribute("stroke-width", "8");
    c.setAttribute("stroke-dasharray", `${(frac * 100).toFixed(2)} ${(100 - frac * 100).toFixed(2)}`);
    c.setAttribute("stroke-dashoffset", String(25 - acc * 100));
    svg.appendChild(c);
    acc += frac;
  });
  const legend = h("div", { class: "chart-legend" });
  counts.filter((c) => c.n).forEach(({ o, n }) => legend.appendChild(
    h("span", { class: "cl-item" }, h("span", { class: "cl-dot", style: `background:${colHsl(o.color)}` }), `${o.name} · ${n}`)));
  return h("div", { class: "chart-pie-wrap" }, svg, legend);
}

/* ═══════════ Tabela inline ═══════════ */
function renderTableBlock(block) {
  block.props = block.props || {};
  const data = block.props.data || (block.props.data = [["", ""], ["", ""]]);
  const wrap = h("div", { class: "block-tableblock", style: "flex:1;min-width:0" });
  const table = h("table", { class: "inline-table" });
  data.forEach((row, ri) => {
    const tr = h("tr", {});
    row.forEach((cell, ci) => {
      const td = h("td", {});
      const c = h("div", { class: "it-cell", contenteditable: state.page.locked ? "false" : "true", html: sanitizeInline(cell || "") });
      if (ri === 0) c.classList.add("it-head");
      c.addEventListener("input", debounce(() => { data[ri][ci] = sanitizeInline(c.innerHTML); touchPageBlocks(state.page.id); }, 400));
      td.appendChild(c); tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  if (!state.page.locked) {
    wrap.appendChild(h("div", { class: "it-actions" },
      h("button", { class: "btn ghost sm", onclick: () => { data.forEach((r) => r.push("")); commit({ structural: true }); } }, "＋ coluna"),
      h("button", { class: "btn ghost sm", onclick: () => { data.push(new Array(data[0].length).fill("")); commit({ structural: true }); } }, "＋ linha"),
      h("button", { class: "btn ghost sm", onclick: () => { if (data[0].length > 1) { data.forEach((r) => r.pop()); commit({ structural: true }); } } }, "− coluna"),
      h("button", { class: "btn ghost sm", onclick: () => { if (data.length > 1) { data.pop(); commit({ structural: true }); } } }, "− linha")));
  }
  return wrap;
}

/* ═══════════ Barra de progresso ═══════════ */
function renderProgress(block) {
  block.props = block.props || { value: 40 };
  const wrap = h("div", { class: "block-progress", style: "flex:1;min-width:0" });
  const label = h("div", { class: "prog-label", contenteditable: state.page.locked ? "false" : "true", "data-placeholder": "Rótulo…", html: sanitizeInline(block.props.label || "") });
  label.addEventListener("input", debounce(() => { block.props.label = sanitizeInline(label.innerHTML); touchPageBlocks(state.page.id); }, 400));
  const pct = h("span", { class: "prog-pct" }, (block.props.value || 0) + "%");
  const range = h("input", { type: "range", min: "0", max: "100", value: String(block.props.value || 0), class: "prog-range", disabled: state.page.locked ? "" : null });
  const fill = h("div", { class: "prog-fill", style: `width:${block.props.value || 0}%` });
  range.addEventListener("input", () => { block.props.value = +range.value; pct.textContent = range.value + "%"; fill.style.width = range.value + "%"; });
  range.addEventListener("change", () => touchPageBlocks(state.page.id));
  wrap.append(
    h("div", { class: "prog-head" }, label, pct),
    h("div", { class: "prog-track" }, fill),
    state.page.locked ? null : range);
  return wrap;
}

/* ═══════════ Botão ═══════════ */
function renderButton(block) {
  block.props = block.props || {};
  const a = block.props.action || (block.props.action = { type: "url", target: "" });
  const btn = h("button", { class: "block-button" }, block.props.label || "Botão");
  btn.onclick = () => {
    if (a.type === "page" && a.target) navigate("page", a.target);
    else if (a.type === "url" && a.target) open(/^https?:/i.test(a.target) ? a.target : "https://" + a.target, "_blank");
    else if (!state.page.locked) configBtn();
  };
  const cog = state.page.locked ? null : h("button", { class: "icon-btn block-button-cfg", "aria-label": "Configurar", onclick: (e) => { e.stopPropagation(); configBtn(e.currentTarget); } }, "⚙");
  function configBtn(anchor) {
    showMenu(anchor || btn, [
      { icon: "✎", title: "Editar rótulo", action: async () => { const l = await promptDialog({ title: "Rótulo do botão", value: block.props.label || "" }); if (l != null) { block.props.label = l; commit({ structural: true }); } } },
      { icon: "🔗", title: "Abrir uma URL", action: async () => { const u = await promptDialog({ title: "URL", value: a.type === "url" ? a.target : "" }); if (u != null) { block.props.action = { type: "url", target: u }; commit({ structural: true }); } } },
      { icon: "📄", title: "Abrir uma página", action: () => pickPageForButton(block) },
    ]);
  }
  return h("div", { class: "block-button-wrap", style: "flex:1;min-width:0" }, btn, cog);
}
function pickPageForButton(block) {
  const items = listPages().filter((p) => p.id !== state.page.id).slice(0, 20).map((p) => ({
    icon: p.icon || "▢", title: p.title || "Sem título",
    action: () => { block.props.action = { type: "page", target: p.id }; commit({ structural: true }); },
  }));
  showMenu(state.blocksEl.querySelector(`[data-block-id="${block.id}"] .block-button`), items.length ? items : [{ title: "Nenhuma outra página" }]);
}

/* ═══════════ Sub-página ═══════════ */
function renderSubpage(block) {
  const child = block.props?.pageId ? getPage(block.props.pageId) : null;
  if (!child) return h("div", { class: "block-subpage broken" }, "⤷ Sub-página removida");
  return h("button", { class: "block-subpage", style: "flex:1;min-width:0", onclick: () => navigate("page", child.id) },
    h("span", { class: "sp-icon" }, child.icon || "📄"),
    h("span", { class: "sp-title" }, child.title || "Sem título"),
    h("span", { class: "sp-arrow" }, "›"));
}

/* ═══════════ Vídeo / Áudio local ═══════════ */
function renderMedia(block) {
  if (block.props?.src) {
    const el = block.type === "video"
      ? h("video", { src: block.props.src, controls: "", style: "width:100%;border-radius:var(--r-md)" })
      : h("audio", { src: block.props.src, controls: "", style: "width:100%" });
    return h("div", { class: "block-media", style: "flex:1;min-width:0" }, el);
  }
  return h("div", { class: "image-placeholder", style: "flex:1;min-width:0", onclick: () => pickMedia(block, block.type) },
    h("span", {}, block.type === "video" ? "🎬" : "🎧"),
    h("span", {}, `Clique para enviar um ${block.type === "video" ? "vídeo" : "áudio"} (fica no dispositivo)`));
}
function pickMedia(block, kind) {
  const input = h("input", { type: "file", accept: kind + "/*", style: "display:none" });
  input.addEventListener("change", () => {
    const f = input.files[0]; if (!f) return;
    if (f.size > 40 * 1024 * 1024) { toast("Arquivo grande demais (máx. 40MB para guardar localmente)", { type: "warn" }); return; }
    const reader = new FileReader();
    reader.onload = () => { block.props = { ...block.props, src: reader.result }; commit({ structural: true }); };
    reader.readAsDataURL(f);
  });
  document.body.appendChild(input); input.click(); setTimeout(() => input.remove(), 1000);
}

/* ═══════════ Bookmark ═══════════ */
function renderBookmark(block) {
  const url = block.props?.url;
  if (!url) {
    return h("div", { class: "image-placeholder", style: "flex:1;min-width:0", onclick: async () => {
      const u = await promptDialog({ title: "URL do bookmark", placeholder: "https://…" });
      if (u) { block.props = { ...block.props, url: u }; commit({ structural: true }); }
    } }, h("span", {}, "🔖"), h("span", {}, "Clique para colar um link"));
  }
  let host = url; try { host = new URL(/^https?:/i.test(url) ? url : "https://" + url).host; } catch {}
  return h("a", { class: "block-bookmark card hoverable", href: /^https?:/i.test(url) ? url : "https://" + url, target: "_blank", rel: "noopener", style: "flex:1;min-width:0" },
    h("span", { class: "bm-favicon" }, "🔖"),
    h("div", { class: "bm-body" },
      h("div", { class: "bm-host" }, host),
      h("div", { class: "bm-url" }, url)));
}

/* ═══════════ Imagens ═══════════ */
function renderImage(block) {
  if (block.props?.src) {
    return h("div", { class: "block-image" }, h("img", { src: block.props.src, alt: "" }));
  }
  const input = h("input", { type: "file", accept: "image/*", style: "display:none" });
  input.addEventListener("change", () => {
    if (input.files[0]) setImageFromFile(block, input.files[0]);
  });
  return h("div", {},
    h("div", { class: "image-placeholder", onclick: () => input.click() },
      h("span", {}, "🖼"), h("span", {}, "Clique para enviar uma imagem (ou cole com Ctrl+V)")),
    input
  );
}

function setImageFromFile(block, file) {
  const reader = new FileReader();
  reader.onload = () => {
    block.props = { ...block.props, src: reader.result };
    commit({ structural: true });
  };
  reader.readAsDataURL(file);
}

function insertImageBlock(afterBlock, file) {
  const found = findBlock(afterBlock.id);
  const nb = makeBlock("image", "");
  found.list.splice(found.index + 1, 0, nb);
  setImageFromFile(nb, file);
}

/* ═══════════ Código ═══════════ */
const LANGS = ["javascript", "typescript", "python", "html", "css", "json", "bash", "sql", "rust", "go", "texto"];
function renderCode(block) {
  const content = h("div", {
    class: "block-content",
    contenteditable: state.page.locked ? "false" : "true",
    spellcheck: "false",
    "data-placeholder": "// código…",
  });
  content.textContent = block.content || "";

  const langBtn = h("button", { class: "code-lang" }, (block.props?.lang || "texto") + " ▾");
  langBtn.onclick = (e) => showMenu(e.currentTarget, LANGS.map((l) => ({
    title: l,
    action: () => { block.props = { ...block.props, lang: l }; langBtn.textContent = l + " ▾"; highlight(); commit(); },
  })));

  const copyBtn = h("button", {
    class: "icon-btn code-copy", title: "Copiar código",
    onclick: () => { navigator.clipboard.writeText(block.content || ""); toast("Código copiado"); },
  }, "⧉");

  const save = debounce(() => { commit(); }, 500);
  content.addEventListener("input", () => { block.content = content.textContent; save(); });
  content.addEventListener("focus", () => { content.textContent = block.content || ""; });
  content.addEventListener("blur", highlight);
  content.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
    if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertText", false, "\n"); }
    if (e.key === "Backspace" && !content.textContent) {
      e.preventDefault();
      const found = findBlock(block.id);
      found.list.splice(found.index, 1);
      if (!found.list.length) found.list.push(makeBlock());
      commit({ structural: true });
    }
  });
  content.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });

  function highlight() {
    const code = block.content || "";
    content.innerHTML = highlightCode(code, block.props?.lang);
  }
  highlight();

  return h("div", { class: "code-wrap", style: "flex:1;min-width:0" },
    h("div", { class: "code-head" }, langBtn, copyBtn),
    content
  );
}

const KEYWORDS = /\b(function|const|let|var|return|if|else|for|while|class|import|export|from|def|async|await|new|try|catch|throw|switch|case|break|continue|typeof|instanceof|in|of|not|and|or|is|None|True|False|null|undefined|true|false|print|lambda|self|this|pass|elif|with|as|yield|struct|fn|pub|impl|use|mut|match)\b/g;
export function highlightCode(code, lang) {
  let out = escapeHtml(code);
  out = out.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[^`]*`)/g, '<span class="tok-str">$1</span>');
  out = out.replace(/(\/\/[^\n<]*|#(?![0-9a-fA-F]{3})[^\n<]*)/g, '<span class="tok-com">$1</span>');
  out = out.replace(KEYWORDS, '<span class="tok-kw">$1</span>');
  out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
  out = out.replace(/\b([a-zA-Z_]\w*)(?=\()/g, '<span class="tok-fn">$1</span>');
  return out;
}

/* ═══════════ Slash menu ═══════════ */
const slashState = { open: false, menu: null, block: null, contentEl: null, query: "" };

function maybeSlashMenu(content, block) {
  const before = textBeforeCaret(content);
  const m = before.match(/(?:^|\s)\/([^\s/]*)$/); // aceita acentos e outros caracteres
  if (m) {
    slashState.query = m[1];
    if (!slashState.open) openSlashMenu(content, block);
    else refreshSlashMenu();
  } else if (slashState.open) {
    closeSlash();
  }
}

function openSlashMenu(content, block, empty = false) {
  closeSlash();
  slashState.open = true;
  slashState.block = block;
  slashState.contentEl = content;
  if (empty) slashState.query = "";
  const menu = h("div", { class: "menu", role: "menu", style: "min-width:280px" });
  slashState.menu = menu;
  document.getElementById("overlay-root").appendChild(menu);
  refreshSlashMenu();

  const r = caretRange();
  const rect = r ? r.getBoundingClientRect() : content.getBoundingClientRect();
  positionFloating(menu, rect.width || rect.height ? rect : content.getBoundingClientRect(), { gap: 8 });

  const onKey = (e) => {
    if (!slashState.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSlash(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveSlashSel(+1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSlashSel(-1); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      menu.querySelector(".menu-item.selected")?.click();
    }
  };
  addEventListener("keydown", onKey, true);
  slashState.offKey = () => removeEventListener("keydown", onKey, true);
  const onOutside = (ev) => { if (!menu.contains(ev.target)) closeSlash(); };
  setTimeout(() => addEventListener("pointerdown", onOutside, true), 0);
  slashState.offOutside = () => removeEventListener("pointerdown", onOutside, true);
}

function refreshSlashMenu() {
  const { menu, query } = slashState;
  if (!menu) return;
  const scored = BLOCK_DEFS
    .map((d) => ({ d, s: query ? Math.max(fuzzyScore(query, d.title), fuzzyScore(query, d.kw)) : 0 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  menu.innerHTML = "";
  menu.appendChild(h("div", { class: "menu-label" }, "Blocos"));
  scored.forEach(({ d }, i) => {
    menu.appendChild(h("button", {
      class: "menu-item" + (i === 0 ? " selected" : ""),
      style: `animation-delay:${Math.min(i * 20, 140)}ms`,
      onclick: () => applySlash(d),
      onmousemove: (e) => {
        if (e.currentTarget.classList.contains("selected")) return;
        menu.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("selected"));
        e.currentTarget.classList.add("selected");
      },
    },
      h("i", { class: "mi-icon" }, d.icon),
      h("div", { class: "mi-body" },
        h("div", { class: "mi-title" }, d.title),
        h("div", { class: "mi-desc" }, d.desc)),
    ));
  });
  if (!scored.length) menu.appendChild(h("div", { class: "palette-empty" }, "Nenhum bloco encontrado"));
}

function moveSlashSel(dir) {
  const items = [...slashState.menu.querySelectorAll(".menu-item")];
  const cur = items.findIndex((x) => x.classList.contains("selected"));
  const next = clamp(cur + dir, 0, items.length - 1);
  items.forEach((x, i) => x.classList.toggle("selected", i === next));
  items[next]?.scrollIntoView({ block: "nearest" });
}

function applySlash(def) {
  const { block, contentEl } = slashState;
  // remove o texto "/query" digitado
  const text = contentEl.innerHTML.replace(/\/[^\s/]*(\s|&nbsp;)?$/, "");
  block.content = sanitizeInline(text);
  block.type = def.type;
  if (def.type === "callout") block.props = { icon: def.preset === "warn" ? "⚠" : def.preset === "ok" ? "✅" : def.preset === "danger" ? "⛔" : def.preset === "accent" ? "ℹ" : "💡", color: def.preset || "", ...block.props };
  if (def.type === "code") block.props = { lang: "javascript", ...block.props };
  if (def.type === "table") block.props = { data: [["", "", ""], ["", "", ""]] };
  if (def.type === "progress") block.props = { value: 40, label: "" };
  if (def.type === "button") block.props = { label: "Clique aqui", action: { type: "url", target: "" } };
  if (def.type === "bookmark") block.props = { url: "" };
  if (def.type === "subpage") {
    const child = createPage({ title: "Sub-página", parentId: state.page.id });
    block.props = { pageId: child.id };
  }
  closeSlash();

  // blocos não-textuais ganham um parágrafo em branco logo abaixo, para o fluxo continuar
  const NEEDS_TRAILING = new Set(["table", "progress", "button", "subpage", "bookmark", "chart", "toc", "divider", "image", "video", "audio"]);
  let trailingId = null;
  if (NEEDS_TRAILING.has(def.type)) {
    const found = findBlock(block.id);
    if (found) {
      const next = found.list[found.index + 1];
      if (!next || next.type !== "p" || stripHtml(next.content).trim()) {
        const nb = makeBlock();
        found.list.splice(found.index + 1, 0, nb);
        trailingId = nb.id;
      } else trailingId = next.id;
    }
  }

  commit({ structural: true });
  if (TEXTUAL.has(def.type)) focusBlock(block.id, false);
  else if (def.type === "code") {
    const el = state.blocksEl.querySelector(`[data-block-id="${block.id}"] .block-content`);
    if (el) { el.textContent = block.content ? stripHtml(block.content) : ""; placeCaret(el, false); }
  } else if (trailingId) {
    focusBlock(trailingId, true);
  }
  if (def.type === "video" || def.type === "audio") pickMedia(block, def.type);
}

function closeSlash() {
  slashState.menu?.remove();
  slashState.offKey?.();
  slashState.offOutside?.();
  Object.assign(slashState, { open: false, menu: null, block: null, contentEl: null, query: "" });
}

/* ═══════════ Wiki-links [[...]] ═══════════ */
const wikiState = { open: false, menu: null, block: null, contentEl: null, query: "" };

function maybeWikiLink(content, block) {
  const before = textBeforeCaret(content);
  const m = before.match(/\[\[([^\]]*)$/);
  if (m) {
    wikiState.query = m[1];
    if (!wikiState.open) openWikiMenu(content, block);
    else refreshWikiMenu();
  } else if (wikiState.open) closeWiki();
}

function openWikiMenu(content, block) {
  closeWiki();
  wikiState.open = true;
  wikiState.block = block;
  wikiState.contentEl = content;
  const menu = h("div", { class: "menu", style: "min-width:260px" });
  wikiState.menu = menu;
  document.getElementById("overlay-root").appendChild(menu);
  refreshWikiMenu();
  const r = caretRange();
  positionFloating(menu, r ? r.getBoundingClientRect() : content.getBoundingClientRect(), { gap: 8 });

  const onKey = (e) => {
    if (!wikiState.open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeWiki(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...menu.querySelectorAll(".menu-item")];
      const cur = items.findIndex((x) => x.classList.contains("selected"));
      const next = clamp(cur + (e.key === "ArrowDown" ? 1 : -1), 0, items.length - 1);
      items.forEach((x, i) => x.classList.toggle("selected", i === next));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); e.stopPropagation();
      menu.querySelector(".menu-item.selected")?.click();
    }
  };
  addEventListener("keydown", onKey, true);
  wikiState.offKey = () => removeEventListener("keydown", onKey, true);
}

function refreshWikiMenu() {
  const { menu, query } = wikiState;
  if (!menu) return;
  const pages = listPages()
    .filter((p) => p.id !== state.page.id)
    .map((p) => ({ p, s: query ? fuzzyScore(query, p.title || "") : 1 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8);
  menu.innerHTML = "";
  menu.appendChild(h("div", { class: "menu-label" }, "Linkar página"));
  pages.forEach(({ p }, i) => {
    menu.appendChild(h("button", {
      class: "menu-item" + (i === 0 ? " selected" : ""),
      onclick: () => insertWikiLink(p),
    },
      h("i", { class: "mi-icon" }, p.icon || "▢"),
      h("div", { class: "mi-body" }, h("div", { class: "mi-title" }, p.title || "Sem título"))));
  });
  menu.appendChild(h("button", {
    class: "menu-item" + (!pages.length ? " selected" : ""),
    onclick: () => {
      const np = createPage({ title: query || "Nova página" });
      insertWikiLink(np);
    },
  },
    h("i", { class: "mi-icon" }, "＋"),
    h("div", { class: "mi-body" }, h("div", { class: "mi-title" }, `Criar “${query || "Nova página"}”`))));
}

function insertWikiLink(page) {
  const { contentEl, block } = wikiState;
  closeWiki();
  contentEl.focus();
  // apaga "[[query" antes do caret
  const sel = getSelection();
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    let node = r.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.slice(0, r.startOffset);
      const idx = text.lastIndexOf("[[");
      if (idx >= 0) {
        const del = document.createRange();
        del.setStart(node, idx);
        del.setEnd(r.startContainer, r.startOffset);
        del.deleteContents();
      }
    }
  }
  const span = h("span", {
    class: "wiki-link", dataset: { pageId: page.id }, contenteditable: "false",
  }, page.title || "Sem título");
  const r2 = getSelection().getRangeAt(0);
  r2.insertNode(span);
  const space = document.createTextNode(" ");
  span.after(space);
  const after = document.createRange();
  after.setStartAfter(space);
  after.collapse(true);
  const s = getSelection();
  s.removeAllRanges(); s.addRange(after);

  block.content = sanitizeInline(contentEl.innerHTML);
  commit();
}

function closeWiki() {
  wikiState.menu?.remove();
  wikiState.offKey?.();
  Object.assign(wikiState, { open: false, menu: null, block: null, contentEl: null, query: "" });
}

/* ═══════════ Atalhos markdown ═══════════ */
function maybeMarkdownShortcut(content, block) {
  if (block.type === "code") return;
  const text = content.textContent;
  const map = [
    [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^####\s$/, "h4"],
    [/^[-*]\s$/, "bulleted"], [/^1[.)]\s$/, "numbered"],
    [/^\[\]\s$/, "todo"], [/^>\s$/, "quote"], [/^```$/, "code"], [/^---$/, "divider"],
    [/^▸\s$/, "toggle"],
  ];
  for (const [re, type] of map) {
    if (re.test(text) && block.type === "p") {
      block.type = type;
      block.content = "";
      if (type === "code") block.props = { lang: "javascript" };
      commit({ structural: true });
      if (type === "code") {
        const el = state.blocksEl.querySelector(`[data-block-id="${block.id}"] .block-content`);
        if (el) { el.textContent = ""; placeCaret(el, true); }
      } else if (type !== "divider") focusBlock(block.id, true);
      return;
    }
  }
}

/* ═══════════ Menu do bloco (handle) ═══════════ */
function blockMenu(e, block) {
  e.stopPropagation();
  const found = findBlock(block.id);
  showMenu(e.currentTarget, [
    { label: "Transformar em" },
    ...BLOCK_DEFS.filter((d) => TEXTUAL.has(d.type)).slice(0, 9).map((d) => ({
      icon: d.icon, title: d.title,
      action: () => { block.type = d.type; commit({ structural: true }); },
    })),
    { sep: true },
    { icon: "⧉", title: "Duplicar", kbd: "⌘D", action: () => {
      const copy = structuredClone(block); copy.id = uid("b");
      (copy.children || []).forEach((c) => (c.id = uid("b")));
      found.list.splice(found.index + 1, 0, copy);
      commit({ structural: true });
    } },
    { icon: "🗑", title: "Excluir bloco", danger: true, action: () => {
      found.list.splice(found.index, 1);
      if (!state.page.blocks.length) state.page.blocks.push(makeBlock());
      commit({ structural: true });
    } },
  ]);
}

/* ═══════════ Drag & drop de blocos ═══════════ */
function setupDrag(handleEl, blockEl, block) {
  handleEl.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/nexus-block", block.id);
    e.dataTransfer.effectAllowed = "move";
    blockEl.classList.add("dragging");
    setTimeout(() => blockEl.classList.add("lifted"), 0);
  });
  handleEl.addEventListener("dragend", () => {
    blockEl.classList.remove("dragging", "lifted");
    state.blocksEl.querySelectorAll(".drag-over-top,.drag-over-bottom")
      .forEach((x) => x.classList.remove("drag-over-top", "drag-over-bottom"));
  });

  blockEl.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes("text/nexus-block")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = blockEl.getBoundingClientRect();
    const top = e.clientY < rect.top + rect.height / 2;
    blockEl.classList.toggle("drag-over-top", top);
    blockEl.classList.toggle("drag-over-bottom", !top);
  });
  blockEl.addEventListener("dragleave", () => {
    blockEl.classList.remove("drag-over-top", "drag-over-bottom");
  });
  blockEl.addEventListener("drop", (e) => {
    const id = e.dataTransfer.getData("text/nexus-block");
    if (!id || id === block.id) return;
    e.preventDefault();
    const rect = blockEl.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const src = findBlock(id);
    const dst = findBlock(block.id);
    if (!src || !dst) return;
    src.list.splice(src.index, 1);
    // recalcula índice de destino após remoção
    const dst2 = findBlock(block.id);
    dst2.list.splice(dst2.index + (before ? 0 : 1), 0, src.block);
    commit({ structural: true });
  });
}

/* ═══════════ Barra de formatação flutuante ═══════════ */
let fmtBar = null;
const scheduleFmtBar = debounce(updateFmtBar, 120);

function updateFmtBar() {
  if (!state) return;
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { hideFmtBar(); return; }
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const blockContent = (container.nodeType === 1 ? container : container.parentElement)?.closest?.(".block-content");
  if (!blockContent || !state.container.contains(blockContent)) { hideFmtBar(); return; }
  const blockEl = blockContent.closest(".block");
  if (blockEl?.dataset.type === "code") { hideFmtBar(); return; }
  const text = sel.toString();
  if (!text.trim()) { hideFmtBar(); return; }

  hideFmtBar();
  const cmd = (name, arg) => (e) => {
    e.preventDefault();
    document.execCommand(name, false, arg);
    syncBlockFromSelection();
  };
  const savedRange = range.cloneRange();

  fmtBar = h("div", { class: "fmt-bar" },
    fmtButton("B", "b", cmd("bold"), "bold"),
    fmtButton("I", "i", cmd("italic"), "italic"),
    fmtButton("U", "u", cmd("underline"), "underline"),
    fmtButton("S", "s", cmd("strikeThrough"), "strikeThrough"),
    fmtButton("‹›", "code", (e) => { e.preventDefault(); wrapSelection("code"); }),
    fmtButton("▉", "mark", (e) => { e.preventDefault(); wrapSelection("mark"); }),
    h("span", { class: "fmt-sep" }),
    fmtButton("🔗", "link", (e) => {
      e.preventDefault();
      const url = prompt("URL do link:");
      if (url) { document.execCommand("createLink", false, url); syncBlockFromSelection(); }
    }),
  );
  // estilo dos botões B/I/U/S
  fmtBar.querySelector('[data-k="b"]').style.fontWeight = "800";
  fmtBar.querySelector('[data-k="i"]').style.fontStyle = "italic";
  fmtBar.querySelector('[data-k="u"]').style.textDecoration = "underline";
  fmtBar.querySelector('[data-k="s"]').style.textDecoration = "line-through";

  document.getElementById("overlay-root").appendChild(fmtBar);
  const rect = range.getBoundingClientRect();
  const barRect = fmtBar.getBoundingClientRect();
  fmtBar.style.top = Math.max(8, rect.top - barRect.height - 8) + "px";
  fmtBar.style.left = clamp(rect.left + rect.width / 2 - barRect.width / 2, 8, innerWidth - barRect.width - 8) + "px";
}

function fmtButton(label, key, onmousedown, queryCmd) {
  const b = h("button", { class: "fmt-btn" + (key === "ai" ? " ai" : ""), dataset: { k: key }, onmousedown }, label);
  if (queryCmd) { try { if (document.queryCommandState(queryCmd)) b.classList.add("on"); } catch {} }
  return b;
}

function wrapSelection(tag) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const el = document.createElement(tag);
  try {
    range.surroundContents(el);
  } catch {
    el.appendChild(range.extractContents());
    range.insertNode(el);
  }
  sel.removeAllRanges();
  syncBlockFromSelection(el);
}

function syncBlockFromSelection(node) {
  const sel = getSelection();
  const anchor = node || (sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null);
  const el = (anchor?.nodeType === 1 ? anchor : anchor?.parentElement)?.closest?.(".block-content");
  if (!el) return;
  const blockEl = el.closest(".block");
  const found = findBlock(blockEl.dataset.blockId);
  if (found) {
    found.block.content = sanitizeInline(el.innerHTML);
    touchPageBlocks(state.page.id);
  }
}

function hideFmtBar() {
  fmtBar?.remove();
  fmtBar = null;
}

/* ═══════════ Topbar: histórico, foco, menu ═══════════ */
function setupTopbar(page) {
  const actions = document.getElementById("topbar-actions");
  actions.innerHTML = "";

  const focusBtn = h("button", { class: "icon-btn", title: "Modo foco", "aria-label": "Modo foco" }, "◎");
  focusBtn.onclick = () => toggleFocusMode(focusBtn);

  const historyBtn = h("button", { class: "icon-btn", title: "Histórico de versões", "aria-label": "Histórico" }, "↺");
  historyBtn.onclick = () => showHistory(page);

  const moreBtn = h("button", { class: "icon-btn", title: "Mais opções", "aria-label": "Mais opções" }, "⋯");
  moreBtn.onclick = (e) => showMenu(e.currentTarget, [
    { icon: "★", title: page.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos",
      action: () => updatePage(page.id, { favorite: !page.favorite }) },
    { icon: "⧉", title: "Duplicar página", action: () => { const c = duplicatePage(page.id); navigate("page", c.id); } },
    { icon: page.locked ? "🔓" : "🔒", title: page.locked ? "Desbloquear página" : "Bloquear página (somente leitura)",
      action: () => { updatePage(page.id, { locked: !page.locked }); navigate("page", page.id); } },
    { icon: page.private ? "👁" : "🔐", title: page.private ? "Remover privacidade" : "Tornar privada (PIN)",
      action: () => togglePrivate(page) },
    { sep: true },
    { icon: "⬇", title: "Exportar como Markdown", action: () => {
      import("../core/utils.js").then(({ download }) =>
        download((page.title || "pagina") + ".md", pageToMarkdown(page), "text/markdown"));
    } },
    { icon: "⎙", title: "Exportar como PDF (imprimir)", action: () => {
      document.title = page.title || "NEXUS";
      hideFmtBar(); closeMenus();
      setTimeout(() => window.print(), 60);
    } },
    { sep: true },
    { icon: "🗑", title: "Mover para a lixeira", danger: true, action: async () => {
      const ok = await confirmDialog({ title: "Mover para a lixeira?", message: "Você pode restaurar depois na Lixeira.", confirmText: "Mover", danger: true });
      if (ok) { await deletePage(page.id); toast("Página movida para a lixeira"); navigate("home"); }
    } },
  ], { align: "right" });

  actions.append(focusBtn, historyBtn, moreBtn);
}

function toggleFocusMode(btn) {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle("focus-mode", state.focusMode);
  btn.classList.toggle("active", state.focusMode);
  if (state.focusMode) {
    toast("Modo foco — Esc para sair", { type: "info", icon: "◎" });

    // HUD: contador de palavras + meta diária + tempo
    const goal = getFocusGoal();
    const hud = h("div", { class: "focus-hud" });
    const bar = h("div", { class: "fh-bar" }, h("div", { class: "fh-fill" }));
    const label = h("div", { class: "fh-label" });
    const goalBtn = h("button", { class: "fh-goal", title: "Definir meta de palavras" }, "🎯 meta");
    hud.append(h("div", { class: "fh-count" }, label), bar, goalBtn);
    document.body.appendChild(hud);
    const startWords = pageWordCount(state.page);

    const updateHud = () => {
      const words = pageWordCount(state.page);
      const written = Math.max(0, words - startWords);
      const g = getFocusGoal();
      label.textContent = `${words} palavras · +${written} nesta sessão`;
      const pct = g ? clamp((written / g) * 100, 0, 100) : 0;
      bar.querySelector(".fh-fill").style.width = pct + "%";
      goalBtn.textContent = g ? `🎯 ${written}/${g}` : "🎯 meta";
      if (g && written >= g && !state._goalHit) { state._goalHit = true; toast("Meta de escrita atingida! 🎉", { type: "ok" }); }
    };
    goalBtn.onclick = async () => {
      const v = await promptDialog({ title: "Meta de palavras da sessão", value: String(getFocusGoal() || 300) });
      const n = parseInt(v, 10);
      if (n >= 0) { setFocusGoal(n); state._goalHit = false; updateHud(); }
    };

    const onMove = () => {
      const sel = getSelection();
      const node = sel.anchorNode;
      const blockEl = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".block");
      state.blocksEl.querySelectorAll(".focus-current").forEach((x) => x.classList.remove("focus-current"));
      if (blockEl) {
        blockEl.classList.add("focus-current");
        blockEl.scrollIntoView({ block: "center", behavior: "smooth" }); // scroll estilo máquina de escrever
      }
    };
    const onInput = () => updateHud();
    const onEsc = (e) => { if (e.key === "Escape") toggleFocusMode(btn); };
    document.addEventListener("selectionchange", onMove);
    state.blocksEl.addEventListener("input", onInput, true);
    addEventListener("keydown", onEsc);
    updateHud();
    state.focusCleanup = () => {
      document.removeEventListener("selectionchange", onMove);
      state.blocksEl?.removeEventListener("input", onInput, true);
      removeEventListener("keydown", onEsc);
      hud.remove();
      state._goalHit = false;
    };
  } else {
    state.focusCleanup?.();
    state.blocksEl?.querySelectorAll(".focus-current").forEach((x) => x.classList.remove("focus-current"));
  }
}
function getFocusGoal() { return Number(getSetting("writeGoal", 300)) || 0; }
function setFocusGoal(n) { setSetting("writeGoal", n); }

/* ═══════════ Histórico de versões com diff ═══════════ */
async function showHistory(page) {
  const versions = await listVersions(page.id);
  const body = h("div", {});
  if (!versions.length) {
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "↺"),
      h("div", { class: "es-desc" }, "Snapshots automáticos aparecem aqui conforme você edita.")));
  }
  versions.forEach((v) => {
    const diffBtn = h("button", { class: "btn ghost sm" }, "Ver diff");
    const restoreBtn = h("button", { class: "btn sm" }, "Restaurar");
    const row = h("div", { class: "version-item" },
      h("div", {},
        h("div", { style: "font-weight:550" }, fmtRelative(v.ts)),
        h("div", { style: "font-size:var(--fs-xs);color:var(--text-3)" },
          new Date(v.ts).toLocaleString("pt-BR"))),
      h("div", { style: "display:flex;gap:6px" }, diffBtn, restoreBtn));
    diffBtn.onclick = () => {
      const cur = state.page.blocks.map((b) => stripHtml(b.content)).join("\n");
      const old = v.blocks.map((b) => stripHtml(b.content)).join("\n");
      const diffEl = renderDiff(old, cur);
      showModal({ title: "Diferenças (versão → atual)", body: diffEl, width: 640 });
    };
    restoreBtn.onclick = async () => {
      await restoreVersion(page.id, v.id);
      m.close();
      toast("Versão restaurada");
      navigate("page", page.id);
    };
    body.appendChild(row);
  });
  const m = showModal({ title: "Histórico de versões", body, width: 520 });
}

function renderDiff(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const out = h("div", { style: "font-size:var(--fs-sm);line-height:1.7;font-family:var(--font-mono);white-space:pre-wrap" });
  oldLines.forEach((l) => {
    if (!newSet.has(l) && l.trim()) out.appendChild(h("div", {}, h("span", { class: "diff-del" }, l)));
  });
  newLines.forEach((l) => {
    if (!oldSet.has(l) && l.trim()) out.appendChild(h("div", {}, h("span", { class: "diff-add" }, l)));
  });
  if (!out.children.length) out.appendChild(h("div", { style: "color:var(--text-3)" }, "Sem diferenças de texto."));
  return out;
}
