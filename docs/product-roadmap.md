# Direção de produto: coordenação entre agentes

## Objetivo

O Octob deve permitir iniciar, acompanhar, transferir e revisar trabalho feito por diferentes agentes de código sobre repositórios reais. A experiência principal é concluir uma tarefa com uma ou mais CLIs sem perder contexto, estado Git ou a próxima ação necessária do usuário.

## Marco 1 — delegação confiável

- [x] Permitir que o assistente global escolha uma CLI por tarefa quando o usuário a nomear; caso contrário, usar o agente padrão atual.
- [x] Registrar e mostrar a CLI usada em cada tarefa delegada e medir a escolha explícita ou padrão sem conteúdo do projeto.
- [ ] Cobrir em teste de integração os três destinos: worktree nova, worktree existente e Connection.
- [ ] Verificar criação, retomada, erro e encerramento com Claude Code e Codex em Windows, macOS e Linux.
- [ ] Corrigir qualquer falha de estado encontrada antes de expandir o fluxo.

**Aceite:** um pedido explícito de Claude Code inicia uma sessão Claude Code mesmo com Codex como padrão; um pedido sem agente inicia Codex; erro de inicialização não deixa sessão ou worktree órfã.

## Marco 2 — handoff de qualquer sessão

- [x] Disponibilizar “Continuar com outro agente” em uma sessão comum, aproveitando o seletor do handoff de plano existente.
- [x] Mostrar uma prévia editável das mensagens recentes e do rascunho, instruindo o destino a conferir o Git.
- [x] Estruturar objetivo, arquivos alterados, estado Git e pendências disponíveis na prévia; marcar decisões sem registro como desconhecidas.
- [x] Persistir o vínculo da sessão de destino com a origem; manter a origem se a criação ou o vínculo falhar.
- [x] Exibir navegação nos dois sentidos e reutilizar o destino existente nas tentativas da mesma execução.

**Aceite:** Claude Code → Codex e Codex → Claude Code preservam o contexto necessário; a origem continua íntegra se o destino falhar.

**Limite atual:** a recuperação de uma falha persistente de vínculo depende do estado em memória. Se o app for fechado antes de concluir o vínculo, pode restar uma sessão de destino sem origem; idempotência no backend fecha essa janela.

## Marco 3 — central de supervisão

- [ ] Unificar os estados visíveis de sessões e tarefas delegadas: executando, aguardando usuário, concluída, erro e desconhecida.
- [x] Priorizar no Assistente Global os trabalhos delegados que aguardam resposta ou falharam.
- [ ] Priorizar trabalhos que pedem intervenção e abrir diretamente a sessão ou o diff correspondente.
- [ ] Diferenciar estado desconhecido de conclusão quando a CLI não fornecer sinal suficiente.

**Aceite:** uma tarefa que aguarda resposta pode ser encontrada e aberta sem procurar manualmente em cada projeto.

## Marco 4 — Connections de ponta a ponta

- [ ] Iniciar trabalho em dois ou mais repositórios a partir de um pedido.
- [ ] Mostrar alterações, testes e pendências por repositório na mesma revisão.
- [ ] Revisar e concluir cada repositório separadamente, preservando o contexto da Connection.

**Aceite:** uma mudança de API e frontend em repositórios diferentes pode ser acompanhada até a revisão final no Octob.

## Marco 5 — runtime local no navegador

- [ ] Estabilizar instalação e inicialização do runtime local.
- [ ] Garantir paridade dos fluxos de sessão, delegação, supervisão e revisão com o desktop.
- [ ] Validar autenticação local, limites de acesso a arquivos e recuperação após reinício.

## Medição

Com a telemetria opcional habilitada, medir apenas eventos agregados: uso de duas ou mais CLIs, handoffs iniciados e concluídos, tarefas em Connections e conclusão em revisão/commit/PR. Não enviar prompts, conteúdo de arquivos, nomes de projetos ou diffs.

Reavaliar a prioridade dos marcos 3–5 após observar uso real do handoff e ouvir usuários que tentaram concluir uma tarefa entre agentes.
