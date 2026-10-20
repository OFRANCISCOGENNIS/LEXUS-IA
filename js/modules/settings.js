// ═══════════════ NEXUS · Configurações ═══════════════

import {
  getSetting, setSetting, workspaceStats, exportWorkspace, importWorkspace, listPages,
} from "../core/store.js";
import { estimateStorage } from "../core/db.js";
import { h, download, todayKey, fmtRelative } from "../core/utils.js";
import { toast, confirmDialog, promptDialog, showMenu, showModal } from "../core/ui.js";
import { navigate } from "../core/router.js";
import { setTheme } from "../shell.js";
import { pageToMarkdown } from "../core/markdown.js";
import * as sync from "../core/sync.js";
import * as ai from "../core/ai.js";
import { bus } from "../core/bus.js";

const ACCENTS = [
  ["violet", "hsl(243 66% 65%)"], ["slate", "hsl(215 28% 46%)"], ["navy", "hsl(222 45% 38%)"],
  ["iris", "hsl(248 72% 62%)"], ["blue", "hsl(214 84% 56%)"], ["teal", "hsl(176 62% 44%)"],
  ["green", "hsl(148 55% 44%)"], ["amber", "hsl(36 90% 50%)"], ["rose", "hsl(346 72% 56%)"],
];

export default {
  async mount(container) {
    const wrap = h("div", { class: "page-container settings" });
    wrap.appendChild(h("h1", { class: "home-greeting" }, "Configurações"));

    /* ── Conta & Sincronização ── */
    wrap.appendChild(renderSyncSection());

    /* ── Aparência ── */
    const ap = section("Aparência");

    ap.appendChild(rowEl("Tema", segmented(
      [["light", "Claro"], ["dark", "Escuro"], ["auto", "Auto"]],
      getSetting("theme", "auto"), (v) => setTheme(v))));

    const swatches = h("div", { class: "accent-row" });
    ACCENTS.forEach(([name, color]) => {
      const b = h("button", {
        class: "accent-swatch" + (getSetting("accent", "iris") === name ? " on" : ""),
        style: `background:${color}`, title: name, "aria-label": "Acento " + name,
        onclick: () => {
          setSetting("accent", name);
          swatches.querySelectorAll(".accent-swatch").forEach((x) => x.classList.remove("on"));
          b.classList.add("on");
        },
      });
      swatches.appendChild(b);
    });
    ap.appendChild(rowEl("Cor de acento", swatches));

    ap.appendChild(rowEl("Densidade", segmented(
      [["compact", "Compacta"], ["comfortable", "Confortável"], ["spacious", "Espaçosa"]],
      getSetting("density", "comfortable"), (v) => setSetting("density", v))));

    ap.appendChild(rowEl("Fonte", segmented(
      [["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]],
      getSetting("font", "sans"), (v) => setSetting("font", v))));

    ap.appendChild(rowEl("Largura da página", segmented(
      [["normal", "Normal"], ["wide", "Larga"], ["full", "Cheia"]],
      getSetting("pagewidth", "normal"), (v) => setSetting("pagewidth", v))));

    wrap.appendChild(ap);

    /* ── Assistente de IA (gateway local) ── */
    wrap.appendChild(renderAiSection());

    /* ── Dados ── */
    const data = section("Dados & backup");

    const exportBtn = h("button", { class: "btn" }, "⬇ Exportar backup (JSON)");
    exportBtn.onclick = async () => {
      const bk = await exportWorkspace();
      download(`nexus-backup-${todayKey()}.json`, JSON.stringify(bk, null, 2), "application/json");
      toast("Backup exportado");
    };

    const mdBtn = h("button", { class: "btn" }, "⬇ Exportar tudo em Markdown");
    mdBtn.onclick = () => {
      const pages = listPages({ includeArchived: true });
      const md = pages.map((p) => pageToMarkdown(p)).join("\n\n---\n\n");
      download(`nexus-paginas-${todayKey()}.md`, md, "text/markdown");
      toast("Markdown exportado");
    };

    const fileInput = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
    const importBtn = h("button", { class: "btn", onclick: () => fileInput.click() }, "⬆ Importar backup");
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        await importWorkspace(data, { merge: true });
        toast("Backup importado (mesclado) ✓");
      } catch (e) {
        toast("Arquivo inválido: " + e.message, { type: "danger" });
      }
    });

    data.appendChild(rowEl("Backup completo", h("div", { class: "btn-row" }, exportBtn, importBtn, fileInput)));

    /* ── Importar do Notion ── */
    const notionInput = h("input", { type: "file", accept: ".zip,.md,.csv", multiple: true, style: "display:none" });
    notionInput.addEventListener("change", async () => {
      const picked = [...notionInput.files];
      notionInput.value = "";
      if (picked.length) await notionFlow(picked);
    });
    data.appendChild(rowEl("Vindo do Notion",
      h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: () => notionInput.click() }, "⬆ Importar export do Notion"),
        notionInput)));
    data.appendChild(h("p", { class: "settings-hint", style: "margin:-6px 0 12px" },
      "No Notion: ⋯ → Export → formato ", h("strong", {}, "Markdown & CSV"),
      ", marque “Include subpages”. Depois solte o .zip aqui — páginas, sub-páginas e databases entram no seu workspace. O arquivo é lido neste aparelho, não sai daqui."));
    data.appendChild(rowEl("Portabilidade", h("div", { class: "btn-row" }, mdBtn)));

    const storageEl = h("span", { class: "settings-hint" }, "calculando…");
    estimateStorage().then((est) => {
      storageEl.textContent = est
        ? `${(est.usage / 1048576).toFixed(1)} MB usados de ~${(est.quota / 1073741824).toFixed(1)} GB disponíveis`
        : "indisponível neste navegador";
    });
    data.appendChild(rowEl("Armazenamento local", storageEl));
    wrap.appendChild(data);

    /* ── Estatísticas ── */
    const s = workspaceStats();
    const stats = section("Estatísticas do workspace");
    const kpis = h("div", { class: "home-stats", style: "margin:4px 0 8px" });
    [[s.pages, "páginas"], [s.words.toLocaleString("pt-BR"), "palavras"], [s.databases, "databases"], [s.rows, "linhas"]]
      .forEach(([n, l]) => kpis.appendChild(h("div", { class: "home-kpi" },
        h("div", { class: "hk-num" }, String(n)), h("div", { class: "hk-label" }, l))));
    stats.appendChild(kpis);
    wrap.appendChild(stats);

    /* ── Privacidade ── */
    const priv = section("Privacidade");
    priv.appendChild(h("div", { class: "local-badge", style: "margin:0" },
      h("span", { class: "badge-dot" }),
      "100% local por padrão · suas páginas e databases vivem só neste dispositivo, em IndexedDB. Nada sai daqui sem você ligar — e são só dois caminhos, ambos opcionais: a sincronização (cifrada no aparelho antes de subir) e o assistente de IA (fala com um gateway que roda na sua máquina)."));
    wrap.appendChild(priv);

    /* ── Zona de perigo ── */
    const danger = section("Zona de perigo");
    const clearBtn = h("button", { class: "btn danger" }, "Apagar todo o workspace");
    clearBtn.onclick = async () => {
      const ok = await confirmDialog({
        title: "Apagar TUDO?",
        message: "Todas as páginas, databases e configurações serão removidas deste dispositivo. Exporte um backup antes.",
        confirmText: "Continuar", danger: true,
      });
      if (!ok) return;
      const word = await promptDialog({ title: "Confirmação final", label: "Digite “apagar” para confirmar:", placeholder: "apagar" });
      if (word?.trim().toLowerCase() !== "apagar") { toast("Cancelado", { type: "warn" }); return; }
      await importWorkspace({ app: "nexus", pages: [], databases: [] }, { merge: false });
      toast("Workspace apagado");
      setTimeout(() => location.reload(), 600);
    };
    danger.appendChild(rowEl("Começar do zero", clearBtn));
    wrap.appendChild(danger);

    container.appendChild(wrap);
  },
  unmount() {},
};

function section(title) {
  return h("section", { class: "settings-section card" },
    h("h2", { class: "settings-title" }, title));
}

/* ═══════════ Conta & Sincronização (Supabase + E2E) ═══════════ */
function renderSyncSection() {
  const sec = section("Conta & Sincronização");
  const body = h("div", {});
  sec.appendChild(body);
  const paint = () => { body.innerHTML = ""; body.appendChild(buildSyncBody()); };
  const off = bus.on("sync:status", () => paint());
  paint();
  // limpa o listener quando a seção sai de cena (best-effort)
  setTimeout(() => { if (!document.body.contains(sec)) off(); }, 0);
  return sec;
}

function buildSyncBody() {
  const st = sync.syncState();
  const box = h("div", {});

  const statusText = {
    off: st.configured ? "Projeto pronto — falta entrar na conta" : "Somente neste aparelho",
    ready: "No ar e sincronizado ✓", syncing: "Sincronizando…",
    error: "Erro na última sincronização", locked: "Bloqueado — informe a senha",
  }[st.status] || st.status;

  box.appendChild(h("div", { class: "sync-status sync-" + st.status },
    h("span", { class: "sync-dot" }),
    h("span", {}, statusText),
    st.user ? h("span", { class: "sync-email" }, st.user.email) : null));

  box.appendChild(h("p", { class: "settings-hint", style: "margin:6px 0 14px" },
    st.lastSyncAt
      ? `Última sincronização ${fmtRelative(st.lastSyncAt)} · este aparelho: ${st.device}`
      : "Use o NEXUS de qualquer aparelho: os dados são cifrados aqui (AES-256) antes de subir para um projeto seu — o servidor guarda só texto embaralhado."));

  const abrir = h("button", { class: "btn primary", onclick: () => navigate("cloud") },
    st.configured ? "☁ Abrir a Nuvem" : "☁ Ligar a nuvem");
  const agora = st.status === "ready"
    ? h("button", { class: "btn", onclick: async () => {
        try { await sync.pullNow(); await sync.pushNow({ force: true }); toast("Sincronizado ✓"); }
        catch (e) { toast(String(e.message || e), { type: "danger" }); }
      } }, "⟳ Sincronizar agora")
    : null;
  box.appendChild(h("div", { class: "btn-row" }, abrir, agora));
  return box;
}

/* ═══════════ Importar do Notion ═══════════ */
async function notionFlow(picked) {
  const prog = h("div", { class: "cloud-msg" }, "Lendo o arquivo…");
  const modal = showModal({ title: "Importar do Notion", body: prog, width: 560 });
  try {
    const [{ unzip }, notion] = await Promise.all([import("../core/zip.js"), import("../core/notion.js")]);

    let files = [];
    for (const f of picked) {
      if (/\.zip$/i.test(f.name)) {
        prog.textContent = `Abrindo ${f.name}…`;
        files.push(...await unzip(await f.arrayBuffer()));
      } else {
        files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
    }
    if (!files.length) throw new Error("Não encontrei arquivos dentro do que você escolheu.");

    const info = notion.analyzeNotion(files);
    if (!info.counts.pages && !info.counts.databases && !info.counts.rowPages) {
      throw new Error("Não achei páginas (.md) nem databases (.csv) aí dentro. No Notion, exporte em “Markdown & CSV”.");
    }

    modal.close();
    await confirmImport(info, notion, files);
  } catch (e) {
    prog.className = "cloud-msg err";
    prog.textContent = String(e.message || e);
  }
}

function confirmImport(info, notion, files) {
  return new Promise((resolve) => {
    const c = info.counts;
    const withRows = h("input", { type: "checkbox" });
    const body = h("div", {},
      h("p", { class: "cloud-lead" }, "Encontrei no export:"),
      h("ul", { class: "cloud-list yes" },
        h("li", {}, `${c.pages} página(s)`),
        h("li", {}, `${c.databases} database(s)`),
        c.images ? h("li", {}, `${c.images} imagem(ns) — as até 2 MB entram embutidas nas páginas`) : null),
      c.rowPages
        ? h("label", { class: "tb-check", style: "margin-top:10px" }, withRows,
            h("span", {}, `Importar também as ${c.rowPages} páginas de linhas das databases (o conteúdo de cada item; os dados já vêm na database)`))
        : null,
      h("p", { class: "settings-hint", style: "margin-top:12px" },
        "Nada é apagado: o que já existe no NEXUS continua como está. Links entre páginas viram wiki-links [[assim]]."));

    const ok = h("button", { class: "btn primary" }, "Importar");
    const cancel = h("button", { class: "btn ghost" }, "Cancelar");
    const m = showModal({ title: "Importar do Notion", body, footer: [cancel, ok], width: 560, onClose: resolve });
    cancel.onclick = () => m.close();
    ok.onclick = async () => {
      ok.disabled = cancel.disabled = true;
      const line = h("div", { class: "cloud-msg" }, "Importando…");
      body.appendChild(line);
      try {
        const { stats } = await notion.importNotion(files, {
          withRowPages: withRows.checked,
          onProgress: (s) => { line.textContent = `Importando… ${s.pages} página(s), ${s.databases} database(s)`; },
        });
        m.close();
        toast(`Importado: ${stats.pages} página(s), ${stats.databases} database(s), ${stats.rows} linha(s) ✓`, { duration: 5000 });
        navigate("home");
      } catch (e) {
        ok.disabled = cancel.disabled = false;
        line.className = "cloud-msg err";
        line.textContent = String(e.message || e);
      }
    };
  });
}

/* ═══════════ Assistente de IA (gateway OmniRoute local) ═══════════ */
function renderAiSection() {
  const sec = section("Assistente de IA (opcional)");
  sec.dataset.section = "ai";
  const body = h("div", {});
  sec.appendChild(body);
  const paint = () => { body.innerHTML = ""; body.appendChild(buildAiBody(paint)); };
  paint();
  return sec;
}

function buildAiBody(repaint) {
  const c = ai.aiConfig();
  const box = h("div", {});

  const sw = h("button", {
    class: "switch" + (c.enabled ? " on" : ""),
    role: "switch", "aria-checked": String(c.enabled),
    "aria-label": c.enabled ? "Desligar o assistente" : "Ligar o assistente",
  });
  sw.onclick = () => { ai.setAiConfig({ enabled: !c.enabled }); repaint(); };
  box.appendChild(rowEl("Ligar o assistente", sw));
  box.appendChild(h("p", { class: "settings-hint", style: "margin:-2px 0 14px" },
    c.enabled
      ? "Ligado: o texto que você enviar ao assistente sai deste aparelho rumo ao seu gateway e, de lá, ao provedor configurado lá dentro. Com um modelo local (Ollama, LM Studio) no OmniRoute, nada sai do computador."
      : "Desligado, o NEXUS não faz nenhuma chamada de IA. Ligue só quando quiser — e aponte para um gateway que VOCÊ roda."));

  const url = h("input", { class: "input", value: c.baseUrl, placeholder: "http://localhost:20128/v1", spellcheck: "false" });
  url.addEventListener("change", () => ai.setAiConfig({ baseUrl: url.value.trim() }));
  box.appendChild(rowEl("URL do gateway", url));

  const key = h("input", { class: "input", type: "password", value: c.apiKey, placeholder: "chave gerada no painel do OmniRoute", spellcheck: "false" });
  key.addEventListener("change", () => ai.setAiConfig({ apiKey: key.value.trim() }));
  box.appendChild(rowEl("Chave do gateway", key));

  const model = h("input", { class: "input", value: c.model, placeholder: "auto", spellcheck: "false" });
  model.addEventListener("change", () => ai.setAiConfig({ model: model.value.trim() || "auto" }));
  const pick = h("button", { class: "btn ghost sm", title: "Listar os modelos que o gateway oferece" }, "⌄ Modelos");
  pick.onclick = async (e) => {
    const anchor = e.currentTarget;           // guardado: some depois do await
    pick.disabled = true; pick.textContent = "Carregando…";
    const r = await ai.ping();
    pick.disabled = false; pick.textContent = "⌄ Modelos";
    if (!r.ok) { toast(r.error, { type: "danger", duration: 6000 }); return; }
    const items = ["auto", ...r.models].slice(0, 60).map((id) => ({
      icon: "✳", title: id,
      action: () => { model.value = id; ai.setAiConfig({ model: id }); toast(`Modelo: ${id}`); },
    }));
    showMenu(anchor, items.length ? items : [{ icon: "⚠", title: "O gateway não listou modelos" }], { align: "right" });
  };
  box.appendChild(rowEl("Modelo", h("div", { class: "btn-row" }, model, pick)));

  const status = h("span", { class: "settings-hint" }, "");
  const test = h("button", { class: "btn" }, "Testar conexão");
  test.onclick = async () => {
    test.disabled = true;
    status.className = "settings-hint";
    status.textContent = "Chamando o gateway…";
    const r = await ai.ping();
    test.disabled = false;
    if (r.ok) {
      status.className = "settings-hint ai-ok";
      status.textContent = `✓ Conectado — ${r.models.length} modelo(s) disponíveis.`;
    } else {
      status.className = "settings-hint ai-err";
      status.textContent = "⚠ " + r.error;
    }
  };
  box.appendChild(rowEl("Conexão", h("div", { class: "btn-row" }, test,
    h("button", { class: "btn ghost", onclick: () => navigate("assistant") }, "Abrir assistente"))));
  box.appendChild(h("div", { style: "margin-top:4px" }, status));

  box.appendChild(h("p", { class: "settings-hint", style: "margin-top:12px" },
    "O gateway é o ", h("a", { href: "https://github.com/diegosouzapw/OmniRoute", target: "_blank", rel: "noopener noreferrer" }, "OmniRoute"),
    " (MIT): rode `npm install -g omniroute && omniroute`, conecte um provedor no painel em localhost:20128 e cole aqui a chave. Ele fala o protocolo da OpenAI, então qualquer gateway compatível também serve."));

  return box;
}

function rowEl(label, control) {
  return h("div", { class: "settings-row" },
    h("span", { class: "settings-label" }, label),
    control);
}

function segmented(options, current, onPick) {
  const seg = h("div", { class: "segmented" });
  options.forEach(([value, label]) => {
    const b = h("button", {
      class: "seg-btn" + (value === current ? " on" : ""),
      onclick: () => {
        seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        onPick(value);
      },
    }, label);
    seg.appendChild(b);
  });
  return seg;
}
