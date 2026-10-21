# MPMAX

CRM pessoal de pré-venda outbound. Roda no navegador, guarda tudo no teu Supabase.

## Arquivos

| Arquivo | O que é |
|---|---|
| `mpmax.html` | Estrutura. É este que tu abre. |
| `mpmax.css` | Estilos. Os tokens de cor estão em `:root`, nas primeiras linhas. |
| `mpmax.js` | Lógica. O bloco `CONFIG` fica no topo. |
| `mpmax-supabase.sql` | Script do banco. Roda uma vez, no Supabase. |

**Os três primeiros têm que ficar na mesma pasta.** Se faltar um, o app abre sem estilo ou sem funcionar.

## Instalação

**1. Cria o projeto no Supabase**

Região: South America (São Paulo). Guarda a senha do banco que ele pedir — não dá pra recuperar depois.

**2. Roda o SQL**

SQL Editor → New query → cola o `mpmax-supabase.sql` inteiro → Run.

Cria as três tabelas, o bucket dos prints e as policies.

**3. Pega as credenciais**

Project Settings → API (a URL) e Project Settings → API Keys (a chave **anon**).

Se o menu estiver diferente, deriva a URL do endereço do navegador: estando dentro do projeto, o endereço é `supabase.com/dashboard/project/SEUREF`, e a Project URL é `https://SEUREF.supabase.co`.

Nunca use a **service_role**. Ela ignora RLS.

**4. Conecta**

Duas opções, escolhe uma:

- **Pela tela:** abre o `mpmax.html` e cola nos campos que aparecem. Fica salvo no navegador. Tem que repetir em cada máquina.
- **Fixo no código:** preenche o `CONFIG` no topo do `mpmax.js`. Conecta sozinho, nunca mais pergunta. Mas a credencial passa a andar junto com o arquivo — não comita isso em repositório.

## Se der erro

| O que aparece | O que é |
|---|---|
| `404` | A tabela não existe. O SQL não rodou, ou falhou no meio. |
| `401` / `Invalid API key` | Chave errada ou cortada. Usa o botão de copiar do Supabase, não arrasta com o mouse. |
| `permission denied for table leads` | As tabelas foram criadas mas o bloco de RLS não rodou. |
| `403` ao anexar print | Falta a policy do `storage.objects`. É a última linha do SQL, a mais esquecida. |
| `Failed to fetch`, sem número | CORS do `file://`. Ver abaixo. |

### Abrir por servidor local

Se o navegador bloquear a conexão ao abrir com dois cliques:

```
cd pasta-do-mpmax
python3 -m http.server 8000
```

e acessa `localhost:8000/mpmax.html`.

## Login

O app pede e-mail e senha. O usuário é criado no Supabase em Authentication → Users, e os dados ficam amarrados a ele: cada linha do banco tem dono e nenhuma policy libera nada sem sessão aberta.

A sessão fica guardada neste navegador e se renova sozinha a cada hora. **Sair da conta** em Ajustes encerra a sessão e volta pro login. **Desconectar** apaga também a URL e a chave guardadas aqui.

Para ligar isso num banco que já existe, roda o `mpmax-login.sql`.

## Tela

Feito para computador. Largura mínima 1080px — abaixo disso a página rola em vez de reorganizar. Não há versão de celular, e isso é decisão de projeto: um funil de treze colunas e uma tabela de seis colunas não cabem num telefone sem virar outra coisa.

## Tema claro e escuro

Botão de sol/lua no rodapé da barra lateral. Na primeira abertura segue o teu sistema; depois disso vale a tua escolha.

Fica no `localStorage`, não no Supabase — é preferência desta tela, não dado teu. Por isso tu pode ter claro no celular e escuro no PC.

Para mexer nas cores: tudo sai dos tokens no `:root` do `mpmax.css`. O bloco `:root[data-theme="light"]` logo abaixo redefine os mesmos nomes. Não há nenhum hex solto no resto do arquivo, então trocar ali muda o app inteiro.

## Como usar

**Hoje** — o que vence hoje e o que está atrasado. É por onde começar o dia.

**Navegação** — barra lateral fixa à esquerda. Os números ao lado de cada item são contagem viva: toques pendentes em Hoje, leads ativos no Funil, tarefas vencendo. Ficam em âmbar quando há trabalho esperando.

**Funil é a tela inicial.** Abre com as 5 etapas do caminho principal em colunas, com os cards dos leads, mais contagem, valor somado e quantos estão atrasados em cada uma. As saídas — No-show e Desqualificado — ficam à direita, separadas por um filete, porque não são avanço: somá-las ao caminho daria leitura falsa de progresso.

**Tentativa de contato** é uma coluna só na tela inicial. Clicando no cabeçalho dela, abre o quadro das 7 tentativas, onde dá pra arrastar entre elas. Nas outras etapas, clicar não entra em lugar nenhum: os cards já estão ali.

Sete colunas cabem numa tela de 1080px pra cima. Treze não cabiam, e era por isso que existia rolagem lateral.

**Canais de contato** — o painel do lead tem WhatsApp, Instagram e site. Os botões no topo abrem direto: número vira link de wa.me com DDI 55, @perfil vira o endereço do Instagram, domínio solto ganha https.

**Muito importante** — marcação de prioridade, não etapa. Um lead prioritário pode estar em qualquer ponto do funil, então virar coluna obrigaria a escolher entre "importante" e "reunião agendada", que não se excluem. A estrela aparece no card e no avatar da tabela.

**No-show tem motivo próprio**, separado do de desqualificação. Faltar não é sair do funil.

**Recolher blocos** — na tela de Hoje, clica no título de um bloco (Atrasados, Para hoje, Reunião agendada) pra recolher. A contagem continua visível e o que ficou recolhido é lembrado neste navegador. Cada lead aparece numa coluna só. As colunas: Tentativa 1 a 7, Conectados, Decisor envolvido, Desqualificado, Reunião agendada, No-show, Reunião realizada.

Tu move de qualquer coluna para qualquer outra: arrastando no computador, pelo botão **Mover** no card, ou pelo campo Status no painel do lead.

- **Avançar para uma tentativa à frente** marca os dias saltados como **pulados** — tracejados na régua, nunca como feitos. O histórico não registra ligação que não houve.
- **Voltar para uma tentativa anterior** limpa as marcas dos dias dali em diante. Os toques registrados continuam no histórico do lead; o que some é a marcação na régua. Ele pede confirmação quando há o que apagar.
- **Desqualificar** pede o motivo: fora do ICP, não tem fit, ou não é o momento. O motivo aparece no card.

**Leads** — lista completa, com busca e filtro.

**Tarefas** — compromissos com hora marcada. O alerta dispara sozinho com a aba aberta. Para avisar fora da aba, ativa as notificações em Ajustes.

### Cadência

Cada lead tem 7 dias de tentativa, com canal por dia (ligação, WhatsApp, e-mail). As datas saem todas do campo "Dia 1 começa em" — mudar essa data reposiciona a cadência inteira.

Clicar numa célula da régua registra o toque e marca o dia. O que tu escrever ali vira histórico.

### Qualificação

O painel do lead confere os critérios juntos e avisa quando falta algum.

Os critérios e os rótulos ficam no bloco `NEGOCIO`, no topo do `mpmax.js`:

```javascript
const NEGOCIO = {
  qualTitulo:  "Reunião válida",
  valorLabel:  "Verba mensal estimada (R$)",
  valorMin:    0,
  valorMax:    null,          // null = sem teto
  segmentoLabel: "Segmento",
  segmentoDica:  "nicho, tipo de operação, origem",
  fitLabel:    "Tem fit com o que a gente vende",
  exigirDecisor: true         // false remove o critério
};
```

Nenhum nome de produto, plataforma ou faixa de valor está cravado em outro lugar do código. Trocar de empresa ou de ICP é editar esse bloco.

## Segurança, sem rodeio

A chave anon fica visível: no navegador ou no próprio arquivo. Ela não é segredo — quem protege as tabelas é a RLS.

O SQL entregue liga a RLS e abre tudo para o papel `anon`. Isso **não protege nada**; serve para deixar explícito que está aberto. Quem tiver a URL mais a chave lê e escreve teu pipeline inteiro e vê teus prints.

A proteção real é a chave não sair da tua máquina. Se este app for parar em lugar acessível por outras pessoas, o certo é ligar login (a Opção B comentada no SQL) e mudar o adapter para mandar o token do usuário no lugar da chave anon.
