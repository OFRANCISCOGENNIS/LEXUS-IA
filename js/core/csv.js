// ═══════════════ NEXUS · CSV ═══════════════
// Leitura de CSV (com aspas escapadas) e adivinhação de tipo de coluna.
// Vive no core porque é usado tanto pelo import das databases quanto pelo
// importador do Notion.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text).replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // aspas escapadas
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* adivinha o tipo da coluna pelos valores (data → número → checkbox → texto) */
export function guessType(values) {
  const vals = values.filter((v) => String(v).trim() !== "");
  if (!vals.length) return "text";
  if (vals.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()))) return "date";
  if (vals.every((v) => /^-?[\d.,]+$/.test(String(v).trim()) && !isNaN(parseFloat(String(v).replace(",", "."))))) return "number";
  if (vals.every((v) => /^(sim|não|nao|true|false|x|)$/i.test(String(v).trim()))) return "checkbox";
  return "text";
}
