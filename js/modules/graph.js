// ═══════════════ NEXUS · Grafo de conhecimento (canvas força-dirigido) ═══════════════

import { knowledgeGraph } from "../core/store.js";
import { bus } from "../core/bus.js";
import { navigate } from "../core/router.js";
import { h, clamp } from "../core/utils.js";

let sim = null;

export default {
  async mount(container) {
    const { nodes, edges } = knowledgeGraph();

    if (nodes.length < 2) {
      container.innerHTML = "";
      container.appendChild(h("div", { class: "empty-state", style: "height:70vh" },
        h("div", { class: "es-icon" }, "◉"),
        h("div", { class: "es-title" }, "Seu grafo ainda está nascendo"),
        h("div", { class: "es-desc" }, "Crie páginas e conecte-as com [[wiki-links]] — cada conexão aparece aqui como uma aresta.")));
      return;
    }

    const canvas = h("canvas", { class: "graph-canvas" });
    const hud = h("div", { class: "graph-hud" },
      h("span", { class: "graph-stat" }, `${nodes.length} páginas · ${edges.length} conexões`),
      h("button", { class: "btn ghost sm", onclick: () => sim?.reseed() }, "↻ Reorganizar"),
      h("button", { class: "icon-btn", "aria-label": "Aproximar", onclick: () => sim?.zoomBy(1.25) }, "＋"),
      h("button", { class: "icon-btn", "aria-label": "Afastar", onclick: () => sim?.zoomBy(0.8) }, "−"));
    const tip = h("div", { class: "graph-tip", hidden: true });

    const wrap = h("div", { class: "graph-wrap" }, canvas, hud, tip);
    container.appendChild(wrap);

    sim = createSim(canvas, tip, nodes, edges);
    sim.start();

    this._offTheme = bus.on("settings:changed", () => sim?.refreshColors());
  },
  unmount() {
    sim?.destroy();
    sim = null;
    this._offTheme?.();
  },
};

function createSim(canvas, tip, nodes, edges) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0;
  let cam = { x: 0, y: 0, z: 1 };
  let raf = 0, running = false, settleFrames = 0;
  let hoverNode = null, dragNode = null, panning = false;
  let last = { x: 0, y: 0 };
  let colors = {};

  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = new Map(nodes.map((n) => [n.id, new Set()]));
  edges.forEach((e) => { adj.get(e.from)?.add(e.to); adj.get(e.to)?.add(e.from); });

  function refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = {
      bg: cs.getPropertyValue("--bg").trim(),
      node: cs.getPropertyValue("--text-3").trim(),
      nodeHi: cs.getPropertyValue("--accent").trim(),
      edge: cs.getPropertyValue("--border-strong").trim(),
      text: cs.getPropertyValue("--text-2").trim(),
      faint: cs.getPropertyValue("--text-faint").trim(),
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
    // repulsão O(n²) — ok até algumas centenas de nós
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = 1400 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      // gravidade para o centro
      a.vx += (W / 2 - a.x) * 0.0015;
      a.vy += (H / 2 - a.y) * 0.0015;
    }
    // molas
    edges.forEach((e) => {
      const a = nodes[idIndex.get(e.from)], b = nodes[idIndex.get(e.to)];
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 110) * 0.004;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });
    let energy = 0;
    nodes.forEach((n) => {
      if (n === dragNode) { n.vx = 0; n.vy = 0; return; }
      n.vx *= 0.86; n.vy *= 0.86; // damping suave
      n.x += n.vx; n.y += n.vy;
      energy += Math.abs(n.vx) + Math.abs(n.vy);
    });
    return energy;
  }

  const radius = (n) => clamp(5 + n.links * 1.6, 5, 14);

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.z, cam.z);

    const hiSet = hoverNode ? new Set([hoverNode.id, ...(adj.get(hoverNode.id) || [])]) : null;

    // arestas
    ctx.lineWidth = 1 / cam.z;
    edges.forEach((e) => {
      const a = nodes[idIndex.get(e.from)], b = nodes[idIndex.get(e.to)];
      if (!a || !b) return;
      const hi = hiSet && (e.from === hoverNode.id || e.to === hoverNode.id);
      ctx.strokeStyle = hi ? colors.nodeHi : colors.edge;
      ctx.globalAlpha = hiSet ? (hi ? 0.9 : 0.12) : 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    // nós
    nodes.forEach((n) => {
      const hi = !hiSet || hiSet.has(n.id);
      const r = radius(n);
      ctx.globalAlpha = hi ? 1 : 0.18;
      ctx.fillStyle = (hoverNode && n.id === hoverNode.id) ? colors.nodeHi
        : n.links === 0 ? colors.faint : colors.node;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (hoverNode && n.id === hoverNode.id) {
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // rótulos quando zoom suficiente ou destaque
      if (cam.z > 0.65 || (hiSet && hiSet.has(n.id))) {
        ctx.globalAlpha = hi ? 0.95 : 0.15;
        ctx.fillStyle = colors.text;
        ctx.font = `${11 / cam.z}px ui-sans-serif, system-ui`;
        ctx.fillText(n.title.slice(0, 28), n.x + r + 5, n.y + 3.5);
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function loop() {
    const energy = step();
    draw();
    if (energy < 0.6) settleFrames++;
    else settleFrames = 0;
    if (settleFrames > 30 && !dragNode) { running = false; return; } // estabilizou — pausa
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
      const r = radius(n) + 4;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
  }

  /* interações */
  const pointers = new Map(); // pinça: rastreia dedos ativos
  let pinchDist = 0;
  const twoPts = () => [...pointers.values()];
  const pinchInfo = () => { const [a, b] = twoPts(); return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };

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
    if (pointers.size === 2) { // pinça → zoom no ponto médio
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
          tip.textContent = (n.icon ? n.icon + " " : "") + n.title;
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
    if (dragNode && !dragNode._moved) navigate("page", dragNode.id);
    dragNode = null; panning = false;
  };
  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(px, py, factor);
  };

  function zoomAt(px, py, factor) {
    const z2 = clamp(cam.z * factor, 0.25, 3);
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
      if (reduced) { for (let i = 0; i < 300; i++) step(); draw(); running = false; }
      else kick();
    },
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
