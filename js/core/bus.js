// ═══════════════ NEXUS · Event bus ═══════════════
// Eventos: "pages:changed", "dbs:changed", "route:changed", "settings:changed",
//          "palette:open", "capture:open", "toast", "ai:status"

const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, payload) {
    listeners.get(event)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[bus:${event}]`, e); }
    });
  },
};
