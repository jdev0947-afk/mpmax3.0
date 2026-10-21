-- =====================================================================
-- MPMAX — campos de contato, prioridade e motivo do no-show
--
-- Roda no SQL Editor do Supabase. É aditivo: não toca em nada que já
-- existe, e o "if not exists" deixa rodar duas vezes sem erro.
--
-- O PostgREST recusa o registro INTEIRO quando o app manda um campo que
-- a tabela não tem. Por isso isto vem antes de trocar os arquivos: sem
-- as colunas, nenhuma gravação de lead passa.
-- =====================================================================

alter table public.leads add column if not exists whatsapp   text;
alter table public.leads add column if not exists instagram  text;
alter table public.leads add column if not exists site       text;

-- Prioridade é marcação, não etapa: um lead importante pode estar em
-- qualquer ponto do funil. Virar etapa obrigaria a escolher entre
-- "importante" e "reunião agendada", que não se excluem.
alter table public.leads add column if not exists importante boolean default false;

-- No-show tem motivo próprio. Faltar não é sair do funil, então
-- reaproveitar motivo_desq misturaria duas saídas diferentes e
-- estragaria qualquer contagem futura.
alter table public.leads add column if not exists motivo_ns  text;
alter table public.leads add column if not exists obs_ns     text;

-- Confere: tem que listar as seis.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'leads'
  and column_name in ('whatsapp','instagram','site','importante','motivo_ns','obs_ns')
order by column_name;
