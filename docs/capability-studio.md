# Capability Studio

Em **Experimentos**, descreva uma tela ou integração na conversa ao lado da prévia. O assistente cria uma versão, valida e apresenta a interface. Peça ajustes na mesma conversa. **Manter no Octob** instala a versão escolhida; **Descartar** remove o rascunho. Versões instaladas persistem entre reinicializações e podem ser revertidas.

## Código gerado

- A interface usa HTML, CSS e JavaScript e chama `window.capability.call(input)` para executar a lógica de servidor. Ela roda em um `iframe` separado.
- O handler é JavaScript de Node: uma função `async (input, api) => result` ou código CommonJS com `module.exports = async (input, api) => result`. Ele roda em um processo separado e pode usar `fetch`, `require`, `process`, arquivos e outros recursos que o usuário do Octob possui. O artefato também pode incluir vários arquivos em `files`; o handler carrega módulos relativos com `require('./arquivo.js')`.
- O destino HTTP pode vir de um campo preenchido pelo usuário. Um POST feito na prévia é real; o Studio não restringe a URL a um provedor nem força `api.mock`.
- Na validação, `httpMocks` nos testes substituem chamadas feitas com `fetch` ou `api.fetch`. Uma chamada dessas sem resposta de teste falha. Outros mecanismos de rede ou execução de comandos usados pelo código Node continuam reais também durante os testes. A execução da prévia usa rede real.
- `timeoutMs` na spec ajusta o tempo permitido para cada execução. O padrão é 60 segundos.

Os artefatos ficam em `~/.octob/capabilities`; metadados e execuções ficam em `~/.octob/capability-studio.db`.

O handler gerado tem os privilégios do usuário que executa o Octob. O processo separado permite encerrar uma execução, mas não é uma barreira de segurança para código não confiável. Teste o código e seus efeitos antes de manter a capability.
