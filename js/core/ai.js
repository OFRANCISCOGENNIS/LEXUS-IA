// ═══════════════ NEXUS · Cliente do gateway de IA (OmniRoute) ═══════════════
// O NEXUS continua 100% local por padrão. Este módulo só conversa com um
// gateway que VOCÊ roda na sua máquina — o OmniRoute, em http://localhost:20128
// — e só depois que você liga o assistente nas Configurações. Nada sai do
// aparelho em segundo plano: toda requisição nasce de um clique seu.
//
// O protocolo é o da OpenAI (/chat/completions, /models), que o OmniRoute
// expõe e repassa para o provedor que você conectou lá. Se o provedor for
// local (Ollama, LM Studio, llama.cpp), o texto nem sai do computador.

import { getSetting, setSetting } from "./store.js";
import { bus } from "./bus.js";

const DEFAULTS = {
  enabled: false,
  baseUrl: "http://localhost:20128/v1",
  apiKey: "",
  model: "auto",
  temperature: 0.7,
};

export const aiConfig = () => ({ ...DEFAULTS, ...(getSetting("aiGateway", {}) || {}) });

export function setAiConfig(patch) {
  const next = { ...aiConfig(), ...patch };
  setSetting("aiGateway", next);
  bus.emit("ai:status", { enabled: next.enabled, model: next.model, baseUrl: next.baseUrl });
  return next;
}

export const aiReady = () => {
  const c = aiConfig();
  return !!(c.enabled && String(c.baseUrl || "").trim());
};

const root = (c) => String(c.baseUrl || "").trim().replace(/\/+$/, "");
const authHeaders = (c) => ({
  "Content-Type": "application/json",
  ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}),
});

/* O fetch devolve sempre "Failed to fetch" quando a rede falha — aqui a gente
   transforma isso no recado que realmente ajuda a destravar. */
function networkHint(c) {
  const https = location.protocol === "https:";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)/i.test(root(c));
  return [
    `Não consegui falar com o gateway em ${root(c) || "(endereço vazio)"}.`,
    "Confira se o OmniRoute está rodando (`omniroute` no terminal) e se o endereço termina em /v1.",
    https && local
      ? "Como o NEXUS está aberto em https://, o navegador pode estar bloqueando a chamada para http://localhost — abra o NEXUS em http://localhost para usar o assistente."
      : "Se o gateway estiver em outra máquina, libere a origem do NEXUS no OmniRoute (CORS_ALLOWED_ORIGINS).",
  ].join(" ");
}

function httpHint(status, detail) {
  const tail = detail ? ` — ${detail}` : "";
  if (status === 401 || status === 403) return `O gateway recusou a chave (HTTP ${status})${tail}. Gere uma chave no painel do OmniRoute e cole nas Configurações.`;
  if (status === 404) return `Endpoint não encontrado (HTTP 404)${tail}. A URL base costuma ser http://localhost:20128/v1.`;
  if (status === 429) return `O provedor atingiu o limite agora (HTTP 429)${tail}. O OmniRoute costuma ter fallback — tente de novo ou troque o modelo.`;
  if (status >= 500) return `O gateway respondeu com erro (HTTP ${status})${tail}.`;
  return `Falha na chamada (HTTP ${status})${tail}`;
}

async function request(path, init = {}) {
  const c = aiConfig();
  let res;
  try {
    res = await fetch(root(c) + path, { ...init, headers: { ...authHeaders(c), ...(init.headers || {}) } });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error(networkHint(c));
  }
  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      try { detail = JSON.parse(text)?.error?.message || ""; } catch { detail = ""; }
      if (!detail) detail = text.slice(0, 180);
    } catch {}
    throw new Error(httpHint(res.status, detail));
  }
  return res;
}

/* ── Modelos disponíveis no gateway ── */
export async function listModels() {
  const res = await request("/models");
  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
}

/* Teste de conexão para as Configurações — nunca lança, sempre relata */
export async function ping() {
  try {
    const models = await listModels();
    bus.emit("ai:status", { ok: true, models: models.length });
    return { ok: true, models };
  } catch (e) {
    bus.emit("ai:status", { ok: false, error: String(e.message || e) });
    return { ok: false, error: String(e.message || e) };
  }
}

/* ── Conversa (streaming) ──
   messages: [{role:"user"|"assistant"|"system", content}]
   onToken(texto) é chamado a cada pedaço; devolve o texto completo. */
export async function chat(messages, { model, temperature, system, signal, onToken } = {}) {
  if (!aiReady()) throw new Error("O assistente está desligado. Ligue em Configurações → Assistente de IA.");
  const c = aiConfig();
  const body = {
    model: model || c.model || "auto",
    messages: system ? [{ role: "system", content: system }, ...messages] : messages,
    temperature: temperature ?? c.temperature,
    stream: true,
  };

  const res = await request("/chat/completions", { method: "POST", body: JSON.stringify(body), signal });

  // alguns gateways/provedores ignoram stream e devolvem JSON de uma vez
  const ctype = res.headers.get("content-type") || "";
  if (!/event-stream/i.test(ctype)) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
    if (text) onToken?.(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") return out;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        if (json?.error) throw new Error(json.error.message || "O gateway devolveu um erro no meio da resposta.");
        const choice = json?.choices?.[0];
        const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? "";
        if (delta) { out += delta; onToken?.(delta); }
      }
    }
  }
  return out;
}

/* Atalho de uma pergunta só */
export const complete = (prompt, opts = {}) => chat([{ role: "user", content: prompt }], opts);

/* Corta o contexto para não estourar a janela do modelo (nem a paciência do gateway) */
export const CONTEXT_LIMIT = 12000;
export function clipContext(text = "", limit = CONTEXT_LIMIT) {
  const t = String(text);
  if (t.length <= limit) return t;
  return t.slice(0, limit) + `\n\n[…texto cortado em ${limit} caracteres…]`;
}

export const SYSTEM_PT = [
  "Você é o assistente do NEXUS, um workspace de notas e databases.",
  "Responda sempre em português do Brasil, de forma direta e útil.",
  "Use Markdown simples (títulos, listas, negrito, código) — nada de HTML.",
  "Quando não souber, diga que não sabe em vez de inventar.",
].join(" ");
