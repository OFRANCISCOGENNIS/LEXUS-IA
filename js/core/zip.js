// ═══════════════ NEXUS · Leitor de ZIP ═══════════════
// Mínimo e sem dependências: lê o diretório central, extrai entradas
// "stored" (sem compressão) e "deflate" usando DecompressionStream, que o
// navegador já tem. É o suficiente para abrir um export do Notion.

const SIG_EOCD = 0x06054b50;   // fim do diretório central
const SIG_CEN = 0x02014b50;    // entrada do diretório central
const SIG_LOC = 0x04034b50;    // cabeçalho local do arquivo

const utf8 = new TextDecoder("utf-8");

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador não sabe descompactar .zip. Use um navegador atual (Chrome, Edge, Firefox ou Safari recentes).");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Devolve [{ name, bytes }] — pastas e entradas vazias ficam de fora. */
export async function unzip(arrayBuffer, { onProgress } = {}) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  if (u8.length < 22) throw new Error("Arquivo .zip vazio ou corrompido.");

  // o fim do diretório central fica no fim do arquivo (pode haver comentário)
  let eocd = -1;
  const floor = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Não parece um arquivo .zip válido.");

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);

  const entries = [];
  for (let n = 0; n < count && off + 46 <= u8.length; n++) {
    if (dv.getUint32(off, true) !== SIG_CEN) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const size = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = utf8.decode(u8.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, compSize, size, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) throw new Error("O .zip não tem arquivos dentro.");

  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    onProgress?.(i + 1, entries.length, e.name);
    if (e.name.endsWith("/") || e.size === 0) continue;
    const lo = e.localOff;
    if (lo + 30 > u8.length || dv.getUint32(lo, true) !== SIG_LOC) continue;
    const nLen = dv.getUint16(lo + 26, true);
    const eLen = dv.getUint16(lo + 28, true);
    const start = lo + 30 + nLen + eLen;
    const raw = u8.subarray(start, start + e.compSize);
    try {
      if (e.method === 0) out.push({ name: e.name, bytes: raw });
      else if (e.method === 8) out.push({ name: e.name, bytes: await inflateRaw(raw) });
      // outros métodos (lzma etc.) são raros em exports e ficam de fora
    } catch {
      // uma entrada ilegível não derruba o import inteiro
    }
  }
  return out;
}

export const bytesToText = (bytes) => utf8.decode(bytes);

/* data: URL para imagens e anexos pequenos */
export function bytesToDataUrl(bytes, mime = "application/octet-stream") {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp",
};
export const mimeOf = (name) => MIME[(name.split(".").pop() || "").toLowerCase()] || "";
export const isImage = (name) => !!mimeOf(name);
