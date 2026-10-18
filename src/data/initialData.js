// Dados Iniciais e Estrutura de Domínio conforme PRD - Escala do Reino
// Piloto: Ministério Shalom (Consolidação 30/09/2026)

export const INITIAL_CHURCH = {
  id: "shalom",
  name: "Ministério Shalom",
  city: "São Paulo, SP",
  adminName: "Pastor Marcos Ribeiro"
};

export const INITIAL_ROLES = [
  { id: "admin", name: "Administrador", desc: "Administração web, convites e designação de liderança" },
  { id: "liturgia", name: "Líder da Liturgia", desc: "Controle do andamento, cronômetro e bastidores do culto" },
  { id: "lider_equipe", name: "Líder de Equipe", desc: "Escala e realocação da equipe, habilitação e checklist" },
  { id: "membro", name: "Membro", desc: "Consulta do cronograma macro e detalhes da própria escala" }
];

export const INITIAL_MEMBERS = [
  {
    id: "marcos",
    name: "Pastor Marcos Ribeiro",
    email: "marcos@shalom.org",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    roles: ["admin"],
    teams: ["Pastoral", "Liturgia"],
    skills: ["Pregação", "Ceia", "Oração"],
    active: true
  },
  {
    id: "carlos",
    name: "Carlos Oliveira",
    email: "carlos@shalom.org",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
    roles: ["liturgia"],
    teams: ["Liturgia"],
    skills: ["Direção de Culto", "Liturgia", "Avisos"],
    active: true
  },
  {
    id: "mariana",
    name: "Mariana Santos",
    email: "mariana@shalom.org",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
    roles: ["lider_equipe"],
    teams: ["Louvor & Adoração"],
    skills: ["Louvor - Canto", "Louvor - Violão", "Direção de Louvor"],
    active: true
  },
  {
    id: "lucas",
    name: "Lucas Mendes",
    email: "lucas@shalom.org",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    roles: ["lider_equipe"],
    teams: ["Sonoplastia & Áudio"],
    skills: ["Sonoplastia", "Mesa Digital", "Retorno de Fone"],
    active: true
  },
  {
    id: "beatriz",
    name: "Beatriz Costa",
    email: "beatriz@shalom.org",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Louvor & Adoração", "Dança"],
    skills: ["Louvor - Canto", "Louvor - Dança", "Oportunidade - Solo"],
    active: true
  },
  {
    id: "daniel",
    name: "Daniel Lima",
    email: "daniel@shalom.org",
    avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Louvor & Adoração"],
    skills: ["Louvor - Teclado", "Louvor - Violão"],
    active: true
  },
  {
    id: "thiago",
    name: "Thiago Rocha",
    email: "thiago@shalom.org",
    avatar: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Louvor & Adoração"],
    skills: ["Louvor - Bateria", "Louvor - Percussão"],
    active: true
  },
  {
    id: "camila",
    name: "Camila Nogueira",
    email: "camila@shalom.org",
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Louvor & Adoração"],
    skills: ["Louvor - Canto", "Oportunidade - Solo"],
    active: true
  },
  {
    id: "gabriel",
    name: "Gabriel Souza",
    email: "gabriel@shalom.org",
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Sonoplastia & Áudio", "Transmissão & Mídia"],
    skills: ["Sonoplastia", "Transmissão ao vivo", "Câmera"],
    active: true
  },
  {
    id: "fernanda",
    name: "Fernanda Alves",
    email: "fernanda@shalom.org",
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Transmissão & Mídia"],
    skills: ["Transmissão ao vivo", "Projeção / Letras"],
    active: true
  },
  {
    id: "roberto",
    name: "Roberto Pereira",
    email: "roberto@shalom.org",
    avatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80",
    roles: ["membro"],
    teams: ["Recepção"],
    skills: ["Portaria", "Boas-vindas"],
    active: true
  }
];

export const INITIAL_TEAMS = [
  { id: "liturgia", name: "Liturgia & Direção", leaderId: "carlos", color: "#6366f1" },
  { id: "louvor", name: "Louvor & Adoração", leaderId: "mariana", color: "#ec4899" },
  { id: "danca", name: "Ministério de Dança", leaderId: "mariana", color: "#f43f5e" },
  { id: "som", name: "Sonoplastia & Áudio", leaderId: "lucas", color: "#3b82f6" },
  { id: "midia", name: "Transmissão & Mídia", leaderId: "lucas", color: "#06b6d4" },
  { id: "recepcao", name: "Recepção & Portaria", leaderId: "marcos", color: "#10b981" }
];

export const INITIAL_CANCEL_REASONS = [
  { id: "cr-1", name: "Falha técnica de equipamento / som", active: true },
  { id: "cr-2", name: "Falta de energia elétrica", active: true },
  { id: "cr-3", name: "Imprevisto de saúde / emergência", active: true },
  { id: "cr-4", name: "Ajuste litúrgico de última hora pela liderança", active: true },
  { id: "cr-5", name: "Tempo do culto excedido / encurtamento", active: true },
  { id: "cr-6", name: "Ausência do participante sem substituto viável", active: true }
];

export const INITIAL_ACCESS_INVITES = [
  { id: "inv-1", email: "joao.silva@gmail.com", memberName: "João Silva", status: "Pendente", sentAt: "2026-09-28 14:00" },
  { id: "inv-2", email: "aline.rocha@outlook.com", memberName: "Aline Rocha", status: "Aceito", sentAt: "2026-09-25 10:30" }
];

export const INITIAL_EVENT = {
  id: "culto-dom-20261004",
  title: "Culto de Celebração de Domingo",
  type: "Celebração Geral",
  date: "2026-10-04",
  scheduledStartTime: "19:00",
  plannedDurationMinutes: 105, // Soma das 7 atividades: 5+25+7+8+45+10+5 = 105 min
  liturgyLeaderId: "carlos", // Designado por evento pelo admin (PRD 3.2)
  status: "pronto", // "pronto", "em_andamento", "encerrado"
  realStartTime: null,
  realEndTime: null,
  currentActivityIndex: 0, // Índice da atividade em execução
  currentActivityStatus: "pendente", // "pendente", "em_execucao", "cancelada", "concluida"
  activityStartTime: null, // timestamp quando a atividade iniciou
  activityElapsedSeconds: 0,
  inBreak: false, // se está em "intervalo entre atividades"
  breakStartTime: null,
  lastSyncTimestamp: new Date().toISOString(),

  // Atividades principais (sequência cronológica)
  activities: [
    {
      id: "act-1",
      title: "Boas-Vindas e Oração Inicial",
      category: "Liturgia",
      plannedDurationMinutes: 5,
      responsibleMemberId: "carlos",
      responsibleTeamId: "liturgia",
      status: "pendente", // "pendente", "em_execucao", "concluida", "cancelada"
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Acolhimento aos visitantes e oração de abertura",
      musics: []
    },
    {
      id: "act-2",
      title: "Louvor e Adoração Congregacional",
      category: "Louvor",
      plannedDurationMinutes: 25,
      responsibleMemberId: "mariana",
      responsibleTeamId: "louvor",
      status: "pendente",
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Bloco unificado de louvor. Participantes dedicados exclusivamente à sua função no louvor.",
      // Ficha de Músicas (PRD 9.1)
      musics: [
        {
          id: "m-1",
          name: "Bondade de Deus",
          artist: "Isaías Saad",
          key: "G",
          youtubeUrl: "https://www.youtube.com/watch?v=k-V31xWj6W4",
          notes: "Introdução suave no teclado. Todos os vocais entram no refrão."
        },
        {
          id: "m-2",
          name: "A Bênção",
          artist: "Gabriel Guedes",
          key: "C",
          youtubeUrl: "https://www.youtube.com/watch?v=wXoG1Wj8WkE",
          notes: "Ponte com dinâmica forte, repetição com a congregação."
        }
      ],
      // Escala nominal específica do bloco de louvor (PRD 5.1 & 5.2)
      roster: [
        { memberId: "mariana", role: "Louvor - Canto / Líder" },
        { memberId: "camila", role: "Louvor - Canto" },
        { memberId: "daniel", role: "Louvor - Teclado" },
        { memberId: "thiago", role: "Louvor - Bateria" },
        { memberId: "beatriz", role: "Louvor - Dança" } // Regra PRD 5.2: Beatriz já está na dança no louvor, não pode cantar neste bloco
      ]
    },
    {
      id: "act-3",
      title: "Oportunidade Especial de Louvor",
      category: "Música Especial",
      plannedDurationMinutes: 7,
      responsibleMemberId: "camila",
      responsibleTeamId: "louvor",
      status: "pendente",
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Solo especial após o louvor congregacional.",
      requiresPlayback: true, // Gera aviso automático para a Sonoplastia! (PRD 9.2)
      musics: [
        {
          id: "m-3",
          name: "Ruja o Leão",
          artist: "Talita Catanzaro",
          key: "D",
          youtubeUrl: "https://www.youtube.com/watch?v=s0m3example",
          notes: "Playback enviado no pendrive para o Lucas. Tom alterado para D."
        }
      ],
      roster: [
        { memberId: "camila", role: "Oportunidade - Solo" }
      ]
    },
    {
      id: "act-4",
      title: "Dízimos, Ofertas e Comunicação",
      category: "Liturgia",
      plannedDurationMinutes: 8,
      responsibleMemberId: "marcos",
      responsibleTeamId: "liturgia",
      status: "pendente",
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Vídeo institucional no telão, oração de consagração e avisos da semana.",
      musics: []
    },
    {
      id: "act-5",
      title: "Ministração da Palavra (Sermão)",
      category: "Mensagem",
      plannedDurationMinutes: 45,
      responsibleMemberId: "marcos",
      responsibleTeamId: "Pastoral",
      status: "pendente",
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Tema: Vivendo pelo Espírito. Transmissão com foco no púlpito.",
      musics: []
    },
    {
      id: "act-6",
      title: "Apelo, Oração e Ministração Final",
      category: "Oração",
      plannedDurationMinutes: 10,
      responsibleMemberId: "marcos",
      responsibleTeamId: "Pastoral",
      status: "pendente",
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Fundo instrumental suave (Daniel no teclado).",
      musics: []
    },
    {
      id: "act-7",
      title: "Bênção Apostólica e Encerramento",
      category: "Liturgia",
      plannedDurationMinutes: 5,
      responsibleMemberId: "carlos",
      responsibleTeamId: "liturgia",
      status: "pendente",
      realStartTime: null,
      realEndTime: null,
      cancellationReason: null,
      notes: "Despedida e convite para a comunhão no salão social.",
      musics: []
    }
  ],

  // Serviços Paralelos (PRD 7.7: acompanham início e fim reais do culto, sem cronômetro próprio)
  parallelServices: [
    {
      id: "serv-som",
      name: "Sonoplastia & Retorno",
      teamId: "som",
      leaderId: "lucas",
      volunteers: ["lucas", "gabriel"],
      status: "Aguardando culto", // "Aguardando culto", "Em execução (com o culto)", "Finalizado"
      prepRequiredMinutes: 30
    },
    {
      id: "serv-midia",
      name: "Transmissão ao Vivo & Projeção",
      teamId: "midia",
      leaderId: "lucas",
      volunteers: ["gabriel", "fernanda"],
      status: "Aguardando culto",
      prepRequiredMinutes: 20
    }
  ],

  // Checklist simples e conjunto de preparação (PRD 9.3)
  checklist: [
    {
      id: "chk-1",
      activityId: "act-5",
      title: "Microfone sem fio do pastor testado e pilha nova colocada",
      isJoint: false,
      targetTeamId: "som",
      assignedLeaderId: "lucas",
      completed: true,
      confirmedBy: "lucas",
      confirmedAt: "2026-10-04 18:35"
    },
    {
      id: "chk-2",
      activityId: "act-3",
      title: "Playback da oportunidade especial entregue e testado na mesa",
      isJoint: true, // Exige 2 lideranças (Louvor + Sonoplastia)
      targetTeamId: "som",
      assignedLeaderId: "lucas", // Validador 1: Sonoplastia
      secondLeaderId: "mariana", // Validador 2: Louvor
      validation1: true,
      validation1By: "mariana",
      validation1At: "2026-10-04 18:40",
      validation2: false, // Ainda pendente pelo Lucas!
      validation2By: null,
      validation2At: null,
      completed: false
    },
    {
      id: "chk-3",
      activityId: "act-2",
      title: "Letras das músicas conferidas e alinhadas na Projeção",
      isJoint: false,
      targetTeamId: "midia",
      assignedLeaderId: "lucas",
      completed: true,
      confirmedBy: "fernanda",
      confirmedAt: "2026-10-04 18:45"
    },
    {
      id: "chk-4",
      activityId: "act-4",
      title: "Água no púlpito e avisos impressos para a direção",
      isJoint: false,
      targetTeamId: "liturgia",
      assignedLeaderId: "carlos",
      completed: false,
      confirmedBy: null,
      confirmedAt: null
    }
  ],

  // Avisos Internos (PRD 10.2)
  internalAlerts: [
    {
      id: "alt-1",
      recipientType: "team",
      targetTeamId: "som",
      title: "Aviso Operacional: Oportunidade com Playback",
      message: "A atividade 'Oportunidade Especial de Louvor' requer playback de apoio no tom de Ré (D). Conferir pendrive/arquivo com a Camila antes do início.",
      timestamp: "2026-10-04 17:30",
      urgent: true
    },
    {
      id: "alt-2",
      recipientType: "all",
      title: "Alinhamento das Escalas",
      message: "Todas as equipes escaladas para o culto de Domingo: favor estar presentes para oração coletiva às 18h30.",
      timestamp: "2026-10-04 16:00",
      urgent: false
    }
  ]
};

// Log de Auditoria & Histórico de 1 Ano (PRD 10.5)
export const INITIAL_AUDIT_LOGS = [
  {
    id: "log-1",
    timestamp: "2026-09-30 19:10:00",
    authorName: "Pastor Marcos Ribeiro",
    authorRole: "Administrador",
    action: "Designação de Liderança da Liturgia",
    details: "Designou Carlos Oliveira como Líder da Liturgia para o Culto de Domingo Noite (04/10/2026)."
  },
  {
    id: "log-2",
    timestamp: "2026-09-30 19:40:00",
    authorName: "Mariana Santos",
    authorRole: "Líder de Louvor",
    action: "Planejamento de Músicas",
    details: "Adicionou músicas 'Bondade de Deus' (Tom G) e 'A Bênção' (Tom C) no bloco de louvor."
  },
  {
    id: "log-3",
    timestamp: "2026-09-30 20:00:00",
    authorName: "Carlos Oliveira",
    authorRole: "Líder da Liturgia",
    action: "Ajuste na Ordem Litúrgica",
    details: "Definiu duração planejada de 25 min para Louvor e 45 min para Pregação da Palavra."
  }
];
