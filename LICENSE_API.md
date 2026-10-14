# Contrato da API de licenças do Dev+

Este documento descreve o contrato compartilhado pelo cliente desktop, pela API
Bun para desenvolvimento local e pelo backend Supabase para produção. O cliente
continua consultando somente uma API; ele nunca acessa a tabela de licenças.

## Configuração

Copie `license-server/.env.example` para `.env` na raiz para executar a API e o
cliente localmente. Gere um segredo administrativo aleatório com pelo menos 32
caracteres e substitua `LICENSE_ADMIN_TOKEN`. Rode `bun run license:server` para
iniciar a API e `bun run license:admin -- create` para emitir uma chave mensal.
A configuração de exemplo usa localhost e não serve para distribuir aos
clientes. Antes de um build público, defina `VITE_LICENSE_API_URL` com a URL
HTTPS real do backend implantado; esse valor é público e não pode conter
segredos.

O valor é público e será incluído no bundle. Nunca coloque chaves privadas,
tokens administrativos ou segredos nesse valor ou em qualquer variável `VITE_*`.
Em produção, use HTTPS. O serviço deve permitir CORS somente para as origens
reais do cliente web e do cliente desktop distribuído; não habilite `*` com
credenciais. As requisições usam `Content-Type: application/json` e
`Accept: application/json`.

## Supabase

O modo Supabase usa PostgreSQL e duas Edge Functions. `license-api` atende
ativação e consulta do app; `license-admin` exige uma sessão Supabase Auth e uma
allowlist de IDs de usuários. As tabelas ficam no schema privado, sem acesso
direto pelos clientes. O app usa somente a chave publishable; a chave secret
fica nas Edge Functions.

### Desenvolvimento local

- Instale Docker Desktop e rode `bun run supabase:start`.
- Em outro terminal, rode `bun run supabase:reset` para aplicar a migração e
  `bun run supabase:functions` para servir as Edge Functions localmente.
- `supabase status` mostra a URL e a chave publishable locais. Configure no
  `.env.local` `VITE_LICENSE_API_MODE=supabase`, `VITE_SUPABASE_URL`,
  `VITE_LICENSE_API_URL` (a mesma URL) e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Crie um arquivo local ignorado pelo Git em
  `supabase/functions/.env.local`, contendo `LICENSE_ADMIN_USER_IDS=<UUID>` e,
  se necessário, `LICENSE_CORS_ORIGINS` e `LICENSE_ADMIN_ALLOWED_ORIGINS`.
  Execute `bunx supabase functions serve --env-file supabase/functions/.env.local`
  para carregar essas configurações nas Functions.
- Crie uma conta administrativa de teste no Auth local, copie o UUID do usuário
  para `LICENSE_ADMIN_USER_IDS` e reinicie o servidor das Functions. Não habilite
  cadastro público no projeto hospedado.

### Projeto hospedado

1. Crie um projeto Supabase, instale/execute o CLI versionado pelo repositório,
   faça `supabase login` e `supabase link --project-ref <referência>`.
2. Aplique a migração com `supabase db push` e publique as Functions com
   `supabase functions deploy license-api` e
   `supabase functions deploy license-admin`.
3. Configure os secrets das Functions: `LICENSE_ADMIN_USER_IDS` com os UUIDs
   administrativos, `LICENSE_CORS_ORIGINS` com a origem desktop `app://soulfire`
   e origens do cliente que realmente ativarem licenças, e
   `LICENSE_ADMIN_ALLOWED_ORIGINS` com a origem real do painel.
4. Desative a criação pública de contas no Supabase Auth. Crie os usuários
   administrativos manualmente e adicione seus UUIDs à allowlist.
5. Hospede o painel como SPA. O painel está na rota `/license-admin`; o arquivo
   `vercel.json` já encaminha rotas da SPA para `index.html`.
6. No ambiente de build do app e do painel, configure
   `VITE_LICENSE_API_MODE=supabase`, `VITE_SUPABASE_URL`,
   `VITE_LICENSE_API_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Gere novamente o
   instalador desktop para incorporar esses valores públicos.

O Supabase precisa ser conectado à conta/projeto real antes de a API ficar
disponível na internet. A chave administrativa de um projeto nunca deve entrar
no `.env` do frontend, no build do cliente ou no repositório.

## Ativação

`POST {baseUrl}/v1/licenses/activate`

```json
{
  "licenseKey": "<chave fornecida ao usuário>",
  "device": {
    "id": "<identificador aleatório da instalação gerado pelo cliente Electron>",
    "platform": "<navigator.platform>"
  }
}
```

`device.id` é um identificador aleatório por instalação, armazenado cifrado pelo
Electron usando o armazenamento seguro do sistema operacional. O backend guarda
somente o hash desse identificador e vincula cada licença a uma instalação. Uma
licença permite uma instalação por vez. `device.platform` é somente informação
descritiva. O cliente não envia identificador de hardware, `User-Agent` ou outro
dado de fingerprint. Repetir a ativação na instalação vinculada é idempotente.
Para transferir uma licença, o administrador pode executar `reset-device`; o
próximo uso vinculará a chave à instalação nova sem reiniciar o vencimento.

O aplicativo desktop salva a chave localmente apenas depois de receber uma
resposta `active`, usando o armazenamento seguro do sistema operacional. A cada
inicialização, o aplicativo consulta o endpoint de status e só então libera as
demais rotas. Falha de rede, API sem configuração ou qualquer outro status
bloqueia o acesso até uma validação online bem-sucedida. O cliente web não aplica
esse bloqueio; ele é aplicado no aplicativo desktop.

## Consulta

`POST {baseUrl}/v1/licenses/status`

```json
{
  "licenseKey": "<chave fornecida ao usuário>",
  "device": { "id": "<id da instalação>" }
}
```

Sucesso nas duas operações: HTTP `200` e resposta JSON validada pelo cliente:

```json
{
  "status": "active",
  "plan": "nome do plano",
  "expiresAt": "2030-01-01T00:00:00.000Z",
  "device": { "name": "Este dispositivo", "limit": 2, "used": 1 }
}
```

`status` precisa ser `active`, `inactive`, `expired` ou `revoked`. Os demais
campos são opcionais; `expiresAt`, quando enviado, deve ser uma data ISO 8601
com fuso. O backend é a fonte de verdade para todos esses dados. Para um plano
mensal, o backend deve definir o vencimento como um mês de calendário conforme
a política comercial escolhida e retornar o instante absoluto em `expiresAt`;
o cliente nunca calcula a validade pelo relógio local.

Uma licença mensal é criada como `issued`; o mês de calendário começa na
primeira ativação bem-sucedida. Repetir ativação não reinicia o prazo. Renovação
administrativa estende a validade pelo backend.

## Erros

Respostas de erro devem usar JSON no formato `{ "error": { "code": "..." } }`.
O cliente reconhece estes códigos:

- `INVALID_LICENSE` ou `LICENSE_NOT_FOUND` — chave inválida ou inexistente.
- `DEVICE_LIMIT_REACHED` — chave vinculada a outra instalação.
- `RATE_LIMITED` — limite de requisições atingido; HTTP `429` também é aceito.
- `UNAUTHORIZED` — autorização necessária ou inválida; HTTP `401` e `403` também
  são aceitos.

Outros erros 5xx são apresentados como indisponibilidade do serviço. O cliente
não exibe texto de erro arbitrário retornado pelo servidor. Requisições excedendo
15 segundos são canceladas pelo cliente.

## Requisitos de segurança e operação do backend

- Validar, ativar e consultar a licença exclusivamente no servidor; uma chave
  digitada ou guardada no cliente nunca comprova validade.
- Armazenar somente o hash da chave e limitar tentativas com rate limit
  persistente; nunca revelar a chave existente por meio de mensagens de erro.
- Não registrar chaves completas em logs, métricas, rastreamento ou mensagens de
  erro. O tráfego deve usar HTTPS fora do ambiente local.
- Definir como revogação, renovação, transferência e limite de dispositivos são
  administrados e retornar sempre o estado atualizado do backend.
- Fixar allowlist CORS nas origens de produção confirmadas. O cliente desktop
  pode ter uma origem distinta da web; validar o comportamento no empacotamento
  real antes de liberar o serviço.
- Atrás de proxy reverso, deixe `LICENSE_TRUST_PROXY=true` somente se o proxy
  retirar o `X-Forwarded-For` enviado pelo cliente e inserir o endereço real.
  Caso contrário, mantenha o padrão `false` e configure o rate limit no proxy.
- Manter a chave secret do Supabase somente nas Edge Functions. O painel
  administrativo usa Auth e allowlist no backend.
- Para o modo local Bun, persistir e fazer backup do SQLite; esse banco é
  destinado a uma única instância do serviço. Em produção Supabase, o Postgres
  é a fonte de verdade.

## Ainda necessário para produção

Criar/conectar um projeto Supabase real, aplicar a migração, publicar as Edge
Functions, configurar Auth, allowlists e origens, hospedar o painel e gerar um
instalador com a URL do projeto. Nenhuma API Supabase foi publicada a partir
deste repositório. O sistema não processa pagamentos: emissão e renovação são
manuais. Não anuncie cobrança recorrente ou emissão automática até integrar
pagamentos.

## Administração manual

- `bun run license:server` inicia a API local.
- `bun run license:admin -- create` emite uma chave mensal. Copie-a na hora:
  ela não pode ser recuperada depois.
- `bun run license:admin -- list` lista estados e metadados sem chaves completas.
- `bun run license:admin -- renew <id> [months]` renova uma licença.
- `bun run license:admin -- revoke <id>` revoga uma licença.
- `bun run license:admin -- reset-device <id>` permite ativar a chave em outro PC.

O token administrativo é enviado como Bearer token. Não o coloque em variáveis
`VITE_*`, no cliente desktop ou em scripts públicos.
