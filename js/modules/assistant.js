// ═══════════════ NEXUS · Assistente (via gateway OmniRoute) ═══════════════
// Conversa com o gateway que roda na SUA máquina. Enquanto o assistente
// estiver desligado nas Configurações, esta tela só explica como ligar —
// nenhuma requisição sai daqui sozinha.

import { listPages, getPage, createPage, getSetting, setSetting } from "../core/store.js";
import { pageToMarkdown, markdownToBlocks } from "../core/markdown.js";
import { navigate } from "../core/router.js";
import { bus } from "../core/bus.js";
import { h, escapeHtml, stripHtml } from "../core/utils.js";
import { toast, showMenu, confirmDialog, focusSoon } from "../core/ui.js";
import * as ai from "../core/ai.js";

const MAX_KEPT = 40;
const history = () => (getSetting("aiChat", []) || []).slice(-MAX_KEPT);
const saveHistory = (msgs) => setSetting("aiChat", msgs.slice(-MAX_KEPT));

const QUICK = [
  ["📝", "Resumir uma página", "resumir"],
  ["✓", "Transformar uma página em tarefas", "tarefas"],
  ["💡", "Pensar comigo sobre um tema", "brainstorm"],
  ["🔤", "Melhorar um texto meu", "revisar"],
];

let state = null;

export default {
  async mount(container, params) {
    state = {
      container,
      msgs: history(),
      busy: false,
      abort: null,
      attachId: params?.id && getPage(params.id) ? params.id : null,
      offs: [],
    };
    state.offs.push(bus.on("ai:status", () => { if (state) render(); }));
    render();
    if (state.attachId) focusComposer();
  },
  unmount() {
    try { state?.abort?.abort(); } catch {}
    state?.offs.forEach((off) => { try { off?.(); } catch {} });
    state = null;
  },
};

/* ═══════════ render ═══════════ */
function render() {
  const { container } = state;
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container ai-page" });

  const cfg = ai.aiConfig();
  wrap.appendChild(h("div", { class: "ai-head" },
    h("div", {},
      h("h1", { class: "home-greeting" }, "Assistente"),
      h("p", { class: "ai-sub" }, ai.aiReady()
        ? `Conectado ao seu gateway · modelo ${cfg.model || "auto"}`
        : "Desligado — o NEXUS segue 100% local até você ligar")),
    h("div", { class: "ai-head-actions" },
      state.msgs.length ? h("button", { class: "btn ghost sm", onclick: () => saveAsPage() }, "📄 Salvar conversa") : null,
      state.msgs.length ? h("button", { class: "btn ghost sm", onclick: () => clearChat() }, "Limpar") : null,
      h("button", { class: "btn ghost sm", onclick: () => navigate("settings") }, "⚙ Configurar"))));

  if (!ai.aiReady()) {
    wrap.appendChild(setupCard());
    container.appendChild(wrap);
    return;
  }

  const thread = h("div", { class: "ai-thread", id: "ai-thread" });
  if (!state.msgs.length) thread.appendChild(emptyThread());
  state.msgs.forEach((m) => thread.appendChild(bubble(m)));
  wrap.appendChild(thread);
  wrap.appendChild(composer());
  container.appendChild(wrap);
  scrollDown();
}

function setupCard() {
  const box = h("section", { class: "card ai-setup" });
  box.appendChild(h("h2", {}, "✳ Ligue o assistente com o seu próprio gateway"));
  box.appendChild(h("p", { class: "ai-setup-lead" },
    "O NEXUS não embute nenhuma API de IA. Em vez disso, ele fala com um gateway que roda na sua máquina — o ",
    h("strong", {}, "OmniRoute"),
    " — e é você quem decide qual provedor ele usa por trás."));

  const steps = [
    ["1", "Instale e rode o gateway", "npm install -g omniroute\nomniroute"],
    ["2", "Conecte um provedor no painel", "Abra http://localhost:20128 e conecte uma conta (há camadas gratuitas) ou aponte para um modelo local (Ollama, LM Studio)."],
    ["3", "Cole a chave no NEXUS", "Configurações → Assistente de IA: URL http://localhost:20128/v1 e a chave gerada no painel."],
  ];
  const list = h("ol", { class: "ai-steps" });
  steps.forEach(([n, title, body]) => {
    list.appendChild(h("li", {},
      h("div", { class: "ais-title" }, title),
      body.includes("\n") || body.startsWith("npm")
        ? h("pre", { class: "ai-code" }, h("code", {}, body))
        : h("div", { class: "ais-body" }, body)));
  });
  box.appendChild(list);

  box.appendChild(h("p", { class: "settings-hint" },
    "Privacidade: com o assistente ligado, o texto que você enviar sai do aparelho rumo ao seu gateway e, de lá, ao provedor que você configurou. Apontando o OmniRoute para um modelo local, nada sai do computador. Desligado, o NEXUS continua sem fazer nenhuma chamada."));
  box.appendChild(h("div", { class: "ai-setup-actions" },
    h("button", { class: "btn primary", onclick: () => navigate("settings") }, "Abrir Configurações"),
    h("a", { class: "btn ghost", href: "https://github.com/diegosouzapw/OmniRoute", target: "_blank", rel: "noopener noreferrer" }, "Ver o OmniRoute ↗")));
  return box;
}

function emptyThread() {
  const box = h("div", { class: "ai-empty" });
  box.appendChild(h("div", { class: "ai-empty-title" }, "Como posso ajudar?"));
  const grid = h("div", { class: "ai-quick" });
  QUICK.forEach(([icon, label, kind]) => grid.appendChild(h("button", {
    class: "ai-quick-btn", onclick: () => quickAction(kind),
  }, h("span", { class: "aq-icon" }, icon), h("span", {}, label))));
  box.appendChild(grid);
  return box;
}

function bubble(m, streaming = false) {
  const el = h("div", { class: "ai-msg ai-" + m.role + (streaming ? " streaming" : "") });
  el.appendChild(h("div", { class: "ai-role" }, m.role === "user" ? "Você" : "✳ Assistente"));
  const body = h("div", { class: "ai-body", html: m.role === "user" ? escapeHtml(m.content).replace(/\n/g, "<br>") : renderMd(m.content) });
  el.appendChild(body);
  if (m.attached) el.appendChild(h("div", { class: "ai-attached" }, "📎 " + m.attached));
  if (m.role === "assistant" && !streaming && m.content) {
    el.appendChild(h("div", { class: "ai-msg-actions" },
      h("button", { class: "btn ghost sm", onclick: () => { navigator.clipboard?.writeText(m.content); toast("Copiado ✓"); } }, "⧉ Copiar"),
      h("button", { class: "btn ghost sm", onclick: () => insertAsPage(m.content) }, "📄 Virar página")));
  }
  return el;
}

function composer() {
  const ta = h("textarea", {
    class: "ai-input", id: "ai-input", rows: "1",
    placeholder: state.busy ? "Gerando resposta…" : "Pergunte alguma coisa…",
    title: "Enter envia · Shift+Enter quebra linha",
    ...(state.busy ? { disabled: true } : {}),
  });
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(ta.value); }
  });

  const attached = state.attachId ? getPage(state.attachId) : null;
  const chip = h("button", {
    class: "ai-attach" + (attached ? " on" : ""),
    title: "Anexar o conteúdo de uma página ao contexto",
    onclick: (e) => attachMenu(e.currentTarget),
  }, attached ? `📎 ${attached.title || "Sem título"}` : "📎 Anexar página");

  const sendBtn = state.busy
    ? h("button", { class: "btn danger ai-send", onclick: () => { try { state.abort?.abort(); } catch {} } }, "■ Parar")
    : h("button", { class: "btn primary ai-send", onclick: () => send(ta.value) }, "Enviar");

  return h("div", { class: "ai-composer" },
    h("div", { class: "ai-composer-top" }, chip,
      h("span", { class: "ai-model-chip", title: "Modelo pedido ao gateway" }, ai.aiConfig().model || "auto")),
    h("div", { class: "ai-composer-row" }, ta, sendBtn));
}

/* ═══════════ ações ═══════════ */
function attachMenu(anchor) {
  const pages = listPages().filter((p) => !p.private).slice(0, 14);
  showMenu(anchor, [
    { label: "Contexto enviado junto com a pergunta" },
    ...(state.attachId ? [{ icon: "✕", title: "Não anexar nada", action: () => { state.attachId = null; render(); } }] : []),
    ...pages.map((p) => ({
      icon: p.icon || "▢",
      title: p.title || "Sem título",
      action: () => { state.attachId = p.id; render(); focusComposer(); },
    })),
    ...(pages.length ? [] : [{ icon: "▢", title: "Nenhuma página ainda" }]),
  ]);
}

function quickAction(kind) {
  const prompts = {
    resumir: "Resuma a página anexada em até 8 tópicos, destacando decisões e pendências.",
    tarefas: "Leia a página anexada e devolva uma lista de tarefas acionáveis em Markdown (`- [ ] tarefa`), uma por linha, sem explicação extra.",
    brainstorm: "Quero pensar sobre ",
    revisar: "Revise o texto abaixo mantendo o sentido e o tom, corrigindo clareza e gramática:\n\n",
  };
  const ta = document.getElementById("ai-input");
  if (!ta) return;
  ta.value = prompts[kind] || "";
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  if ((kind === "resumir" || kind === "tarefas") && !state.attachId) {
    toast("Anexe uma página em 📎 para eu ler o conteúdo", { type: "warn" });
  }
}

async function send(text) {
  const content = String(text || "").trim();
  if (!content || state.busy) return;

  const attached = state.attachId ? getPage(state.attachId) : null;
  const userMsg = { role: "user", content, attached: attached ? (attached.title || "Sem título") : null };
  state.msgs = [...state.msgs, userMsg];
  saveHistory(state.msgs);
  state.busy = true;
  render();

  const thread = document.getElementById("ai-thread");
  const streamMsg = { role: "assistant", content: "" };
  const streamEl = bubble(streamMsg, true);
  thread?.appendChild(streamEl);
  const bodyEl = streamEl.querySelector(".ai-body");
  bodyEl.innerHTML = '<span class="ai-cursor"></span>';
  scrollDown();

  // o conteúdo da página vai como mensagem de sistema, não misturado à pergunta
  const payload = state.msgs.map(({ role, content }) => ({ role, content }));
  let system = ai.SYSTEM_PT;
  if (attached) {
    system += `\n\nA pessoa anexou a página "${attached.title || "Sem título"}". Use-a como contexto:\n\n` +
      ai.clipContext(pageToMarkdown(attached));
  }

  state.abort = new AbortController();
  try {
    const out = await ai.chat(payload, {
      system,
      signal: state.abort.signal,
      onToken: (t) => {
        streamMsg.content += t;
        bodyEl.innerHTML = renderMd(streamMsg.content) + '<span class="ai-cursor"></span>';
        scrollDown();
      },
    });
    streamMsg.content = out || streamMsg.content;
    if (streamMsg.content.trim()) state.msgs = [...state.msgs, { role: "assistant", content: streamMsg.content }];
    else toast("O gateway respondeu vazio — tente outro modelo", { type: "warn" });
  } catch (e) {
    if (e?.name === "AbortError") {
      if (streamMsg.content.trim()) state.msgs = [...state.msgs, { role: "assistant", content: streamMsg.content }];
      toast("Geração interrompida", { type: "warn" });
    } else {
      state.msgs = [...state.msgs, { role: "assistant", content: "⚠ " + String(e.message || e) }];
    }
  } finally {
    state.abort = null;
    state.busy = false;
    saveHistory(state.msgs);
    if (state) render();
    focusComposer();
  }
}

async function clearChat() {
  if (!(await confirmDialog({ title: "Limpar a conversa?", message: "As mensagens somem deste aparelho. Isso não apaga nada no gateway.", confirmText: "Limpar", danger: true }))) return;
  state.msgs = [];
  saveHistory([]);
  render();
}

function saveAsPage() {
  const md = state.msgs.map((m) => (m.role === "user" ? `**Você:** ${m.content}` : m.content)).join("\n\n---\n\n");
  const p = createPage({ title: "Conversa com o assistente", icon: "✳", blocks: markdownToBlocks(md) });
  toast("Conversa salva como página 📄");
  navigate("page", p.id);
}

function insertAsPage(content) {
  const firstLine = stripHtml(content).split("\n").find((l) => l.trim()) || "Resposta do assistente";
  const p = createPage({ title: firstLine.replace(/^#+\s*/, "").slice(0, 80), icon: "✳", blocks: markdownToBlocks(content) });
  toast("Página criada 📄");
  navigate("page", p.id);
}

const focusComposer = () => focusSoon(document.getElementById("ai-input"));
function scrollDown() {
  const t = document.getElementById("ai-thread");
  if (t) t.scrollTop = t.scrollHeight;
}

/* ═══════════ Markdown mínimo e seguro ═══════════
   Escapa tudo primeiro e só então aplica as marcações — nada que venha do
   modelo vira HTML executável. */
export function renderMd(md = "") {
  const parts = String(md).split("```");
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      html += `<pre class="ai-code"><code>${escapeHtml(code.replace(/\n+$/, ""))}</code></pre>`;
    } else {
      html += mdBlocks(part);
    }
  });
  return html;
}

function mdBlocks(text) {
  const lines = escapeHtml(text).split("\n");
  let out = "", list = null;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      closeList();
      out += `<h${Math.min(m[1].length + 2, 5)}>${mdInline(m[2])}</h${Math.min(m[1].length + 2, 5)}>`;
    } else if ((m = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      if (list !== "ul") { closeList(); out += '<ul class="ai-todo">'; list = "ul"; }
      out += `<li>${m[1].trim() ? "☑" : "☐"} ${mdInline(m[2])}</li>`;
    } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      if (list !== "ul") { closeList(); out += "<ul>"; list = "ul"; }
      out += `<li>${mdInline(m[1])}</li>`;
    } else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) {
      if (list !== "ol") { closeList(); out += "<ol>"; list = "ol"; }
      out += `<li>${mdInline(m[1])}</li>`;
    } else if ((m = /^&gt;\s?(.*)$/.exec(line))) {
      closeList();
      out += `<blockquote>${mdInline(m[1])}</blockquote>`;
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList();
      out += "<hr>";
    } else {
      closeList();
      out += `<p>${mdInline(line)}</p>`;
    }
  }
  closeList();
  return out;
}

const mdInline = (s) => s
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
