// ═══════════════ NEXUS · UI primitives (toast, menu, modal, confirm) ═══════════════

import { h, positionFloating } from "./utils.js";

const overlayRoot = () => document.getElementById("overlay-root");

/* ── Toast ── */
export function toast(message, { type = "ok", duration = 2600, icon } = {}) {
  const root = document.getElementById("toast-root");
  const icons = { ok: "✓", warn: "△", danger: "✕", info: "ℹ" };
  const el = h("div", { class: `toast ${type}` },
    h("span", { class: "t-icon" }, icon || icons[type] || "✓"),
    h("span", {}, message)
  );
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 250);
  }, duration);
  return el;
}

/* ── Menu contextual flutuante ──
   items: [{icon, title, desc, kbd, danger, action, sep, label}] */
export function showMenu(anchor, items, { align = "left", width } = {}) {
  closeMenus();
  const menu = h("div", { class: "menu", role: "menu" });
  if (width) menu.style.width = width + "px";
  let selected = -1;
  const actionable = [];

  items.forEach((item, i) => {
    if (item.sep) { menu.appendChild(h("div", { class: "menu-sep" })); return; }
    if (item.label) { menu.appendChild(h("div", { class: "menu-label" }, item.label)); return; }
    const el = h("button", {
      class: "menu-item" + (item.danger ? " danger" : ""),
      style: `animation-delay:${Math.min(i * 20, 160)}ms`,
      role: "menuitem",
      onclick: (e) => { e.stopPropagation(); close(); item.action?.(); },
      onmousemove: () => { const i = actionable.indexOf(el); if (i !== selected) setSel(i); },
    },
      item.icon ? h("i", { class: "mi-icon" }, item.icon) : null,
      h("div", { class: "mi-body" },
        h("div", { class: "mi-title" }, item.title),
        item.desc ? h("div", { class: "mi-desc" }, item.desc) : null
      ),
      item.kbd ? h("kbd", { class: "mi-kbd" }, item.kbd) : null
    );
    actionable.push(el);
    menu.appendChild(el);
  });

  const setSel = (i) => {
    selected = i;
    actionable.forEach((el, j) => el.classList.toggle("selected", j === i));
    if (i >= 0) actionable[i].scrollIntoView({ block: "nearest" });
  };

  const close = () => {
    menu.remove();
    removeEventListener("pointerdown", onOutside, true);
    removeEventListener("keydown", onKey, true);
  };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel(Math.min(selected + 1, actionable.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(Math.max(selected - 1, 0)); }
    else if (e.key === "Enter" && selected >= 0) { e.preventDefault(); actionable[selected].click(); }
  };

  overlayRoot().appendChild(menu);
  const rect = anchor instanceof DOMRect ? anchor : anchor.getBoundingClientRect();
  positionFloating(menu, rect, { align });
  requestAnimationFrame(() => {
    addEventListener("pointerdown", onOutside, true);
    addEventListener("keydown", onKey, true);
  });
  menu.closeMenu = close;
  return menu;
}

export function closeMenus() {
  overlayRoot().querySelectorAll(".menu").forEach((m) => m.closeMenu ? m.closeMenu() : m.remove());
}

/* ── Modal ── */
export function showModal({ title, body, footer, width, onClose }) {
  const scrim = h("div", { class: "scrim" });
  const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true" });
  if (width) modal.style.width = `min(${width}px, calc(100vw - 48px))`;

  const close = () => {
    scrim.classList.add("leaving"); modal.classList.add("leaving");
    setTimeout(() => { scrim.remove(); modal.remove(); }, 160);
    removeEventListener("keydown", onKey, true);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };

  if (title) modal.appendChild(h("div", { class: "modal-head" },
    h("span", {}, title),
    h("button", { class: "icon-btn", onclick: close, "aria-label": "Fechar" }, "✕")
  ));
  const bodyEl = h("div", { class: "modal-body" });
  if (typeof body === "string") bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  modal.appendChild(bodyEl);
  if (footer) {
    const f = h("div", { class: "modal-foot" });
    if (footer.nodeType) f.appendChild(footer); else footer.forEach((b) => f.appendChild(b));
    modal.appendChild(f);
  }

  scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim) close(); });
  addEventListener("keydown", onKey, true);
  overlayRoot().append(scrim, modal);
  return { close, modal, body: bodyEl };
}

/* ── Confirm ── */
export function confirmDialog({ title = "Tem certeza?", message = "", confirmText = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    const ok = h("button", { class: `btn ${danger ? "danger" : "primary"}` }, confirmText);
    const cancel = h("button", { class: "btn ghost" }, "Cancelar");
    const m = showModal({
      title,
      body: h("p", { style: "color:var(--text-2);font-size:var(--fs-sm);line-height:1.6" }, message),
      footer: [cancel, ok],
      width: 400,
      onClose: () => resolve(false),
    });
    ok.onclick = () => { resolve(true); m.close(); };
    cancel.onclick = () => { resolve(false); m.close(); };
  });
}

/* ── Prompt ── */
export function promptDialog({ title, label = "", value = "", placeholder = "", confirmText = "Salvar" }) {
  return new Promise((resolve) => {
    const input = h("input", { class: "input", value, placeholder });
    const ok = h("button", { class: "btn primary" }, confirmText);
    const cancel = h("button", { class: "btn ghost" }, "Cancelar");
    const m = showModal({
      title,
      body: h("div", {}, label ? h("p", { style: "margin-bottom:8px;font-size:var(--fs-sm);color:var(--text-2)" }, label) : null, input),
      footer: [cancel, ok],
      width: 420,
      onClose: () => resolve(null),
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") ok.click(); });
    ok.onclick = () => { resolve(input.value); m.close(); };
    cancel.onclick = () => { resolve(null); m.close(); };
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

/* ── Emoji picker simples ── */
const EMOJI = "◆ ▲ ● ■ ✦ ✳ ☀ ☾ ★ ♥ ⚑ ✿ ❄ ⚡ 📄 📝 📚 📌 📁 🎯 🚀 💡 🔥 🌱 🧠 🗂 📊 🗓 ✅ 🏷 💼 🎨 🔬 🎬 🎧 🏠 ✈ 🍀 🌊 🏔".split(" ");
export function emojiPicker(anchor, onPick) {
  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:6px;" });
  EMOJI.forEach((e) => grid.appendChild(
    h("button", {
      class: "icon-btn", style: "font-size:16px;font-style:normal",
      onclick: () => { menu.closeMenu(); onPick(e); },
    }, e)
  ));
  grid.appendChild(h("button", {
    class: "btn ghost sm", style: "grid-column:1/-1;margin-top:4px",
    onclick: () => { menu.closeMenu(); onPick(""); },
  }, "Remover ícone"));
  const menu = showMenu(anchor, [], { width: 264 });
  menu.appendChild(grid);
  const rect = anchor instanceof DOMRect ? anchor : anchor.getBoundingClientRect();
  positionFloating(menu, rect, { align: "left" });
  return menu;
}
