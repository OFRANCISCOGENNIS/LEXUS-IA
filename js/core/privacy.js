// ═══════════════ NEXUS · Privacidade (PIN local para páginas privadas) ═══════════════
// O PIN é um obstáculo local (hash SHA-256 guardado no dispositivo). Não é
// criptografia de conteúdo — os dados seguem em IndexedDB; é uma trava de acesso.

import { getSetting, setSetting } from "./store.js";

let unlocked = false; // destravado nesta sessão

async function sha256(str) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // fallback simples (contextos sem SubtleCrypto)
    let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return "f" + h.toString(16);
  }
}

export const hasPin = () => !!getSetting("pinHash", "");
export const isUnlocked = () => unlocked || !hasPin();
export function unlockSession() { unlocked = true; }
export function lockSession() { unlocked = false; }

export async function setPin(pin) {
  setSetting("pinHash", await sha256("nexus:" + pin));
  unlocked = true;
}
export async function removePin() { setSetting("pinHash", ""); unlocked = false; }

export async function verifyPin(pin) {
  const h = await sha256("nexus:" + pin);
  const okv = h === getSetting("pinHash", "");
  if (okv) unlocked = true;
  return okv;
}
