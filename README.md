# ◆ NEXUS — Workspace all-in-one com IA 100% local

> **Seus dados nunca saem do dispositivo.** Sem API externa, sem API key, sem servidor,
> sem conta. A IA roda inteiramente no navegador (WebLLM + WebGPU) e o modelo baixa
> uma única vez — depois funciona offline.

O NEXUS é um workspace de produtividade estilo Notion/Craft/Capacities com um
diferencial estrutural: **inteligência artificial local e privada**, sem limites de
uso (o compute é seu) e integrada a todo o workspace.

## ✨ Destaques

| | |
|---|---|
| 📝 **Editor de blocos** | Slash menu (`/`), formatação inline, wiki-links `[[...]]` com backlinks, drag & drop com FLIP, histórico de versões com diff, modo foco |
| 🤖 **IA local (WebLLM)** | Assistente de escrita sobre seleção, chat com RAG do workspace com fontes clicáveis, catálogo de modelos com recomendação por hardware, streaming token a token |
| 🧹 **Zelador IA** | Higiene proativa do workspace: duplicatas, páginas órfãs, títulos vagos, conteúdo desatualizado — com ações de um clique |
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

### IA local

1. Abra **Assistente IA → Modelos** na barra lateral.
2. O NEXUS detecta seu hardware e recomenda um modelo (de SmolLM2 360M a Phi-3.5 mini).
3. O download acontece uma única vez (via WebLLM); depois disso o modelo roda offline,
   em um Web Worker, sem nunca enviar um byte do seu conteúdo para fora.

Sem WebGPU? O app continua 100% funcional — apenas os recursos de IA ficam desativados
com um aviso. WebGPU está disponível em Chrome/Edge 113+ e Safari 18+.

## 🧱 Stack

HTML + CSS + JavaScript puros (ES modules, sem build step). IndexedDB para dados,
`@mlc-ai/web-llm` carregado sob demanda para a IA. Detalhes de arquitetura e contratos
internos em [ARCHITECTURE.md](ARCHITECTURE.md).

## 🔒 Privacidade

- Nenhum `fetch` para APIs de IA de terceiros — é uma restrição de arquitetura, não uma promessa.
- Todos os dados vivem em IndexedDB local, exportáveis a qualquer momento.
- O único tráfego de rede é o download único do modelo de IA (pesos estáticos via CDN).
