// ═══════════════ NEXUS · Web Worker da IA local ═══════════════
// Todo o processamento do modelo acontece aqui, fora da thread de UI.
// O modelo roda 100% no dispositivo — nenhum dado sai do navegador.

import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
