// ═══════════════ NEXUS · Utilitários ═══════════════

export const uid = (p = "") =>
  p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const debounce = (fn, ms = 300) => {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
};

export const throttle = (fn, ms = 100) => {
  let last = 0, t;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last)); }
  };
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const escapeHtml = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const stripHtml = (html = "") => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent || "";
};

/* Sanitiza HTML de conteúdo de bloco (permite só formatação inline segura) */
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "CODE", "A", "MARK", "SPAN", "BR", "DEL"]);
const ALLOWED_ATTRS = { A: ["href"], SPAN: ["style", "class", "data-page-id"], MARK: ["style", "class"] };
export function sanitizeInline(html = "") {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstChild;
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          // desembrulha mantendo filhos
          walk(child);
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }
        [...child.attributes].forEach((attr) => {
          const ok = (ALLOWED_ATTRS[child.tagName] || []).includes(attr.name);
          if (!ok) child.removeAttribute(attr.name);
          if (attr.name === "href" && /^\s*javascript:/i.test(attr.value)) child.removeAttribute("href");
          if (attr.name === "style" && !/^[\w\s:;#%(),.\-]*$/.test(attr.value)) child.removeAttribute("style");
        });
        walk(child);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    });
  };
  walk(root);
  return root.innerHTML;
}

/* Busca fuzzy — retorna score (maior = melhor) ou -1 */
export function fuzzyScore(query, text) {
  if (!query) return 0;
  query = query.toLowerCase();
  text = (text || "").toLowerCase();
  const idx = text.indexOf(query);
  if (idx === 0) return 1000 - text.length;
  if (idx > 0) return 500 - idx - text.length * 0.1;
  let qi = 0, score = 0, streak = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      qi++; streak++; score += 2 + streak * 2;
      if (ti === 0 || text[ti - 1] === " " || text[ti - 1] === "-") score += 8;
    } else streak = 0;
  }
  return qi === query.length ? score : -1;
}

export function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + "<mark>" + escapeHtml(text.slice(i, i + query.length)) + "</mark>" + escapeHtml(text.slice(i + query.length));
}

/* Datas */
export const todayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const fmtDate = (ts, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  new Date(ts).toLocaleDateString("pt-BR", opts);
export const fmtRelative = (ts) => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h atrás`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 7) return `${d} dias atrás`;
  return fmtDate(ts, { day: "numeric", month: "short" });
};

/* FLIP: anima elementos entre dois estados de layout */
export function flip(container, mutate, { duration = 260, selector = "[data-flip-id]" } = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { mutate(); return; }
  const first = new Map();
  container.querySelectorAll(selector).forEach((el) => {
    first.set(el.dataset.flipId, el.getBoundingClientRect());
  });
  mutate();
  requestAnimationFrame(() => {
    container.querySelectorAll(selector).forEach((el) => {
      const f = first.get(el.dataset.flipId);
      if (!f) { el.animate([{ opacity: 0, transform: "scale(0.97)" }, { opacity: 1, transform: "scale(1)" }], { duration, easing: "cubic-bezier(0.22,1,0.36,1)" }); return; }
      const l = el.getBoundingClientRect();
      const dx = f.left - l.left, dy = f.top - l.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0,0)" }],
        { duration, easing: "cubic-bezier(0.22,1,0.36,1)" }
      );
    });
  });
}

/* Posiciona um elemento flutuante perto de uma âncora, sem sair da tela */
export function positionFloating(el, anchorRect, { gap = 6, align = "left" } = {}) {
  const vw = innerWidth, vh = innerHeight;
  el.style.visibility = "hidden";
  el.style.display = "block";
  const r = el.getBoundingClientRect();
  let top = anchorRect.bottom + gap;
  let left = align === "left" ? anchorRect.left : anchorRect.right - r.width;
  if (top + r.height > vh - 8) top = Math.max(8, anchorRect.top - r.height - gap);
  left = clamp(left, 8, vw - r.width - 8);
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = "";
}

export const isMac = navigator.platform.toUpperCase().includes("MAC");
export const modKey = isMac ? "⌘" : "Ctrl";

export const pluralize = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export const readingTime = (words) => Math.max(1, Math.round(words / 200));

export const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

export function download(filename, content, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
};
