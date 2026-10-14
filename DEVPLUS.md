# Dev+ Control

Distribuição personalizada para `<Dev+/>`, com interface por Dogcode_.
O código original é de SoulFireClient e seus contribuidores; a licença AGPL-3.0
e os avisos originais permanecem em LICENSE e nos arquivos de origem.

## Comandos

- Instalar dependências: `bun install`
- Gerar recursos da logo: `bun run branding:generate`
- Desenvolvimento Electron: `bun run dev`
- Desenvolvimento web: `bun run dev:web`
- Validar traduções e branding: `bun run branding:check`
- TypeScript e lint: `bun run typecheck` e `bun run lint`
- Frontend: `bun run build:web`
- Instalador Windows x64: `bun run build:windows`

O instalador fica em `release-artifacts/DevPlus-Control-Setup.exe` e instala
`Dev+ Control.exe`. Atualizações automáticas estão desativadas; distribua
novas versões personalizadas manualmente. Os endpoints do backend, protocolo
`soulfire:`, protobuf e gerenciamento dos servidores permanecem compatíveis.

## Alterações

Identidade, metadados, janela Sobre, idioma inicial pt-BR, tema escuro azul,
remoção da divulgação opcional e geração de ícones. Escolhas explícitas de
idioma e tema continuam armazenadas. Textos fornecidos pelo servidor e logs
de processos externos continuam sob controle do backend.

O CLI shadcn e as bibliotecas de ícones do frontend ficam nas dependências
de desenvolvimento. O Vite inclui os recursos usados no frontend compilado;
o instalador não precisa carregar cópias desses pacotes de desenvolvimento.

A presença promocional do Discord original está desativada. Para usar uma
presença própria, defina `DEVPLUS_DISCORD_CLIENT_ID` com o ID do seu aplicativo
Discord e envie sua logo como recurso `logo` nesse aplicativo.

## Código-fonte correspondente

Original: https://github.com/soulfiremc-com/SoulFireClient

Antes de distribuir o instalador, disponibilize o código-fonte completo desta
versão modificada, incluindo dependências declaradas, lockfile e scripts de
build. Publique um arquivo de fontes junto ao instalador ou um repositório
com o commit exato. Atualize `public/source-distribution.txt` com esse endereço
e regenere o build. Não há endereço público da versão modificada configurado.

`bun run build:windows` gera também `DevPlus-Control-Source.zip`, incluído
no aplicativo e acessível pela janela Sobre. Distribua esse ZIP junto ao
instalador. `bun run source:package` regenera apenas o pacote de fontes.
