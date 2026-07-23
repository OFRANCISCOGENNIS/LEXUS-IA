// ═══════════════ NEXUS · Lixeira + arquivadas ═══════════════

import { listTrash, restoreFromTrash, purgeTrash, listPages, updatePage } from "../core/store.js";
import { h, fmtRelative } from "../core/utils.js";
import { toast, confirmDialog } from "../core/ui.js";
import { navigate } from "../core/router.js";

export default {
  async mount(container) {
    await render(container);
  },
  unmount() {},
};

async function render(container) {
  container.innerHTML = "";
  const wrap = h("div", { class: "page-container" });
  wrap.appendChild(h("h1", { class: "home-greeting" }, "Lixeira"));

  const items = await listTrash();

  if (items.length) {
    const emptyBtn = h("button", { class: "btn danger sm", style: "margin:8px 0 16px" }, "Esvaziar lixeira");
    emptyBtn.onclick = async () => {
      const ok = await confirmDialog({ title: "Esvaziar lixeira?", message: "Todos os itens serão excluídos permanentemente. Isso não pode ser desfeito.", confirmText: "Esvaziar", danger: true });
      if (ok) { await purgeTrash(); toast("Lixeira esvaziada"); render(container); }
    };
    wrap.appendChild(emptyBtn);

    const list = h("div", { class: "trash-list" });
    items.forEach((item) => {
      const restoreBtn = h("button", { class: "btn sm" }, "Restaurar");
      const purgeBtn = h("button", { class: "btn ghost sm", style: "color:var(--danger)" }, "Excluir de vez");
      restoreBtn.onclick = async () => {
        await restoreFromTrash(item.id);
        toast("Restaurado ✓");
        render(container);
      };
      purgeBtn.onclick = async () => {
        const ok = await confirmDialog({ title: "Excluir permanentemente?", message: `“${item.data.title || item.data.name || "Sem título"}” não poderá ser recuperado.`, confirmText: "Excluir", danger: true });
        if (ok) { await purgeTrash(item.id); render(container); }
      };
      list.appendChild(h("div", { class: "trash-item card" },
        h("span", { class: "ti-icon" }, item.data.icon || (item.kind === "database" ? "▦" : "▢")),
        h("div", { class: "ti-body" },
          h("div", { class: "ti-title" }, item.data.title || item.data.name || "Sem título"),
          h("div", { class: "ti-meta" }, `${item.kind === "database" ? "Database" : "Página"} · excluído ${fmtRelative(item.deletedAt)}`)),
        h("div", { class: "ti-actions" }, restoreBtn, purgeBtn)));
    });
    wrap.appendChild(list);
  } else {
    wrap.appendChild(h("div", { class: "empty-state" },
      h("div", { class: "es-icon" }, "🗑"),
      h("div", { class: "es-title" }, "Lixeira vazia"),
      h("div", { class: "es-desc" }, "Páginas e databases excluídas aparecem aqui e podem ser restauradas.")));
  }

  // arquivadas
  const archived = listPages({ includeArchived: true }).filter((p) => p.archived);
  if (archived.length) {
    wrap.appendChild(h("h2", { class: "home-section-title", style: "margin-top:32px" }, "Páginas arquivadas"));
    const list = h("div", { class: "trash-list" });
    archived.forEach((p) => {
      const un = h("button", { class: "btn sm" }, "Desarquivar");
      un.onclick = () => { updatePage(p.id, { archived: false }); toast("Página desarquivada"); render(container); };
      const open = h("button", { class: "btn ghost sm" }, "Abrir");
      open.onclick = () => navigate("page", p.id);
      list.appendChild(h("div", { class: "trash-item card" },
        h("span", { class: "ti-icon" }, p.icon || "▢"),
        h("div", { class: "ti-body" },
          h("div", { class: "ti-title" }, p.title || "Sem título"),
          h("div", { class: "ti-meta" }, "arquivada · editada " + fmtRelative(p.updatedAt))),
        h("div", { class: "ti-actions" }, open, un)));
    });
    wrap.appendChild(list);
  }

  container.appendChild(wrap);
}
