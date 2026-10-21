# Subir o MPMAX no Netlify

## Antes de tudo: leia isto

`.env` **não esconde a chave**. Num site estático o valor vai parar no JavaScript que o navegador baixa — qualquer visitante abre o DevTools e lê. Isso não tem solução: é como site estático funciona. O `.env` serve para uma coisa só, que é a chave não entrar no teu repositório git.

A proteção não vem de esconder a chave. Vem de **fazer a chave não valer nada sozinha**. É o que o `mpmax-login.sql` faz: cada linha do banco passa a ter dono, e toda policy exige sessão aberta. Depois disso, quem achar a URL do site vê a tela de login e para aí.

**Roda o `mpmax-login.sql` ANTES de publicar.** Sem ele, a chave exposta dá acesso total ao teu pipeline.

## Passo 0 — fechar o banco

1. Supabase → **Authentication → Users → Add user**. Cria teu usuário com e-mail e senha, e marca **Auto Confirm User**.
2. **Authentication → Sign In / Providers** → desliga **Allow new users to sign up**. Senão qualquer visitante cria conta no teu projeto.
3. Abre o `mpmax-login.sql`, troca o e-mail na seção 2 pelo teu, e roda o arquivo inteiro no SQL Editor.
4. As duas consultas do fim têm que voltar `rowsecurity = true` nas três tabelas e `orfas = 0`.

Se as órfãs não vierem zero, para: tem linha sem dono e ela vai sumir da tela quando a RLS entrar.

## Passo a passo

### 1. Terminal, na pasta do projeto

```bash
cd caminho/para/mpmax
```

Confere o Node (precisa 18 ou maior):

```bash
node --version
```

### 2. Cria o `.env`

```bash
cp .env.example .env
```

Abre o `.env` e preenche com a URL e a chave **anon** do teu projeto:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxx
```

O `.gitignore` já ignora o `.env`. Confere antes de commitar:

```bash
git status
```

Se `.env` aparecer na lista, **para** e resolve o `.gitignore` antes de seguir.

### 3. Testa local

```bash
npm run build
```

Deve imprimir `dist/ pronto`. Se faltar variável, ele falha de propósito — melhor falhar do que publicar site quebrado.

Para abrir:

```bash
npm run dev
```

e acessa `http://localhost:8000`.

### 4. Git

```bash
git init
git add .
git commit -m "MPMAX"
```

Antes de mandar pro GitHub, confirma que a chave não foi junto:

```bash
git grep -i "supabase_anon_key\|sb_publishable\|eyJ" -- . ':!*.example' ':!DEPLOY.md'
```

Se voltar alguma linha de arquivo real, a chave vazou pro commit. Resolve antes de dar push — histórico de git é difícil de limpar depois.

```bash
git remote add origin git@github.com:SEUUSUARIO/mpmax.git
git push -u origin main
```

### 5. Netlify

1. app.netlify.com → **Add new site** → **Import an existing project** → GitHub → escolhe o repositório.
2. O `netlify.toml` já define build e publish. Os campos vêm preenchidos: comando `node build.mjs`, diretório `dist`. Não mexe.
3. Antes de dar deploy, vai em **Site settings → Environment variables** e cria as duas:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. **Deploy site**.

Sem as variáveis o build falha com a mensagem dizendo exatamente o que faltou. É proposital.

### 6. CORS do Supabase

Em geral o Supabase já aceita qualquer origem na API REST. Se depois de publicar o app reclamar de conexão, confere em Project Settings se há restrição de origem e libera o domínio do Netlify.

## Deploy pela CLI, sem GitHub

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set SUPABASE_URL "https://abcdefgh.supabase.co"
netlify env:set SUPABASE_ANON_KEY "sb_publishable_xxxx"
netlify deploy --build --prod
```

## Se o build falhar com "Exposed secrets detected"

A detecção automática do Netlify varre a saída do build atrás de credencial e acha a chave anon no `dist/config.js`, onde o `build.mjs` põe de propósito. É falso positivo: a chave anon é pública por construção e quem protege os dados é a RLS.

O `netlify.toml` já traz `SECRETS_SCAN_OMIT_KEYS` e `SECRETS_SCAN_OMIT_PATHS`, que resolvem a varredura normal. Para a detecção automática, que é separada, cria na interface:

- **Key:** `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES`
- **Value:** o valor da tua chave anon

Em Project configuration → Environment variables → Add a variable. Depois Deploys → Trigger deploy → Deploy project.

Esse valor fica só na interface, nunca no `netlify.toml` — o arquivo vai pro git e a ideia é não commitar valor nenhum.

Desligar a varredura inteira com `SECRETS_SCAN_ENABLED=false` também funciona, e é pior: tu perde a rede de proteção no dia em que colar uma chave que de verdade não pode vazar.

## O que o login resolve, e o que não resolve

**Resolve:** a chave anon exposta no JavaScript deixa de dar acesso. Sem e-mail e senha, ela não lê nem grava nada. Os prints ficam em pasta por dono, e a policy do Storage impede um usuário de ler a pasta do outro.

**Não resolve:** senha fraca. A segurança toda passou a depender dela. Usa uma senha longa e que tu não use em outro lugar.

**Não resolve:** se tu rodar o `mpmax-login.sql` pela metade. As policies abertas da Opção A precisam cair; se ficarem, o PostgREST libera a linha quando qualquer policy permite, e a nova regra vira enfeite. A seção 3 do script cuida disso — não pula ela.

Se quiser uma camada a mais, Netlify → Site settings → Access control → Password protection fecha o site inteiro. É independente do login do banco; os dois podem conviver.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run build` | Gera `dist/` |
| `npm run dev` | Build + servidor em `localhost:8000` |

## Arquivos do deploy

| Arquivo | Papel |
|---|---|
| `build.mjs` | Lê `.env` ou o ambiente e escreve `dist/config.js`. Zero dependência. |
| `netlify.toml` | Comando de build, pasta publicada e cabeçalhos de segurança. |
| `.env.example` | Modelo. Vai pro git. |
| `.env` | Tuas credenciais. **Nunca** vai pro git. |
| `dist/` | Saída do build. Gerada, não versionada. |
