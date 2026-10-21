-- =====================================================================
-- MPMAX — ligar login e fechar o banco
--
-- Sai da Opção A (anon lê e escreve tudo) e entra na Opção B (cada linha
-- tem dono). Depois disto, a chave anon exposta no site não abre nada:
-- toda policy exige auth.uid(), que só existe com sessão aberta.
--
-- ANTES DE RODAR:
--   1. Authentication > Providers > Email: confirma que Email está ligado.
--   2. Authentication > Users > Add user: cria teu usuário com e-mail e
--      senha. Marca "Auto Confirm User", senão ele nasce pendente e o
--      login devolve "Email not confirmed".
--   3. Se o projeto for só teu, Authentication > Sign In / Providers e
--      desliga "Allow new users to sign up". Sem isso qualquer visitante
--      cria a própria conta no teu projeto. Ele não veria teus dados,
--      mas encheria teu banco e teu limite de usuários.
--
-- Roda este arquivo inteiro no SQL Editor.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Coluna de dono
--
-- default auth.uid() faz o preenchimento acontecer no banco, não no app.
-- Assim o front-end não precisa mandar user_id em nenhum insert, e não
-- existe o caminho em que ele esquece de mandar e a linha nasce órfã.
-- ---------------------------------------------------------------------
alter table public.leads   add column if not exists user_id uuid default auth.uid();
alter table public.toques  add column if not exists user_id uuid default auth.uid();
alter table public.tarefas add column if not exists user_id uuid default auth.uid();


-- ---------------------------------------------------------------------
-- 2. Adotar as linhas que já existem
--
-- As linhas criadas na Opção A estão com user_id nulo. Quando a RLS
-- entrar, elas deixam de bater em qualquer policy e somem da tela — os
-- dados continuam no banco, mas invisíveis. Este passo dá dono a elas.
--
-- TROCA O E-MAIL ABAIXO pelo do usuário que tu criou.
-- ---------------------------------------------------------------------
do $$
declare dono uuid;
begin
  select id into dono from auth.users where email = 'troca@pelo.teu.email';

  if dono is null then
    raise exception 'Usuário não encontrado. Cria em Authentication > Users e corrige o e-mail acima.';
  end if;

  update public.leads   set user_id = dono where user_id is null;
  update public.toques  set user_id = dono where user_id is null;
  update public.tarefas set user_id = dono where user_id is null;
end $$;


-- ---------------------------------------------------------------------
-- 3. Derrubar as policies abertas
--
-- Se ficarem, a Opção A continua valendo em paralelo: o PostgREST
-- libera a linha se QUALQUER policy permitir. Ligar a nova sem apagar a
-- velha dá sensação de segurança sem segurança nenhuma.
-- ---------------------------------------------------------------------
drop policy if exists anon_tudo  on public.leads;
drop policy if exists anon_tudo  on public.toques;
drop policy if exists anon_tudo  on public.tarefas;
drop policy if exists mpmax_anon on storage.objects;


-- ---------------------------------------------------------------------
-- 4. RLS por dono
-- ---------------------------------------------------------------------
alter table public.leads   enable row level security;
alter table public.toques  enable row level security;
alter table public.tarefas enable row level security;

drop policy if exists dono on public.leads;
drop policy if exists dono on public.toques;
drop policy if exists dono on public.tarefas;

-- using filtra o que sai; with check barra o que entra. Sem o with check,
-- alguém logado poderia gravar linha com user_id de outro.
create policy dono on public.leads   for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dono on public.toques  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dono on public.tarefas for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 5. Prints: cada um na própria pasta
--
-- O app grava em <uid>/<toque>/<arquivo>.jpg. foldername(name)[1] é a
-- primeira pasta do caminho, então a policy compara ela com o dono da
-- sessão.
-- ---------------------------------------------------------------------
drop policy if exists mpmax_dono on storage.objects;
create policy mpmax_dono on storage.objects for all to authenticated
  using      (bucket_id = 'mpmax' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mpmax' and (storage.foldername(name))[1] = auth.uid()::text);


-- ---------------------------------------------------------------------
-- 6. Conferência
--
-- rowsecurity tem que vir true nas três, e órfãs tem que vir 0.
-- ---------------------------------------------------------------------
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('leads','toques','tarefas');

select 'leads' as tabela, count(*) as orfas from public.leads where user_id is null
union all select 'toques',  count(*) from public.toques  where user_id is null
union all select 'tarefas', count(*) from public.tarefas where user_id is null;
