# Integração com o executor — fronteira de confiança

## O que está implementado

O programa `scripts/tfc.py` valida a estrutura e as referências dos artefatos;
confere aprovação por hash, vínculo ao candidato, baseline, arquivos de evidência,
validade temporal e autorização declarada dos produtores; aplica as condições
obrigatórias e os limites informados; produz uma decisão JSON com código de saída.

Ele não implementa sandbox, autenticação, coleta de métricas, supervisão de
processos, treinamento, assinatura de documentos ou integração específica com
um agente. A aprovação declarada só é confiável se o executor proteger sua origem.

## Integração mínima necessária

1. Instale a skill e o validador fora do workspace gravável pelo implementador,
   ou use uma cópia cuja integridade o executor valide de modo independente.
2. O implementador propõe `contract.json`. Um responsável ou política autorizada
   revisa os requisitos e os verificadores. O executor guarda o hash aprovado.
3. O executor gera `current_candidate_id` a partir dos bytes/entradas avaliados,
   não a partir do rótulo que o implementador fornece. Inclua alterações locais,
   testes, configuração relevante e dependências identificadas. Mudanças de
   ambiente relevantes precisam gerar nova identidade ou invalidar evidências.
4. O executor executa procedimentos em ambientes autorizados e coleta saídas
   brutas. Um coletor protegido registra eventos em `run.json` e os artefatos
   referenciados. O implementador pode solicitar verificações, não assinar o
   próprio resultado como `runner` ou `human`.
5. O executor produz `gate-context.json` em área protegida: tarefa, candidato,
   horário, aprovação, produtores e suas permissões, consumo, interrupções,
   bloqueios e novas regressões conhecidas.
6. O executor chama o validador com raízes e arquivos controlados. Só trata
   `status=done` + exit code 0 como autorização, e apenas para o candidato exato.
7. O executor verifica que o candidato não mudou e publica/entrega atomicamente
   essa mesma versão. Resultado antigo não autoriza uma versão nova.

Apenas manter todos os arquivos na mesma pasta editável pelo agente não cria uma
fronteira de confiança. IDs são comparados; identidades não são autenticadas por
este script. Registros não são assinados e a imutabilidade não é imposta localmente.

## Uso do contexto

Use `assets/gate-context.template.json` como estrutura, não como contexto já
confiável. `approved_by` deve identificar autoridade distinta do implementador.
`approval_ref` aponta para a decisão de aprovação. O contexto não é produzido
pela própria LLM implementadora.

Produtores precisam ser cadastrados com categoria e lista explícita dos
verificadores que podem produzir. `runner` cobre verificações determinísticas e
observações de runtime, `human` cobre revisão humana, `model` cobre rubricas LLM
consultivas. Nenhum produtor pode usar o ID do implementador.

Caso não exista integração protegida, o resultado é uma avaliação local assistida.
Não a anuncie como garantia de conclusão autônoma.

## Validade e custo

O horário e os contadores são informados pelo executor. O programa não verifica
um relógio remoto nem consulta a fatura de um provedor. O executor mede custo e
aplica o menor limite entre o contrato e a política do ambiente. Não modifique o
contrato para representar uma autorização de gasto que não existe.

Os limites do contrato são usados pelo gate. Limites mais restritivos do executor
precisam ser aplicados por ele e refletidos em `stop_reason=budget_exhausted` ao
interromper, ou incorporados numa revisão do contrato antes da execução.

## Registro e reavaliação

`run.json` é um snapshot do registro append-only mantido pelo coletor. Eventos não
são apagados para selecionar os favoráveis. A V2 não fornece um banco append-only;
o executor deve garantir essa propriedade.

Inicie um novo `run.json` para cada revisão aprovada e arquive o registro anterior.
Dentro da mesma revisão, mantenha os candidatos anteriores no histórico. Todos
os critérios obrigatórios precisam de evidências do candidato atual para aceitar.

Artefatos externos precisam ser exportados pelo coletor para a raiz de evidências.
Não coloque credenciais, tokens ou informações pessoais desnecessárias em logs.
O programa não acessa URLs, serviços remotos, Git ou ferramentas de teste.

## Estado, processo e saída

O validador não escolhe o próximo comando nem possui um loop autônomo. Ele informa
lacunas. A skill orienta a interpretação dessas lacunas e o executor controla ações.
Um retorno `blocked`, `truncated`, `cancelled` ou `invalid` nunca equivale a sucesso.

Depois de integrar, avalie a skill contra um baseline sem a skill usando tarefas
comparáveis: aceitação por revisão independente, falsos `done`, custo, latência e
retrabalho. Testes do validador comprovam regras implementadas, não eficácia do
processo no seu repositório.
