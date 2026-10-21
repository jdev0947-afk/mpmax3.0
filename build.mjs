/* =====================================================================
   build.mjs — gera dist/ pronto pro Netlify.

   O que faz: copia os três arquivos e escreve dist/config.js com as
   credenciais vindas do ambiente.

   Zero dependência. Node 18+ já tem tudo, e um build de 60 linhas não
   justifica puxar dotenv e arrastar a árvore de dependências dele —
   num projeto que roda credencial, cada pacote a mais é superfície.
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";

/* .env: local. process.env: Netlify. O ambiente vence, porque em produção
   é ele que manda e um .env esquecido na máquina não pode sobrescrever. */
function lerEnv(){
  const env = {};
  if (existsSync(".env")){
    for (const linha of readFileSync(".env","utf8").split("\n")){
      const t = linha.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      env[t.slice(0,i).trim()] = t.slice(i+1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return { ...env, ...process.env };
}

const env = lerEnv();
const URL = env.SUPABASE_URL || "";
const KEY = env.SUPABASE_ANON_KEY || "";

if (!URL || !KEY){
  console.error("\n  Faltou SUPABASE_URL ou SUPABASE_ANON_KEY.");
  console.error("  Local: cria o .env a partir do .env.example.");
  console.error("  Netlify: Site settings > Environment variables.\n");
  process.exit(1);           // falhar o build é melhor que publicar um site quebrado
}
if (/service_role/i.test(KEY) || KEY.startsWith("sb_secret")){
  console.error("\n  Isso parece a chave service_role. Ela ignora RLS e num site");
  console.error("  público daria controle total do teu banco. Build cancelado.\n");
  process.exit(1);
}

mkdirSync("dist", { recursive: true });
copyFileSync("mpmax.html", "dist/index.html");   // Netlify serve index.html na raiz
copyFileSync("mpmax.css",  "dist/mpmax.css");
copyFileSync("mpmax.js",   "dist/mpmax.js");

writeFileSync("dist/config.js",
`/* Gerado por build.mjs — não edita à mão, não comita.
   Lembrete: isto é código de front-end. A chave abaixo é visível pra
   qualquer visitante. Quem protege os dados é a RLS do Supabase. */
window.__MPMAX = ${JSON.stringify({ url: URL, key: KEY }, null, 2)};
`);

console.log(`\n  dist/ pronto — ${URL}\n`);
