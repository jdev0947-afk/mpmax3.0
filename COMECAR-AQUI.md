# Começar aqui

Teu Supabase já está configurado: usuário criado, cadastro público fechado e RLS por dono ligada (`rowsecurity = true`, zero órfãs). Falta só trocar os arquivos e testar.

## 0. Roda o `mpmax-campos.sql` primeiro

No SQL Editor do Supabase, roda o `mpmax-campos.sql` inteiro. Ele adiciona seis colunas: `whatsapp`, `instagram`, `site`, `importante`, `motivo_ns`, `obs_ns`.

**Antes de trocar os arquivos.** Sem essas colunas o PostgREST recusa o registro inteiro e nenhuma gravação de lead passa. A consulta do fim tem que listar as seis.

## 1. Substitui os arquivos

Na tua pasta do MPMAX, troca estes três pelos desta pasta:

- `mpmax.html`
- `mpmax.css`
- `mpmax.js`

Se preferir, apaga a pasta antiga inteira e usa esta. O único arquivo que não vem aqui é o `.env` — ele fica fora de propósito, pra não ser comitado por acidente.

**Não mexe no Supabase.** Teus leads estão lá, não nos arquivos.

## 2. Roda num servidor local

```bash
cd caminho/para/mpmax
python3 -m http.server 8000
```

Abre no navegador:

```
http://localhost:8000/mpmax.html
```

**Não abre com duplo clique no arquivo.** Em `file://` o navegador bloqueia as chamadas ao Supabase por CORS, e o erro que aparece é `Failed to fetch` sem número — parece credencial errada e não é.

## 3. Conecta e entra

Primeira tela pede a URL do projeto e a chave anon. Pega as duas no Supabase, em Project Settings → API e Project Settings → API Keys.

Segunda tela pede e-mail e senha — o usuário que tu criou no Supabase.

Nenhum arquivo deste projeto guarda esses valores. Eles ficam no `.env` (que o `.gitignore` mantém fora do git) e nas variáveis de ambiente do Netlify. Arquivo que vai pro repositório não carrega credencial — inclusive este.

Depois disso teus leads têm que aparecer.

## Se algo der errado

**Login entra mas a lista vem vazia** — alguma linha ficou sem dono. Roda no SQL Editor:

```sql
select 'leads' as tabela, count(*) as orfas from public.leads where user_id is null
union all select 'toques',  count(*) from public.toques  where user_id is null
union all select 'tarefas', count(*) from public.tarefas where user_id is null;
```

Tem que dar zero nas três.

**"Invalid login credentials"** — e-mail ou senha errados. O Supabase devolve a mesma mensagem nos dois casos de propósito, pra não entregar quais e-mails têm conta.

**"Email not confirmed"** — o usuário nasceu pendente. Authentication → Users, abre o usuário e confirma ele.

**`permission denied for table leads`** — o app está falando sem sessão. Confere se tu trocou mesmo o `mpmax.js` pelo desta pasta.

**`Failed to fetch` sem número** — está abrindo em `file://`. Volta pro passo 2.

**Prints antigos não carregam** — esperado. Eles foram salvos em `toques/<id>/...` e o caminho novo é `<teu-id>/<toque>/...`. A policy do Storage não alcança os antigos. Os novos funcionam normalmente.

## Depois que funcionar

O deploy no Netlify está no `DEPLOY.md`. Agora pode ir ao ar: com a RLS por dono, a chave exposta no JavaScript não abre nada sem login.
