/* =====================================================================
   MPMAX — lógica
   Vai junto com mpmax.html e mpmax.css, na mesma pasta.
   Script clássico de propósito: módulo ES exigiria servidor.

   Procura por estes marcadores para navegar:
     ANEXOS            — compressão e Storage
     CAMADA 1          — adapter do Supabase (PostgREST puro)
     CAMADA 2          — Store: estado, gravação, fila de reenvio
     DERIVAÇÕES        — estado da cadência, calculado e nunca salvo
     CAMADA 3          — render das telas
     FUNIL             — precedência de estágio e drag/drop
     ALERTAS           — varredura das tarefas vencidas
     EVENTOS           — delegação única no document
   ===================================================================== */

"use strict";

/* =====================================================================
   CONFIGURAÇÃO — deixa as credenciais fixas aqui, se quiser.

   Preenchidas: o app conecta sozinho e a tela de conexão nunca aparece.
   Vazias: o app pede URL e chave na primeira abertura e guarda no
   navegador. Funciona dos dois jeitos — escolhe um.

   A chave serve nos dois formatos: a nova (sb_publishable_...) e a
   antiga (eyJ..., o JWT). Nunca a service_role: ela ignora RLS, e quem
   abrisse este arquivo teria poder total sobre o banco.

   Fixar aqui significa que a credencial anda junto com o arquivo. Se
   ele for parar num Drive, num repositório ou num pendrive emprestado,
   foi junto. Com a chave no navegador, só vaza se levarem a máquina.
   ===================================================================== */
const CONFIG = {
  url: "",   // https://xxxxxxxx.supabase.co
  key: ""    // sb_publishable_... ou eyJ...
};

/* Publicado pelo Netlify, o build escreve dist/config.js com window.__MPMAX.
   Ele vence o CONFIG acima: o site no ar usa a variável de ambiente, e o
   arquivo aberto na tua máquina continua usando o que estiver escrito aqui
   (ou a tela de conexão, se estiver vazio). Um código, três origens. */
if (typeof window !== "undefined" && window.__MPMAX){
  CONFIG.url = window.__MPMAX.url || CONFIG.url;
  CONFIG.key = window.__MPMAX.key || CONFIG.key;
}

/* =====================================================================
   O QUE TU VENDE — ajusta aqui e o app inteiro acompanha.

   Os rótulos e os critérios de qualificação ficam fora da lógica de
   propósito: trocar de empresa ou de ICP não pode exigir caçar texto
   no meio do código. Nenhum nome de produto ou de plataforma está
   cravado em outro lugar.

   valorMax: null tira o teto. exigirDecisor: false tira o critério.
   ===================================================================== */
const NEGOCIO = {
  qualTitulo:  "Reunião válida",
  valorLabel:  "Verba mensal estimada (R$)",
  valorMin:    0,
  valorMax:    null,
  segmentoLabel: "Segmento",
  segmentoDica:  "nicho, tipo de operação, origem",
  fitLabel:    "Tem fit com o que a gente vende",
  exigirDecisor: true
};
/* =========================================================================
   MPMAX — CRM de pré-venda outbound, arquivo único.

   Arquitetura em três camadas, de baixo pra cima:
     1. Adapters  — falam com um meio de persistência. Dois: local e supabase.
     2. Store     — guarda o estado em memória e manda o adapter persistir.
     3. Render    — funções puras que leem o estado e cospem HTML.

   Por que adapter e não chamar localStorage/fetch espalhado pelo código:
   o resto do app nunca sabe onde o dado mora. Trocar de banco é trocar um
   objeto, não caçar chamada em 800 linhas.
   ========================================================================= */

/* ---------- utilidades de data ----------
   Tudo em string "YYYY-MM-DD" e parse manual. Se usar new Date("2026-10-15")
   o JS interpreta como UTC e no fuso de Brasília volta um dia. Erro clássico. */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const parseISO = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, m-1, d); };
const addDays = (iso, n) => {
  const d = parseISO(iso); d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const daysBetween = (a,b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const fmtDate = iso => { if(!iso) return "—"; const d = parseISO(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`; };
const fmtDateFull = iso => { if(!iso) return "—"; const d = parseISO(iso); return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}); };
const fmtDateTime = dt => {
  if(!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "id-"+Date.now().toString(36)+Math.random().toString(36).slice(2,9));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const fmtBRL = n => {
  if (n === null || n === undefined || n === "" || isNaN(n)) return "—";
  return Number(n).toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
};
const fmtCNPJ = v => {
  const d = String(v||"").replace(/\D/g,"");
  if (d.length !== 14) return v || "";
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
};
const fmtFone = v => {
  const d = String(v||"").replace(/\D/g,"");
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return v || "";
};

/* ---------- ícones de canal ----------
   SVG inline: zero requisição externa, herda currentColor, escala sem borrar. */
const ICON = {
  whatsapp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20.5l1.7-5.5A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
  email:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  ligacao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v2.1a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 3.2 2 2 0 0 1 4.1 1h2.1a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.6 8.6a16 16 0 0 0 6 6l1-1a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
  pulado:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 12h12"/></svg>'
};
const CANAL_NOME = { whatsapp:"WhatsApp", email:"E-mail", ligacao:"Ligação" };
const STATUS_NOME = {
  novo:"Novo", em_cadencia:"Em cadência", conectado:"Conectado",
  decisor_envolvido:"Decisor envolvido", desqualificado:"Desqualificado",
  reuniao_agendada:"Reunião agendada", no_show:"No-show", reuniao_realizada:"Reunião realizada",
  descartado:"Descartado"   // legado: leads antigos caem na coluna de desqualificado
};

const MOTIVOS_NS = {
  esqueceu:  "Esqueceu / não viu",
  imprevisto:"Imprevisto na hora",
  desistiu:  "Perdeu interesse",
  semresp:   "Sumiu, sem resposta"
};

const MOTIVOS_DESQ = {
  icp:    "Fora do ICP",
  sem_fit:"Não tem fit",
  timing: "Não é o momento"
};
const PAPEL_NOME = { decisor:"Decisor", comercial:"Comercial", outro:"Outro" };

/* Cadência padrão. Alterna canal pra não queimar o mesmo meio sete vezes. */
const CADENCIA_PADRAO = ["ligacao","whatsapp","email","ligacao","whatsapp","email","ligacao"];
const novaCadencia = () => CADENCIA_PADRAO.map((canal, i) => ({ dia:i+1, canal, feito:false, feito_em:null }));

/* Regra de reunião válida: os três critérios juntos. */
function faixaTexto(){
  const { valorMin:a, valorMax:b } = NEGOCIO;
  if (a && b) return `entre ${fmtBRL(a)} e ${fmtBRL(b)} por mês`;
  if (b)      return `até ${fmtBRL(b)} por mês`;
  if (a)      return `a partir de ${fmtBRL(a)} por mês`;
  return "informada";
}
function qualificar(l){
  const n = Number(l.tpv);
  const temValor = l.tpv !== null && l.tpv !== undefined && l.tpv !== "" && !isNaN(n);
  const tpvOk = temValor && n >= (NEGOCIO.valorMin || 0) && (NEGOCIO.valorMax == null || n <= NEGOCIO.valorMax);
  const platOk = !!l.plataforma_integra;
  const decisorOk = !NEGOCIO.exigirDecisor || l.papel === "decisor";
  return { tpvOk, platOk, decisorOk, ok: tpvOk && platOk && decisorOk };
}

/* =========================================================================
   ANEXOS (prints de conversa)

   Um meio só: Supabase Storage, bucket privado, URL assinada por 1h.
   ========================================================================= */

/* Print de WhatsApp sai do celular com 2 a 4 MB. Reduzir pra 1400px e
   JPEG 0.75 derruba pra uns 150 KB e o texto continua legível — é print
   de tela, não foto. Sem isso, 50 prints enchem o bucket e cada abertura
   de lead baixa megabytes à toa. */
async function comprimir(file, max = 1400, q = 0.75){
  if (!file.type || !file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
    return (blob && blob.size < file.size) ? blob : file;
  } catch { return file; }
}

const Anexos = {
  async salvar(file, toqueId){
    const blob = await comprimir(file);
    const id = uid();
    /* Primeira pasta = id do dono. É o que a policy do Storage consegue
       checar: storage.foldername(name)[1] = auth.uid(). Sem isso, qualquer
       usuário logado leria o print de qualquer outro. */
    const path = `${Auth.uid()}/${toqueId}/${id}.jpg`;
    await Store.adapter.uploadFile(path, blob);
    return { id, ref: path, nome: file.name || "print.jpg", tipo: blob.type || "image/jpeg", tam: blob.size };
  },

  /* Assina o lote todo numa requisição. Um lead com 8 prints não precisa
     abrir 8 conexões. */
  async resolver(lista){
    const paths = lista.map(a => a.ref).filter(Boolean);
    if (!paths.length) return {};
    try { return await Store.adapter.signedUrls(paths); }
    catch(e){ console.warn("Falha ao assinar URLs:", e.message); return {}; }
  },

  async apagar(a){
    try { await Store.adapter.deleteFile(a.ref); }
    catch(e){ console.warn("Não apagou o anexo:", e); }
  }
};

/* =========================================================================
   CAMADA 1 — ADAPTERS
   ========================================================================= */

/* =========================================================================
   CONTRATO DO BANCO

   As colunas que o app usa, por tabela. Serve a dois propósitos:

   1. Filtro de saída. O PostgREST rejeita o registro INTEIRO se o payload
      tiver uma chave que não existe como coluna (erro PGRST204). Um campo
      novo no JS derrubava toda e qualquer gravação de lead, não só a dele.
   2. Conferência na conexão. Em vez de descobrir no meio do expediente que
      nada salva, o app compara isto com a tabela real e diz qual ALTER
      rodar.
   ========================================================================= */
const COLUNAS = {
  leads: ["id","empresa","cnpj","plataforma","plataforma_integra","contato","papel",
          "email","telefone","tpv","status","obs","cadencia_inicio","cadencia",
          "motivo_desq","obs_desq","whatsapp","instagram","site","importante",
          "motivo_ns","obs_ns","criado_em"],
  toques: ["id","lead_id","canal","data","nota","dia","anexos","criado_em"],
  tarefas:["id","lead_id","titulo","quando","feito","avisado","criado_em"]
};

const TIPO_COLUNA = {
  plataforma_integra:"boolean default false", tpv:"numeric", cadencia:"jsonb",
  cadencia_inicio:"date", anexos:"jsonb default '[]'", feito:"boolean default false",
  avisado:"boolean default false", quando:"timestamptz", data:"date", dia:"int",
  criado_em:"timestamptz default now()"
};

/* Deixa passar só o que é coluna. Chave a mais no payload derruba o
   registro todo, não o campo. */
function somenteColunas(tabela, registro){
  const ok = {};
  for (const k of COLUNAS[tabela]) if (k in registro) ok[k] = registro[k];
  return ok;
}

/* =========================================================================
   AUTENTICAÇÃO

   O ponto que resolve a pergunta "como escondo a chave": não esconde.
   Num site estático a chave anon é pública por construção — ela viaja no
   JavaScript que o navegador baixa. O que muda é o que ela permite.

   Com RLS por dono (Opção B do SQL), a chave anon sozinha não lê nem
   escreve nada: toda policy exige auth.uid(). Quem abre o site vê a tela
   de login e para aí. O que abre o banco é o token de sessão, que só sai
   do Supabase mediante e-mail e senha e expira em uma hora.
   ========================================================================= */
const Auth = {
  sess: null,
  _refreshing: null,

  carregar(){
    try { this.sess = JSON.parse(localStorage.getItem("mpmax.sess") || "null"); }
    catch { this.sess = null; }
    return this.sess;
  },
  guardar(s){
    /* expires_in vem em segundos a partir de agora; guardo o instante
       absoluto porque a aba pode ficar aberta a noite inteira. */
    this.sess = s ? { ...s, expira_em: Date.now() + (s.expires_in || 3600) * 1000 } : null;
    if (this.sess) localStorage.setItem("mpmax.sess", JSON.stringify(this.sess));
    else localStorage.removeItem("mpmax.sess");
  },
  logado(){ return !!(this.sess && this.sess.refresh_token); },
  email(){ return this.sess?.user?.email || ""; },
  uid(){ return this.sess?.user?.id || ""; },

  async entrar(url, key, email, senha){
    const r = await fetch(`${String(url).replace(/\/+$/,"")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: senha })
    });
    const d = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(d.error_description || d.msg || d.message || `Falha no login (${r.status})`);
    this.guardar(d);
    return true;
  },

  /* Uma renovação de cada vez. Sem isto, seis requisições simultâneas
     disparariam seis refresh com o mesmo refresh_token — e o Supabase
     invalida o token a cada uso, então cinco delas derrubariam a sessão. */
  async renovar(url, key){
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      const r = await fetch(`${String(url).replace(/\/+$/,"")}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: this.sess?.refresh_token })
      });
      if (!r.ok){ this.guardar(null); throw new Error("Sessão expirada. Entra de novo."); }
      this.guardar(await r.json());
      return true;
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  },

  /* Renova um minuto antes de vencer: evita a requisição que sai no
     exato segundo da virada e volta 401. */
  async token(url, key){
    if (!this.sess) return null;
    if (Date.now() > (this.sess.expira_em || 0) - 60000) {
      try { await this.renovar(url, key); } catch { return null; }
    }
    return this.sess?.access_token || null;
  },

  async sair(url, key){
    try {
      const t = this.sess?.access_token;
      if (t) await fetch(`${String(url).replace(/\/+$/,"")}/auth/v1/logout`, {
        method: "POST", headers: { apikey: key, Authorization: "Bearer " + t }
      });
    } catch {}
    this.guardar(null);
  }
};

/* Supabase sem SDK: PostgREST puro via fetch.
   Motivo: o SDK é um script de CDN de terceiro. Falando direto com o
   PostgREST, a única rede que a página abre é o projeto do próprio usuário. */
function SupabaseAdapter(url, key){
  const base = String(url).replace(/\/+$/,"") + "/rest/v1";

  /* O cabeçalho é montado por chamada, não uma vez só: o token de sessão
     vence em uma hora e um objeto congelado na criação do adapter
     continuaria mandando o token velho depois da renovação.
     A apikey continua sendo a anon — o Supabase usa ela pra rotear o
     projeto. Quem dá permissão é o Bearer. */
  async function auth(){
    const t = await Auth.token(url, key);
    return {
      apikey: key,
      Authorization: "Bearer " + (t || key),
      "Content-Type": "application/json"
    };
  }
  async function req(path, opts = {}){
    const r = await fetch(base + path, { ...opts, headers: { ...(await auth()), ...(opts.headers||{}) } });
    if (!r.ok) {
      const txt = await r.text().catch(()=> "");
      if (r.status === 401) { Auth.guardar(null); syncGate(); }
      throw new Error(`${r.status} ${r.statusText}${txt ? " — " + txt.slice(0,220) : ""}`);
    }
    return r.status === 204 ? null : r.json().catch(()=> null);
  }
  const storage = String(url).replace(/\/+$/,"") + "/storage/v1";
  const BUCKET = "mpmax";

  return {
    kind: "supabase",
    label: "Supabase",
    async ping(){ await req("/leads?select=id&limit=1"); return true; },

    /* --- Storage. Também sem SDK: três endpoints REST e acabou. --- */
    async uploadFile(path, blob){
      const r = await fetch(`${storage}/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: { ...(await auth()), "x-upsert":"true", "Content-Type": blob.type || "application/octet-stream" },
        body: blob
      });
      if (!r.ok) throw new Error(`upload ${r.status} — ${(await r.text().catch(()=>"" )).slice(0,180)}`);
      return true;
    },
    /* Uma requisição assina N caminhos. Assinar um por um faria o painel
       de um lead com 8 prints abrir 8 conexões sem motivo. */
    async signedUrls(paths, expiresIn = 3600){
      if (!paths.length) return {};
      const r = await fetch(`${storage}/object/sign/${BUCKET}`, {
        method: "POST",
        headers: { ...(await auth()) },
        body: JSON.stringify({ expiresIn, paths })
      });
      if (!r.ok) throw new Error(`sign ${r.status}`);
      const arr = await r.json();
      const out = {};
      for (const it of (arr||[])) if (it.signedURL) out[it.path] = storage + it.signedURL;
      return out;
    },
    async deleteFile(path){
      await fetch(`${storage}/object/${BUCKET}/${path}`, {
        method: "DELETE", headers: { ...(await auth()) }
      });
      return true;
    },
    async load(){
      const [leads, toques, tarefas] = await Promise.all([
        req("/leads?select=*"), req("/toques?select=*"), req("/tarefas?select=*")
      ]);
      return { leads: leads||[], toques: toques||[], tarefas: tarefas||[] };
    },
    async upsert(tabela, registro){
      // Prefer merge-duplicates = upsert pela PK. Um round-trip, sem checar antes.
      await req(`/${tabela}`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(somenteColunas(tabela, registro))
      });
      return true;
    },

    /* Pede uma linha com todas as colunas nomeadas. O PostgREST responde
       400 citando a primeira que não existe, então a busca é uma por vez
       até a tabela aceitar a lista inteira. */
    async conferirSchema(){
      const faltando = {};
      for (const [tabela, cols] of Object.entries(COLUNAS)){
        let restantes = [...cols];
        for (let i = 0; i < cols.length; i++){
          try { await req(`/${tabela}?select=${restantes.join(",")}&limit=1`); break; }
          catch(e){
            const m = /column \\?"?([a-z_]+)\\?"? does not exist|'([a-z_]+)' column/i.exec(e.message)
                   || /\b([a-z_]+)\b[^a-z_]*does not exist/i.exec(e.message);
            const col = m && (m[1] || m[2]);
            if (!col || !restantes.includes(col)) throw e;   // erro de outra natureza
            (faltando[tabela] ||= []).push(col);
            restantes = restantes.filter(c => c !== col);
          }
        }
      }
      return faltando;
    },
    async remove(tabela, id){
      await req(`/${tabela}?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Prefer: "return=minimal" }
      });
      return true;
    },
    async persist(){ return true; } // no Supabase, cada operação já persiste
  };
}

/* =========================================================================
   CAMADA 2 — STORE
   ========================================================================= */

const Store = {
  db: { leads:[], toques:[], tarefas:[] },
  adapter: null,
  estado: "nao_configurado",   // nao_configurado | ok | erro
  err: null,
  CFG: "mpmax.cfg.v1",

  /* Única coisa que ainda mora no navegador: URL e chave. Elas não têm
     onde mais morar — são o que diz ao app qual banco abrir. */
  /* A do arquivo vence a do navegador. Senão tu editaria o CONFIG, abriria
     e continuaria vendo o banco antigo — e levaria meia hora pra entender. */
  cfg(){
    if (CONFIG.url && CONFIG.key)
      return { url: CONFIG.url.trim(), key: CONFIG.key.trim(), fixo: true };
    try { return JSON.parse(localStorage.getItem(this.CFG)) || { url:"", key:"" }; }
    catch { return { url:"", key:"" }; }
  },
  setCfg(c){ localStorage.setItem(this.CFG, JSON.stringify(c)); },
  limparCfg(){ localStorage.removeItem(this.CFG); },

  async init(){
    const c = this.cfg();
    this.db = { leads:[], toques:[], tarefas:[] };
    if (!c.url || !c.key){ this.estado = "nao_configurado"; this.adapter = null; return; }

    this.adapter = SupabaseAdapter(c.url, c.key);
    try {
      this.faltando = await this.adapter.conferirSchema();
      this.db = await this.adapter.load();
      ["leads","toques","tarefas"].forEach(k => { if(!Array.isArray(this.db[k])) this.db[k] = []; });
      this.estado = "ok"; this.err = null;
    } catch(e){
      /* Sem modo local, não existe pra onde cair. Melhor dizer que está
         fora do ar do que mostrar uma tela vazia que parece dado perdido. */
      this.estado = "erro"; this.err = e.message;
      this.adapter = null;
    }
  },

  /* Fila de reenvio. Escrita que falha fica aqui, visível na barra, e o
     usuário reenvia. O silêncio é o pior desenho possível: a memória e o
     banco divergem e ninguém fica sabendo. */
  fila: [],

  /* Devolve true/false. Antes devolvia undefined e quem chamava festejava
     "Alterações salvas" mesmo quando a gravação tinha falhado. Dizer que
     salvou sem ter salvo é o pior defeito possível num CRM. */
  async put(tabela, registro){
    const arr = this.db[tabela];
    const i = arr.findIndex(x => x.id === registro.id);
    if (i >= 0) arr[i] = registro; else arr.push(registro);
    if (!this.adapter){ this.fila.push({op:"put",tabela,registro}); barraFalha("sem conexão"); return false; }
    try { await this.adapter.upsert(tabela, registro); return true; }
    catch(e){ this.fila.push({ op:"put", tabela, registro }); barraFalha(e.message); return false; }
  },

  async del(tabela, id){
    this.db[tabela] = this.db[tabela].filter(x => x.id !== id);
    if (!this.adapter){ this.fila.push({op:"del",tabela,id}); barraFalha("sem conexão"); return false; }
    try { await this.adapter.remove(tabela, id); return true; }
    catch(e){ this.fila.push({ op:"del", tabela, id }); barraFalha(e.message); return false; }
  },

  async reenviar(){
    const pend = this.fila; this.fila = [];
    for (const it of pend){
      try {
        if (it.op === "put") await this.adapter.upsert(it.tabela, it.registro);
        else await this.adapter.remove(it.tabela, it.id);
      } catch(e){ this.fila.push(it); }
    }
    if (this.fila.length) barraFalha("ainda sem resposta do Supabase");
    else { $("#falha").classList.remove("show"); toast("Tudo sincronizado."); }
    return this.fila.length === 0;
  },

  async recarregar(){
    if (!this.adapter) return false;
    this.db = await this.adapter.load();
    ["leads","toques","tarefas"].forEach(k => { if(!Array.isArray(this.db[k])) this.db[k] = []; });
    return true;
  },

  lead(id){ return this.db.leads.find(l => l.id === id); },
  toquesDo(id){ return this.db.toques.filter(t => t.lead_id === id).sort((a,b)=> (b.data||"").localeCompare(a.data||"")); },
  tarefasDo(id){ return this.db.tarefas.filter(t => t.lead_id === id); }
};

/* =========================================================================
   DERIVAÇÕES — estado da cadência
   Nada disso é armazenado. É calculado a partir de cadencia_inicio + hoje.
   Guardar estado derivado é a forma mais rápida de ter dado inconsistente.
   ========================================================================= */

function statusPasso(lead, passo){
  if (passo.feito) return "done";
  /* Terceiro estado. Pular não é fazer: se eu marcasse como feito, o
     histórico diria que tu ligou num dia em que tu não ligou. */
  if (passo.pulado) return "pulado";
  /* Só o PRÓXIMO passo pendente pode cobrar. Antes, um lead parado há duas
     semanas pintava cinco células de âmbar e a régua virava um muro de cor
     sem hierarquia — o olho não achava o que fazer agora. */
  const prox = proximoPasso(lead);
  if (!prox || passo.dia > prox.dia) return "future";
  if (!lead.cadencia_inicio) return "future";
  const prevista = addDays(lead.cadencia_inicio, passo.dia - 1);
  const diff = daysBetween(todayISO(), prevista);
  if (diff < 0) return "late";
  if (diff === 0) return "due";
  return "future";
}
function proximoPasso(lead){
  if (!Array.isArray(lead.cadencia)) return null;
  return lead.cadencia.find(p => !p.feito && !p.pulado) || null;
}
function urgencia(lead){
  // Menor = mais urgente. Atrasado fica negativo, então ordena naturalmente.
  if (["reuniao_agendada","reuniao_realizada","no_show","desqualificado","descartado"].includes(lead.status)) return 9999;
  const p = proximoPasso(lead);
  if (!p || !lead.cadencia_inicio) return 500;
  return daysBetween(todayISO(), addDays(lead.cadencia_inicio, p.dia - 1));
}
function tarefaVencida(t){ return !t.feito && t.quando && new Date(t.quando) <= new Date(); }

/* =========================================================================
   CAMADA 3 — RENDER
   ========================================================================= */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function railHTML(lead){
  if (!Array.isArray(lead.cadencia)) return "";
  return `<div class="rail-cad" data-rail="${lead.id}">` + lead.cadencia.map(p => {
    const st = statusPasso(lead, p);
    const prevista = lead.cadencia_inicio ? addDays(lead.cadencia_inicio, p.dia-1) : null;
    const sufixo = p.feito ? " · feito" : p.pulado ? " · pulado" : "";
    const title = `Dia ${p.dia} · ${CANAL_NOME[p.canal]}${prevista ? " · "+fmtDate(prevista) : ""}${sufixo}`;
    const glifo = p.feito ? ICON.check : p.pulado ? ICON.pulado : ICON[p.canal];
    return `<button class="cell ${st}" data-step="${p.dia}" data-lead="${lead.id}" title="${esc(title)}" aria-label="${esc(title)}">
      <span class="daynum">${p.dia}</span>${glifo}
    </button>`;
  }).join("") + `</div>`;
}

function iniciais(nome){
  const p = String(nome||"?").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0]||"") + (p[1]?.[0]||"")).toUpperCase() || "?";
}

function estagioHTML(lead){
  const col = colunaDo(lead);
  const nome = String(col).startsWith("t") ? "Tentativa " + col.slice(1) : (STATUS_NOME[lead.status] || "—");
  return `<span class="stage s-${esc(lead.status)}"><i></i><span>${esc(nome)}</span></span>`;
}

function ultimoToque(leadId){
  const t = Store.toquesDo(leadId)[0];
  if (!t || !t.data) return `<span class="muted">—</span>`;
  const d = daysBetween(t.data, todayISO());
  return d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
}

function leadRowHTML(lead){
  const q = qualificar(lead);
  return `<div class="lead-row" data-open="${lead.id}" tabindex="0" role="button">
    <div class="lead-main">
      <span class="avatar${lead.importante ? " imp" : ""}">${esc(iniciais(lead.empresa))}</span>
      <span class="lead-id">
        <span class="lead-name">${esc(lead.empresa || "Sem nome")}</span>
        <span class="lead-sub">${esc(lead.plataforma || fmtCNPJ(lead.cnpj) || "—")}</span>
      </span>
    </div>
    <div class="cell-txt">
      ${lead.contato ? `<strong>${esc(lead.contato)}</strong>` : `<strong class="muted">Sem contato</strong>`}
      ${lead.papel ? esc(PAPEL_NOME[lead.papel]) : ""}
    </div>
    <div>${estagioHTML(lead)}</div>
    ${railHTML(lead)}
    <div class="cell-num">
      ${lead.tpv ? esc(fmtBRL(lead.tpv)) : `<span class="muted">—</span>`}
      ${q.ok ? `<div class="lead-sub" style="color:var(--good)">qualificado</div>`
             : `<div class="lead-sub">${ultimoToque(lead.id)}</div>`}
    </div>
  </div>`;
}

const ROWS_HEAD = `<div class="rows-head">
  <div>Empresa</div><div>Contato</div><div>Estágio</div><div>Cadência</div><div class="right">Valor</div>
</div>`;

/* =========================================================================
   GRUPOS RECOLHÍVEIS

   Com dez atrasados, três de hoje e duas reuniões, a tela de Hoje passa
   de uma altura e vira rolagem. Recolher o que já foi resolvido deixa na
   frente só o que importa agora.

   O que fica recolhido é escolha da pessoa e precisa sobreviver ao
   recarregamento — senão ela recolhe toda manhã de novo. Guardo no
   navegador, não no banco: é preferência de tela, não dado de lead, e
   não faz sentido sincronizar entre máquinas.
   ========================================================================= */
const Recolhidos = {
  set: new Set(JSON.parse(localStorage.getItem("mpmax.recolhidos") || "[]")),
  tem(k){ return this.set.has(k); },
  virar(k){
    this.set.has(k) ? this.set.delete(k) : this.set.add(k);
    localStorage.setItem("mpmax.recolhidos", JSON.stringify([...this.set]));
  }
};

const CHEVRON = `<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>`;

function groupHTML(titulo, leads, chave){
  if (!leads.length) return "";
  const k = chave || titulo;
  const fechado = Recolhidos.tem(k);
  return `<div class="grp${fechado ? " fechado" : ""}">
    <button class="group-head" data-grp="${esc(k)}" aria-expanded="${!fechado}">
      ${CHEVRON}
      <h2>${esc(titulo)}</h2>
      <span class="count">${leads.length}</span>
      <span class="rule"></span>
    </button>
    <div class="grp-corpo">
      <div class="rows">${ROWS_HEAD}${leads.map(leadRowHTML).join("")}</div>
    </div>
  </div>`;
}

function renderHoje(){
  const hoje = todayISO();
  const ativos = Store.db.leads.filter(l => !["descartado","desqualificado","reuniao_realizada","no_show"].includes(l.status));

  const atrasados = [], deHoje = [], agendados = [];
  for (const l of ativos){
    if (l.status === "reuniao_agendada"){ agendados.push(l); continue; }
    const p = proximoPasso(l);
    if (!p || !l.cadencia_inicio) continue;
    const diff = daysBetween(hoje, addDays(l.cadencia_inicio, p.dia-1));
    if (diff < 0) atrasados.push(l);
    else if (diff === 0) deHoje.push(l);
  }
  atrasados.sort((a,b)=> urgencia(a)-urgencia(b));

  const tarefasHot = Store.db.tarefas.filter(tarefaVencida);

  $("#s-atrasado").textContent = atrasados.length;
  $("#s-hoje").textContent = deHoje.length;
  $("#s-tarefas").textContent = tarefasHot.length;
  $("#s-reuniao").textContent = Store.db.leads.filter(l=>l.status==="reuniao_agendada").length;

  const h = new Date().getHours();
  $("#greeting").textContent = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const total = atrasados.length + deHoje.length;
  $("#todayLine").textContent = total === 0
    ? `${fmtDateFull(hoje)} · nada vencendo na cadência`
    : `${fmtDateFull(hoje)} · ${total} ${total===1?"toque":"toques"} pra fazer`;

  let html = "";
  if (!Store.db.leads.length){
    html = `<div class="empty"><p>Nenhum lead ainda. Comece adicionando a primeira empresa que tu vai trabalhar.</p>
      <button class="btn btn-primary" data-action="new-lead">Adicionar lead</button></div>`;
  } else {
    html += groupHTML("Atrasados", atrasados, "hoje.atrasados");
    html += groupHTML("Para hoje", deHoje, "hoje.hoje");
    html += groupHTML("Reunião agendada", agendados, "hoje.agendados");
    if (!atrasados.length && !deHoje.length && !agendados.length){
      html = `<div class="empty"><p>Cadência em dia. Nada vence hoje.</p>
        <button class="btn" data-view-jump="leads">Ver todos os leads</button></div>`;
    }
  }
  $("#hojeContent").innerHTML = html;
}

/* =========================================================================
   FUNIL

   Precedência de estágio. Um lead pode ser tudo ao mesmo tempo: estar na
   tentativa 3, ter respondido e ter decisor envolvido. Se cada regra
   decidisse sozinha, o mesmo lead apareceria em três colunas e a soma das
   colunas passaria do total de leads — quadro que mente não serve pra
   bater o olho. Então o estágio é único e vence o mais avançado.
   ========================================================================= */

const ESTAGIOS = [
  { id:"conectado",         nome:"Conectados",        dica:"Respondeu" },
  { id:"decisor_envolvido", nome:"Decisor envolvido", dica:"Chegou em quem decide" },
  { id:"desqualificado",    nome:"Desqualificado",    dica:"Saiu por critério", motivo:true },
  { id:"reuniao_agendada",  nome:"Reunião agendada",  dica:"Data marcada" },
  { id:"no_show",           nome:"No-show",           dica:"Faltou ou vai remarcar" },
  { id:"reuniao_realizada", nome:"Reunião realizada", dica:"Aconteceu" }
];
const ID_ESTAGIOS = ESTAGIOS.map(e => e.id);

function colunaDo(lead){
  if (lead.status === "descartado") return "desqualificado";  // status antigo
  if (ID_ESTAGIOS.includes(lead.status)) return lead.status;
  const p = proximoPasso(lead);
  return p ? "t" + p.dia : "t7";   // cadência toda resolvida e sem resposta: fica no fim
}

/* =========================================================================
   MOVER

   Qualquer coluna para qualquer coluna. O caso delicado é a volta para a
   cadência: ao mandar um lead para a Tentativa 5, os dias 1 a 4 precisam
   de algum estado, e "feito" seria mentira. Ficam PULADOS — visual
   próprio na régua, e não contam como toque no histórico.
   ========================================================================= */
async function moverLead(lead, alvo, extra = {}){
  if (alvo.startsWith("t")){
    const n = Number(alvo.slice(1));
    for (const p of lead.cadencia){
      /* p.pulado = !p.feito, não "se não feito então pulado". A segunda
         forma nunca limpa um pulado antigo, e o dia acaba feito E pulado
         ao mesmo tempo — dois estados que se contradizem no registro. */
      if (p.dia < n) p.pulado = !p.feito;
      else { p.feito = false; p.feito_em = null; p.pulado = false; }
    }
    lead.status = "em_cadencia";
    lead.motivo_desq = null; lead.obs_desq = null;
  } else {
    lead.status = alvo;
    if (alvo === "desqualificado"){
      lead.motivo_desq = extra.motivo || null;
      lead.obs_desq = extra.obs || null;
    } else { lead.motivo_desq = null; lead.obs_desq = null; }
  }
  await Store.put("leads", lead);
  renderAll(); refreshSheet();
  toast(`${lead.empresa} → ${alvo.startsWith("t") ? "Tentativa "+alvo.slice(1) : STATUS_NOME[alvo]}`);
}

/* Quantos dias já marcados como feitos seriam apagados por essa volta.
   Confirmar só quando há o que perder; perguntar à toa treina o usuário
   a clicar OK sem ler. */
function perdaAoVoltar(lead, alvo){
  if (!alvo.startsWith("t")) return 0;
  const n = Number(alvo.slice(1));
  return lead.cadencia.filter(p => p.dia >= n && p.feito).length;
}

function pedirMotivo(lead){
  openModal(`Desqualificar ${lead.empresa || "lead"}`, `
    <div class="fields">
      <div class="field wide"><label for="dq-motivo">Motivo</label>
        <select id="dq-motivo">${Object.entries(MOTIVOS_DESQ).map(([k,v])=>
          `<option value="${k}" ${lead.motivo_desq===k?"selected":""}>${v}</option>`).join("")}</select>
      </div>
      <div class="field wide"><label for="dq-obs">Detalhe (opcional)</label>
        <textarea id="dq-obs" placeholder="Verba muito abaixo do que faz sentido pra gente.">${esc(lead.obs_desq||"")}</textarea></div>
    </div>`, async () => {
      await moverLead(lead, "desqualificado", { motivo: $("#dq-motivo").value, obs: $("#dq-obs").value.trim() });
    }, "Desqualificar");
}

/* Caminho único de movimentação: arrastar, o botão Mover e o select do
   painel passam todos por aqui, então a regra do pulado não tem como
   ficar de fora em um deles. */
async function aplicarMovimento(lead, alvo){
  if (!lead || !alvo) return;
  if (alvo === "desqualificado"){ pedirMotivo(lead); return; }
  const perda = perdaAoVoltar(lead, alvo);
  if (perda && !confirm(`Voltar para a Tentativa ${alvo.slice(1)} vai desmarcar ${perda} dia(s) já registrado(s). Os toques continuam no histórico. Seguir?`)) return;
  await moverLead(lead, alvo);
}

function cardHTML(lead){
  const q = qualificar(lead);
  const p = proximoPasso(lead);
  const esgotada = !p && !ID_ESTAGIOS.includes(lead.status);
  const atrasado = p && lead.cadencia_inicio
    && daysBetween(todayISO(), addDays(lead.cadencia_inicio, p.dia-1)) < 0;

  /* Um sinal, um lugar. A régua já mostra atraso com a célula sólida —
     repetir num chip gasta linha e some com a hierarquia. */
  const chips = [];
  if (lead.status === "desqualificado")
    chips.push(`<span class="chip out">${MOTIVOS_DESQ[lead.motivo_desq] || "Sem motivo"}</span>`);
  if (q.ok && lead.status !== "desqualificado") chips.push(`<span class="chip q">Qualificado</span>`);
  if (esgotada) chips.push(`<span class="chip late">Cadência encerrada</span>`);

  const meta = lead.contato ? esc(lead.contato) : "";

  return `<div class="card st-${esc(lead.status)}" draggable="true"
    data-card="${lead.id}" data-open="${lead.id}" tabindex="0" role="button">
    <div class="nm">${lead.importante ? `<span class="star" title="Muito importante">★</span>` : ""}${esc(lead.empresa||"Sem nome")}</div>
    ${meta ? `<div class="mt">${meta}</div>` : ""}
    ${railHTML(lead)}
    <div class="ft">${chips.join("")}
      ${lead.tpv ? `<span class="val">${esc(fmtBRL(lead.tpv))}</span>` : `<span class="val"></span>`}
      <button class="mv" data-move="${lead.id}" aria-label="Mover de estágio">Mover</button>
    </div>
  </div>`;
}

function colHTML(id, nome, leads, icone){
  return `<div class="col" data-col="${id}">
    <div class="col-head">
      ${icone ? `<span class="ico">${icone}</span>` : ""}
      <span class="nm">${esc(nome)}</span>
      <span class="ct">${leads.length}</span>
    </div>
    <div class="col-body" data-drop="${id}">
      ${leads.length ? leads.map(cardHTML).join("") : `<div class="void">vazio</div>`}
    </div>
  </div>`;
}

/* =========================================================================
   FUNIL EM DOIS NÍVEIS

   Treze colunas lado a lado obrigavam rolagem lateral e nenhuma delas
   cabia inteira na tela. Mas trocar o quadro por um menu de botões
   custaria caro: a leitura de onde o funil empilha e onde ele vaza.

   Então o nível 1 continua sendo o funil — etapas na ordem real, com
   contagem, valor e quantos estão atrasados. O clique abre a etapa.

   Nível 2 muda de forma conforme o conteúdo: "Tentativa de contato" vira
   quadro de 7 colunas, porque as tentativas são sequência e arrastar
   entre elas significa alguma coisa. As outras etapas viram tabela — uma
   coluna com três cards é desperdício de tela.
   ========================================================================= */

/* Caminho principal do funil, na ordem em que um lead avança. */
const FUNIL_ETAPAS = [
  { id:"cadencia",          nome:"Tentativa de contato", dica:"Ainda não respondeu" },
  { id:"conectado",         nome:"Conectados",           dica:"Respondeu" },
  { id:"decisor_envolvido", nome:"Decisor envolvido",    dica:"Chegou em quem decide" },
  { id:"reuniao_agendada",  nome:"Reunião agendada",     dica:"Data marcada" },
  { id:"reuniao_realizada", nome:"Reunião realizada",    dica:"Aconteceu" }
];
/* Saídas: não são etapa de avanço, são onde o lead para. Separadas
   visualmente porque somá-las ao caminho principal daria uma leitura
   falsa de progresso. */
const FUNIL_SAIDAS = [
  { id:"no_show",        nome:"No-show",        dica:"Faltou ou vai remarcar" },
  { id:"desqualificado", nome:"Desqualificado", dica:"Saiu por critério" }
];

let funilEtapa = null;   // null = visão geral; senão, id da etapa aberta

function bucketsFunil(){
  const b = {};
  for (let i=1;i<=7;i++) b["t"+i] = [];
  for (const e of ESTAGIOS) b[e.id] = [];
  for (const l of Store.db.leads){
    const c = colunaDo(l);
    if (c) (b[c] ||= []).push(l);
  }
  for (const k in b) b[k].sort((a,b2)=> urgencia(a)-urgencia(b2));
  return b;
}

function leadsDaEtapa(b, id){
  if (id === "cadencia") return [1,2,3,4,5,6,7].flatMap(i => b["t"+i]);
  return b[id] || [];
}

function resumoEtapa(leads){
  const valor = leads.reduce((s,l)=> s + (Number(l.tpv)||0), 0);
  const atrasados = leads.filter(l => urgencia(l) < 0).length;
  return { n: leads.length, valor, atrasados };
}

function etapaTileHTML(et, leads, maior){
  const r = resumoEtapa(leads);
  /* A barra é proporcional à maior etapa, não ao total: com 40 leads numa
     etapa e 2 na outra, proporção sobre o total deixaria quase tudo
     invisível. Comparar com a maior mostra a diferença. */
  const pct = maior > 0 ? Math.round((r.n / maior) * 100) : 0;
  return `<button class="etapa" data-etapa="${et.id}" ${r.n ? "" : "data-vazia=\"1\""}>
    <span class="et-top">
      <span class="et-nome">${esc(et.nome)}</span>
      <span class="et-n">${r.n}</span>
    </span>
    <span class="et-bar"><i style="width:${pct}%"></i></span>
    <span class="et-pe">
      <span class="et-dica">${esc(et.dica)}</span>
      ${r.atrasados ? `<span class="et-late">${r.atrasados} atrasado${r.atrasados>1?"s":""}</span>` : ""}
    </span>
    ${r.valor ? `<span class="et-valor">${esc(fmtBRL(r.valor))}</span>` : ""}
  </button>`;
}

/* Sete colunas cabem numa tela de 1080px pra cima; treze não cabiam.
   "Tentativa de contato" é uma coluna só aqui e abre as 7 tentativas no
   clique do cabeçalho — a sequência fica disponível sem ocupar a tela
   inteira o tempo todo. */
function colFunilHTML(et, leads, drill){
  const r = resumoEtapa(leads);
  return `<div class="col col-etapa" data-col="${et.id}">
    <div class="col-head ${drill ? "drill" : ""}" ${drill ? `data-etapa="${et.id}" role="button" tabindex="0"` : ""}>
      <span class="nm">${esc(et.nome)}</span>
      <span class="ct">${r.n}</span>
      ${drill ? `<svg class="go" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"/></svg>` : ""}
    </div>
    <div class="col-meta">
      ${r.valor ? `<span>${esc(fmtBRL(r.valor))}</span>` : `<span class="muted">sem valor</span>`}
      ${r.atrasados ? `<span class="late">${r.atrasados} atrasado${r.atrasados>1?"s":""}</span>` : ""}
    </div>
    <div class="col-body" ${drill ? "" : `data-drop="${et.id}"`}>
      ${leads.length ? leads.slice(0,40).map(cardHTML).join("") : `<div class="void">vazio</div>`}
      ${leads.length > 40 ? `<div class="void">+${leads.length-40} — abre a etapa pra ver todos</div>` : ""}
    </div>
  </div>`;
}

function renderFunilGeral(b){
  const caminho = FUNIL_ETAPAS.map(e =>
    colFunilHTML(e, leadsDaEtapa(b, e.id), e.id === "cadencia")).join("");
  const saidas = FUNIL_SAIDAS.map(e => colFunilHTML(e, leadsDaEtapa(b, e.id), false)).join("");

  return `<div class="board-wrap"><div class="board">
    <div class="bgroup bgroup-tent"><div class="bgroup-cols">${caminho}</div></div>
    <div class="bgroup bgroup-saida">
      <div class="bgroup-label"><h3>Pararam aqui</h3></div>
      <div class="bgroup-cols">${saidas}</div>
    </div>
  </div></div>`;
}

function renderFunilEtapa(b, id){
  const et = [...FUNIL_ETAPAS, ...FUNIL_SAIDAS].find(e => e.id === id);
  if (!et){ funilEtapa = null; return renderFunilGeral(b); }
  const leads = leadsDaEtapa(b, id);

  const topo = `<div class="etapa-head">
    <button class="btn btn-ghost btn-sm" data-etapa-voltar>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>
      Funil
    </button>
    <h2>${esc(et.nome)}</h2>
    <span class="et-count">${leads.length} ${leads.length===1?"lead":"leads"}</span>
  </div>`;

  if (!leads.length)
    return topo + `<div class="empty"><p>Nenhum lead em ${esc(et.nome.toLowerCase())}.</p></div>`;

  /* Tentativa de contato: quadro, porque as 7 colunas são uma sequência e
     arrastar entre elas muda o estado do lead. */
  if (id === "cadencia")
    return topo + `<div class="board-wrap"><div class="board"><div class="bgroup bgroup-tent">
      <div class="bgroup-cols">${[1,2,3,4,5,6,7].map(i =>
        colHTML("t"+i, "Tentativa "+i, b["t"+i])).join("")}</div>
    </div></div></div>`;

  /* Demais etapas: tabela. Mesmas colunas da tela de Leads, pra pessoa não
     ter que aprender dois formatos. */
  return topo + `<div class="rows">${ROWS_HEAD}${leads.map(leadRowHTML).join("")}</div>`;
}

function renderFunil(){
  const b = bucketsFunil();
  const ativos = Store.db.leads.filter(l => colunaDo(l)).length;

  $("#board").innerHTML = Store.db.leads.length
    ? (funilEtapa ? renderFunilEtapa(b, funilEtapa) : renderFunilGeral(b))
    : `<div class="empty" style="width:100%"><p>Nenhum lead no funil ainda.</p>
       <button class="btn btn-primary" data-action="new-lead">Adicionar lead</button></div>`;

  $("#funilSub").textContent = `${ativos} ${ativos===1?"lead":"leads"} no funil`;
}

/* Mover sem arrastar. É o caminho do celular e do tablet, mas fica
   disponível no mouse também — teclado agradece. */
function modalMover(leadId){
  const l = Store.lead(leadId); if(!l) return;
  const atual = colunaDo(l);
  const tent = [1,2,3,4,5,6,7].map(i => ({ v:"t"+i, t:"Tentativa "+i, d:CANAL_NOME[l.cadencia?.find(p=>p.dia===i)?.canal] || "" }));
  openModal(`Mover ${l.empresa || "lead"}`, `
    <div class="fields">
      <div class="field wide"><label for="mv-estagio">Para onde</label>
        <select id="mv-estagio">
          <optgroup label="Tentativa de contato">
            ${tent.map(o=>`<option value="${o.v}" ${o.v===atual?"selected":""}>${o.t}${o.d?" — "+o.d:""}</option>`).join("")}
          </optgroup>
          <optgroup label="Avançaram">
            ${ESTAGIOS.map(e=>`<option value="${e.id}" ${e.id===atual?"selected":""}>${e.nome} — ${e.dica}</option>`).join("")}
          </optgroup>
        </select>
        <span class="hint">Voltar para uma tentativa anterior à atual desmarca os dias já registrados. Avançar marca os dias pulados como pulados, nunca como feitos.</span>
      </div>
    </div>`, async () => {
      const alvo = $("#mv-estagio").value;
      if (alvo === atual) return;
      closeModal();                    // o motivo abre outro modal por cima
      await aplicarMovimento(l, alvo);
      return false;                    // já fechei acima
    }, "Mover");
}

/* ---------- arrastar e soltar ---------- */
let dragId = null;

document.addEventListener("dragstart", e => {
  const card = e.target.closest("[data-card]"); if(!card) return;
  dragId = card.dataset.card;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId); // Firefox exige payload
});
document.addEventListener("dragend", e => {
  e.target.closest("[data-card]")?.classList.remove("dragging");
  dragId = null;
  $$(".col-body.hover,.bgroup.hover").forEach(n => n.classList.remove("hover"));
});
document.addEventListener("dragover", e => {
  const zona = e.target.closest("[data-drop]"); if(!zona || !dragId) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "move";
  $$(".col-body.hover,.bgroup.hover").forEach(n => { if(n !== zona) n.classList.remove("hover"); });
  zona.classList.add("hover");
});
document.addEventListener("drop", async e => {
  const zona = e.target.closest("[data-drop]"); if(!zona || !dragId) return;
  e.preventDefault();
  const lead = Store.lead(dragId); dragId = null;
  $$(".col-body.hover,.bgroup.hover").forEach(n => n.classList.remove("hover"));
  if (!lead) return;

  const alvo = zona.dataset.drop;
  if (colunaDo(lead) === alvo) return;   // soltou onde já estava
  await aplicarMovimento(lead, alvo);
});

function renderLeads(){
  const q = $("#fSearch").value.trim().toLowerCase();
  const fs = $("#fStatus").value, fp = $("#fPapel").value, sort = $("#fSort").value;

  let list = Store.db.leads.filter(l => {
    if (fs && l.status !== fs) return false;
    if (fp && l.papel !== fp) return false;
    if (!q) return true;
    const hay = [l.empresa,l.contato,l.email,l.telefone,l.cnpj,l.plataforma]
      .filter(Boolean).join(" ").toLowerCase()
      + " " + String(l.cnpj||"").replace(/\D/g,"") + " " + String(l.telefone||"").replace(/\D/g,"");
    return hay.includes(q) || hay.includes(q.replace(/\D/g,""));
  });

  const cmp = {
    urgencia: (a,b)=> urgencia(a)-urgencia(b),
    recente:  (a,b)=> String(b.criado_em||"").localeCompare(String(a.criado_em||"")),
    alfabetica:(a,b)=> String(a.empresa||"").localeCompare(String(b.empresa||""),"pt-BR"),
    tpv:      (a,b)=> (Number(b.tpv)||0)-(Number(a.tpv)||0)
  }[sort];
  list.sort(cmp);

  $("#leadsCount").textContent = `${list.length} de ${Store.db.leads.length} ${Store.db.leads.length===1?"lead":"leads"}`;
  $("#leadsContent").innerHTML = list.length
    ? `<div class="rows">${ROWS_HEAD}${list.map(leadRowHTML).join("")}</div>`
    : `<div class="empty"><p>${Store.db.leads.length ? "Nenhum lead bate com esse filtro." : "Nenhum lead ainda."}</p>
       <button class="btn btn-primary" data-action="new-lead">Adicionar lead</button></div>`;
}

function taskHTML(t){
  const lead = t.lead_id ? Store.lead(t.lead_id) : null;
  const late = tarefaVencida(t);
  return `<div class="task ${t.feito?"done":""} ${late?"late":""}">
    <button class="check" data-task-toggle="${t.id}" aria-label="Concluir">${ICON.check}</button>
    <div class="t-body">
      <div class="t-title">${esc(t.titulo)}</div>
      <div class="t-meta">
        <span class="when ${late?"late":""}">${fmtDateTime(t.quando)}</span>
        ${lead ? `<span class="sep"> · </span><a href="#" data-open="${lead.id}" style="color:inherit">${esc(lead.empresa)}</a>` : ""}
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" data-task-del="${t.id}">Excluir</button>
  </div>`;
}

function renderTarefas(){
  const abertas = Store.db.tarefas.filter(t=>!t.feito).sort((a,b)=> String(a.quando).localeCompare(String(b.quando)));
  const feitas  = Store.db.tarefas.filter(t=>t.feito).sort((a,b)=> String(b.quando).localeCompare(String(a.quando))).slice(0,25);

  let html = "";
  if (!Store.db.tarefas.length){
    html = `<div class="empty"><p>Nenhuma tarefa. Quando um lead pedir pra retornar num dia e hora, registra aqui e o alerta dispara sozinho.</p>
      <button class="btn btn-primary" data-action="new-task">Criar tarefa</button></div>`;
  } else {
    if (abertas.length) html += `<div class="group-head"><h2>Em aberto</h2><span class="count">${abertas.length}</span><span class="rule"></span></div>` + abertas.map(taskHTML).join("");
    if (feitas.length)  html += `<div class="group-head"><h2>Concluídas</h2><span class="rule"></span></div>` + feitas.map(taskHTML).join("");
  }
  $("#tarefasContent").innerHTML = html;

  renderRail();
}

/* ---------- sheet do lead ---------- */
let sheetLeadId = null;

/* =========================================================================
   CANAIS DE CONTATO

   Número vira link de wa.me, @perfil vira instagram.com/perfil, domínio
   solto ganha https://. Normalizo na hora de abrir e não na gravação:
   assim o que a pessoa digitou continua sendo o que ela vê no campo.
   ========================================================================= */
const Canal = {
  whatsapp(v){
    const d = String(v||"").replace(/\D/g,"");
    if (d.length < 10) return null;                 // curto demais pra ser telefone
    /* Sem DDI o wa.me assume o país de quem abre e erra. 10 ou 11 dígitos
       é número brasileiro sem código: prefixo 55. */
    return "https://wa.me/" + (d.length <= 11 ? "55" + d : d);
  },
  instagram(v){
    const s = String(v||"").trim().replace(/^@/,"");
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/instagram\.com/i.test(s)) return "https://" + s.replace(/^\/+/,"");
    return "https://instagram.com/" + s.replace(/\/+$/,"");
  },
  site(v){
    const s = String(v||"").trim();
    if (!s) return null;
    return /^https?:\/\//i.test(s) ? s : "https://" + s;
  }
};

function canaisHTML(l){
  const itens = [
    ["whatsapp", "WhatsApp",  Canal.whatsapp(l.whatsapp || l.telefone)],
    ["instagram","Instagram", Canal.instagram(l.instagram)],
    ["site",     "Site",      Canal.site(l.site)]
  ].filter(x => x[2]);
  if (!itens.length) return "";
  /* noopener: sem ele a página aberta ganha window.opener e pode
     redirecionar esta aba. */
  return `<div class="canais">${itens.map(([k,nome,url]) =>
    `<a class="canal ${k}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ICON_CANAL[k]}${nome}</a>`
  ).join("")}</div>`;
}

const ICON_CANAL = {
  whatsapp:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-5.9A8.4 8.4 0 1 1 21 11.5Z"/></svg>`,
  instagram:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="17" cy="7" r="1"/></svg>`,
  site:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17a13 13 0 0 1 0-17Z"/></svg>`
};

function sheetHTML(l){
  const q = qualificar(l);
  const mark = ok => `<span class="mark">${ok?ICON.check:""}</span>`;

  const cad = (l.cadencia||[]).map(p => {
    const st = statusPasso(l,p);
    const prevista = l.cadencia_inicio ? addDays(l.cadencia_inicio, p.dia-1) : null;
    return `<div class="cad-step ${st}" data-cad="${p.dia}">
      <span class="d">D${p.dia}</span>
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <select data-cad-canal="${p.dia}">
          ${Object.entries(CANAL_NOME).map(([k,v])=>`<option value="${k}" ${p.canal===k?"selected":""}>${v}</option>`).join("")}
        </select>
        <span class="when">${p.feito ? "feito "+fmtDate(p.feito_em) : p.pulado ? "pulado" : prevista ? fmtDate(prevista) : "sem data"}</span>
      </div>
      <button class="toggle" data-cad-toggle="${p.dia}" aria-label="Marcar dia ${p.dia}">${p.pulado ? ICON.pulado : ICON.check}</button>
    </div>`;
  }).join("");

  const toques = Store.toquesDo(l.id);
  const tlHTML = toques.length ? `<div class="tl">${toques.map(t=>{
    const ax = Array.isArray(t.anexos) ? t.anexos : [];
    const thumbs = ax.length ? `<div class="thumbs">${ax.map(a=>`
      <button class="thumb loading" data-anexo-ref="${esc(a.ref)}" data-toque="${t.id}" data-anexo="${a.id}">
        <img alt="${esc(a.nome||"print")}">
        <span class="rm" data-anexo-del="${a.id}" data-toque="${t.id}" role="button" aria-label="Remover print">&times;</span>
      </button>`).join("")}</div>` : "";
    return `<div class="tl-item ${t.canal==="whatsapp"?"wa":t.canal==="email"?"email":"call"}">
      <div class="tl-head">${CANAL_NOME[t.canal]||t.canal} · ${fmtDateFull(t.data)}
        <button class="btn btn-ghost btn-sm" data-toque-del="${t.id}" style="margin-left:auto">Excluir</button></div>
      <div class="tl-body">${esc(t.nota||"(sem anotação)")}</div>
      ${thumbs}
    </div>`;
  }).join("")}</div>`
    : `<p class="note" style="margin:0">Nenhum registro ainda. Cada toque que tu marcar na cadência entra aqui com o que foi dito.</p>`;

  const tarefas = Store.tarefasDo(l.id).sort((a,b)=>String(a.quando).localeCompare(String(b.quando)));

  return `
  <div class="prio ${l.importante ? "on" : ""}">
    <button data-prio="${l.id}" aria-pressed="${!!l.importante}">
      <svg viewBox="0 0 24 24" fill="${l.importante?"currentColor":"none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8Z"/></svg>
      ${l.importante ? "Muito importante" : "Marcar como muito importante"}
    </button>
    <span class="note">Prioridade é marcação, não etapa — vale em qualquer ponto do funil.</span>
  </div>
  ${canaisHTML(l)}
  <div class="block">
    <div class="block-title">${esc(NEGOCIO.qualTitulo)}</div>
    <div class="qual">
      <div class="qual-item ${q.tpvOk?"ok":""}">${mark(q.tpvOk)}<span class="txt">${esc(NEGOCIO.valorLabel.replace(/\s*\(R\$\)\s*$/,""))} ${faixaTexto()}</span><span class="note">${l.tpv?fmtBRL(l.tpv):"não informado"}</span></div>
      <div class="qual-item ${q.platOk?"ok":""}">${mark(q.platOk)}<span class="txt">${esc(NEGOCIO.fitLabel)}</span><span class="note">${esc(l.plataforma||"não informada")}</span></div>
      ${NEGOCIO.exigirDecisor ? `<div class="qual-item ${q.decisorOk?"ok":""}">${mark(q.decisorOk)}<span class="txt">Contato é o decisor</span><span class="note">${l.papel?PAPEL_NOME[l.papel]:"não definido"}</span></div>` : ""}
      <div class="qual-verdict ${q.ok?"ok":""}">${q.ok
        ? "Todos os critérios batem. Reunião conta como qualificada."
        : "Ainda falta critério. Agendar assim gera reunião que não conta."}</div>
    </div>
  </div>

  <div class="block">
    <div class="block-title">Empresa e contato</div>
    <div class="fields">
      <div class="field wide"><label for="f-empresa">Empresa</label><input id="f-empresa" value="${esc(l.empresa||"")}"></div>
      <div class="field"><label for="f-cnpj">CNPJ</label><input id="f-cnpj" value="${esc(l.cnpj||"")}" inputmode="numeric"></div>
      <div class="field"><label for="f-plataforma">${esc(NEGOCIO.segmentoLabel)}</label><input id="f-plataforma" value="${esc(l.plataforma||"")}" placeholder="${esc(NEGOCIO.segmentoDica)}"></div>
      <div class="field"><label for="f-contato">Nome do contato</label><input id="f-contato" value="${esc(l.contato||"")}"></div>
      <div class="field"><label for="f-papel">Papel</label>
        <select id="f-papel">
          <option value="">Não definido</option>
          ${Object.entries(PAPEL_NOME).map(([k,v])=>`<option value="${k}" ${l.papel===k?"selected":""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" value="${esc(l.email||"")}"></div>
      <div class="field"><label for="f-telefone">Telefone</label><input id="f-telefone" value="${esc(l.telefone||"")}" inputmode="tel"></div>
      <div class="field"><label for="f-whatsapp">WhatsApp</label><input id="f-whatsapp" value="${esc(l.whatsapp||"")}" inputmode="tel" placeholder="51 99999-9999"></div>
      <div class="field"><label for="f-instagram">Instagram</label><input id="f-instagram" value="${esc(l.instagram||"")}" placeholder="@perfil" spellcheck="false"></div>
      <div class="field"><label for="f-site">Site</label><input id="f-site" value="${esc(l.site||"")}" placeholder="empresa.com.br" spellcheck="false"></div>
      <div class="field"><label for="f-tpv">${esc(NEGOCIO.valorLabel)}</label><input id="f-tpv" type="number" min="0" step="1000" value="${l.tpv ?? ""}"></div>
      <div class="field"><label for="f-status">Status</label>
        <select id="f-status">${Object.entries(STATUS_NOME).filter(([k])=>k!=="descartado").map(([k,v])=>`<option value="${k}" ${l.status===k?"selected":""}>${v}</option>`).join("")}</select>
      </div>
      <div class="field"><label for="f-motivo-ns">Motivo do no-show</label>
        <select id="f-motivo-ns">
          <option value="">—</option>
          ${Object.entries(MOTIVOS_NS).map(([k,v])=>`<option value="${k}" ${l.motivo_ns===k?"selected":""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label for="f-motivo">Motivo da desqualificação</label>
        <select id="f-motivo">
          <option value="">—</option>
          ${Object.entries(MOTIVOS_DESQ).map(([k,v])=>`<option value="${k}" ${l.motivo_desq===k?"selected":""}>${v}</option>`).join("")}
        </select>
        <span class="hint">Só vale quando o status é Desqualificado.</span>
      </div>
      <div class="field wide" style="flex-direction:row;align-items:center;gap:9px">
        <input type="checkbox" id="f-integra" ${l.plataforma_integra?"checked":""} style="width:auto">
        <label for="f-integra" style="margin:0">${esc(NEGOCIO.fitLabel)}</label>
      </div>
      <div class="field wide"><label for="f-obs">Anotações</label><textarea id="f-obs">${esc(l.obs||"")}</textarea></div>
    </div>
  </div>

  <div class="block">
    <div class="block-title">Cadência de 7 dias</div>
    <div class="fields" style="margin-bottom:12px">
      <div class="field wide"><label for="f-inicio">Dia 1 começa em</label><input id="f-inicio" type="date" value="${esc(l.cadencia_inicio||"")}">
        <span class="hint">As datas dos outros seis dias saem daqui. Mudar esta data reposiciona a cadência inteira.</span></div>
    </div>
    <div class="cad-list">${cad}</div>
  </div>

  <div class="block">
    <div class="block-title">Tarefas deste lead</div>
    ${tarefas.length ? tarefas.map(taskHTML).join("") : `<p class="note" style="margin:0 0 12px">Nenhuma tarefa marcada.</p>`}
    <button class="btn btn-sm" data-action="new-task" data-lead="${l.id}">Criar tarefa para este lead</button>
  </div>

  <div class="block">
    <div class="block-title">Histórico de toques</div>
    <div style="margin-bottom:12px"><button class="btn btn-sm" data-action="new-toque" data-lead="${l.id}">Registrar toque avulso</button></div>
    ${tlHTML}
  </div>`;
}

/* As URLs dos anexos não dá pra montar no meio do HTML: as do Supabase
   são assinadas por requisição. Então o HTML sai com a miniatura vazia
   e esta função preenche quando as URLs chegam. O painel abre na hora,
   sem esperar imagem. */
async function hidratarAnexos(){
  const nodes = $$("#shBody .thumb[data-anexo-ref]");
  if (!nodes.length) return;
  const lead = Store.lead(sheetLeadId); if(!lead) return;
  const lista = Store.toquesDo(lead.id).flatMap(t => Array.isArray(t.anexos) ? t.anexos : []);
  const mapa = await Anexos.resolver(lista);
  for (const n of nodes){
    const url = mapa[n.dataset.anexoRef];
    n.classList.remove("loading");
    if (url) n.querySelector("img").src = url;
    else n.innerHTML = `<span class="fail">não carregou</span>`;
  }
}

function openSheet(id){
  const l = Store.lead(id); if(!l) return;
  sheetLeadId = id;
  $("#shTitle").textContent = l.empresa || "Sem nome";
  const bits = [fmtCNPJ(l.cnpj), fmtFone(l.telefone), l.email].filter(Boolean);
  $("#shSub").textContent = bits.join("  ·  ") || "Sem dados de contato";
  $("#shBody").innerHTML = sheetHTML(l);
  $("#shBody").scrollTop = 0;
  $("#sheet").classList.add("open");
  $("#scrim").classList.add("open");
  hidratarAnexos();
}
function closeSheet(){
  sheetLeadId = null;
  $("#sheet").classList.remove("open");
  $("#scrim").classList.remove("open");
}
function refreshSheet(){
  if (!sheetLeadId) return;
  const l = Store.lead(sheetLeadId);
  if (l){ $("#shBody").innerHTML = sheetHTML(l); hidratarAnexos(); }
}

function coletarSheet(l){
  const v = id => { const el = $("#"+id); return el ? el.value.trim() : ""; };
  l.empresa = v("f-empresa"); l.cnpj = v("f-cnpj"); l.plataforma = v("f-plataforma");
  l.contato = v("f-contato"); l.papel = v("f-papel"); l.email = v("f-email");
  l.telefone = v("f-telefone"); l.status = v("f-status") || "novo"; l.obs = v("f-obs");
  l.whatsapp = v("f-whatsapp") || null; l.instagram = v("f-instagram") || null; l.site = v("f-site") || null;
  const tpv = v("f-tpv"); l.tpv = tpv === "" ? null : Number(tpv);
  l.plataforma_integra = $("#f-integra")?.checked || false;
  /* Motivo amarrado ao status: se o lead saiu de desqualificado, o motivo
     antigo vira mentira no histórico e precisa cair junto. */
  l.motivo_desq = l.status === "desqualificado" ? (v("f-motivo") || null) : null;
  l.motivo_ns   = l.status === "no_show"        ? (v("f-motivo-ns") || null) : null;
  l.cadencia_inicio = v("f-inicio") || null;
  $$("[data-cad-canal]").forEach(sel => {
    const dia = Number(sel.dataset.cadCanal);
    const p = l.cadencia.find(x=>x.dia===dia); if(p) p.canal = sel.value;
  });
  return l;
}

/* ---------- modal genérico ---------- */
let modalOk = null;
function openModal(titulo, corpo, onOk, okLabel="Salvar"){
  $("#mTitle").textContent = titulo;
  $("#mBody").innerHTML = corpo;
  $("#mOk").textContent = okLabel;
  modalOk = onOk;
  $("#modal").classList.add("open");
  $("#scrim").classList.add("open");
  setTimeout(()=> $("#mBody input, #mBody select, #mBody textarea")?.focus(), 40);
}
function closeModal(){
  $("#modal").classList.remove("open");
  if (!$("#sheet").classList.contains("open")) $("#scrim").classList.remove("open");
  modalOk = null;
}

function modalNovoLead(){
  openModal("Adicionar lead", `
    <div class="fields">
      <div class="field wide"><label for="n-empresa">Empresa</label><input id="n-empresa" placeholder="Razão social ou nome da loja"></div>
      <div class="field"><label for="n-cnpj">CNPJ</label><input id="n-cnpj" inputmode="numeric" placeholder="00.000.000/0000-00"></div>
      <div class="field"><label for="n-plataforma">${esc(NEGOCIO.segmentoLabel)}</label><input id="n-plataforma" placeholder="${esc(NEGOCIO.segmentoDica)}"></div>
      <div class="field"><label for="n-contato">Nome do contato</label><input id="n-contato"></div>
      <div class="field"><label for="n-papel">Papel</label>
        <select id="n-papel"><option value="">Não definido</option>${Object.entries(PAPEL_NOME).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></div>
      <div class="field"><label for="n-email">E-mail</label><input id="n-email" type="email"></div>
      <div class="field"><label for="n-telefone">Telefone</label><input id="n-telefone" inputmode="tel"></div>
      <div class="field"><label for="n-tpv">${esc(NEGOCIO.valorLabel)}</label><input id="n-tpv" type="number" min="0" step="1000"></div>
      <div class="field"><label for="n-inicio">Dia 1 da cadência</label><input id="n-inicio" type="date" value="${todayISO()}"></div>
    </div>`, async () => {
      const empresa = $("#n-empresa").value.trim();
      if (!empresa){ toast("Dá um nome pra empresa antes de salvar."); return false; }
      const tpv = $("#n-tpv").value;
      const okLead = await Store.put("leads", {
        id: uid(), empresa,
        cnpj: $("#n-cnpj").value.trim(),
        plataforma: $("#n-plataforma").value.trim(),
        plataforma_integra: false,
        contato: $("#n-contato").value.trim(),
        papel: $("#n-papel").value,
        email: $("#n-email").value.trim(),
        telefone: $("#n-telefone").value.trim(),
        tpv: tpv === "" ? null : Number(tpv),
        status: "em_cadencia",
        obs: "",
        cadencia_inicio: $("#n-inicio").value || todayISO(),
        cadencia: novaCadencia(),
        criado_em: new Date().toISOString()
      });
      renderAll(); toast(okLead ? "Lead adicionado." : "NÃO salvou — ver a barra vermelha.");
    }, "Adicionar");
}

function modalNovaTarefa(leadId){
  const leads = Store.db.leads.slice().sort((a,b)=>String(a.empresa).localeCompare(String(b.empresa),"pt-BR"));
  const agora = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  openModal("Criar tarefa", `
    <div class="fields">
      <div class="field wide"><label for="t-titulo">O que precisa ser feito</label>
        <input id="t-titulo" placeholder="Ligar de volta — pediu retorno">
      </div>
      <div class="field"><label for="t-quando">Quando</label><input id="t-quando" type="datetime-local" value="${agora}"></div>
      <div class="field"><label for="t-lead">Lead</label>
        <select id="t-lead"><option value="">Sem lead vinculado</option>
          ${leads.map(l=>`<option value="${l.id}" ${l.id===leadId?"selected":""}>${esc(l.empresa)}</option>`).join("")}</select>
      </div>
    </div>
    <p class="note" style="margin-top:14px">O alerta dispara na hora marcada, enquanto esta aba estiver aberta. Se tu ativar as notificações em Ajustes, ele aparece também fora da aba.</p>`,
    async () => {
      const titulo = $("#t-titulo").value.trim();
      const quando = $("#t-quando").value;
      if (!titulo){ toast("Escreve o que precisa ser feito."); return false; }
      if (!quando){ toast("Define a data e a hora."); return false; }
      const okT = await Store.put("tarefas", {
        id: uid(), titulo, quando: new Date(quando).toISOString(),
        lead_id: $("#t-lead").value || null, feito: false, avisado: false,
        criado_em: new Date().toISOString()
      });
      renderAll(); refreshSheet(); toast(okT ? "Tarefa criada." : "NÃO salvou — ver a barra vermelha.");
    }, "Criar");
}

/* Arquivos escolhidos mas ainda não gravados. Só sobem quando o toque é
   salvo — assim um modal cancelado não deixa lixo no bucket. */
let toqueStaged = [];

function renderStaged(){
  const box = $("#k-thumbs"); if(!box) return;
  box.innerHTML = toqueStaged.map((s,i)=>`
    <div class="thumb"><img src="${s.url}" alt="">
      <button class="rm" data-unstage="${i}" aria-label="Remover">&times;</button></div>`).join("");
}
function stageFiles(files){
  for (const f of files){
    if (!f.type.startsWith("image/")) continue;
    toqueStaged.push({ file: f, url: URL.createObjectURL(f) });
  }
  renderStaged();
}

function modalToque(leadId, dia){
  const l = Store.lead(leadId); if(!l) return;
  const passo = dia ? l.cadencia.find(p=>p.dia===dia) : null;
  const canalSugerido = passo ? passo.canal : "ligacao";
  toqueStaged.forEach(s => URL.revokeObjectURL(s.url));
  toqueStaged = [];

  openModal(dia ? `Registrar dia ${dia} da cadência` : "Registrar toque", `
    <div class="fields">
      <div class="field"><label for="k-canal">Canal</label>
        <select id="k-canal">${Object.entries(CANAL_NOME).map(([k,v])=>`<option value="${k}" ${canalSugerido===k?"selected":""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label for="k-data">Data</label><input id="k-data" type="date" value="${todayISO()}"></div>
      <div class="field wide"><label for="k-nota">O que aconteceu</label>
        <textarea id="k-nota" placeholder="Gatekeeper pediu pra ligar depois das 15h. Decisor é o Rafael, sócio."></textarea></div>
      <div class="field wide">
        <label>Prints da conversa</label>
        <div class="dropzone" id="k-drop" tabindex="0" role="button">
          <b>Cola com Ctrl+V, arrasta pra cá ou clica pra escolher</b>
          Imagem é reduzida antes de subir, então print de celular não pesa.
        </div>
        <input type="file" id="k-file" accept="image/*" multiple hidden>
        <div class="thumbs" id="k-thumbs"></div>
      </div>
      ${dia ? `<div class="field wide" style="flex-direction:row;align-items:center;gap:9px">
        <input type="checkbox" id="k-marcar" checked style="width:auto">
        <label for="k-marcar" style="margin:0">Marcar o dia ${dia} como feito</label></div>` : ""}
    </div>`, async () => {
      const canal = $("#k-canal").value, data = $("#k-data").value || todayISO();
      const toqueId = uid();

      const anexos = [];
      if (toqueStaged.length){
        $("#mOk").textContent = "Enviando...";
        $("#mOk").disabled = true;
        for (const s of toqueStaged){
          try { anexos.push(await Anexos.salvar(s.file, toqueId)); }
          catch(err){ toast("Um print não subiu: " + err.message); }
        }
        $("#mOk").disabled = false;
      }

      const okToque = await Store.put("toques", {
        id: toqueId, lead_id: leadId, canal, data,
        nota: $("#k-nota").value.trim(), dia: dia || null, anexos,
        criado_em: new Date().toISOString()
      });
      if (dia && $("#k-marcar")?.checked){
        passo.feito = true; passo.feito_em = data; passo.canal = canal; passo.pulado = false;
        if (l.status === "novo") l.status = "em_cadencia";
        await Store.put("leads", l);
      }
      toqueStaged.forEach(s => URL.revokeObjectURL(s.url));
      toqueStaged = [];
      renderAll(); refreshSheet(); toast(okToque ? "Toque registrado." : "NÃO salvou — ver a barra vermelha.");
    }, "Registrar");

  const drop = $("#k-drop"), file = $("#k-file");
  drop.onclick = () => file.click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
  file.onchange = e => { stageFiles(e.target.files); e.target.value = ""; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("hover"); };
  drop.ondragleave = () => drop.classList.remove("hover");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("hover"); stageFiles(e.dataTransfer.files); };
}

/* =========================================================================
   ALERTAS
   Um timer só, varrendo tarefas. Nada de setTimeout por tarefa — se o
   usuário deixa a aba aberta a semana toda, isso vira centena de timers.
   ========================================================================= */

let alertDismissedUntil = 0;

function checarAlertas(){
  const vencidas = Store.db.tarefas.filter(tarefaVencida)
    .sort((a,b)=> String(a.quando).localeCompare(String(b.quando)));

  renderTarefas();

  for (const t of vencidas){
    if (!t.avisado){
      t.avisado = true;
      Store.put("tarefas", t);
      notificar(t);
    }
  }

  const bar = $("#alertbar");
  if (!vencidas.length || Date.now() < alertDismissedUntil){ bar.classList.remove("show"); return; }

  $("#alertTitle").textContent = vencidas.length === 1
    ? "1 tarefa chegou na hora"
    : `${vencidas.length} tarefas chegaram na hora`;
  $("#alertList").innerHTML = vencidas.slice(0,5).map(t => {
    const l = t.lead_id ? Store.lead(t.lead_id) : null;
    return `<li><b>${esc(t.titulo)}</b> · ${fmtDateTime(t.quando)}${l?` · ${esc(l.empresa)}`:""}
      <button data-task-toggle="${t.id}">concluir</button>${l?`<button data-open="${l.id}">abrir lead</button>`:""}</li>`;
  }).join("") + (vencidas.length>5 ? `<li>e mais ${vencidas.length-5}</li>` : "");
  bar.classList.add("show");
}

function notificar(t){
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const l = t.lead_id ? Store.lead(t.lead_id) : null;
  try {
    new Notification("MPMAX — " + t.titulo, {
      body: l ? `${l.empresa} · ${fmtDateTime(t.quando)}` : fmtDateTime(t.quando),
      tag: t.id
    });
  } catch(e){ /* alguns navegadores bloqueiam em file:// — o alerta interno cobre */ }
}

/* =========================================================================
   EVENTOS
   Delegação única no document: a lista se redesenha inteira a cada render,
   então listener preso em elemento morreria junto com o nó.
   ========================================================================= */

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-move],[data-view],[data-view-jump],[data-action],[data-open],[data-step],[data-cad-toggle],[data-task-toggle],[data-task-del],[data-toque-del],[data-unstage],[data-anexo-del],[data-anexo-ref],[data-etapa],[data-etapa-voltar],[data-grp],[data-prio]");
  if (!t) return;

  if (t.dataset.prio){
    const l = Store.lead(t.dataset.prio); if(!l) return;
    l.importante = !l.importante;
    const ok = await Store.put("leads", l);
    toast(ok ? (l.importante ? "Marcado como muito importante." : "Marcação removida.")
             : "NÃO salvou. Confere a conexão.");
    refreshSheet(); renderAll(); return;
  }

  if (t.dataset.grp){
    /* Mexo só na classe do grupo em vez de chamar renderHoje(): redesenhar
       dez linhas pra esconder um bloco perderia a transição e o foco. */
    Recolhidos.virar(t.dataset.grp);
    const box = t.closest(".grp");
    box.classList.toggle("fechado");
    t.setAttribute("aria-expanded", String(!box.classList.contains("fechado")));
    return;
  }

  if (t.dataset.etapaVoltar !== undefined){ funilEtapa = null; renderFunil(); return; }
  if (t.dataset.etapa){
    e.preventDefault(); e.stopPropagation();
    funilEtapa = t.dataset.etapa; renderFunil(); return;
  }

  /* Vem antes de data-open: o botão mora dentro do card, que abre o lead. */
  if (t.dataset.move){ e.preventDefault(); e.stopPropagation(); modalMover(t.dataset.move); return; }

  if (t.dataset.unstage !== undefined){
    const i = Number(t.dataset.unstage);
    URL.revokeObjectURL(toqueStaged[i].url);
    toqueStaged.splice(i,1); renderStaged(); return;
  }

  /* O X fica dentro da miniatura, então vem antes dela no closest. */
  if (t.dataset.anexoDel){
    e.preventDefault(); e.stopPropagation();
    const toque = Store.db.toques.find(x => x.id === t.dataset.toque);
    const a = toque?.anexos?.find(x => x.id === t.dataset.anexoDel);
    if (!a) return;
    if (!confirm("Remover este print?")) return;
    await Anexos.apagar(a);
    toque.anexos = toque.anexos.filter(x => x.id !== a.id);
    await Store.put("toques", toque);
    refreshSheet(); return;
  }

  if (t.dataset.anexoRef){
    const img = t.querySelector("img");
    if (img?.src){ $("#lbImg").src = img.src; $("#lightbox").classList.add("open"); }
    return;
  }

  if (t.dataset.view){ switchView(t.dataset.view); return; }
  if (t.dataset.viewJump){ switchView(t.dataset.viewJump); return; }

  if (t.dataset.action === "new-lead"){ modalNovoLead(); return; }
  if (t.dataset.action === "new-task"){ modalNovaTarefa(t.dataset.lead || null); return; }
  if (t.dataset.action === "new-toque"){ modalToque(t.dataset.lead, null); return; }

  if (t.dataset.step){ e.preventDefault(); e.stopPropagation(); // célula da régua
    const lead = Store.lead(t.dataset.lead);
    const p = lead?.cadencia.find(x=>x.dia===Number(t.dataset.step));
    if (!p) return;
    if (p.feito || p.pulado){ p.feito = false; p.feito_em = null; p.pulado = false; await Store.put("leads", lead); renderAll(); refreshSheet(); }
    else modalToque(lead.id, p.dia);
    return;
  }

  if (t.dataset.cadToggle){ // botão dentro do sheet
    const lead = Store.lead(sheetLeadId);
    const p = lead?.cadencia.find(x=>x.dia===Number(t.dataset.cadToggle));
    if (!p) return;
    if (p.feito || p.pulado){ p.feito=false; p.feito_em=null; p.pulado=false; await Store.put("leads", lead); renderAll(); refreshSheet(); }
    else modalToque(lead.id, p.dia);
    return;
  }

  if (t.dataset.taskToggle){
    const task = Store.db.tarefas.find(x=>x.id===t.dataset.taskToggle);
    if (task){ task.feito = !task.feito; if(task.feito) task.avisado = true; await Store.put("tarefas", task); renderAll(); refreshSheet(); }
    return;
  }
  if (t.dataset.taskDel){ await Store.del("tarefas", t.dataset.taskDel); renderAll(); refreshSheet(); return; }
  if (t.dataset.toqueDel){
    const toque = Store.db.toques.find(x => x.id === t.dataset.toqueDel);
    for (const a of (toque?.anexos || [])) await Anexos.apagar(a);
    await Store.del("toques", t.dataset.toqueDel); refreshSheet(); return;
  }

  if (t.dataset.open){ e.preventDefault(); openSheet(t.dataset.open); return; }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape"){
    if ($("#lightbox").classList.contains("open")) $("#lightbox").classList.remove("open");
    else if ($("#modal").classList.contains("open")) closeModal();
    else if ($("#sheet").classList.contains("open")) closeSheet();
  }
  if (e.key === "Enter" && e.target.classList?.contains("lead-row")) e.target.click();
  // Enter dentro do modal confirma, menos em textarea e no dropzone
  // (lá o Enter abre o seletor de arquivo e não pode salvar junto).
  if (e.key === "Enter" && $("#modal").classList.contains("open")
      && e.target.tagName !== "TEXTAREA" && e.target.id !== "k-drop"){
    e.preventDefault(); $("#mOk").click();
  }
});

/* Ctrl+V com print no clipboard. É o caminho real: o cara recorta a tela
   do WhatsApp e cola. Obrigar a salvar arquivo antes mataria o uso. */
document.addEventListener("paste", e => {
  if (!$("#modal").classList.contains("open") || !$("#k-drop")) return;
  const imgs = [...(e.clipboardData?.items || [])]
    .filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean);
  if (!imgs.length) return;
  e.preventDefault(); stageFiles(imgs); toast(imgs.length === 1 ? "Print colado." : `${imgs.length} prints colados.`);
});

$("#lbClose").onclick = () => $("#lightbox").classList.remove("open");
$("#lightbox").onclick = e => { if (e.target.id !== "lbImg") $("#lightbox").classList.remove("open"); };

/* ---------- login ---------- */
$("#lEntrar").onclick = async () => {
  const c = Store.cfg(), email = $("#lEmail").value.trim(), senha = $("#lSenha").value;
  if (!email || !senha){ $("#lStatus").textContent = "Preenche e-mail e senha."; return; }
  const b = $("#lEntrar"); b.disabled = true; b.textContent = "Entrando...";
  $("#lStatus").textContent = "";
  try {
    await Auth.entrar(c.url, c.key, email, senha);
    $("#lSenha").value = "";
    await Store.init();                       // recarrega já como dono das linhas
    syncGate(); syncStorePill(); syncAjustes(); avisarSchema(); renderAll(); checarAlertas();
  } catch(e){
    /* O Supabase devolve a mesma mensagem pra e-mail inexistente e senha
       errada, de propósito: distinguir as duas entrega quais e-mails têm
       conta. Repasso como veio em vez de inventar um texto mais específico. */
    $("#lStatus").textContent = e.message;
  } finally { b.disabled = false; b.textContent = "Entrar"; }
};
$("#lSenha").addEventListener("keydown", e => { if (e.key === "Enter") $("#lEntrar").click(); });
$("#btnSair").onclick = async () => {
  const c = Store.cfg();
  await Auth.sair(c.url, c.key);
  Store.db = { leads:[], toques:[], tarefas:[] };   // nada do dono anterior fica na tela
  renderAll(); syncGate(); syncStorePill();
};
$("#lTrocar").onclick = () => {
  Auth.guardar(null); Store.estado = "vazio"; syncGate(); syncStorePill();
};

$("#scrim").onclick = () => { closeModal(); closeSheet(); };
$("#shClose").onclick = closeSheet;
$("#mCancel").onclick = closeModal;
$("#mOk").onclick = async () => { if (modalOk){ const r = await modalOk(); if (r !== false) closeModal(); } };

$("#shSave").onclick = async () => {
  const l = Store.lead(sheetLeadId); if(!l) return;
  coletarSheet(l);
  const ok = await Store.put("leads", l);
  $("#shTitle").textContent = l.empresa || "Sem nome";
  renderAll(); refreshSheet();
  toast(ok ? "Alterações salvas." : "NÃO salvou — ver a barra vermelha.");
};
$("#shDelete").onclick = async () => {
  const l = Store.lead(sheetLeadId); if(!l) return;
  if (!confirm(`Excluir "${l.empresa}" e todo o histórico dele? Isso não volta.`)) return;
  for (const k of Store.toquesDo(l.id)){
    for (const a of (k.anexos || [])) await Anexos.apagar(a);  // senão sobra arquivo órfão no bucket
    await Store.del("toques", k.id);
  }
  for (const k of Store.tarefasDo(l.id)) await Store.del("tarefas", k.id);
  await Store.del("leads", l.id);
  closeSheet(); renderAll(); toast("Lead excluído.");
};

["#fSearch","#fStatus","#fPapel","#fSort"].forEach(s => $(s).addEventListener("input", renderLeads));

$("#alertDismiss").onclick = () => {
  alertDismissedUntil = Date.now() + 15*60*1000; // some por 15 min, depois volta
  $("#alertbar").classList.remove("show");
};

/* ---------- navegação ---------- */
function switchView(name){
  /* Entrar pelo menu sempre começa no panorama. Guardar a última etapa
     aberta faria o usuário voltar numa tela de detalhe sem lembrar por quê. */
  if (name === "funil") funilEtapa = null;
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-"+name));
  $$("nav button").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === name)));
  window.scrollTo({top:0});
}
$("#storePill").onclick = () => switchView("ajustes");

/* O tema já foi aplicado pelo script do <head>; aqui só se alterna.
   Fica no localStorage, não no Supabase: é preferência desta tela, não
   dado teu — no celular tu pode querer claro e no PC escuro. */
$("#themeBtn").onclick = () => {
  const novo = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", novo);
  try { localStorage.setItem("mpmax.tema", novo); } catch(e){}
};

/* ---------- ajustes ---------- */
/* Coluna faltando quebra TODA gravação da tabela, não só o campo dela.
   Então isso é aviso de topo, não nota de rodapé — e vem com o SQL pronto. */
function avisarSchema(){
  const f = Store.faltando || {};
  const tabelas = Object.keys(f);
  const bar = $("#schema");
  if (!tabelas.length){ bar.classList.remove("show"); return; }
  const sql = tabelas.flatMap(t => f[t].map(c =>
    `alter table public.${t} add column if not exists ${c} ${TIPO_COLUNA[c] || "text"};`)).join("\n");
  $("#schemaMsg").textContent = tabelas.map(t => `${t}: ${f[t].join(", ")}`).join(" · ");
  $("#schemaSql").textContent = sql;
  bar.classList.add("show");
}

function barraFalha(msg){
  $("#falhaMsg").textContent = `${Store.fila.length} pendente(s) — ${msg}`;
  $("#falha").classList.add("show");
}
$("#falhaRetry").onclick = () => Store.reenviar();
$("#schemaCopy").onclick = async () => {
  try { await navigator.clipboard.writeText($("#schemaSql").textContent); toast("SQL copiado."); }
  catch(e){ toast("Copia manualmente o bloco abaixo."); }
};

/* O portão. Sem banco o app não tem o que mostrar, e tela vazia parece
   dado perdido — então o estado fica escrito na cara. */
/* Dois portões em sequência: primeiro há projeto configurado, depois há
   sessão aberta. Publicado, o build já resolve o primeiro e o usuário só
   vê o login. Com o arquivo local, ele vê os dois. */
function syncGate(){
  const g = $("#gate"), lg = $("#login"), c = Store.cfg();
  if (Store.estado === "ok"){
    g.classList.remove("show");
    lg.classList.toggle("show", !Auth.logado());
    if (!Auth.logado()){
      /* Dizer a qual projeto o login se refere: com dois projetos abertos
         em abas diferentes, a tela seria idêntica nas duas. */
      const host = (c.url || "").replace(/^https?:\/\//,"").replace(/\/.*$/,"");
      $("#loginNote").textContent = host
        ? `Teus leads são privados. Entra com o usuário que tu criou em ${host}.`
        : "Teus leads são privados. Entra com o e-mail e a senha do usuário que tu criou no Supabase.";
      setTimeout(()=> $("#lEmail")?.focus(), 60);
    }
    return;
  }
  lg.classList.remove("show");
  g.classList.add("show");
  if (Store.estado === "erro"){
    $("#gateTitle").textContent = "Não consegui falar com o Supabase";
    $("#gateNote").textContent = c.fixo
      ? "Os dados estão lá, intactos. É a conexão daqui que não fechou. As credenciais estão fixas no mpmax.js — confere elas lá ou tenta de novo em instantes."
      : "Os dados estão lá, intactos. É a conexão daqui que não fechou. Confere a URL e a chave, ou tenta de novo em instantes.";
    $("#gStatus").textContent = Store.err ? "Erro: " + Store.err : "";
    $("#gConnect").textContent = "Tentar de novo";
  } else {
    $("#gateTitle").textContent = "Conecta o banco";
    $("#gateNote").textContent = "O MPMAX guarda tudo no teu Supabase. Cola a URL do projeto e a chave anon pra começar.";
    $("#gConnect").textContent = "Conectar";
  }
  $("#gUrl").value = c.url || ""; $("#gKey").value = c.key || "";
}

async function conectar(url, key){
  if (!Store.cfg().fixo) Store.setCfg({ url, key });  // com CONFIG preenchido não há o que salvar
  Auth.carregar();
  await Store.init();
  syncGate(); syncStorePill(); syncAjustes(); avisarSchema(); renderAll(); checarAlertas();
  return Store.estado === "ok";
}

$("#gConnect").onclick = async () => {
  const b = $("#gConnect"); b.disabled = true; $("#gStatus").textContent = "Conectando...";
  const ok = await conectar($("#gUrl").value.trim(), $("#gKey").value.trim());
  b.disabled = false;
  if (ok) toast("Conectado ao Supabase.");
};
$("#gTest").onclick = async () => {
  $("#gStatus").textContent = "Testando...";
  try {
    await SupabaseAdapter($("#gUrl").value.trim(), $("#gKey").value.trim()).ping();
    $("#gStatus").textContent = "Conexão ok. As tabelas respondem.";
  } catch(e){ $("#gStatus").textContent = "Falhou: " + e.message; }
};

function syncStorePill(){
  const pill = $("#storePill");
  pill.classList.toggle("on", Store.estado === "ok");
  pill.classList.toggle("err", Store.estado !== "ok");
  $("#storeLabel").textContent = Store.estado === "ok" ? (Auth.email() || "Supabase")
    : Store.estado === "erro" ? "Sem conexão" : "Não configurado";
}
function syncAjustes(){
  const c = Store.cfg();
  $("#stUrl").value = c.url || ""; $("#stKey").value = c.key || "";

  /* Campo editável que não surte efeito é pior que campo travado: tu edita,
     salva, nada muda, e procura o bug no lugar errado. */
  ["#stUrl","#stKey","#stSave","#btnWipe"].forEach(s => $(s).disabled = !!c.fixo);
  $("#cfgFixo").hidden = !c.fixo;

  if (Store.estado === "erro" && Store.err) $("#stStatus").textContent = "Última tentativa falhou: " + Store.err;
  const perm = ("Notification" in window) ? Notification.permission : "indisponível";
  $("#notifStatus").textContent = { granted:"Ativadas.", denied:"Bloqueadas pelo navegador.", default:"Ainda não ativadas." }[perm] || "Este navegador não suporta.";
  $("#btnNotif").disabled = perm === "granted" || perm === "denied";
}
$("#stSave").onclick = async () => {
  const ok = await conectar($("#stUrl").value.trim(), $("#stKey").value.trim());
  $("#stStatus").textContent = ok ? "Conectado." : "Não conectou. " + (Store.err || "");
};
$("#stTest").onclick = async () => {
  $("#stStatus").textContent = "Testando...";
  try {
    await SupabaseAdapter($("#stUrl").value.trim(), $("#stKey").value.trim()).ping();
    $("#stStatus").textContent = "Conexão ok. As tabelas respondem.";
  } catch(e){ $("#stStatus").textContent = "Falhou: " + e.message; }
};
/* Com um banco só e várias máquinas, a cópia em memória envelhece. */
$("#stReload").onclick = async () => {
  $("#stStatus").textContent = "Recarregando...";
  try { await Store.recarregar(); renderAll(); refreshSheet(); $("#stStatus").textContent = "Dados atualizados."; }
  catch(e){ $("#stStatus").textContent = "Falhou: " + e.message; }
};

$("#btnExport").onclick = () => {
  const blob = new Blob([JSON.stringify(Store.db,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mpmax-backup-${todayISO()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
};
$("#btnImport").onclick = () => $("#fileImport").click();
$("#fileImport").onchange = async e => {
  const f = e.target.files[0]; if(!f) return;
  try{
    const data = JSON.parse(await f.text());
    let n = 0;
    for (const tabela of ["leads","toques","tarefas"]){
      for (const r of (data[tabela]||[])) { if (r && r.id){ await Store.put(tabela, r); n++; } }
    }
    renderAll(); toast(`${n} registro(s) enviados ao Supabase.`);
  } catch(err){ toast("Arquivo inválido: " + err.message); }
  e.target.value = "";
};
$("#btnWipe").onclick = async () => {
  if (!confirm("Esquecer a URL e a chave neste navegador? Teus dados continuam no Supabase — tu só vai precisar colar as credenciais de novo.")) return;
  Store.limparCfg();
  await Store.init(); syncGate(); syncStorePill(); syncAjustes(); renderAll();
};
$("#btnNotif").onclick = async () => {
  if (!("Notification" in window)) return;
  await Notification.requestPermission(); syncAjustes();
};

function toast(msg){
  const el = $("#toast"); el.textContent = msg; el.classList.add("show");
  clearTimeout(el._t); el._t = setTimeout(()=> el.classList.remove("show"), 2600);
}

/* ---------- boot ---------- */
/* As contagens da barra lateral são informação, não enfeite: dizem onde
   há trabalho antes de a pessoa abrir a tela. */
function renderRail(){
  const hoje = todayISO();
  let pend = 0;
  for (const l of Store.db.leads){
    if (["desqualificado","reuniao_realizada","no_show","descartado"].includes(l.status)) continue;
    const p = proximoPasso(l);
    if (!p || !l.cadencia_inicio) continue;
    if (daysBetween(hoje, addDays(l.cadencia_inicio, p.dia-1)) <= 0) pend++;
  }
  const tarefas = Store.db.tarefas.filter(tarefaVencida).length;
  const ativos = Store.db.leads.filter(l => colunaDo(l)).length;

  const set = (id, n, hot) => {
    const el = $(id); if(!el) return;
    el.textContent = n || "";
    el.classList.toggle("hot", !!hot && n > 0);
  };
  set("#c-hoje", pend, true);
  set("#c-funil", ativos, false);
  set("#c-leads", Store.db.leads.length, false);
  set("#c-tarefas", tarefas, true);
}

function renderAll(){ renderHoje(); renderFunil(); renderLeads(); renderTarefas(); renderRail(); }

(async function boot(){
  await Store.init();
  syncGate(); syncStorePill(); syncAjustes(); avisarSchema(); renderAll();
  if (Store.estado === "ok") checarAlertas();
  setInterval(() => { if (Store.estado === "ok") checarAlertas(); }, 30000);
  // Se a máquina dormiu, ao voltar o foco a varredura roda na hora.
  document.addEventListener("visibilitychange", () => { if(!document.hidden) checarAlertas(); });
})();
