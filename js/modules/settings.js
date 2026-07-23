// ═══════════════ NEXUS · Configurações ═══════════════

import {
  getSetting, setSetting, workspaceStats, exportWorkspace, importWorkspace, listPages,
} from "../core/store.js";
import { estimateStorage } from "../core/db.js";
import { h, download, todayKey } from "../core/utils.js";
import { toast, confirmDialog, promptDialog } from "../core/ui.js";
import { setTheme } from "../shell.js";
import { pageToMarkdown } from "../core/markdown.js";

const ACCENTS = [
  ["iris", "hsl(248 72% 62%)"], ["blue", "hsl(214 84% 56%)"], ["teal", "hsl(176 62% 44%)"],
  ["green", "hsl(148 55% 44%)"], ["amber", "hsl(36 90% 50%)"], ["rose", "hsl(346 72% 56%)"],
];

export default {
  async mount(container) {
    const wrap = h("div", { class: "page-container settings" });
    wrap.appendChild(h("h1", { class: "home-greeting" }, "Configurações"));

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
