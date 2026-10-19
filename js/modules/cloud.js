// ═══════════════ NEXUS · Nuvem ═══════════════
// Tela única para deixar o workspace acessível de qualquer lugar: assistente
// de configuração com verificação passo a passo, status do que já está no ar,
// diagnóstico quando algo não funciona e o endereço para abrir em outro
// aparelho. O app continua local-first — isto aqui é opcional do começo ao fim.

import { getSetting, workspaceStats } from "../core/store.js";
import { bus } from "../core/bus.js";
import { h, fmtRelative } from "../core/utils.js";
import { toast, confirmDialog } from "../core/ui.js";
import * as sync from "../core/sync.js";

let state = null;

export default {
  async mount(container) {
    state = { container, busy: false, diag: null, offs: [] };
    state.offs.push(bus.on("sync:status", () => { if (state) render(); }));
    render();
  },
  unmount() {
    state?.offs.forEach((off) => { try { off?.(); } catch {} });
    state = null;
  },
};

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

function render() {
  if (!state) return;
  const { container } = state;
  container.innerHTML = "";
  const st = sync.syncState();
  const wrap = h("div", { class: "page-container cloud-page" });

  wrap.appendChild(h("div", { class: "cloud-head" },
    h("h1", { class: "home-greeting" }, "Nuvem"),
    h("p", { class: "cloud-sub" }, "Use o NEXUS de qualquer aparelho, com os seus dados cifrados antes de sair daqui.")));

  wrap.appendChild(statusCard(st));

  if (!st.configured) wrap.appendChild(wizard());
  else if (st.status === "off") wrap.appendChild(accountCard());
  else if (st.status === "locked") wrap.appendChild(unlockCard(st));
  else wrap.appendChild(connectedCard(st));

  if (st.configured) wrap.appendChild(diagnosticsCard());
  wrap.appendChild(reachCard());
  wrap.appendChild(privacyCard());

  container.appendChild(wrap);
}

/* ═══════════ status ═══════════ */
function statusCard(st) {
  const map = {
    off: st.configured ? ["Projeto pronto — falta entrar na conta", "warn"] : ["Somente neste aparelho", "local"],
    ready: ["No ar e sincronizado", "ok"],
    syncing: ["Sincronizando…", "sync"],
    locked: ["Bloqueado — informe a senha", "warn"],
    error: ["Erro na última sincronização", "err"],
  };
  const [label, tone] = map[st.status] || ["Desconhecido", "local"];

  const s = workspaceStats();
  return h("section", { class: "cloud-status card tone-" + tone },
    h("div", { class: "cs-main" },
      h("span", { class: "cs-dot" }),
      h("div", {},
        h("div", { class: "cs-label" }, label),
        h("div", { class: "cs-meta" },
          st.user ? st.user.email + " · " : "",
          `este aparelho: ${st.device}`,
          st.lastSyncAt ? ` · última sincronização ${fmtRelative(st.lastSyncAt)}` : "",
          st.remoteDevice ? ` · última alteração veio de ${st.remoteDevice}` : ""))),
    h("div", { class: "cs-stats" },
      h("span", {}, plural(s.pages, "página", "páginas")),
      h("span", {}, plural(s.databases, "database", "databases")),
      h("span", {}, plural(s.rows, "linha", "linhas"))));
}

/* ═══════════ assistente de configuração ═══════════ */
function wizard() {
  const box = h("section", { class: "card cloud-wizard" });
  box.appendChild(h("h2", {}, "Ligar a nuvem em 3 passos"));
  box.appendChild(h("p", { class: "cloud-lead" },
    "A nuvem é ", h("strong", {}, "sua"), ": um projeto gratuito do Supabase, criado na sua conta. ",
    "O NEXUS cifra tudo aqui no aparelho (AES-256) antes de enviar — o servidor guarda texto embaralhado, que nem você consegue ler pelo painel dele."));

  /* passo 1 */
  box.appendChild(step(1, "Crie o projeto gratuito",
    h("div", {},
      h("p", { class: "cloud-step-text" }, "Leva ~2 minutos. Guarde a senha do banco que ele pedir (não é a senha do NEXUS)."),
      h("a", { class: "btn primary", href: "https://supabase.com/dashboard/new", target: "_blank", rel: "noopener noreferrer" }, "Criar projeto no Supabase ↗"))));

  /* passo 2 */
  const sqlBox = h("pre", { class: "cloud-sql" }, h("code", {}, sync.SETUP_SQL));
  box.appendChild(step(2, "Crie a tabela cifrada",
    h("div", {},
      h("p", { class: "cloud-step-text" }, "No projeto: SQL Editor → New query, cole e clique em Run. Isso cria a tabela e a trava por usuário (RLS)."),
      sqlBox,
      h("button", { class: "btn ghost", onclick: async () => {
        try { await navigator.clipboard.writeText(sync.SETUP_SQL); toast("SQL copiado ✓"); }
        catch { toast("Selecione o texto e copie manualmente", { type: "warn" }); }
      } }, "⧉ Copiar SQL"))));

  /* passo 3 */
  const url = h("input", { class: "input", placeholder: "https://xxxx.supabase.co", value: getSetting("supabaseUrl", ""), spellcheck: "false" });
  const key = h("input", { class: "input", placeholder: "chave anon public", value: getSetting("supabaseKey", ""), spellcheck: "false" });
  const msg = h("div", { class: "cloud-msg" });
  const save = h("button", { class: "btn primary" }, "Verificar e salvar");
  save.onclick = async () => {
    const u = url.value.trim().replace(/\/+$/, ""), k = key.value.trim();
    if (!validProjectUrl(u)) {
      msg.className = "cloud-msg err";
      msg.textContent = "Endereço inválido. Use a Project URL do Supabase (https://xxxx.supabase.co) — ou o endereço do seu Supabase próprio.";
      return;
    }
    if (!k) { msg.className = "cloud-msg err"; msg.textContent = "Cole a chave anon public."; return; }
    save.disabled = true;
    msg.className = "cloud-msg";
    msg.textContent = "Verificando o projeto…";
    sync.saveConfig(u, k);
    const d = await sync.diagnose();
    save.disabled = false;
    const tabela = d.steps.find((x) => x.name === "Tabela de sincronização");
    const api = d.steps.find((x) => x.name === "API do projeto responde");
    if (api && !api.ok) { msg.className = "cloud-msg err"; msg.textContent = `${api.detail} — ${api.fix}`; return; }
    if (tabela && !tabela.ok) { msg.className = "cloud-msg err"; msg.textContent = `${tabela.detail} — ${tabela.fix}`; return; }
    toast("Projeto verificado ✓ Agora crie a sua conta");
    bus.emit("sync:status", sync.syncState());
  };

  box.appendChild(step(3, "Conecte o NEXUS ao projeto",
    h("div", {},
      h("p", { class: "cloud-step-text" }, "No projeto: Project Settings → API. Copie a Project URL e a chave anon public."),
      row("URL do projeto", url), row("Chave anon public", key),
      h("div", { class: "btn-row" }, save), msg)));
  return box;
}

/* Aceita o Supabase hospedado, um Supabase próprio em domínio seu e, só em
   localhost, http:// — fora disso a criptografia do navegador nem roda. */
export function validProjectUrl(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol === "https:") return !!url.hostname && url.hostname.includes(".");
  if (url.protocol === "http:") return ["localhost", "127.0.0.1"].includes(url.hostname);
  return false;
}

const step = (n, title, body) =>
  h("div", { class: "cloud-step" },
    h("div", { class: "cst-n" }, String(n)),
    h("div", { class: "cst-body" }, h("div", { class: "cst-title" }, title), body));

const row = (label, control) =>
  h("label", { class: "settings-row" }, h("span", { class: "settings-label" }, label), control);

/* ═══════════ conta ═══════════ */
function accountCard() {
  const box = h("section", { class: "card cloud-account" });
  box.appendChild(h("h2", {}, "Sua conta"));
  box.appendChild(h("p", { class: "cloud-lead" },
    "Use o ", h("strong", {}, "mesmo e-mail e a mesma senha"), " em cada aparelho — é a senha que decifra os seus dados. ",
    "Se você esquecê-la, nem o Supabase consegue recuperar o conteúdo: ele só tem o texto cifrado."));

  const email = h("input", { class: "input", type: "email", placeholder: "seu@email.com", autocomplete: "username" });
  const pass = h("input", { class: "input", type: "password", placeholder: "senha (mín. 6 caracteres)", autocomplete: "current-password" });
  const msg = h("div", { class: "cloud-msg" });
  const entrar = h("button", { class: "btn primary" }, "Entrar");
  const criar = h("button", { class: "btn" }, "Criar conta");

  const run = (fn, label) => async () => {
    msg.className = "cloud-msg";
    if (!email.value.trim() || pass.value.length < 6) { msg.className = "cloud-msg err"; msg.textContent = "E-mail e senha de pelo menos 6 caracteres."; return; }
    entrar.disabled = criar.disabled = true;
    msg.textContent = "Conectando…";
    try {
      await fn(email.value.trim(), pass.value);
      toast(label + " ✓");
      bus.emit("sync:status", sync.syncState());
    } catch (e) {
      msg.className = "cloud-msg err";
      msg.textContent = friendlyAuth(String(e?.message || e));
    } finally {
      entrar.disabled = criar.disabled = false;
    }
  };
  entrar.onclick = run(sync.signIn, "Conectado");
  criar.onclick = run(sync.signUp, "Conta criada");

  box.append(row("E-mail", email), row("Senha", pass), msg,
    h("div", { class: "btn-row" }, entrar, criar),
    h("div", { style: "margin-top:10px" },
      h("button", { class: "btn ghost sm", onclick: () => { sync.saveConfig("", ""); bus.emit("sync:status", sync.syncState()); } }, "Trocar de projeto")));
  return box;
}

function friendlyAuth(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha não conferem. Se é o primeiro aparelho, use “Criar conta”.";
  if (/user already registered/i.test(msg)) return "Esse e-mail já tem conta — use “Entrar”.";
  if (/email.*confirm/i.test(msg)) return "Confirme o e-mail que o Supabase enviou (ou desligue a confirmação em Authentication → Providers).";
  if (/password/i.test(msg) && /least/i.test(msg)) return "A senha precisa de pelo menos 6 caracteres.";
  if (/failed to fetch|networkerror/i.test(msg)) return "Não consegui falar com o projeto. Veja o diagnóstico abaixo.";
  return msg;
}

function unlockCard(st) {
  const box = h("section", { class: "card" });
  box.appendChild(h("h2", {}, "Desbloquear"));
  box.appendChild(h("p", { class: "cloud-lead" },
    `Sessão de ${st.user?.email}. A senha não fica guardada: ela é a chave que decifra os dados, então entra de novo a cada vez que o app abre.`));
  const pass = h("input", { class: "input", type: "password", placeholder: "sua senha", autocomplete: "current-password" });
  const msg = h("div", { class: "cloud-msg" });
  const go = h("button", { class: "btn primary" }, "Desbloquear e sincronizar");
  go.onclick = async () => {
    go.disabled = true; msg.className = "cloud-msg"; msg.textContent = "Decifrando…";
    try { await sync.unlock(pass.value); toast("Desbloqueado ✓"); bus.emit("sync:status", sync.syncState()); }
    catch (e) { msg.className = "cloud-msg err"; msg.textContent = String(e.message || e); }
    finally { go.disabled = false; }
  };
  pass.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
  box.append(row("Senha", pass), msg, h("div", { class: "btn-row" }, go,
    h("button", { class: "btn ghost", onclick: () => sync.signOut() }, "Sair")));
  return box;
}

function connectedCard(st) {
  const box = h("section", { class: "card" });
  box.appendChild(h("h2", {}, "Tudo no ar"));
  box.appendChild(h("p", { class: "cloud-lead" },
    "Mudanças sobem sozinhas alguns segundos depois de você escrever, e descem a cada 45 segundos (ou quando você volta para a aba). ",
    "Conflito entre aparelhos é resolvido item a item: ", h("strong", {}, "a versão mais recente vence"), "."));

  const sincronizar = h("button", { class: "btn primary" }, "⟳ Sincronizar agora");
  sincronizar.onclick = async () => {
    sincronizar.disabled = true;
    try { await sync.pullNow(); await sync.pushNow({ force: true }); toast("Sincronizado ✓"); }
    catch (e) { toast(String(e.message || e), { type: "danger" }); }
    finally { sincronizar.disabled = false; render(); }
  };

  const baixar = h("button", { class: "btn" }, "⬇ Baixar da nuvem");
  baixar.onclick = async () => {
    baixar.disabled = true;
    try { await sync.pullNow(); toast("Baixado ✓"); }
    catch (e) { toast(String(e.message || e), { type: "danger" }); }
    finally { baixar.disabled = false; render(); }
  };

  const sair = h("button", { class: "btn ghost" }, "Sair deste aparelho");
  sair.onclick = async () => {
    const ok = await confirmDialog({
      title: "Sair da conta neste aparelho?",
      message: "Os dados continuam aqui e continuam na nuvem. Só esta sessão é encerrada — para voltar, entre de novo com o mesmo e-mail e senha.",
      confirmText: "Sair",
    });
    if (!ok) return;
    await sync.signOut();
    toast("Sessão encerrada");
    render();
  };

  box.appendChild(h("div", { class: "btn-row" }, sincronizar, baixar, sair));
  return box;
}

/* ═══════════ diagnóstico ═══════════ */
function diagnosticsCard() {
  const box = h("section", { class: "card cloud-diag" });
  box.appendChild(h("h2", {}, "Diagnóstico"));
  box.appendChild(h("p", { class: "cloud-lead" }, "Checa o caminho inteiro e diz o que fazer em cada ponto que falhar."));

  const list = h("div", { class: "diag-list" });
  if (state.diag) {
    state.diag.steps.forEach((s) => list.appendChild(h("div", { class: "diag-row " + (s.ok ? "ok" : "err") },
      h("span", { class: "diag-icon" }, s.ok ? "✓" : "✗"),
      h("div", { class: "diag-body" },
        h("div", { class: "diag-name" }, s.name, h("span", { class: "diag-detail" }, s.detail ? " — " + s.detail : "")),
        !s.ok && s.fix ? h("div", { class: "diag-fix" }, s.fix) : null))));
  }

  const run = h("button", { class: "btn" }, "Testar tudo");
  run.onclick = async () => {
    run.disabled = true; run.textContent = "Testando…";
    state.diag = await sync.diagnose();
    run.disabled = false; run.textContent = "Testar tudo";
    render();
  };
  box.append(h("div", { class: "btn-row" }, run), list);
  return box;
}

/* ═══════════ abrir em outro aparelho ═══════════ */
function reachCard() {
  const url = appUrl();
  const box = h("section", { class: "card cloud-reach" });
  box.appendChild(h("h2", {}, "Abrir em outro aparelho"));
  box.appendChild(h("p", { class: "cloud-lead" },
    "O NEXUS é um site: abra este endereço no celular ou em outro computador, entre com o mesmo e-mail e senha, e o workspace aparece lá."));
  const field = h("div", { class: "cloud-url" }, h("code", {}, url),
    h("button", { class: "btn ghost sm", onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast("Endereço copiado ✓"); }
      catch { toast("Copie da barra de endereço", { type: "warn" }); }
    } }, "⧉ Copiar"));
  box.appendChild(field);
  box.appendChild(h("ul", { class: "cloud-tips" },
    h("li", {}, h("strong", {}, "Instalar como app:"), " no celular, menu do navegador → “Adicionar à tela inicial”. No computador, o ícone de instalar na barra de endereço. Fica igual a um aplicativo, com ícone próprio e funcionando offline."),
    h("li", {}, h("strong", {}, "Sem internet:"), " o app abre e funciona normalmente com o que já está no aparelho; ao voltar a rede, ele sincroniza sozinho."),
    h("li", {}, h("strong", {}, "Assistente de IA:"), " o gateway roda na sua máquina, então ele só funciona nos aparelhos que alcançam esse endereço.")));
  return box;
}

/* ═══════════ privacidade ═══════════ */
function privacyCard() {
  const box = h("section", { class: "card cloud-privacy" });
  box.appendChild(h("h2", {}, "O que sobe e o que não sobe"));
  const yes = h("ul", { class: "cloud-list yes" },
    h("li", {}, "Páginas, databases, lixeira e preferências — tudo cifrado com a sua senha antes de sair daqui"),
    h("li", {}, "Blocos de tempo, metas, sessões do cronômetro e hábitos"),
    h("li", {}, "A identificação do aparelho que fez a última alteração (para você saber de onde veio)"));
  const no = h("ul", { class: "cloud-list no" },
    h("li", {}, "A sua senha — ela nunca é enviada; a chave de criptografia é derivada dela aqui no aparelho"),
    h("li", {}, "A senha da equipe (espaço de time) — fica só neste aparelho, nem cifrada ela viaja"),
    h("li", {}, "O cronômetro em andamento e o estado da barra lateral — são coisas deste aparelho"));
  box.append(h("h3", { class: "cloud-sub-title" }, "Vai para a nuvem"), yes,
    h("h3", { class: "cloud-sub-title" }, "Nunca sai daqui"), no);
  box.appendChild(h("p", { class: "settings-hint", style: "margin-top:10px" },
    "Prefere não usar nuvem nenhuma? Configurações → Dados & backup exporta tudo num arquivo JSON, e o botão de importar traz de volta em qualquer aparelho."));
  return box;
}
