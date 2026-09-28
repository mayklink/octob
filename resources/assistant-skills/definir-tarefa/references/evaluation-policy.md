# Política de avaliação — V2

## 1. Aceitação sem score global

Uma condição é aprovada somente se TODOS os seus verificadores obrigatórios
forem aprovados em TODOS os ambientes que a condição lista. Cada condição
precisa de pelo menos um verificador e ambiente; cada contrato precisa de pelo
menos um requisito obrigatório e uma condição de regressão obrigatória.

Restrições rígidas e regressões não podem ser opcionais. O validador rejeita
referências inexistentes, identificadores duplicados e uso de juiz LLM como
verificador de obrigação. Uma rubrica LLM pode orientar investigação; uma revisão
humana documentada pode aprovar uma condição sem verificação automática.

`done` exige contrato aprovado, candidato atual, baseline verificável, obrigações
aprovadas, ausência de bloqueios e novas regressões relatadas pelo executor,
ausência de interrupção e respeito ao orçamento. Critérios opcionais continuam
visíveis, mas não compensam nem bloqueiam obrigações. Se um achado opcional
revelar risco material, o executor o registra como bloqueio; não o esconde sob
a classificação de opcional.

## 2. Estados dos critérios

- `satisfied`: todos os pares verificador/ambiente têm aprovação admissível.
- `unsatisfied`: existe reprovação admissível, inclusive conflito com aprovação.
- `inconclusive`: existe resultado inconclusivo ou evidência inválida necessária.
- `unverified`: falta uma observação admissível e não há reprovação conhecida.

A avaliação lista lacunas concretas e evidências desconsideradas. Percentuais
não são usados como sinal de recompensa nem como autorização.

## 3. Admissão de evidências

Para sustentar aprovação, a evidência deve:

1. apontar para o hash do contrato e para o candidato em avaliação;
2. referenciar uma condição, um verificador e um ambiente definidos;
3. vir de um produtor autorizado para aquele verificador e da categoria correta;
4. identificar o baseline correto quando for evidência de regressão;
5. ter data válida, não futura, dentro do prazo previsto pelo verificador;
6. referenciar arquivos locais dentro da raiz de evidências, com hashes válidos.

Todos os artefatos de uma evidência precisam passar na verificação. Caminhos
absolutos, escapes da raiz e links simbólicos para fora dela são rejeitados.
Os arquivos são apenas lidos; procedimentos textuais não são executados.

Eventos de contratos/candidatos anteriores são históricos e não aprovam o atual.
Na mesma versão e ambiente, uma falha admissível não desaparece por existir um
`pass` posterior. Uma observação inconclusiva anterior pode ser substituída por
uma observação posterior admissível; inconclusão, por si só, não comprova sucesso.
No mesmo horário, uma observação inconclusiva impede aprovação por desempate de ID.
Falhas do candidato atual não perdem efeito por envelhecerem; o prazo de validade
não serve para fazer uma reprovação desaparecer.

Uma correção de falso negativo ou teste instável requer adjudicação e nova
revisão aprovada do contrato/verificador. A V2 não implementa um protocolo de
revogação de evidências que permita apagar falhas do candidato atual.

## 4. Integridade não é autenticidade

O hash vincula um registro a bytes e ajuda a detectar alterações. Não prova que
um teste foi executado nem que uma pessoa aprovou algo. `producer_id` não é uma
assinatura digital. A autenticação e a proteção dos registros pertencem ao executor.

Um teste escrito pelo agente pode ser uma boa verificação, mas sua mera aprovação
não comprova que expressa a regra de negócio correta. A seleção dos critérios e
verificadores precisa de revisão com base nas fontes da tarefa. O mesmo modelo
não se torna independente por ser chamado novamente em outra conversa.

## 5. Baseline e regressões

Capture o estado inicial dentro do escopo de impacto, com identificação do código,
ambiente, verificações executadas e falhas preexistentes em um artefato bruto.
O contrato guarda sua referência e hash. Condições de regressão obrigatórias
comparam explicitamente o candidato atual com esse baseline.

A V2 não calcula sozinha o impacto de dependências ou o diff semântico entre
relatórios. O verificador de regressão do projeto produz essa evidência. O gate
confere os vínculos, o resultado admitido e os bloqueios informados pelo executor.

## 6. Orçamento e término

Os limites de iteração, tempo e estagnação são obrigatórios. Limites de tokens e
custo são opcionais; quando configurados, exigem contadores confiáveis. Não
substitua dados ausentes por zero. O contador de estagnação é medido pelo executor;
esta implementação não inventa uma definição universal de progresso.

O executor define o que caracteriza uma iteração, contabiliza também a qualificação
conforme sua política e registra por que houve progresso material. Resolver uma
lacuna bloqueante, obter evidência nova ou reduzir uma falha demonstrada pode
constituir progresso; apenas mudar texto, tentar novamente ou aumentar uma nota
não é progresso por definição.

Cancelamento e interrupção explícita prevalecem sobre um `pass` tardio. Se um
contador ultrapassou o limite, o gate retorna `truncated`. Exatamente no limite,
uma solução já comprovada pode ser aceita se o executor não tiver encerrado a
execução; sem aceitação, retorna `truncated`. O executor deve aplicar timeouts e
limites de gasto antes/durante as ações, não aguardar apenas a avaliação final.

## 7. Otimizações

Medições opcionais são reportadas individualmente, com unidade e protocolo do
contrato. Não são somadas, normalizadas arbitrariamente ou convertidas em
probabilidade de correção. O gate filtra medições inválidas, mas não escolhe uma
implementação automaticamente. Uma meta indispensável vira condição de aceitação.

## 8. Alterações e escopo desta V2

Não existem pesos globais, `confidence` autodeclarada, compensação de restrições,
aceitação por maioria de avaliadores ou aprendizado automático de política.
O contrato e o registro da execução são arquivos distintos. A aprovação usa o
hash dos bytes exatos; qualquer mudança do contrato exige nova aprovação.
