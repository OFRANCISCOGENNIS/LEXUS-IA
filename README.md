# ◆ NEXUS — Workspace all-in-one 100% local

> **Seus dados nunca saem do dispositivo.** Sem API externa, sem API key, sem servidor,
> sem conta. Tudo roda no navegador e os dados vivem em IndexedDB local.

O NEXUS é um workspace de produtividade estilo Notion/Craft/Capacities,
100% estático e com privacidade absoluta.

## ✨ Destaques

| | |
|---|---|
| 📝 **Editor de blocos** | Slash menu (`/`), formatação inline, wiki-links `[[...]]` com backlinks, drag & drop com FLIP, histórico de versões com diff, modo foco |
| ▦ **Databases** | Tabela e Kanban com drag & drop, propriedades tipadas (select, data, número, URL…), filtros, ordenação, export CSV |
| ◉ **Grafo de conhecimento** | Grafo força-dirigido de todas as páginas e links, com pan/zoom e destaque de vizinhança |
| ⌘K **Command palette** | Navegação, criação, comandos, busca universal com fuzzy matching |
| ☀ **Daily notes** | Journal com calendário, streak, humor do dia |
| 🎨 **Personalização** | Claro/escuro/auto, 6 cores de acento, densidade, fonte, largura de página |
| 💾 **Data ownership** | Export/import de backup JSON completo, export Markdown e CSV — tudo em IndexedDB no seu dispositivo |

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
