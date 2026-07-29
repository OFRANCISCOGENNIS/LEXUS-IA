# ◆ NEXUS — Workspace all-in-one 100% local

> **Seus dados nunca saem do dispositivo.** Sem API externa, sem API key, sem servidor,
> sem conta. Tudo roda no navegador e os dados vivem em IndexedDB local.

O NEXUS é um workspace de produtividade estilo Notion/Craft/Capacities,
100% estático e com privacidade absoluta.

## ✨ Destaques

| | |
|---|---|
| 📝 **Editor de blocos** | Slash menu (`/`), formatação inline, wiki-links `[[...]]` com backlinks, **menções `@página`/`@data`**, **database inline**, **multi-seleção de blocos** (Esc · Shift+↑↓ · ações em massa), desfazer/refazer, colunas, equações (KaTeX), embeds, modo apresentação, drag & drop com FLIP, histórico de versões com diff, sumário (TOC), capas, tags, bloco de gráfico |
| ✍ **Modo foco/máquina de escrever** | Isola o parágrafo atual, HUD com contador de palavras e meta de escrita, scroll centralizado |
| ▦ **Databases** | Views Tabela (virtualizada — dezenas de milhares de linhas), Kanban, Galeria, Lista, Calendário e **Timeline/Gantt**; propriedades select, data, número, URL, checkbox, **fórmula, relação, rollup, criado/editado em**; **sub-itens** aninhados; **templates de linha**; filtros simples e avançados (E/OU), ordenação, agrupamento, **automações locais** (gatilho → ação), export CSV |
| ✓ **Tarefas & Projetos** | Agrega prazos das databases e checklists das páginas em Hoje/Semana/Atrasadas |
| ◷ **Produtividade** | Pomodoro, hábitos com heatmap, lembretes locais |
| 🏷 **Tags & Coleções** | Tags por página, páginas de tag automáticas e coleções inteligentes |
| 🔐 **Privacidade** | Páginas privadas com PIN local, bloqueio somente-leitura, lixeira e arquivo |
| 📱 **PWA + Mobile** | Instalável, offline após primeira carga, sidebar em drawer no celular |
| ⎙ **Export** | Markdown, CSV, JSON e **PDF** (impressão limpa) |
| ◉ **Grafo de conhecimento** | Grafo força-dirigido de todas as páginas e links, com pan/zoom e destaque de vizinhança |
| ⌘K **Command palette** | Navegação, criação, comandos, busca universal com fuzzy matching |
| ☀ **Daily notes** | Journal com calendário, streak, humor do dia |
| 🎨 **Personalização** | Claro/escuro/auto, 8 cores de acento, densidade, fonte, largura de página |
| 💾 **Data ownership** | Export/import de backup JSON completo — tudo em IndexedDB no seu dispositivo |

## 🚀 Rodando

É um app 100% estático — basta servir a pasta:

```bash
npm start            # python3 -m http.server 8080
# ou qualquer servidor estático (serve, caddy, nginx…)
```

Abra `http://localhost:8080`. Não há build, bundler nem dependências para instalar.

## 🧱 Stack

HTML + CSS + JavaScript puros (ES modules, sem build step) com IndexedDB para dados.
Detalhes de arquitetura e contratos internos em [ARCHITECTURE.md](ARCHITECTURE.md).

## 🔒 Privacidade

- Nenhum `fetch` para serviços de terceiros — é uma restrição de arquitetura, não uma promessa.
- Todos os dados vivem em IndexedDB local, exportáveis a qualquer momento.
