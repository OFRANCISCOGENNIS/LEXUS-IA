// ═══════════════ NEXUS · Lembretes locais (Notification API) ═══════════════
// Agendador global: verifica lembretes vencidos e dispara notificações locais.
// Sem servidor — tudo roda no dispositivo.

import { getSetting, setSetting } from "./store.js";
import { bus } from "./bus.js";
import { toast } from "./ui.js";

export const listReminders = () =>
  (getSetting("reminders", []) || []).slice().sort((a, b) => a.at - b.at);

export function saveReminders(list) {
  setSetting("reminders", list);
  bus.emit("reminders:changed", {});
}

export async function requestNotifyPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}

function fire(reminder) {
  const canNotify = "Notification" in window && Notification.permission === "granted";
  if (canNotify) {
    try {
      const n = new Notification("⏰ " + reminder.title, {
        body: "Lembrete do NEXUS", tag: reminder.id, silent: false,
      });
      n.onclick = () => { window.focus(); location.hash = "#/productivity"; n.close(); };
    } catch { toast("⏰ " + reminder.title, { type: "info", duration: 6000 }); }
  } else {
    toast("⏰ " + reminder.title, { type: "info", duration: 6000, icon: "⏰" });
  }
}

let timer = null;

export function checkDueReminders() {
  const now = Date.now();
  const list = getSetting("reminders", []) || [];
  let changed = false;
  for (const r of list) {
    if (!r.done && !r.fired && r.at <= now) {
      fire(r);
      r.fired = true;
      changed = true;
    }
  }
  if (changed) setSetting("reminders", list);
}

export function initReminders() {
  // verifica ao abrir e a cada 30s
  checkDueReminders();
  clearInterval(timer);
  timer = setInterval(checkDueReminders, 30000);
  // reverifica quando a aba volta ao foco
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkDueReminders();
  });
}
