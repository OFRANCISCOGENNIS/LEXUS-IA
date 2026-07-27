// ═══════════════ NEXUS · Grafo de conhecimento (estilo Obsidian) ═══════════════
// Canvas força-dirigido com: brilho nos nós, tamanho ∝ conexões, destaque de
// vizinhos no hover (resto esmaece com transição), rótulos por zoom, tags como
// nós, filtro de busca e painel de forças ajustáveis.

import { knowledgeGraph, listPages, getSetting, setSetting } from "../core/store.js";
import { bus } from "../core/bus.js";
import { navigate } from "../core/router.js";
import { h, clamp, debounce } from "../core/utils.js";

let sim = null;

const DEFAULT_CFG = {
  showTags: true, showDailies: true, showOrphans: true,
  center: 0.0015, repel: 1400, linkDist: 110, nodeSize: 1, labelZ: 0.65,
};

function loadCfg() { return { ...DEFAULT_CFG, ...(getSetting("graph:cfg", {}) || {}) }; }
const saveCfg = debounce((cfg) => setSetting("graph:cfg", cfg), 300);

/* Monta nós + arestas: wiki-links/menções + sub-páginas + tags (opcionais) */
function buildData(cfg) {
  const { nodes: pageNodes, edges: linkEdges } = knowledgeGraph();
  const pages = listPages();
  const meta = new Map(pages.map((p) => [p.id, p]));

  const nodes = [];
  const byId = new Map();
  pageNodes.forEach((n) => {
    const p = meta.get(n.id);
    const kind = p?.type === "daily" ? "daily" : "page";
    if (!cfg.showDailies && kind === "daily") return;
    const node = { ...n, kind, fade: 1 };
    nodes.push(node); byId.set(n.id, node);
  });

  const edges = [];
  const seen = new Set();
  const pushEdge = (from, to) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const k = from < to ? from + "|" + to : to + "|" + from;
    if (seen.has(k)) return;
    seen.add(k); edges.push({ from, to });
  };
  linkEdges.forEach((e) => pushEdge(e.from, e.to));
  // sub-páginas: filho ↔ pai
  pages.forEach((p) => { if (p.parentId && byId.has(p.id) && byId.has(p.parentId)) pushEdge(p.id, p.parentId); });
  // tags como nós (páginas que compartilham tag se conectam através dela)
  if (cfg.showTags) {
    const tagNodes = new Map();
    pages.forEach((p) => (p.tags || []).forEach((t) => {
      if (!byId.has(p.id)) return;
      const id = "tag:" + String(t).toLowerCase();
      if (!tagNodes.has(id)) {
        const tn = { id, title: "#" + t, kind: "tag", links: 0, fade: 1 };
        tagNodes.set(id, tn); nodes.push(tn); byId.set(id, tn);
      }
      pushEdge(p.id, id);
    }));
  }

  const deg = new Map();
  edges.forEach((e) => { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); });
  nodes.forEach((n) => { n.links = deg.get(n.id) || 0; });

  let out = nodes;
  if (!cfg.showOrphans) out = out.filter((n) => n.links > 0);
  const outSet = new Set(out.map((n) => n.id));
  return { nodes: out, edges: edges.filter((e) => outSet.has(e.from) && outSet.has(e.to)) };
}

export default {
  async mount(container) {
    const cfg = loadCfg();
    const data = buildData({ ...cfg, showOrphans: true });

    if (data.nodes.length < 2) {
      container.innerHTML = "";
      container.appendChild(h("div", { class: "empty-state", style: "height:70vh" },
        h("div", { class: "es-icon" }, "◉"),
        h("div", { class: "es-title" }, "Seu grafo ainda está nascendo"),
        h("div", { class: "es-desc" }, "Crie páginas e conecte-as com [[wiki-links]], menções @ ou tags — cada conexão vira uma aresta aqui.")));
      return;
    }

    const canvas = h("canvas", { class: "graph-canvas" });
    const stats = h("span", { class: "graph-stat" });
    const controlsBtn = h("button", { class: "btn ghost sm", "aria-expanded": "false" }, "⚙ Controles");
    const hud = h("div", { class: "graph-hud" },
      stats,
      h("button", { class: "btn ghost sm", onclick: () => sim?.reseed() }, "↻ Reorganizar"),
      h("button", { class: "icon-btn", "aria-label": "Aproximar", onclick: () => sim?.zoomBy(1.25) }, "＋"),
      h("button", { class: "icon-btn", "aria-label": "Afastar", onclick: () => sim?.zoomBy(0.8) }, "−"),
      controlsBtn);
    const tip = h("div", { class: "graph-tip", hidden: true });

    const wrap = h("div", { class: "graph-wrap" }, canvas, hud, tip);
    container.appendChild(wrap);

    sim = createSim(canvas, tip, cfg);
    const apply = () => {
      const d = buildData(cfg);
      sim.setData(d);
      const nPages = d.nodes.filter((n) => n.kind !== "tag").length;
      stats.textContent = `${nPages} páginas · ${d.edges.length} conexões`;
      saveCfg(cfg);
    };
    apply();
    sim.start();

    // ── Painel de controles (estilo Obsidian) ──
    const panel = buildControls(cfg, apply, () => sim);
    panel.hidden = true;
    wrap.appendChild(panel);
    controlsBtn.onclick = () => {
      panel.hidden = !panel.hidden;
      controlsBtn.setAttribute("aria-expanded", String(!panel.hidden));
    };

    this._offTheme = bus.on("settings:changed", ({ key }) => { if (key === "theme" || key === "accent") sim?.refreshColors(); });
  },
  unmount() {
    sim?.destroy();
    sim = null;
    this._offTheme?.();
  },
};

function buildControls(cfg, apply, getSim) {
  const check = (label, key) => {
    const cb = h("input", { type: "checkbox" });
    cb.checked = cfg[key];
    cb.onchange = () => { cfg[key] = cb.checked; apply(); };
    return h("label", { class: "gcp-check" }, cb, h("span", {}, label));
  };
  const slider = (label, key, min, max, step) => {
    const r = h("input", { type: "range", min, max, step });
    r.value = cfg[key];
    r.addEventListener("input", () => { cfg[key] = parseFloat(r.value); getSim()?.kickPhysics(); saveCfg(cfg); });
    return h("label", { class: "gcp-slider" }, h("span", {}, label), r);
  };
  const search = h("input", { class: "input sm", placeholder: "Filtrar páginas…", "aria-label": "Filtrar nós" });
  search.addEventListener("input", () => getSim()?.setQuery(search.value));

  return h("div", { class: "graph-controls" },
    h("div", { class: "gcp-title" }, "Filtros"),
    search,
    check("Tags", "showTags"),
    check("Notas diárias", "showDailies"),
    check("Órfãs (sem conexões)", "showOrphans"),
    h("div", { class: "gcp-title" }, "Forças"),
    slider("Força central", "center", 0.0002, 0.006, 0.0002),
    slider("Repulsão", "repel", 200, 4000, 100),
    slider("Distância de link", "linkDist", 40, 260, 10),
    h("div", { class: "gcp-title" }, "Exibição"),
    slider("Tamanho dos nós", "nodeSize", 0.5, 2, 0.1),
    slider("Rótulos (limiar de zoom)", "labelZ", 0.2, 1.5, 0.05),
  );
}

function createSim(canvas, tip, P) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let nodes = [], edges = [];
  let idIndex = new Map(), adj = new Map();
  let W = 0, H = 0;
  let cam = { x: 0, y: 0, z: 1 };
  let raf = 0, running = false, settleFrames = 0;
  let hoverNode = null, dragNode = null, panning = false;
  let last = { x: 0, y: 0 };
  let colors = {};
  let query = "";

  function rebuildIndex() {
    idIndex = new Map(nodes.map((n, i) => [n.id, i]));
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    edges.forEach((e) => { adj.get(e.from)?.add(e.to); adj.get(e.to)?.add(e.from); });
  }

  function setData(data) {
    // preserva posições dos nós que já existiam
    const old = new Map(nodes.map((n) => [n.id, n]));
    nodes = data.nodes.map((n) => {
      const o = old.get(n.id);
      return o ? Object.assign(n, { x: o.x, y: o.y, vx: o.vx, vy: o.vy, fade: o.fade ?? 1 }) : n;
    });
    edges = data.edges;
    rebuildIndex();
    // posiciona os novos
    nodes.forEach((n, i) => {
      if (n.x == null) {
        const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        n.x = W / 2 + Math.cos(a) * 120 + (Math.random() - 0.5) * 60;
        n.y = H / 2 + Math.sin(a) * 120 + (Math.random() - 0.5) * 60;
        n.vx = 0; n.vy = 0;
      }
    });
    if (hoverNode && !idIndex.has(hoverNode.id)) hoverNode = null;
    kick();
  }

  function refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    const dark = document.documentElement.dataset.theme === "dark";
    colors = {
      node: cs.getPropertyValue("--text-3").trim() || (dark ? "#9a9aa3" : "#6b6b74"),
      accent: cs.getPropertyValue("--accent").trim() || "#5b7cfa",
      edge: cs.getPropertyValue("--border-strong").trim() || (dark ? "#3a3a42" : "#d4d4da"),
      text: cs.getPropertyValue("--text-2").trim(),
      faint: cs.getPropertyValue("--text-faint").trim(),
      tag: dark ? "#a78bfa" : "#7c3aed",
      daily: dark ? "#fbbf24" : "#d97706",
    };
    kick();
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    kick();
  }

  function reseed() {
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const orphan = n.links === 0;
      const rad = (orphan ? 0.42 : 0.18) * Math.min(W, H) + Math.random() * 40;
      n.x = W / 2 + Math.cos(angle) * rad;
      n.y = H / 2 + Math.sin(angle) * rad;
      n.vx = 0; n.vy = 0;
    });
    kick();
  }

  function step() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = P.repel / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      a.vx += (W / 2 - a.x) * P.center;
      a.vy += (H / 2 - a.y) * P.center;
    }
    edges.forEach((e) => {
      const a = nodes[idIndex.get(e.from)], b = nodes[idIndex.get(e.to)];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - P.linkDist) * 0.004;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });
    let energy = 0;
    nodes.forEach((n) => {
      if (n === dragNode) { n.vx = 0; n.vy = 0; return; }
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx; n.y += n.vy;
      energy += Math.abs(n.vx) + Math.abs(n.vy);
    });
    return energy;
  }

  const radius = (n) => clamp(3.5 + Math.sqrt(n.links) * 2.6, 3.5, 16) * P.nodeSize;
  const baseColor = (n) =>
    n.kind === "tag" ? colors.tag :
    n.kind === "daily" ? colors.daily :
    n.links === 0 ? colors.faint : colors.node;

  /* transição suave de destaque (assinatura visual do Obsidian) */
  function animFades() {
    const q = query.trim().toLowerCase();
    const hiSet = hoverNode ? new Set([hoverNode.id, ...(adj.get(hoverNode.id) || [])]) : null;
    let anim = 0;
    nodes.forEach((n) => {
      let target = 1;
      if (hiSet) target = hiSet.has(n.id) ? 1 : 0.08;
      else if (q) target = n.title.toLowerCase().includes(q) ? 1 : 0.1;
      const d = target - (n.fade ?? 1);
      n.fade = (n.fade ?? 1) + d * 0.16;
      anim = Math.max(anim, Math.abs(d));
    });
    return anim;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.z, cam.z);

    const hovered = hoverNode;

    // arestas — alpha acompanha o fade dos dois extremos
    ctx.lineWidth = 1 / cam.z;
    edges.forEach((e) => {
      const a = nodes[idIndex.get(e.from)], b = nodes[idIndex.get(e.to)];
      if (!a || !b) return;
      const incident = hovered && (e.from === hovered.id || e.to === hovered.id);
      const fade = Math.min(a.fade ?? 1, b.fade ?? 1);
      ctx.strokeStyle = incident ? colors.accent : colors.edge;
      ctx.globalAlpha = incident ? 0.9 : 0.45 * fade;
      ctx.lineWidth = (incident ? 1.6 : 1) / cam.z;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    // nós com brilho (glow)
    const labelBase = clamp((cam.z - P.labelZ) * 2.5, 0, 1);
    nodes.forEach((n) => {
      const r = radius(n);
      const isHover = hovered && n.id === hovered.id;
      const isNeighbor = hovered && adj.get(hovered.id)?.has(n.id);
      const fill = isHover || isNeighbor ? colors.accent : baseColor(n);
      const fade = n.fade ?? 1;

      ctx.globalAlpha = fade;
      ctx.fillStyle = fill;
      ctx.shadowColor = fill;
      ctx.shadowBlur = (isHover ? 26 : isNeighbor ? 16 : 9) * fade;
      ctx.beginPath();
      ctx.arc(n.x, n.y, isHover ? r * 1.25 : r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // rótulo abaixo do nó (como no Obsidian), surgindo com o zoom
      let la = labelBase;
      if (isHover || isNeighbor) la = 1;
      la *= fade;
      if (la > 0.03) {
        ctx.globalAlpha = la * 0.92;
        ctx.fillStyle = colors.text;
        ctx.font = `${11 / cam.z}px ui-sans-serif, system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(n.title.slice(0, 30), n.x, n.y + r + 13 / cam.z);
        ctx.textAlign = "start";
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function loop() {
    const energy = step();
    const anim = animFades();
    draw();
    if (energy < 0.6 && anim < 0.01) settleFrames++;
    else settleFrames = 0;
    if (settleFrames > 30 && !dragNode) { running = false; return; }
    raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (!running) { running = true; settleFrames = 0; raf = requestAnimationFrame(loop); }
    else settleFrames = 0;
  }

  const toWorld = (px, py) => ({ x: (px - cam.x) / cam.z, y: (py - cam.y) / cam.z });

  function nodeAt(px, py) {
    const { x, y } = toWorld(px, py);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = radius(n) + 5;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
  }

  /* interações (mouse + toque + pinça) */
  const pointers = new Map();
  let pinchDist = 0;
  const pinchInfo = () => { const [a, b] = [...pointers.values()]; return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };

  const onDown = (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cap = (id) => { try { canvas.setPointerCapture(id); } catch { /* pointer já solto */ } };
    if (pointers.size === 2) { dragNode = null; panning = false; pinchDist = pinchInfo().dist; cap(e.pointerId); return; }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const n = nodeAt(px, py);
    if (n) { dragNode = n; n._moved = false; }
    else panning = true;
    last = { x: e.clientX, y: e.clientY };
    cap(e.pointerId);
  };
  const onMove = (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const rect = canvas.getBoundingClientRect();
      const { dist, mx, my } = pinchInfo();
      if (pinchDist > 0 && dist > 0) zoomAt(mx - rect.left, my - rect.top, dist / pinchDist);
      pinchDist = dist;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (dragNode) {
      const w = toWorld(px, py);
      dragNode.x = w.x; dragNode.y = w.y;
      dragNode._moved = true;
      kick();
    } else if (panning) {
      cam.x += e.clientX - last.x;
      cam.y += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      kick();
    } else {
      const n = nodeAt(px, py);
      if (n !== hoverNode) {
        hoverNode = n;
        canvas.style.cursor = n ? "pointer" : "grab";
        if (n) {
          tip.textContent = (n.icon ? n.icon + " " : "") + n.title +
            (n.links ? `  ·  ${n.links} ${n.links === 1 ? "conexão" : "conexões"}` : "");
          tip.hidden = false;
        } else tip.hidden = true;
        kick();
      }
      if (n) {
        tip.style.left = px + 14 + "px";
        tip.style.top = py + 10 + "px";
      }
    }
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (dragNode && !dragNode._moved) {
      if (dragNode.kind === "tag") navigate("tags");
      else navigate("page", dragNode.id);
    }
    dragNode = null; panning = false;
  };
  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  };

  function zoomAt(px, py, factor) {
    const z2 = clamp(cam.z * factor, 0.25, 3.5);
    const w = toWorld(px, py);
    cam.z = z2;
    cam.x = px - w.x * z2;
    cam.y = py - w.y * z2;
    kick();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const ro = new ResizeObserver(resize);

  return {
    start() {
      ro.observe(canvas.parentElement);
      refreshColors();
      resize();
      reseed();
      if (reduced) { for (let i = 0; i < 300; i++) step(); animFades(); draw(); running = false; }
      else kick();
    },
    setData,
    setQuery(q) { query = q; kick(); },
    kickPhysics: kick,
    reseed,
    refreshColors,
    zoomBy(f) { zoomAt(W / 2, H / 2, f); },
    destroy() {
      cancelAnimationFrame(raf);
      running = false;
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}
