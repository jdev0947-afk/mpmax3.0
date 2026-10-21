-- =====================================================================
-- MPMAX — schema Supabase
-- Cola isso inteiro no SQL Editor do Supabase e roda uma vez.
-- =====================================================================

create table if not exists public.leads (
  id                  text primary key,
  empresa             text not null,
  cnpj                text,
  plataforma          text,
  plataforma_integra  boolean default false,
  contato             text,
  papel               text,          -- decisor | comercial | outro
  email               text,
  telefone            text,
  tpv                 numeric,       -- TPV mensal estimado em R$
  status              text default 'novo',
  obs                 text,
  cadencia_inicio     date,
  cadencia            jsonb,         -- [{dia,canal,feito,feito_em,pulado}] x7
  motivo_desq         text,          -- icp | sem_fit | timing
  obs_desq            text,
  criado_em           timestamptz default now()
);

create table if not exists public.toques (
  id         text primary key,
  lead_id    text references public.leads(id) on delete cascade,
  canal      text,                   -- whatsapp | email | ligacao
  data       date,
  nota       text,
  dia        int,                    -- dia da cadência, null se avulso
  anexos     jsonb default '[]',     -- [{id,meio,ref,nome,tipo,tam}]
  criado_em  timestamptz default now()
);

-- Se a tabela já existia da primeira versão, roda só esta linha:
alter table public.toques add column if not exists anexos jsonb default '[]';

-- Se as tabelas já existiam, roda também estas duas:
alter table public.leads add column if not exists motivo_desq text;
alter table public.leads add column if not exists obs_desq    text;

create table if not exists public.tarefas (
  id         text primary key,
  lead_id    text references public.leads(id) on delete set null,
  titulo     text not null,
  quando     timestamptz,
  feito      boolean default false,
  avisado    boolean default false,  -- evita repetir o alerta
  criado_em  timestamptz default now()
);

-- Índices nas colunas que o app filtra e ordena de verdade.
create index if not exists toques_lead_idx  on public.toques (lead_id);
create index if not exists tarefas_lead_idx on public.tarefas (lead_id);
create index if not exists tarefas_quando_idx on public.tarefas (quando) where feito = false;

-- =====================================================================
-- STORAGE — bucket dos prints
-- =====================================================================
-- Bucket PRIVADO de propósito. O app pede uma URL assinada que vale 1h.
-- Se fosse público, qualquer um com o link do arquivo veria o print da
-- tua conversa pra sempre, sem chave nenhuma.

insert into storage.buckets (id, name, public, file_size_limit)
values ('mpmax', 'mpmax', false, 5242880)
on conflict (id) do nothing;

-- Policies do bucket. Vão junto com a OPÇÃO que tu escolher abaixo.
--
-- Para a OPÇÃO A (sem login):
-- create policy mpmax_anon on storage.objects for all to anon
--   using (bucket_id = 'mpmax') with check (bucket_id = 'mpmax');
--
-- Para a OPÇÃO B (com login), cada um só enxerga a própria pasta:
-- create policy mpmax_dono on storage.objects for all to authenticated
--   using (bucket_id = 'mpmax' and owner = auth.uid())
--   with check (bucket_id = 'mpmax' and owner = auth.uid());

-- =====================================================================
-- RLS — leia antes de rodar
-- =====================================================================
-- A anon key fica visível no HTML. Ela NÃO é a proteção. A proteção é RLS.
-- Abaixo há duas opções. Escolhe uma. Não roda as duas.
-- =====================================================================

-- OPÇÃO A — uso solo, sem login, projeto não compartilhado.
-- Qualquer um com a URL + anon key lê e escreve tudo. Aceitável só se
-- o arquivo HTML nunca sair da tua máquina e tu não publicar a chave.
--
-- alter table public.leads   enable row level security;
-- alter table public.toques  enable row level security;
-- alter table public.tarefas enable row level security;
-- create policy anon_tudo on public.leads   for all to anon using (true) with check (true);
-- create policy anon_tudo on public.toques  for all to anon using (true) with check (true);
-- create policy anon_tudo on public.tarefas for all to anon using (true) with check (true);

-- OPÇÃO B — com login (recomendado se o arquivo for sair da máquina).
-- Exige adicionar auth no app: o adapter passa a mandar o access_token
-- do usuário no header Authorization em vez da anon key.
--
-- alter table public.leads   add column if not exists user_id uuid default auth.uid();
-- alter table public.toques  add column if not exists user_id uuid default auth.uid();
-- alter table public.tarefas add column if not exists user_id uuid default auth.uid();
--
-- alter table public.leads   enable row level security;
-- alter table public.toques  enable row level security;
-- alter table public.tarefas enable row level security;
--
-- create policy dono on public.leads   for all to authenticated
--   using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy dono on public.toques  for all to authenticated
--   using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy dono on public.tarefas for all to authenticated
--   using (user_id = auth.uid()) with check (user_id = auth.uid());
