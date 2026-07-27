# Como contribuir

Obrigado pelo interesse em contribuir com o Octob. Correções, melhorias de documentação e novas funcionalidades são bem-vindas.

## Antes de começar

Para desenvolver localmente, você precisa de:

- Git;
- Node.js `20.20.x` ou `22.22+`;
- Yarn Classic (`1.x`);
- toolchain nativa da sua plataforma quando a alteração envolver `better-sqlite3`, `node-pty` ou o módulo do Ghostty.

Consulte o [README](README.md) para conhecer os agentes suportados, as dependências nativas e a arquitetura do projeto.

## Preparando o ambiente

Faça um fork do repositório ou clone uma cópia na qual você tenha permissão de escrita:

```bash
git clone https://github.com/mayklink/Octo-b.git
cd Octo-b
yarn install
yarn dev
```

Crie uma branch curta e descritiva a partir da `main`:

```bash
git switch main
git pull --ff-only
git switch -c feature/minha-alteracao
```

Prefixos sugeridos:

- `feature/` para funcionalidades;
- `fix/` para correções;
- `docs/` para documentação;
- `refactor/` para mudanças internas sem alteração intencional de comportamento.

## Organização do código

- `src/main`: integrações com o sistema operacional, banco de dados, Git, agentes e handlers IPC;
- `src/preload`: APIs expostas de forma controlada ao renderer;
- `src/renderer`: interface React, hooks, stores, estilos e traduções;
- `src/shared`: tipos e contratos usados por mais de um processo;
- `src/native`: integração nativa opcional do Ghostty para macOS.

Ao alterar um contrato IPC, atualize em conjunto o handler no processo principal, a API do preload e os tipos consumidos pelo renderer.

## Diretrizes

- escreva TypeScript com tipos explícitos nas fronteiras entre módulos;
- mantenha componentes e serviços focados em uma responsabilidade;
- preserve a separação de segurança entre `main`, `preload` e `renderer`;
- não exponha diretamente APIs do Node.js ao renderer;
- use os aliases existentes (`@`, `@main` e `@shared`) quando aplicáveis;
- adicione textos visíveis ao usuário nas traduções `en` e `pt-BR`;
- não inclua tokens, credenciais, bancos locais, logs ou arquivos pessoais no commit;
- mantenha mudanças fora do escopo em commits separados.

O projeto ainda não possui comandos dedicados de lint ou testes automatizados. Portanto, valide ao menos a compilação e faça uma verificação manual do fluxo alterado.

## Validando uma alteração

Execute a build de produção:

```bash
yarn build
```

Para alterações específicas de empacotamento, execute também o comando da plataforma correspondente:

```bash
yarn build:win
yarn build:mac:unsigned
yarn build:linux
```

Antes de abrir o pull request, confira:

- se a aplicação inicia com `yarn dev`;
- se o fluxo alterado funciona na plataforma testada;
- se erros e estados vazios continuam compreensíveis;
- se as traduções necessárias foram atualizadas;
- se nenhum segredo ou arquivo gerado entrou no diff;
- se `yarn build` termina com sucesso.

## Commits

Use mensagens curtas, no imperativo e que descrevam o resultado da alteração. Exemplos:

```text
Add contribution guide
Fix Windows worktree path handling
Update agent setup translations
```

Evite misturar refatorações amplas com uma correção pequena no mesmo commit.

## Pull requests

Abra o pull request contra a branch `main` e inclua:

- um resumo objetivo do que mudou;
- a motivação da alteração;
- como o comportamento foi validado;
- plataformas testadas;
- imagens ou gravações quando houver mudança visual;
- issues relacionadas, quando existirem.

Mantenha o pull request pequeno o suficiente para ser revisado com segurança. Se uma mudança exigir migração do banco, alteração de IPC ou uma nova permissão do Electron, destaque isso na descrição.

## Reportando problemas

Ao abrir uma issue, informe:

- sistema operacional e versão;
- versão do Octob;
- CLI de agente envolvida e sua versão;
- passos para reproduzir;
- comportamento esperado e observado;
- logs relevantes sem credenciais ou conteúdo sensível.

Logs de diagnóstico podem estar em `~/.octob/logs`. Revise-os antes de compartilhar.

## Segurança

Não publique vulnerabilidades, tokens ou dados sensíveis em issues públicas. Para uma possível falha de segurança, entre em contato de forma privada com o mantenedor do repositório.
