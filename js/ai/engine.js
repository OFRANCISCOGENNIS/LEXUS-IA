// ═══════════════ NEXUS · Engine de IA local (WebLLM) ═══════════════
// Importa a biblioteca dinamicamente (só quando o usuário ativa a IA) e roda
// o modelo num Web Worker via WebGPU. Sem API externa, sem key, sem backend.

import { bus } from "../core/bus.js";
import { setSetting, getSetting } from "../core/store.js";

export const MODELS = [
  {
    id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    name: "SmolLM2 360M", params: "360M", sizeMB: 380,
    desc: "Ultraleve — roda em quase qualquer GPU. Bom para reescritas simples.",
    tier: 0,
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B", params: "1B", sizeMB: 880,
    desc: "Melhor equilíbrio entre velocidade e qualidade. Recomendado para a maioria.",
    tier: 1,
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen2.5 1.5B", params: "1.5B", sizeMB: 1100,
    desc: "Forte em multilíngue e instruções — ótimo em português.",
    tier: 2,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 3B", params: "3B", sizeMB: 2000,
    desc: "Qualidade alta para GPUs com mais memória.",
    tier: 3,
  },
  {
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    name: "Phi-3.5 mini", params: "3.8B", sizeMB: 2400,
    desc: "Máxima qualidade do catálogo — exige GPU dedicada.",
    tier: 4,
  },
];

export function capabilities() {
  return {
    webgpu: !!navigator.gpu,
    windowAi: typeof window !== "undefined" && typeof window.ai !== "undefined",
    memory: navigator.deviceMemory || null,
  };
}

export function recommendModel() {
  const cap = capabilities();
  if (!cap.webgpu) return null;
  const mem = cap.memory || 8;
  if (mem <= 4) return MODELS[0].id;
  if (mem <= 8) return MODELS[1].id;
  if (mem <= 16) return MODELS[2].id;
  return MODELS[3].id;
}

/* ── Estado ── */
export const aiState = {
  status: capabilities().webgpu ? "idle" : "unavailable", // idle|downloading|ready|error|unavailable
  modelId: getSetting?.("aiModel", null) ?? null,
  progress: 0,
  text: "",
  generating: false,
};

function setStatus(patch) {
  Object.assign(aiState, patch);
  bus.emit("ai:status", { ...aiState });
}

let engine = null;
let loadingPromise = null;

export function isReady() { return aiState.status === "ready" && !!engine; }

/* ── Carregamento ── */
export async function loadEngine(modelId, onProgress) {
  if (!capabilities().webgpu) {
    setStatus({ status: "unavailable" });
    throw new Error("WebGPU não está disponível neste navegador.");
  }
  if (engine && aiState.modelId === modelId && aiState.status === "ready") return engine;
  if (loadingPromise) return loadingPromise;

  setStatus({ status: "downloading", modelId, progress: 0, text: "Preparando…" });

  loadingPromise = (async () => {
    try {
      const webllm = await import("https://esm.run/@mlc-ai/web-llm");
      if (engine) { try { await engine.unload(); } catch {} engine = null; }
      const worker = new Worker(new URL("./llm-worker.js", import.meta.url), { type: "module" });
      engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (r) => {
          setStatus({ progress: r.progress ?? 0, text: r.text || "" });
          onProgress?.(r);
        },
      });
      setSetting("aiModel", modelId);
      setStatus({ status: "ready", modelId, progress: 1, text: "Pronto" });
      return engine;
    } catch (e) {
      engine = null;
      setStatus({ status: "error", text: String(e?.message || e) });
      throw e;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

export async function unloadModel() {
  if (engine) { try { await engine.unload(); } catch {} }
  engine = null;
  setStatus({ status: capabilities().webgpu ? "idle" : "unavailable", progress: 0 });
}

/* ── Geração com streaming ── */
export async function chatStream({ messages, temperature = 0.7, maxTokens = 1024, onToken }) {
  if (!isReady()) throw new Error("Nenhum modelo carregado. Abra Assistente IA → Modelos.");
  setStatus({ generating: true });
  try {
    const chunks = await engine.chat.completions.create({
      messages, temperature, max_tokens: maxTokens, stream: true,
    });
    let out = "";
    for await (const c of chunks) {
      const delta = c.choices?.[0]?.delta?.content || "";
      if (delta) {
        out += delta;
        onToken?.(delta, out);
      }
    }
    return out;
  } finally {
    setStatus({ generating: false });
  }
}

export function abortStream() {
  try { engine?.interruptGenerate?.(); } catch {}
}

/* ── System prompt com persona e memória ── */
export function systemPrompt(extra = "") {
  const persona = getSetting("aiPersona", "") ||
    "Você é o assistente do NEXUS, um workspace de produtividade. Seja claro, direto e útil. Responda sempre em português brasileiro, a menos que o usuário peça outro idioma.";
  const memory = getSetting("aiMemory", "");
  return [
    persona,
    memory ? `Fatos que você deve lembrar sobre o usuário:\n${memory}` : "",
    extra,
  ].filter(Boolean).join("\n\n");
}

/* ── Gerência de cache ── */
export async function deleteModelCache(modelId) {
  try {
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");
    if (webllm.deleteModelAllInfoInCache) {
      await webllm.deleteModelAllInfoInCache(modelId);
      return true;
    }
  } catch {}
  // fallback best-effort: limpa caches do webllm
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /webllm|mlc/i.test(k)).map((k) => caches.delete(k)));
    return true;
  } catch { return false; }
}

export async function cacheUsage() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est ? est.usage || 0 : 0;
  } catch { return 0; }
}
