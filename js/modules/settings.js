// ═══════════════ NEXUS · Configurações ═══════════════

import {
  getSetting, setSetting, workspaceStats, exportWorkspace, importWorkspace, listPages,
} from "../core/store.js";
import { estimateStorage } from "../core/db.js";
import { h, download, todayKey } from "../core/utils.js";
import { toast, confirmDialog, promptDialog } from "../core/ui.js";
import { setTheme } from "../shell.js";
import { pageToMarkdown } from "../core/markdown.js";
import * as sync from "../core/sync.js";
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
      "100% local · seus dados vivem apenas neste dispositivo, em IndexedDB. A IA roda no navegador via WebGPU — nenhum byte é enviado para servidores."));
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

  // selo de status
  const statusText = { off: "Desconectado", ready: "Sincronizado ✓", syncing: "Sincronizando…", error: "Erro de sincronização", locked: "Bloqueado — informe a senha" }[st.status] || st.status;
  box.appendChild(h("div", { class: "sync-status sync-" + st.status },
    h("span", { class: "sync-dot" }),
    h("span", {}, statusText),
    st.user ? h("span", { class: "sync-email" }, st.user.email) : null));

  box.appendChild(h("p", { class: "settings-hint", style: "margin:6px 0 14px" },
    "Login por e-mail/senha com sincronização entre dispositivos. Seus dados são criptografados neste aparelho (AES-256) antes de subir — o servidor guarda só texto cifrado."));

  if (!st.configured) {
    // configurar Supabase
    const url = h("input", { class: "input", placeholder: "https://xxxx.supabase.co", value: getSetting("supabaseUrl", "") });
    const key = h("input", { class: "input", placeholder: "chave anon public", value: getSetting("supabaseKey", "") });
    const save = h("button", { class: "btn primary", onclick: () => {
      if (!url.value.trim() || !key.value.trim()) { toast("Preencha URL e chave", { type: "warn" }); return; }
      sync.saveConfig(url.value, key.value); toast("Configuração salva"); bus.emit("sync:status", sync.syncState());
    } }, "Salvar configuração");
    box.append(
      h("details", { class: "sync-setup" },
        h("summary", {}, "Como configurar (grátis, 3 passos)"),
        h("ol", { class: "sync-steps" },
          h("li", {}, "Crie um projeto grátis em supabase.com"),
          h("li", {}, "Em SQL Editor, rode o SQL abaixo (cria a tabela cifrada + segurança por usuário):"),
          h("pre", { class: "sync-sql" }, sync.SETUP_SQL),
          h("li", {}, "Em Project Settings → API, copie a Project URL e a chave anon public e cole aqui:"))),
      rowEl("URL do projeto", url),
      rowEl("Chave anon public", key),
      h("div", { class: "btn-row" }, save));
    return box;
  }

  if (st.status === "off") {
    // login / cadastro
    const email = h("input", { class: "input", type: "email", placeholder: "seu@email.com", autocomplete: "username" });
    const pass = h("input", { class: "input", type: "password", placeholder: "senha", autocomplete: "current-password" });
    const msg = h("div", { style: "color:var(--danger);font-size:var(--fs-xs);min-height:14px" });
    const doAuth = (fn, label) => async () => {
      msg.textContent = "";
      if (!email.value || pass.value.length < 6) { msg.textContent = "E-mail e senha (mín. 6) obrigatórios."; return; }
      try { await fn(email.value.trim(), pass.value); toast(label + " ✓"); bus.emit("sync:status", sync.syncState()); }
      catch (e) { msg.textContent = e.message || String(e); }
    };
    const login = h("button", { class: "btn primary", onclick: doAuth(sync.signIn, "Conectado") }, "Entrar");
    const signup = h("button", { class: "btn ghost", onclick: doAuth(sync.signUp, "Conta criada") }, "Criar conta");
    const reconfig = h("button", { class: "btn ghost sm", onclick: () => { sync.saveConfig("", ""); bus.emit("sync:status", sync.syncState()); } }, "Trocar projeto Supabase");
    box.append(rowEl("E-mail", email), rowEl("Senha", pass), msg, h("div", { class: "btn-row" }, login, signup), h("div", { style: "margin-top:8px" }, reconfig));
    return box;
  }

  if (st.status === "locked") {
    const pass = h("input", { class: "input", type: "password", placeholder: "sua senha", autocomplete: "current-password" });
    const msg = h("div", { style: "color:var(--danger);font-size:var(--fs-xs);min-height:14px" });
    const unlock = h("button", { class: "btn primary", onclick: async () => {
      try { await sync.unlock(pass.value); toast("Desbloqueado ✓"); bus.emit("sync:status", sync.syncState()); }
      catch (e) { msg.textContent = e.message; }
    } }, "Desbloquear e sincronizar");
    box.append(h("p", { class: "settings-hint" }, `Sessão de ${st.user?.email}. Informe a senha para descriptografar e sincronizar.`),
      rowEl("Senha", pass), msg, h("div", { class: "btn-row" }, unlock,
        h("button", { class: "btn ghost", onclick: () => sync.signOut() }, "Sair")));
    return box;
  }

  // conectado
  const syncNow = h("button", { class: "btn", onclick: async () => { try { await sync.pullNow(); await sync.pushNow(); toast("Sincronizado ✓"); } catch (e) { toast(e.message, { type: "danger" }); } } }, "⟳ Sincronizar agora");
  const out = h("button", { class: "btn ghost", onclick: async () => { await sync.signOut(); toast("Sessão encerrada"); bus.emit("sync:status", sync.syncState()); } }, "Sair");
  box.append(h("div", { class: "btn-row" }, syncNow, out));
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
