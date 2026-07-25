export const shortcuts = {
  title: 'Atalhos de teclado',
  subtitle: 'Personalize os atalhos de teclado',
  resetAll: 'Redefinir tudo',
  conflictTitle: 'Conflito de atalho',
  conflictBody: 'Esta combinação já é usada por:',
  pressKeys: 'Pressione as teclas...',
  resetToDefault: 'Restaurar padrão',
  toastUpdated: 'Atalho atualizado para {{binding}}',
  toastResetOne: 'Atalho restaurado para o padrão',
  toastResetAll: 'Todos os atalhos foram restaurados para o padrão',
  toastModifierRequired:
    'Atalhos devem incluir pelo menos um modificador (Cmd/Ctrl/Alt/Shift)',
  categories: {
    session: 'Sessões',
    navigation: 'Navegação',
    git: 'Git',
    sidebar: 'Barras laterais',
    focus: 'Foco',
    settings: 'Configurações'
  },
  definitions: {
    session_new: { label: 'Nova sessão', description: 'Criar uma nova sessão de chat' },
    session_close: {
      label: 'Fechar sessão',
      description: 'Fechar a aba da sessão atual (nada se não houver sessão)'
    },
    'session_mode-toggle': {
      label: 'Alternar modo Build/Plan',
      description: 'Alternar entre modo build e plan'
    },
    'session_super-plan-toggle': {
      label: 'Alternar Super Plan',
      description: 'Alternar modo super-plan (Shift+Tab)'
    },
    project_run: {
      label: 'Executar projeto',
      description: 'Iniciar ou parar o script de execução do projeto'
    },
    'model_cycle-variant': {
      label: 'Alternar variante do modelo',
      description: 'Percorrer variantes de nível de raciocínio (ex.: high/max)'
    },
    'nav_file-search': {
      label: 'Buscar arquivos',
      description: 'Abrir o diálogo de busca de arquivos'
    },
    'nav_command-palette': {
      label: 'Abrir paleta de comandos',
      description: 'Abrir a paleta de comandos'
    },
    'nav_session-history': {
      label: 'Abrir histórico de sessões',
      description: 'Abrir o painel de histórico de sessões'
    },
    'nav_new-worktree': {
      label: 'Novo worktree',
      description: 'Criar um novo worktree para o projeto atual'
    },
    'nav_filter-projects': {
      label: 'Filtrar projetos',
      description: 'Focar o campo de filtro de projetos'
    },
    git_commit: {
      label: 'Focar formulário de commit',
      description: 'Focar o formulário de commit git'
    },
    git_push: {
      label: 'Enviar para o remoto',
      description: 'Enviar commits para o repositório remoto'
    },
    git_pull: {
      label: 'Puxar do remoto',
      description: 'Puxar commits do repositório remoto'
    },
    'sidebar_toggle-left': {
      label: 'Alternar barra esquerda',
      description: 'Mostrar ou ocultar a barra lateral esquerda'
    },
    'sidebar_toggle-right': {
      label: 'Alternar barra direita',
      description: 'Mostrar ou ocultar a barra lateral direita'
    },
    'sidebar_toggle-bottom-terminal': {
      label: 'Alternar terminal inferior',
      description: 'Mostrar ou ocultar o painel de terminal na parte inferior'
    },
    'focus_left-sidebar': {
      label: 'Focar barra esquerda',
      description: 'Mover o foco para a barra lateral esquerda'
    },
    'focus_main-pane': {
      label: 'Focar painel principal',
      description: 'Mover o foco para o painel principal de chat'
    },
    settings_open: {
      label: 'Abrir configurações',
      description: 'Abrir o painel de configurações'
    }
  }
}
