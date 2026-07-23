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
