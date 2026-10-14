# Validação da personalização

- JSONs de todos os idiomas: válidos.
- pt-BR: todos os namespaces cobertos, chaves e interpoladores verificados.
- TypeScript e lint: aprovados.
- Testes existentes: 40 aprovados, 1 ignorado por ser específico de plataforma.
- Conversão de ícones: dimensões, proporção, transparência e ICO multirresolução aprovados.
- Frontend e módulos Electron: compilados.
- Formatação global: há inconsistências em arquivos originais fora desta alteração.
  Os arquivos modificados que participam da configuração do formatador foram formatados.

A logo do usuário ainda não foi fornecida. Os recursos originais permanecem como
substitutos temporários. Coloque a logo em `branding/devplus-logo.png` e execute
`bun run branding:generate`, seguido de `bun run build:windows`.

A conexão com um servidor remoto Ubuntu real não foi testada nesta sessão:
não há endereço e credenciais de um servidor de teste. Os contratos protobuf,
endpoints e lógica de autenticação e gerenciamento não foram alterados.

Os avisos do build sobre imports dinâmicos do Zod e tamanho dos chunks são
informativos. Nenhuma assinatura digital personalizada foi configurada.
