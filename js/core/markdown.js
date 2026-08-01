// ═══════════════ NEXUS · Conversões Markdown ═══════════════

import { makeBlock } from "./store.js";
import { stripHtml } from "./utils.js";

function inlineToMd(html = "") {
  let s = html;
  s = s.replace(/<(b|strong)>(.*?)<\/\1>/gis, "**$2**");
  s = s.replace(/<(i|em)>(.*?)<\/\1>/gis, "*$2*");
  s = s.replace(/<(s|strike|del)>(.*?)<\/\1>/gis, "~~$2~~");
  s = s.replace(/<code>(.*?)<\/code>/gis, "`$1`");
  s = s.replace(/<mark[^>]*>(.*?)<\/mark>/gis, "==$1==");
  s = s.replace(/<span[^>]*class="wiki-link[^"]*"[^>]*>(.*?)<\/span>/gis, "[[$1]]");
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, "[$2]($1)");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  return stripHtml(s);
}

export function blocksToMarkdown(blocks, depth = 0) {
  const pad = "  ".repeat(depth);
  const lines = [];
  let num = 0;
  for (const b of blocks || []) {
    const t = inlineToMd(b.content || "");
    if (b.type !== "numbered") num = 0;
    switch (b.type) {
      case "h1": lines.push(`# ${t}`); break;
      case "h2": lines.push(`## ${t}`); break;
      case "h3": lines.push(`### ${t}`); break;
      case "h4": lines.push(`#### ${t}`); break;
      case "bulleted": lines.push(`${pad}- ${t}`); break;
      case "numbered": num++; lines.push(`${pad}${num}. ${t}`); break;
      case "todo": lines.push(`${pad}- [${b.props?.checked ? "x" : " "}] ${t}`); break;
      case "quote": lines.push(`> ${t}`); break;
      case "callout": lines.push(`> ${b.props?.icon || "💡"} ${t}`); break;
      case "code": lines.push("```" + (b.props?.lang || "") + "\n" + (b.content || "") + "\n```"); break;
      case "divider": lines.push("---"); break;
      case "toggle":
        lines.push(`${pad}- ▸ ${t}`);
        if (b.children?.length) lines.push(blocksToMarkdown(b.children, depth + 1));
        break;
      case "image": lines.push(`![${t || "imagem"}](${b.props?.src ? "imagem-local" : ""})`); break;
      default: lines.push(t); break;
    }
    if (!["bulleted", "numbered", "todo"].includes(b.type)) lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function pageToMarkdown(page) {
  const title = page.title ? `# ${page.title}\n\n` : "";
  return title + blocksToMarkdown(page.blocks);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function mdInline(s) {
  let out = esc(s);
  out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  out = out.replace(/~~(.+?)~~/g, "<s>$1</s>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/==(.+?)==/g, "<mark>$1</mark>");
  return out;
}

/* Markdown → blocos (para importação e saída da IA) */
export function markdownToBlocks(md = "") {
  const blocks = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      blocks.push(makeBlock("code", buf.join("\n"), { lang }));
      continue;
    }
    let m;
    if ((m = trimmed.match(/^(#{1,4})\s+(.*)/))) blocks.push(makeBlock("h" + m[1].length, mdInline(m[2])));
    else if (/^(-{3,}|\*{3,})$/.test(trimmed)) blocks.push(makeBlock("divider", ""));
    else if ((m = trimmed.match(/^[-*]\s+\[( |x|X)\]\s+(.*)/))) blocks.push(makeBlock("todo", mdInline(m[2]), { checked: m[1].toLowerCase() === "x" }));
    else if ((m = trimmed.match(/^[-*]\s+(.*)/))) blocks.push(makeBlock("bulleted", mdInline(m[1])));
    else if ((m = trimmed.match(/^\d+[.)]\s+(.*)/))) blocks.push(makeBlock("numbered", mdInline(m[1])));
    else if ((m = trimmed.match(/^>\s?(.*)/))) blocks.push(makeBlock("quote", mdInline(m[1])));
    else blocks.push(makeBlock("p", mdInline(trimmed)));
    i++;
  }
  return blocks.length ? blocks : [makeBlock()];
}

/* ═══════════ Export HTML autocontido ═══════════
   Gera um .html que abre em qualquer navegador sem depender do NEXUS:
   estilos embutidos, nenhuma requisição externa. */
export function pageToHtml(page) {
  const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const renderBlocks = (blocks = []) => {
    let out = "";
    let listBuf = null; // acumula <li> para fechar ul/ol corretamente
    const flush = () => { if (listBuf) { out += `<${listBuf.tag}>${listBuf.items}</${listBuf.tag}>\n`; listBuf = null; } };
    const push = (tag, item) => {
      if (listBuf && listBuf.tag !== tag) flush();
      if (!listBuf) listBuf = { tag, items: "" };
      listBuf.items += item;
    };

    for (const b of blocks) {
      const c = b.content || "";
      switch (b.type) {
        case "h1": flush(); out += `<h1>${c}</h1>\n`; break;
        case "h2": flush(); out += `<h2>${c}</h2>\n`; break;
        case "h3": case "h4": flush(); out += `<h3>${c}</h3>\n`; break;
        case "bulleted": push("ul", `<li>${c}</li>`); break;
        case "numbered": push("ol", `<li>${c}</li>`); break;
        case "todo": push("ul", `<li class="todo">${b.props?.checked ? "☑" : "☐"} <span${b.props?.checked ? ' class="done"' : ""}>${c}</span></li>`); break;
        case "quote": flush(); out += `<blockquote>${c}</blockquote>\n`; break;
        case "callout": flush(); out += `<div class="callout"><span>${esc(b.props?.icon || "💡")}</span><div>${c}</div></div>\n`; break;
        case "code": flush(); out += `<pre><code>${esc(b.content || "")}</code></pre>\n`; break;
        case "divider": flush(); out += "<hr>\n"; break;
        case "image": flush(); if (b.props?.src) out += `<img src="${esc(b.props.src)}" alt="">\n`; break;
        case "equation": flush(); out += `<pre class="eq">${esc(b.props?.latex || "")}</pre>\n`; break;
        case "toggle":
          flush();
          out += `<details open><summary>${c}</summary>${renderBlocks(b.children || [])}</details>\n`;
          break;
        case "columns":
          flush();
          out += `<div class="cols">${(b.children || []).map((col) => `<div>${renderBlocks(col.children || [])}</div>`).join("")}</div>\n`;
          break;
        case "table": {
          flush();
          const rows = b.props?.data || [];
          if (rows.length) {
            out += "<table>" + rows.map((r, i) =>
              "<tr>" + r.map((cell) => (i === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`)).join("") + "</tr>").join("") + "</table>\n";
          }
          break;
        }
        default:
          flush();
          if (c.trim()) out += `<p>${c}</p>\n`;
      }
      // comentários viram notas ao pé do bloco, para o documento não perder contexto
      const notes = (b.props?.comments || []).filter((x) => !x.resolved);
      if (notes.length) {
        flush();
        out += `<div class="notes">${notes.map((n) => `<div>💬 ${esc(n.text)}</div>`).join("")}</div>\n`;
      }
    }
    flush();
    return out;
  };

  const title = esc(page.title || "Sem título");
  const tags = (page.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join(" ");

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px;
         font: 16px/1.7 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         color: #26251f; background: #f7f7f5; }
  @media (prefers-color-scheme: dark) { body { color: #eae8e3; background: #17171b; } }
  h1 { font-size: 2.1rem; letter-spacing: -.02em; margin: 0 0 4px; }
  h2 { font-size: 1.4rem; margin: 2em 0 .5em; }
  h3 { font-size: 1.15rem; margin: 1.6em 0 .4em; }
  p { margin: 0 0 1em; }
  ul, ol { padding-left: 1.4em; }
  li.todo { list-style: none; margin-left: -1.4em; }
  li.todo .done { opacity: .55; text-decoration: line-through; }
  blockquote { border-left: 3px solid currentColor; margin: 1em 0; padding-left: 1em; opacity: .8; font-style: italic; }
  pre { background: rgba(128,128,128,.12); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .9em; }
  hr { border: none; border-top: 1px solid rgba(128,128,128,.3); margin: 2em 0; }
  img { max-width: 100%; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid rgba(128,128,128,.3); padding: 6px 10px; text-align: left; }
  th { background: rgba(128,128,128,.1); }
  .callout { display: flex; gap: 10px; background: rgba(128,128,128,.1); border-radius: 8px; padding: 12px 14px; margin: 1em 0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .meta { color: rgba(128,128,128,.9); font-size: .82rem; margin-bottom: 2em; }
  .tag { font-size: .78rem; opacity: .75; }
  .notes { border-left: 2px dashed rgba(128,128,128,.5); margin: .5em 0 1em; padding-left: 10px; font-size: .85rem; opacity: .75; }
  .eq { font-family: ui-monospace, monospace; }
  @media (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
</style>
</head><body>
${page.cover ? `<img src="${esc(page.cover)}" alt="" style="width:100%;height:180px;object-fit:cover;margin-bottom:20px">\n` : ""}
<h1>${page.icon ? esc(page.icon) + " " : ""}${title}</h1>
<div class="meta">${new Date(page.updatedAt).toLocaleString("pt-BR")}${tags ? " · " + tags : ""}</div>
${renderBlocks(page.blocks || [])}
</body></html>`;
}
