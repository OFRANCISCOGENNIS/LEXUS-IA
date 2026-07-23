// ═══════════════ NEXUS · Galeria de templates ═══════════════

import { createPage, createDatabase, makeBlock, makeRow, makeDatabase } from "../core/store.js";
import { navigate } from "../core/router.js";
import { h, uid, todayKey } from "../core/utils.js";
import { toast } from "../core/ui.js";

const hoje = () => new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
const semana = () => {
  const d = new Date();
  const start = new Date(d); start.setDate(d.getDate() - d.getDay() + 1);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const f = (x) => x.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
  return `${f(start)} – ${f(end)}`;
};

/* preview: mini-mockup em CSS (linhas estilizadas) */
const PREVIEWS = {
  doc: ["t", "l", "l", "s", "l", "l"],
  meeting: ["t", "s", "c", "c", "c", "l"],
  board: ["cols"],
  table: ["table"],
  goals: ["t", "bar", "l", "bar", "l"],
};

const PAGE_TEMPLATES = [
  {
    id: "meeting", icon: "🗓", name: "Ata de reunião", desc: "Pauta, decisões e ações", preview: "meeting",
    make: () => createPage({
      title: `Reunião — ${hoje()}`, icon: "🗓",
      blocks: [
        makeBlock("h2", "Participantes"), makeBlock("bulleted", ""),
        makeBlock("h2", "Pauta"), makeBlock("numbered", ""),
        makeBlock("h2", "Decisões"), makeBlock("callout", "", { icon: "✅", color: "ok" }),
        makeBlock("h2", "Itens de ação"), makeBlock("todo", ""), makeBlock("todo", ""),
      ],
    }),
  },
  {
    id: "project", icon: "🎯", name: "Plano de projeto", desc: "Objetivo, escopo, marcos e riscos", preview: "doc",
    make: () => createPage({
      title: "Plano de projeto", icon: "🎯",
      blocks: [
        makeBlock("callout", "<b>Objetivo:</b> descreva em uma frase o resultado esperado.", { icon: "🎯", color: "accent" }),
        makeBlock("h2", "Escopo"), makeBlock("bulleted", "Dentro do escopo"), makeBlock("bulleted", "Fora do escopo"),
        makeBlock("h2", "Marcos"), makeBlock("todo", "Kickoff"), makeBlock("todo", "Entrega v1"),
        makeBlock("h2", "Riscos"), makeBlock("quote", "O que pode dar errado — e o plano B."),
      ],
    }),
  },
  {
    id: "blog", icon: "✍", name: "Post de blog", desc: "Estrutura de artigo com gancho e CTA", preview: "doc",
    make: () => createPage({
      title: "Rascunho de post", icon: "✍",
      blocks: [
        makeBlock("h1", "Título chamativo aqui"),
        makeBlock("quote", "Gancho: por que o leitor deveria se importar?"),
        makeBlock("h2", "O problema"), makeBlock("p", ""),
        makeBlock("h2", "A solução"), makeBlock("p", ""),
        makeBlock("h2", "Conclusão + CTA"), makeBlock("p", ""),
      ],
    }),
  },
  {
    id: "book", icon: "📚", name: "Notas de livro", desc: "Resumo, ideias e citações", preview: "doc",
    make: () => createPage({
      title: "Notas — [Título do livro]", icon: "📚",
      blocks: [
        makeBlock("callout", "<b>Autor:</b> · <b>Ano:</b> · <b>Nota:</b> ★★★★☆", { icon: "📚" }),
        makeBlock("h2", "Resumo em 3 frases"), makeBlock("p", ""),
        makeBlock("h2", "Principais ideias"), makeBlock("bulleted", ""),
        makeBlock("h2", "Citações favoritas"), makeBlock("quote", ""),
        makeBlock("h2", "Como vou aplicar"), makeBlock("todo", ""),
      ],
    }),
  },
  {
    id: "weekly", icon: "🔄", name: "Revisão semanal", desc: "Vitórias, aprendizados e próxima semana", preview: "goals",
    make: () => createPage({
      title: `Revisão semanal · ${semana()}`, icon: "🔄",
      blocks: [
        makeBlock("h2", "✅ Vitórias da semana"), makeBlock("bulleted", ""),
        makeBlock("h2", "📖 Aprendizados"), makeBlock("bulleted", ""),
        makeBlock("h2", "🚧 O que travou"), makeBlock("bulleted", ""),
        makeBlock("h2", "🎯 Foco da próxima semana"), makeBlock("todo", ""), makeBlock("todo", ""), makeBlock("todo", ""),
      ],
    }),
  },
  {
    id: "brainstorm", icon: "💡", name: "Brainstorm", desc: "Divergir, agrupar, decidir", preview: "doc",
    make: () => createPage({
      title: "Brainstorm", icon: "💡",
      blocks: [
        makeBlock("callout", "Regra: sem julgamento na fase de ideias. Quantidade > qualidade.", { icon: "💡", color: "warn" }),
        makeBlock("h2", "Ideias brutas"), makeBlock("bulleted", ""), makeBlock("bulleted", ""), makeBlock("bulleted", ""),
        makeBlock("h2", "Top 3"), makeBlock("numbered", ""),
        makeBlock("h2", "Próximo passo"), makeBlock("todo", ""),
      ],
    }),
  },
];

const DB_TEMPLATES = [
  {
    id: "tasks", icon: "✅", name: "Rastreador de tarefas", desc: "Kanban com prioridade e prazo", preview: "board",
    make: () => {
      const d = makeDatabase({ name: "Tarefas", icon: "✅" });
      const st = d.properties[1], pr = d.properties[2];
      d.rows = [
        makeRow(d, { title: "Primeira tarefa", [st.id]: st.options[0].id, [pr.id]: pr.options[0].id }),
        makeRow(d, { title: "Tarefa em andamento", [st.id]: st.options[1].id, [pr.id]: pr.options[1].id }),
      ];
      return persistDb(d);
    },
  },
  {
    id: "crm", icon: "🤝", name: "CRM simples", desc: "Contatos com estágio e empresa", preview: "table",
    make: () => {
      const stage = { id: uid("pr"), name: "Estágio", type: "select", options: [
        { id: uid("o"), name: "Lead", color: "gray" }, { id: uid("o"), name: "Conversando", color: "blue" },
        { id: uid("o"), name: "Proposta", color: "amber" }, { id: uid("o"), name: "Fechado", color: "green" },
      ] };
      const d = makeDatabase({
        name: "CRM", icon: "🤝",
        properties: [
          { id: "title", name: "Contato", type: "title" },
          { id: uid("pr"), name: "Empresa", type: "text" },
          stage,
          { id: uid("pr"), name: "E-mail", type: "url" },
          { id: uid("pr"), name: "Próximo contato", type: "date" },
        ],
        views: [
          { id: uid("v"), name: "Tabela", type: "table", filters: [], sorts: [], groupBy: null },
          { id: uid("v"), name: "Pipeline", type: "kanban", filters: [], sorts: [], groupBy: stage.id },
        ],
      });
      d.rows = [makeRow(d, { title: "Ana Silva", [d.properties[1].id]: "Acme Ltda", [stage.id]: stage.options[0].id })];
      return persistDb(d);
    },
  },
  {
    id: "habits", icon: "🔁", name: "Rastreador de hábitos", desc: "Checklist diário de hábitos", preview: "table",
    make: () => {
      const props = [
        { id: "title", name: "Hábito", type: "title" },
        { id: uid("pr"), name: "Hoje", type: "checkbox" },
        { id: uid("pr"), name: "Meta semanal", type: "number" },
        { id: uid("pr"), name: "Categoria", type: "select", options: [
          { id: uid("o"), name: "Saúde", color: "green" }, { id: uid("o"), name: "Mente", color: "purple" },
          { id: uid("o"), name: "Trabalho", color: "blue" },
        ] },
      ];
      const d = makeDatabase({
        name: "Hábitos", icon: "🔁", properties: props,
        views: [{ id: uid("v"), name: "Tabela", type: "table", filters: [], sorts: [], groupBy: null }],
      });
      const cat = props[3];
      d.rows = [
        makeRow(d, { title: "Exercício 30min", [props[1].id]: false, [props[2].id]: 5, [cat.id]: cat.options[0].id }),
        makeRow(d, { title: "Ler 20 páginas", [props[1].id]: false, [props[2].id]: 7, [cat.id]: cat.options[1].id }),
        makeRow(d, { title: "Journaling", [props[1].id]: false, [props[2].id]: 7, [cat.id]: cat.options[1].id }),
      ];
      return persistDb(d);
    },
  },
  {
    id: "content", icon: "🎬", name: "Pipeline de conteúdo", desc: "Do rascunho à publicação", preview: "board",
    make: () => {
      const st = { id: uid("pr"), name: "Fase", type: "select", options: [
        { id: uid("o"), name: "Ideia", color: "gray" }, { id: uid("o"), name: "Rascunho", color: "amber" },
        { id: uid("o"), name: "Revisão", color: "blue" }, { id: uid("o"), name: "Publicado", color: "green" },
      ] };
      const d = makeDatabase({
        name: "Conteúdo", icon: "🎬",
        properties: [
          { id: "title", name: "Título", type: "title" },
          st,
          { id: uid("pr"), name: "Canal", type: "select", options: [
            { id: uid("o"), name: "Blog", color: "purple" }, { id: uid("o"), name: "Vídeo", color: "red" },
            { id: uid("o"), name: "Newsletter", color: "blue" },
          ] },
          { id: uid("pr"), name: "Publicar em", type: "date" },
        ],
        views: [
          { id: uid("v"), name: "Pipeline", type: "kanban", filters: [], sorts: [], groupBy: st.id },
          { id: uid("v"), name: "Tabela", type: "table", filters: [], sorts: [], groupBy: null },
        ],
      });
      d.rows = [makeRow(d, { title: "Minha primeira ideia", [st.id]: st.options[0].id })];
      return persistDb(d);
    },
  },
];

// makeDatabase não persiste — registra via createDatabase preservando o objeto montado
function persistDb(d) {
  return createDatabase(d);
}

function previewEl(kind) {
  const p = h("div", { class: "tpl-preview" });
  const rows = PREVIEWS[kind] || PREVIEWS.doc;
  if (rows[0] === "cols") {
    const cols = h("div", { class: "tp-cols" });
    for (let c = 0; c < 3; c++) {
      const col = h("div", { class: "tp-col" });
      for (let i = 0; i < 3 - (c === 2 ? 1 : 0); i++) col.appendChild(h("div", { class: "tp-card" }));
      cols.appendChild(col);
    }
    p.appendChild(cols);
  } else if (rows[0] === "table") {
    const t = h("div", { class: "tp-table" });
    for (let i = 0; i < 12; i++) t.appendChild(h("div", { class: "tp-cell" }));
    p.appendChild(t);
  } else {
    rows.forEach((r) => p.appendChild(h("div", { class: "tp-line tp-" + r })));
  }
  return p;
}

export default {
  async mount(container) {
    const wrap = h("div", { class: "page-container" });
    wrap.appendChild(h("h1", { class: "home-greeting" }, "Templates"));
    wrap.appendChild(h("p", { class: "home-date" }, "Comece com estrutura — personalize à vontade."));

    const section = (title, tpls, isDb) => {
      wrap.appendChild(h("h2", { class: "home-section-title" }, title));
      const grid = h("div", { class: "tpl-grid" });
      tpls.forEach((t, i) => {
        grid.appendChild(h("button", {
          class: "card hoverable tpl-card", style: `animation-delay:${i * 40}ms`,
          onclick: () => {
            const created = t.make();
            toast(`Criado a partir de “${t.name}” ✓`);
            navigate(isDb ? "db" : "page", created.id);
          },
        },
          previewEl(t.preview),
          h("div", { class: "tpl-body" },
            h("div", { class: "tpl-name" }, `${t.icon} ${t.name}`),
            h("div", { class: "tpl-desc" }, t.desc)),
          h("span", { class: "btn sm tpl-use" }, "Usar")));
      });
      wrap.appendChild(grid);
    };

    section("Páginas", PAGE_TEMPLATES, false);
    section("Databases", DB_TEMPLATES, true);
    container.appendChild(wrap);
  },
  unmount() {},
};
