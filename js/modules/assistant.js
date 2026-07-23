// ═══════════════ NEXUS · Assistente IA (chat, zelador, modelos, popover de seleção) ═══════════════

import {
  MODELS, capabilities, recommendModel, aiState, loadEngine, unloadModel,
  chatStream, abortStream, isReady, systemPrompt, deleteModelCache, cacheUsage,
} from "../ai/engine.js";
import {
  listPages, getPage, updatePage, deletePage, createPage, pageText, knowledgeGraph,
  getSetting, setSetting, touchPageBlocks, pageWordCount,
} from "../core/store.js";
import { markdownToBlocks } from "../core/markdown.js";
import { bus } from "../core/bus.js";
import { navigate } from "../core/router.js";
import { h, escapeHtml, clamp, fmtRelative, stripHtml, debounce } from "../core/utils.js";
import { toast, confirmDialog, promptDialog, showModal } from "../core/ui.js";

/* ═══════════ Estado persistente do módulo (sobrevive à navegação) ═══════════ */
const chat = { messages: [], contextPageId: null };
let activeTab = "chat";

/* ═══════════ Ações de escrita sobre seleção ═══════════ */
const SELECTION_ACTIONS = [
  { icon: "✨", label: "Melhorar escrita", prompt: "Reescreva o texto melhorando clareza, fluidez e correção, mantendo o sentido e o idioma original." },
  { icon: "📝", label: "Resumir", prompt: "Resuma o texto de forma concisa, mantendo os pontos essenciais." },
  { icon: "➕", label: "Expandir", prompt: "Expanda o texto com mais detalhes e exemplos, mantendo o tom." },
  { icon: "✂", label: "Encurtar", prompt: "Reduza o texto ao mínimo necessário sem perder o sentido." },
  { icon: "✔", label: "Corrigir gramática", prompt: "Corrija erros de gramática, ortografia e pontuação. Não mude o estilo." },
  { icon: "💬", label: "Simplificar", prompt: "Reescreva em linguagem simples, como se explicasse para alguém leigo." },
  { icon: "🎩", label: "Tom formal", prompt: "Reescreva o texto em tom formal e profissional." },
  { icon: "😎", label: "Tom casual", prompt: "Reescreva o texto em tom casual e amigável." },
  { icon: "🎯", label: "Tom persuasivo", prompt: "Reescreva o texto em tom persuasivo e convincente." },
  { icon: "🇺🇸", label: "Traduzir → inglês", prompt: "Traduza o texto para o inglês." },
  { icon: "🇪🇸", label: "Traduzir → espanhol", prompt: "Traduza o texto para o espanhol." },
  { icon: "🇧🇷", label: "Traduzir → português", prompt: "Traduza o texto para o português brasileiro." },
  { icon: "•", label: "Transformar em lista", prompt: "Transforme o texto em uma lista de tópicos com hífens (-)." },
  { icon: "T", label: "Gerar título", prompt: "Gere um título curto e forte para este texto. Responda só o título." },
  { icon: "☑", label: "Extrair ações", prompt: "Extraia os itens de ação do texto como uma lista de tarefas com hífens (-)." },
];

/* ═══════════ Listeners globais (registrados no import — idempotente) ═══════════ */
let listenersOn = false;
export function initAiListeners() {
  if (listenersOn) return;
  listenersOn = true;
  bus.on("ai:selection", openSelectionPopover);
  bus.on("ai:page", ({ pageId }) => {
    chat.contextPageId = pageId;
    activeTab = "chat";
    navigate("assistant");
  });
}
initAiListeners();

/* ═══════════ Popover de seleção ═══════════ */
let popoverEl = null;

function closePopover() {
  abortStream();
  popoverEl?.remove();
  popoverEl = null;
  removeEventListener("keydown", popKey, true);
}
function popKey(e) { if (e.key === "Escape") { e.stopPropagation(); closePopover(); } }

function openSelectionPopover({ text, pageId, rect, apply }) {
  closePopover();
  const pop = h("div", { class: "ai-popover" });
  popoverEl = pop;

  const head = h("div", { class: "ai-pop-head" },
    h("span", { class: "ai-glyph" }, "✳"),
    h("span", { class: "ai-pop-title" }, "IA local"),
    h("span", { class: "ai-pop-sel" }, `${text.length} caracteres`),
    h("button", { class: "icon-btn", style: "margin-left:auto", "aria-label": "Fechar", onclick: closePopover }, "✕"));
  pop.appendChild(head);

  const body = h("div", { class: "ai-pop-body" });
  pop.appendChild(body);

  if (!capabilities().webgpu) {
    body.appendChild(h("div", { class: "ai-notice" },
      h("span", {}, "⚡"),
      h("div", {},
        h("b", {}, "WebGPU indisponível neste navegador."),
        h("div", { style: "margin-top:2px" }, "A IA local precisa de Chrome/Edge 113+ ou Safari 18+. Todo o resto do NEXUS funciona normalmente."))));
    mountPopover(pop, rect);
    return;
  }

  if (!isReady()) {
    body.appendChild(h("div", { class: "ai-notice" },
      h("span", {}, "✳"),
      h("div", {},
        h("b", {}, "Nenhum modelo carregado."),
        h("div", { style: "margin-top:6px" },
          h("button", { class: "btn primary sm", onclick: () => { closePopover(); navigate("assistant"); activeTab = "models"; } },
            "Configurar IA local")))));
    mountPopover(pop, rect);
    return;
  }

  // grid de ações
  const grid = h("div", { class: "ai-actions-grid" });
  SELECTION_ACTIONS.forEach((a, i) => {
    grid.appendChild(h("button", {
      class: "ai-action", style: `animation-delay:${Math.min(i * 15, 150)}ms`,
      onclick: () => runAction(a.prompt, a.label),
    }, h("span", { class: "aa-icon" }, a.icon), h("span", {}, a.label)));
  });
  body.appendChild(grid);

  // prompt livre
  const free = h("input", { class: "input", placeholder: "Ou peça qualquer coisa… (Enter)", style: "margin-top:8px" });
  free.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && free.value.trim()) runAction(free.value.trim(), "Prompt livre");
  });
  body.appendChild(free);

  mountPopover(pop, rect);

  async function runAction(instruction, label) {
    body.innerHTML = "";
    const preview = h("div", { class: "ai-preview" });
    const cursor = h("span", { class: "ai-cursor" });
    preview.appendChild(cursor);
    const status = h("div", { class: "ai-pop-status" }, `${label}…`);
    body.append(status, preview);

    const stopBtn = h("button", { class: "btn ghost sm", onclick: () => abortStream() }, "◼ Parar");
    const btnRow = h("div", { class: "ai-pop-btns" }, stopBtn);
    body.appendChild(btnRow);

    let result = "";
    try {
      result = await chatStream({
        messages: [
          { role: "system", content: systemPrompt("Você é um assistente de escrita. Responda APENAS com o texto resultante — sem explicações, sem aspas, sem preâmbulo.") },
          { role: "user", content: `${instruction}\n\nTexto:\n"""\n${text}\n"""` },
        ],
        temperature: 0.6,
        onToken: (_, full) => {
          preview.textContent = full;
          preview.appendChild(cursor);
          preview.scrollTop = preview.scrollHeight;
        },
      });
    } catch (e) {
      status.textContent = "Erro: " + (e?.message || e);
      return;
    }
    cursor.remove();
    status.textContent = label + " ✓";
    btnRow.innerHTML = "";
    btnRow.append(
      h("button", { class: "btn primary sm", onclick: () => { apply(result.trim()); closePopover(); toast("Texto substituído ✳"); } }, "Substituir"),
      h("button", { class: "btn sm", onclick: () => { navigator.clipboard.writeText(result.trim()); toast("Copiado"); } }, "Copiar"),
      h("button", { class: "btn ghost sm", onclick: () => runAction(instruction, label) }, "↻ De novo"),
      h("button", { class: "btn ghost sm", onclick: closePopover }, "Fechar"),
    );
  }
}

function mountPopover(pop, rect) {
  document.getElementById("overlay-root").appendChild(pop);
  const r = pop.getBoundingClientRect();
  const top = rect && rect.bottom + r.height + 16 < innerHeight ? rect.bottom + 8 : Math.max(8, (rect?.top ?? 100) - r.height - 8);
  const left = clamp((rect?.left ?? innerWidth / 2) + ((rect?.width ?? 0) / 2) - r.width / 2, 8, innerWidth - r.width - 8);
  pop.style.top = top + "px";
  pop.style.left = left + "px";
  addEventListener("keydown", popKey, true);
}

/* ═══════════ Módulo de rota ═══════════ */
let ui = null;

export default {
  async mount(container) {
    ui = { container };
    render();
    ui.offStatus = bus.on("ai:status", () => {
      // re-render leve da barra de status nos momentos-chave
      if (activeTab === "models") renderTab();
      updateStatusPill();
    });
  },
  unmount() {
    ui?.offStatus?.();
    ui = null;
  },
};

function render() {
  const { container } = ui;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container ai-page" });

  wrap.appendChild(h("div", { class: "ai-hero" },
    h("div", {},
      h("h1", { class: "home-greeting" }, "✳ Assistente IA"),
      h("p", { class: "home-date" }, "Roda 100% no seu dispositivo · sem API · sem limites de uso")),
    h("span", { class: "ai-status-pill", id: "ai-status-pill" })));

  const zelCount = zeladorFindings().length;
  const tabs = h("div", { class: "ai-tabs" });
  [["chat", "💬 Chat"], ["zelador", `🧹 Zelador${zelCount ? ` (${zelCount})` : ""}`], ["models", "⚙ Modelos"]].forEach(([key, label]) => {
    tabs.appendChild(h("button", {
      class: "ai-tab" + (activeTab === key ? " active" : ""),
      onclick: () => { activeTab = key; render(); },
    }, label));
  });
  wrap.appendChild(tabs);

  const tabBody = h("div", { class: "ai-tab-body", id: "ai-tab-body" });
  wrap.appendChild(tabBody);
  container.appendChild(wrap);

  renderTab();
  updateStatusPill();
}

function updateStatusPill() {
  const pill = document.getElementById("ai-status-pill");
  if (!pill) return;
  const map = {
    unavailable: ["Sem WebGPU", "warn"],
    idle: ["Modelo não carregado", ""],
    downloading: [`Baixando ${Math.round(aiState.progress * 100)}%`, "accent"],
    ready: [`● ${MODELS.find((m) => m.id === aiState.modelId)?.name || "Pronto"}`, "ok"],
    error: ["Erro", "danger"],
  };
  const [label, cls] = map[aiState.status] || ["", ""];
  pill.textContent = label;
  pill.className = "ai-status-pill " + cls;
}

function renderTab() {
  const body = document.getElementById("ai-tab-body");
  if (!body) return;
  body.innerHTML = "";
  if (activeTab === "chat") renderChat(body);
  else if (activeTab === "zelador") renderZelador(body);
  else renderModels(body);
}

/* ═══════════ ABA: Modelos ═══════════ */
function renderModels(body) {
  const cap = capabilities();

  if (!cap.webgpu) {
    body.appendChild(h("div", { class: "ai-unavailable card" },
      h("div", { class: "es-icon", style: "font-size:34px" }, "⚡"),
      h("h3", {}, "WebGPU não está disponível"),
      h("p", {}, "A IA local usa a GPU através do WebGPU. Este navegador não expõe essa API — mas todo o resto do NEXUS continua 100% funcional."),
      h("p", { style: "color:var(--text-3)" }, "Compatível: Chrome 113+, Edge 113+, Safari 18+, Firefox 141+ (Windows). Em alguns casos é preciso ativar a flag de WebGPU.")));
    renderPersona(body);
    return;
  }

  const rec = recommendModel();
  body.appendChild(h("p", { class: "ai-models-hint" },
    cap.memory ? `Hardware detectado: ~${cap.memory} GB de RAM · WebGPU disponível ✓` : "WebGPU disponível ✓",
    cap.windowAi ? " · window.ai (Gemini Nano) detectado" : ""));

  const grid = h("div", { class: "ai-models" });
  MODELS.forEach((m) => {
    const active = aiState.modelId === m.id && aiState.status === "ready";
    const downloading = aiState.modelId === m.id && aiState.status === "downloading";

    const action = h("div", { class: "mc-action" });
    if (active) {
      action.append(
        h("span", { class: "chip c-green" }, "✓ Ativo"),
        h("button", { class: "btn ghost sm", onclick: async () => { await unloadModel(); renderTab(); } }, "Descarregar"));
    } else if (downloading) {
      const bar = h("div", { class: "ai-progress" }, h("div", { class: "ai-progress-fill", style: `width:${Math.round(aiState.progress * 100)}%` }));
      const label = h("div", { class: "ai-progress-label" }, aiState.text || "Baixando…");
      action.append(bar, label);
      const off = bus.on("ai:status", (s) => {
        if (s.modelId !== m.id) return;
        bar.firstChild.style.width = `${Math.round(s.progress * 100)}%`;
        label.textContent = s.status === "ready" ? "Pronto ✓" : (s.text || "").slice(0, 60);
        if (s.status === "ready" || s.status === "error") { off(); renderTab(); }
      });
    } else {
      action.appendChild(h("button", {
        class: "btn sm" + (m.id === rec ? " primary" : ""),
        onclick: async () => {
          renderTab.pending = m.id;
          try { await loadEngine(m.id); toast("Modelo pronto ✳"); }
          catch (e) { toast("Falha ao carregar: " + (e?.message || e), { type: "danger", duration: 5000 }); }
        },
      }, "⬇ Baixar e carregar"));
      action.appendChild(h("button", {
        class: "icon-btn", title: "Excluir do cache", "aria-label": "Excluir do cache",
        onclick: async () => {
          const ok = await confirmDialog({ title: "Excluir do cache?", message: "O modelo precisará ser baixado de novo para ser usado.", confirmText: "Excluir", danger: true });
          if (ok) { await deleteModelCache(m.id); toast("Cache do modelo removido"); }
        },
      }, "🗑"));
    }

    grid.appendChild(h("div", { class: "card model-card" + (active ? " active" : "") },
      h("div", { class: "mc-head" },
        h("span", { class: "mc-name" }, m.name),
        m.id === rec ? h("span", { class: "chip c-accent" }, "Recomendado") : null),
      h("div", { class: "mc-meta" }, `${m.params} parâmetros · ~${m.sizeMB >= 1000 ? (m.sizeMB / 1000).toFixed(1) + " GB" : m.sizeMB + " MB"} · download único`),
      h("div", { class: "mc-desc" }, m.desc),
      action));
  });
  body.appendChild(grid);

  const usage = h("p", { class: "ai-models-hint" }, "");
  cacheUsage().then((u) => {
    usage.textContent = u ? `Armazenamento local em uso (workspace + modelos): ${(u / 1048576).toFixed(0)} MB` : "";
  });
  body.appendChild(usage);

  renderPersona(body);
}

function renderPersona(body) {
  const section = h("div", { class: "card ai-persona" });
  section.appendChild(h("h3", { class: "settings-title" }, "Persona & memória"));

  const presets = [
    ["Editor de texto", "Você é um editor de texto experiente. Seja rigoroso com clareza, concisão e gramática. Responda em português brasileiro."],
    ["Coach de produtividade", "Você é um coach de produtividade pragmático. Ajude a priorizar, quebrar tarefas e manter o foco. Responda em português brasileiro."],
    ["Analista", "Você é um analista criterioso. Estruture o raciocínio, aponte prós/contras e riscos. Responda em português brasileiro."],
  ];
  const presetRow = h("div", { class: "btn-row", style: "margin-bottom:8px" });
  const personaTa = h("textarea", { class: "textarea", rows: 3, placeholder: "System prompt do assistente…" });
  personaTa.value = getSetting("aiPersona", "");
  presets.forEach(([name, text]) => presetRow.appendChild(
    h("button", { class: "btn ghost sm", onclick: () => { personaTa.value = text; setSetting("aiPersona", text); toast("Persona aplicada"); } }, name)));
  personaTa.addEventListener("input", debounce(() => setSetting("aiPersona", personaTa.value), 500));

  const memTa = h("textarea", { class: "textarea", rows: 2, placeholder: "Memória: fatos que a IA deve lembrar (ex.: “trabalho com marketing; escrevo no plural”)…" });
  memTa.value = getSetting("aiMemory", "");
  memTa.addEventListener("input", debounce(() => setSetting("aiMemory", memTa.value), 500));

  section.append(presetRow, personaTa,
    h("div", { style: "height:8px" }), memTa);
  body.appendChild(section);
}

/* ═══════════ ABA: Chat ═══════════ */
function renderChat(body) {
  const thread = h("div", { class: "chat-thread" });
  const paint = () => {
    thread.innerHTML = "";
    if (!chat.messages.length) {
      thread.appendChild(h("div", { class: "empty-state", style: "padding:48px 16px" },
        h("div", { class: "es-icon" }, "✳"),
        h("div", { class: "es-title" }, isReady() ? "Pergunte qualquer coisa" : "Carregue um modelo para conversar"),
        h("div", { class: "es-desc" }, isReady()
          ? "Ative “Contexto do workspace” para perguntar sobre as suas páginas — com fontes citadas."
          : "Vá em ⚙ Modelos, baixe um modelo uma única vez e use offline para sempre."),
        !isReady() ? h("button", { class: "btn primary sm", style: "margin-top:4px", onclick: () => { activeTab = "models"; render(); } }, "Escolher modelo") : null));
      return;
    }
    chat.messages.forEach((m) => thread.appendChild(bubble(m)));
    thread.scrollTop = thread.scrollHeight;
  };

  const bubble = (m) => {
    const b = h("div", { class: "chat-bubble " + m.role },
      h("div", { class: "cb-text" }, m.content));
    if (m.sources?.length) {
      const src = h("div", { class: "cb-sources" }, h("span", {}, "Fontes: "));
      m.sources.forEach((s) => src.appendChild(h("button", {
        class: "cb-source", onclick: () => navigate("page", s.id),
      }, (s.icon || "▢") + " " + s.title)));
      b.appendChild(src);
    }
    if (m.role === "assistant" && m.done) {
      b.appendChild(h("div", { class: "cb-actions" },
        h("button", { class: "btn ghost sm", onclick: () => { navigator.clipboard.writeText(m.content); toast("Copiado"); } }, "Copiar"),
        h("button", { class: "btn ghost sm", onclick: () => {
          const p = createPage({ title: "Resposta da IA", icon: "✳", blocks: markdownToBlocks(m.content) });
          navigate("page", p.id);
        } }, "＋ Virar página")));
    }
    return b;
  };

  // contexto
  const ctxToggle = h("button", { class: "chip" + (getSetting("aiUseContext", true) ? " c-accent" : ""), style: "cursor:pointer" }, "◉ Contexto do workspace");
  ctxToggle.onclick = () => {
    const v = !getSetting("aiUseContext", true);
    setSetting("aiUseContext", v);
    ctxToggle.classList.toggle("c-accent", v);
  };
  const ctxRow = h("div", { class: "chat-ctx" }, ctxToggle);
  if (chat.contextPageId) {
    const p = getPage(chat.contextPageId);
    if (p) ctxRow.appendChild(h("span", { class: "chip" },
      `Contexto: ${p.icon || "▢"} ${p.title || "Sem título"}`,
      h("button", { style: "margin-left:4px;color:var(--text-3)", onclick: () => { chat.contextPageId = null; renderTab(); }, "aria-label": "Remover contexto" }, "✕")));
  }

  const input = h("textarea", { class: "chat-input", rows: 1, placeholder: isReady() ? "Pergunte à IA… (Enter envia, Shift+Enter quebra linha)" : "Carregue um modelo primeiro…" });
  const sendBtn = h("button", { class: "btn primary chat-send", "aria-label": "Enviar" }, "➤");
  const stopBtn = h("button", { class: "btn ghost chat-send", hidden: true, "aria-label": "Parar" }, "◼");

  const send = async () => {
    const q = input.value.trim();
    if (!q || !isReady() || aiState.generating) return;
    input.value = "";
    autoGrow();

    // RAG local simples
    let sources = [];
    let ctxBlock = "";
    if (getSetting("aiUseContext", true)) {
      sources = retrieve(q, chat.contextPageId);
      if (sources.length) {
        ctxBlock = "Contexto do workspace do usuário (use para responder e cite as páginas pelo título quando relevante):\n\n" +
          sources.map((s) => `## ${s.title}\n${s.excerpt}`).join("\n\n");
      }
    }

    chat.messages.push({ role: "user", content: q });
    const reply = { role: "assistant", content: "", done: false, sources };
    chat.messages.push(reply);
    paint();
    const lastBubble = thread.lastElementChild?.querySelector(".cb-text");
    const cursor = h("span", { class: "ai-cursor" });
    lastBubble?.appendChild(cursor);

    sendBtn.hidden = true; stopBtn.hidden = false;
    try {
      const history = chat.messages.slice(0, -1).slice(-8).map(({ role, content }) => ({ role, content }));
      await chatStream({
        messages: [
          { role: "system", content: systemPrompt(ctxBlock) },
          ...history,
        ],
        onToken: (_, full) => {
          reply.content = full;
          if (lastBubble) { lastBubble.textContent = full; lastBubble.appendChild(cursor); }
          thread.scrollTop = thread.scrollHeight;
        },
      });
    } catch (e) {
      reply.content = reply.content || "⚠ " + (e?.message || e);
    }
    reply.done = true;
    cursor.remove();
    sendBtn.hidden = false; stopBtn.hidden = true;
    paint();
  };

  sendBtn.onclick = send;
  stopBtn.onclick = () => abortStream();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  const autoGrow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; };
  input.addEventListener("input", autoGrow);

  body.append(ctxRow, thread, h("div", { class: "chat-input-row" }, input, sendBtn, stopBtn));
  paint();
  setTimeout(() => input.focus(), 60);
}

/* recuperação local: pontua páginas por sobreposição de termos */
function retrieve(query, priorityPageId = null, k = 3) {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const scored = [];
  for (const p of listPages()) {
    const text = pageText(p);
    const lower = text.toLowerCase();
    let score = 0;
    terms.forEach((t) => {
      let i = -1, n = 0;
      while ((i = lower.indexOf(t, i + 1)) >= 0 && n < 20) n++;
      score += n * (p.title.toLowerCase().includes(t) ? 3 : 1);
    });
    if (p.id === priorityPageId) score += 1000;
    if (score > 0) scored.push({ p, score, text });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ p, text }) => ({
      id: p.id, title: p.title || "Sem título", icon: p.icon,
      excerpt: text.slice(0, 700),
    }));
}

/* ═══════════ ABA: Zelador (higiene do workspace) ═══════════ */
function normTitle(t) {
  return (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\W+/g, " ").trim();
}

export function zeladorFindings() {
  const pages = listPages().filter((p) => p.type !== "daily");
  const findings = [];

  // duplicatas / quase idênticas
  const seen = new Map();
  pages.forEach((p) => {
    const key = normTitle(p.title);
    if (!key) return;
    if (seen.has(key)) findings.push({ kind: "dup", a: seen.get(key), b: p });
    else seen.set(key, p);
  });

  // órfãs (sem links de entrada nem saída)
  const { nodes } = knowledgeGraph();
  const linkCount = new Map(nodes.map((n) => [n.id, n.links]));
  pages.forEach((p) => {
    if ((linkCount.get(p.id) || 0) === 0 && pages.length > 3) findings.push({ kind: "orphan", a: p });
  });

  // títulos vagos
  pages.forEach((p) => {
    const t = (p.title || "").trim();
    if (!t || t.length < 4 || /^(nova página|sem título|untitled|teste|nota)$/i.test(t))
      findings.push({ kind: "vague", a: p });
  });

  // desatualizadas
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  pages.forEach((p) => {
    if (p.updatedAt < cutoff && pageWordCount(p) < 50) findings.push({ kind: "stale", a: p });
  });

  return findings;
}

function renderZelador(body) {
  const findings = zeladorFindings();

  body.appendChild(h("p", { class: "ai-models-hint" },
    "O Zelador varre o workspace localmente e sugere limpezas — o antídoto para a desordem que outros workspaces só amplificam."));

  if (!findings.length) {
    body.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "✨"),
      h("div", { class: "es-title" }, "Workspace impecável"),
      h("div", { class: "es-desc" }, "Nenhuma duplicata, página órfã, título vago ou conteúdo abandonado encontrado.")));
    return;
  }

  const meta = {
    dup: ["⧉", "Possível duplicata", "c-amber"],
    orphan: ["◌", "Página órfã (sem links)", "c-blue"],
    vague: ["✎", "Título vago", "c-accent"],
    stale: ["🕸", "Possivelmente abandonada", "c-red"],
  };

  const list = h("div", { class: "zel-list" });
  findings.slice(0, 40).forEach((f, i) => {
    const [icon, label, cls] = meta[f.kind];
    const actions = h("div", { class: "zel-actions" });

    const openBtn = (p) => h("button", { class: "btn ghost sm", onclick: () => navigate("page", p.id) }, "Abrir");
    const renameBtn = (p) => h("button", {
      class: "btn ghost sm", onclick: async () => {
        const name = await promptDialog({ title: "Renomear página", value: p.title || "" });
        if (name != null) { updatePage(p.id, { title: name }); toast("Renomeada"); renderTab(); }
      },
    }, "Renomear");
    const archiveBtn = (p) => h("button", {
      class: "btn ghost sm", onclick: () => { updatePage(p.id, { archived: true }); toast("Arquivada — veja na Lixeira"); renderTab(); },
    }, "Arquivar");

    if (f.kind === "dup") {
      actions.append(openBtn(f.a), openBtn(f.b), h("button", {
        class: "btn sm", onclick: async () => {
          const ok = await confirmDialog({
            title: "Mesclar páginas?",
            message: `Os blocos de “${f.b.title}” serão anexados a “${f.a.title}” e a segunda irá para a lixeira.`,
            confirmText: "Mesclar",
          });
          if (!ok) return;
          f.a.blocks.push(...structuredClone(f.b.blocks));
          touchPageBlocks(f.a.id);
          await deletePage(f.b.id);
          toast("Páginas mescladas ✓");
          renderTab();
        },
      }, "Mesclar"));
    } else if (f.kind === "vague") {
      actions.append(openBtn(f.a), renameBtn(f.a));
    } else if (f.kind === "orphan") {
      actions.append(openBtn(f.a), archiveBtn(f.a));
    } else {
      actions.append(openBtn(f.a), archiveBtn(f.a));
    }

    list.appendChild(h("div", { class: "card zel-item", style: `animation-delay:${Math.min(i * 25, 250)}ms` },
      h("span", { class: "zel-icon" }, icon),
      h("div", { class: "zel-body" },
        h("div", { class: "zel-title" },
          h("span", { class: `chip ${cls}`, style: "margin-right:8px" }, label),
          (f.a.icon ? f.a.icon + " " : "") + (f.a.title || "Sem título") + (f.b ? `  ·  ${f.b.title || "Sem título"}` : "")),
        h("div", { class: "zel-meta" }, "editada " + fmtRelative(f.a.updatedAt))),
      actions));
  });
  body.appendChild(list);
}
