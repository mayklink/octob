<p align="center">
  <img src="resources/icon.png" alt="Ícone do Octob" width="112" />
</p>

<h1 align="center">Octob</h1>

<p align="center">
  Um workspace desktop para organizar repositórios Git, worktrees, tarefas e sessões paralelas de programação com IA.
</p>

## Sobre o projeto

O Octob reúne o fluxo de desenvolvimento em uma aplicação Electron para Windows, macOS e Linux. Cada repositório adicionado se torna um projeto; a partir dele, é possível criar worktrees isoladas, conversar com diferentes agentes de código, acompanhar alterações e organizar o trabalho em um quadro Kanban.

Os dados da aplicação são armazenados localmente em `~/.octob`, incluindo o banco SQLite (`~/.octob/octob.db`) e anexos. As credenciais e a autenticação dos agentes continuam sendo gerenciadas pelas respectivas CLIs.

## Principais recursos

- gerenciamento de projetos Git, branches e worktrees;
- sessões independentes e paralelas com agentes de IA;
- suporte a OpenCode, Claude Code, Codex, Mistral Vibe, Cursor CLI e Google Antigravity;
- modo de terminal manual para usar outras ferramentas;
- quadro Kanban por projeto, com execução de tarefas por agente;
- importação de tickets do GitHub, Jira e Azure DevOps;
- visualização e edição de arquivos, busca, status Git e diffs;
- operações de commit, push, pull, merge e criação/revisão de pull requests;
- terminal integrado com xterm.js e, no macOS, backend opcional do Ghostty;
- servidores MCP personalizados e presets de integração;
- interface em português do Brasil e inglês;
- atualizações automáticas e telemetria anônima opcional.

## Tecnologias

- Electron, electron-vite e electron-builder;
- React 19 e TypeScript;
- Tailwind CSS e Radix UI;
- Zustand;
- SQLite com `better-sqlite3`;
- CodeMirror, Monaco Editor e xterm.js;
- `simple-git` e `node-pty`.

## Pré-requisitos

Para executar o projeto localmente:

- [Git](https://git-scm.com/);
- Node.js `20.20.x` ou `22.22+`;
- Yarn Classic (`1.x`);
- ao menos uma CLI de agente instalada e autenticada, caso queira usar sessões de IA.

O Octob detecta automaticamente as CLIs disponíveis no `PATH`. Atualmente, as opções integradas são:

| Agente | Executável esperado |
| --- | --- |
| OpenCode | `opencode` |
| Claude Code | `claude` |
| Codex | `codex` |
| Mistral Vibe | `vibe-acp` |
| Cursor CLI | `agent` |
| Google Antigravity | `agy` |

Para os recursos do GitHub, a forma mais simples de autenticação é instalar a [GitHub CLI](https://cli.github.com/) e executar `gh auth login`. Também é possível informar tokens nas configurações de integrações do aplicativo.

### Dependências nativas

Durante a instalação, `better-sqlite3` e `node-pty` são recompilados para a versão do Electron usada pelo projeto.

No Windows, caso a compilação do `node-pty` falhe, instale o Visual Studio Build Tools com a carga **Desktop development with C++** e execute:

```bash
yarn rebuild:app-deps
```

Sem essa ferramenta, a aplicação e o banco local ainda podem funcionar, mas o terminal integrado fica indisponível.

## Instalação e desenvolvimento

Clone o repositório e instale as dependências:

```bash
git clone https://github.com/mayklink/Octo-b.git
cd Octo-b
yarn install
```

Inicie o ambiente de desenvolvimento:

```bash
yarn dev
```

Na primeira execução:

1. escolha uma das CLIs detectadas ou o modo de terminal manual;
2. adicione a pasta de um repositório Git existente;
3. selecione a worktree principal ou crie uma nova;
4. abra uma sessão de IA ou crie uma tarefa no Board.

Não é necessário criar um arquivo `.env` para o desenvolvimento padrão. Configurações de agentes, integrações, MCPs, terminal e privacidade são gerenciadas pela interface do Octob.

## Comandos disponíveis

| Comando | Descrição |
| --- | --- |
| `yarn dev` | inicia o Electron em modo de desenvolvimento |
| `yarn build` | compila os processos main, preload e renderer |
| `yarn preview` | executa uma prévia da build compilada |
| `yarn rebuild:app-deps` | recompila os módulos nativos para o Electron |
| `yarn build:unpack` | gera a aplicação descompactada em `dist/` |
| `yarn build:win` | gera instalador NSIS e arquivo ZIP para Windows |
| `yarn build:mac:unsigned` | gera DMG e ZIP sem assinatura para macOS |
| `yarn build:linux` | gera AppImage, pacote DEB e `tar.gz` para Linux |

Os artefatos empacotados são gravados em `dist/`.

## Estrutura do projeto

```text
src/
├── main/       # processo principal, banco SQLite, Git, agentes e IPC
├── native/     # integração nativa opcional com Ghostty no macOS
├── preload/    # ponte segura entre Electron e a interface
├── renderer/   # aplicação React, componentes, stores e traduções
└── shared/     # tipos e contratos compartilhados
resources/      # ícones e arquivos usados no empacotamento
scripts/        # instalação e rebuild de dependências nativas
```

O processo principal concentra o acesso ao sistema de arquivos, Git, terminal, banco de dados e CLIs. O preload expõe operações controladas por IPC, enquanto o renderer contém a interface React e o estado da aplicação.

## Integrações e privacidade

O Octob pode se conectar a GitHub, Jira e Azure DevOps para importar tarefas e trabalhar com pull requests. Servidores MCP também podem ser cadastrados nas configurações e são enviados apenas para novas sessões de agentes compatíveis quando estiverem ativados.

A telemetria pode ser desativada em **Configurações → Privacidade**. Quando habilitada, registra contagens de uso, versão e plataforma; segundo a implementação atual, não envia nomes de projetos, conteúdo de arquivos, prompts, respostas de IA ou dados Git.

## Builds e releases

O repositório possui workflows do GitHub Actions para:

- gerar artefatos de Windows, macOS e Linux manualmente;
- validar tags no formato `v<versão>`;
- publicar os pacotes e metadados de atualização no armazenamento configurado do projeto.

Para criar uma release, a versão da tag deve ser igual ao campo `version` do `package.json`.

## Contribuindo

Contribuições são bem-vindas. Antes de enviar uma alteração, consulte o [guia de contribuição](CONTRIBUTING.md) para preparar o ambiente, validar o código e abrir um pull request.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).
