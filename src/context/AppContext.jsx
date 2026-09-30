import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  INITIAL_CHURCH,
  INITIAL_MEMBERS,
  INITIAL_TEAMS,
  INITIAL_CANCEL_REASONS,
  INITIAL_ACCESS_INVITES,
  INITIAL_EVENT,
  INITIAL_AUDIT_LOGS
} from '../data/initialData';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Configurações e Dados Base
  const [church] = useState(INITIAL_CHURCH);
  const [members, setMembers] = useState(INITIAL_MEMBERS);
  const [teams, setTeams] = useState(INITIAL_TEAMS);
  const [cancelReasons, setCancelReasons] = useState(INITIAL_CANCEL_REASONS);
  const [accessInvites, setAccessInvites] = useState(INITIAL_ACCESS_INVITES);
  const [auditLogs, setAuditLogs] = useState(INITIAL_AUDIT_LOGS);

  // Usuário Atual Ativo (Simulação de Perfis para avaliação de papéis)
  // Padrão: Carlos Oliveira (Líder da Liturgia do Culto)
  const [currentUserId, setCurrentUserId] = useState("carlos");

  // Estado do Evento / Culto
  const [event, setEvent] = useState(INITIAL_EVENT);

  // Simulação de Rede / Conexão (PRD 10.3)
  const [isOnline, setIsOnline] = useState(true);
  const [isDataStale, setIsDataStale] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(new Date().toLocaleTimeString('pt-BR'));

  // Tema Visual (Dark Litúrgico vs Light)
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const currentUser = members.find(m => m.id === currentUserId) || members[0];

  // Helper de Permissões (PRD 3.2 & 4)
  const isAdmin = currentUser.roles.includes("admin");
  const isLiturgyLeader = event.liturgyLeaderId === currentUser.id;
  const isTeamLeader = currentUser.roles.includes("lider_equipe") || teams.some(t => t.leaderId === currentUser.id);

  // Função para adicionar registro no Histórico de 1 Ano (PRD 10.5)
  const addAuditLog = (action, details) => {
    const newLog = {
      id: "log-" + Date.now(),
      timestamp: new Date().toLocaleString('pt-BR'),
      authorName: currentUser.name,
      authorRole: isAdmin ? "Administrador" : isLiturgyLeader ? "Líder da Liturgia" : isTeamLeader ? "Líder de Equipe" : "Membro",
      action,
      details
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  // Cronômetro da Atividade em Execução (PRD 7.2)
  // Contagem regressiva da atividade, com contagem progressiva de tempo excedido se passar de zero.
  useEffect(() => {
    let interval = null;
    if (event.status === "em_andamento" && event.currentActivityStatus === "em_execucao") {
      interval = setInterval(() => {
        setEvent(prev => {
          const newElapsed = prev.activityElapsedSeconds + 1;
          return {
            ...prev,
            activityElapsedSeconds: newElapsed
          };
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [event.status, event.currentActivityStatus]);

  // Contagem de Intervalo entre Atividades (PRD 7.5)
  const [breakElapsedSeconds, setBreakElapsedSeconds] = useState(0);
  useEffect(() => {
    let interval = null;
    if (event.inBreak) {
      interval = setInterval(() => {
        setBreakElapsedSeconds(sec => sec + 1);
      }, 1000);
    } else {
      setBreakElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [event.inBreak]);

  // AÇÕES LITÚRGICAS (Exclusivas da Liturgia no MVP - PRD 7)

  // Iniciar o Culto
  const startService = () => {
    if (!isLiturgyLeader && !isAdmin) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => ({
      ...prev,
      status: "em_andamento",
      realStartTime: timeStr,
      parallelServices: prev.parallelServices.map(s => ({
        ...s,
        status: "Em execução (com o culto)"
      }))
    }));

    addAuditLog("Início do Culto", `Culto iniciado manualmente às ${timeStr} por ${currentUser.name}.`);
  };

  // Iniciar Atividade específica da sequência
  const startActivity = (activityIndex) => {
    if (!isLiturgyLeader) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => {
      const updatedActivities = [...prev.activities];
      const target = { ...updatedActivities[activityIndex] };
      
      target.status = "em_execucao";
      target.realStartTime = timeStr;
      updatedActivities[activityIndex] = target;

      // Se o culto ainda não havia sido iniciado explicitamente, inicia agora (PRD 7.7)
      const serviceStarted = prev.status === "em_andamento";
      const parallel = serviceStarted
        ? prev.parallelServices
        : prev.parallelServices.map(s => ({ ...s, status: "Em execução (com o culto)" }));

      return {
        ...prev,
        status: "em_andamento",
        realStartTime: prev.realStartTime || timeStr,
        currentActivityIndex: activityIndex,
        currentActivityStatus: "em_execucao",
        activityStartTime: now.toISOString(),
        activityElapsedSeconds: 0,
        inBreak: false,
        breakStartTime: null,
        activities: updatedActivities,
        parallelServices: parallel
      };
    });

    const actName = event.activities[activityIndex].title;
    addAuditLog("Início de Atividade", `Atividade '${actName}' iniciada às ${timeStr}.`);
  };

  // Concluir Atual e Iniciar Próxima Manualmente (PRD 7.1, Intervalo = 0, Cenário M14)
  const finishAndNextActivity = () => {
    if (!isLiturgyLeader) return;
    const currentIndex = event.currentActivityIndex;
    const nextIndex = currentIndex + 1;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => {
      const updatedActivities = [...prev.activities];
      // Conclui atual
      updatedActivities[currentIndex] = {
        ...updatedActivities[currentIndex],
        status: "concluida",
        realEndTime: timeStr
      };

      if (nextIndex < updatedActivities.length) {
        // Inicia próxima imediatamente
        updatedActivities[nextIndex] = {
          ...updatedActivities[nextIndex],
          status: "em_execucao",
          realStartTime: timeStr
        };

        return {
          ...prev,
          currentActivityIndex: nextIndex,
          currentActivityStatus: "em_execucao",
          activityStartTime: now.toISOString(),
          activityElapsedSeconds: 0,
          inBreak: false,
          activities: updatedActivities
        };
      } else {
        // Última atividade concluída
        return {
          ...prev,
          currentActivityStatus: "concluida",
          inBreak: true,
          breakStartTime: now.toISOString(),
          activities: updatedActivities
        };
      }
    });

    const curTitle = event.activities[currentIndex]?.title;
    const nextTitle = event.activities[nextIndex]?.title;
    addAuditLog(
      "Avanço de Atividade",
      `Concluiu '${curTitle}' e iniciou '${nextTitle || "Fim da sequência"}' imediatamente (intervalo: 0s).`
    );
  };

  // Apenas Concluir Atividade (Abre Intervalo entre Atividades, PRD 7.5, Cenário M13)
  const finishCurrentActivityOnly = () => {
    if (!isLiturgyLeader) return;
    const currentIndex = event.currentActivityIndex;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => {
      const updatedActivities = [...prev.activities];
      updatedActivities[currentIndex] = {
        ...updatedActivities[currentIndex],
        status: "concluida",
        realEndTime: timeStr
      };

      return {
        ...prev,
        currentActivityStatus: "concluida",
        inBreak: true,
        breakStartTime: now.toISOString(),
        activities: updatedActivities
      };
    });

    const actName = event.activities[currentIndex]?.title;
    addAuditLog("Conclusão de Etapa", `Etapa '${actName}' concluída. Iniciado intervalo entre atividades.`);
  };

  // Devolver para Pendente (PRD 7.4, Cenário M09 & M10)
  // Interrompe contagem, preserva tentativa como execução interrompida, abre intervalo, recomeça com duração inteira
  const returnToPending = () => {
    if (!isLiturgyLeader) return;
    const currentIndex = event.currentActivityIndex;
    const act = event.activities[currentIndex];
    const now = new Date();

    const elapsedMin = Math.round(event.activityElapsedSeconds / 60);

    setEvent(prev => {
      const updatedActivities = [...prev.activities];
      updatedActivities[currentIndex] = {
        ...updatedActivities[currentIndex],
        status: "pendente",
        previousAttemptMinutes: elapsedMin
      };

      return {
        ...prev,
        currentActivityStatus: "pendente",
        inBreak: true,
        breakStartTime: now.toISOString(),
        activityElapsedSeconds: 0,
        activities: updatedActivities
      };
    });

    addAuditLog(
      "Devolver para Pendente",
      `Atividade '${act.title}' devolvida para pendente após ${elapsedMin} min decorridos. Execução anterior preservada; reinício será com duração integral.`
    );
  };

  // Cancelar Atividade em Execução (PRD 7.3, Cenário M11 - Exige motivo previamente cadastrado)
  const cancelActivity = (reason) => {
    if (!isLiturgyLeader) return;
    if (!reason) return;

    const currentIndex = event.currentActivityIndex;
    const act = event.activities[currentIndex];
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => {
      const updatedActivities = [...prev.activities];
      updatedActivities[currentIndex] = {
        ...updatedActivities[currentIndex],
        status: "cancelada",
        realEndTime: timeStr,
        cancellationReason: reason,
        cancelledBy: currentUser.name
      };

      return {
        ...prev,
        currentActivityStatus: "cancelada",
        inBreak: true,
        breakStartTime: now.toISOString(),
        activities: updatedActivities
      };
    });

    addAuditLog(
      "Cancelamento de Atividade",
      `Atividade '${act.title}' cancelada por ${currentUser.name}. Motivo obrigatório registrado: "${reason}".`
    );
  };

  // Corrigir Horários Reais (PRD 7.8, Cenários M41, M42, M43)
  const correctActivityTimes = (activityId, newStartTime, newEndTime) => {
    if (!isLiturgyLeader && !isAdmin) return { success: false, error: "Permissão insuficiente." };

    const target = event.activities.find(a => a.id === activityId);
    if (!target) return { success: false, error: "Atividade não encontrada." };

    // Validação de horário impossível (PRD 7.8 & M43: Fim anterior ao início não é aceito)
    if (newStartTime && newEndTime && newEndTime < newStartTime) {
      return { success: false, error: "Inconsistência: o horário de término não pode ser anterior ao horário de início." };
    }

    setEvent(prev => {
      const updatedActivities = prev.activities.map(a => {
        if (a.id === activityId) {
          return {
            ...a,
            realStartTime: newStartTime || a.realStartTime,
            realEndTime: newEndTime || a.realEndTime,
            timeCorrectionHistory: [
              ...(a.timeCorrectionHistory || []),
              {
                correctedAt: new Date().toLocaleString('pt-BR'),
                correctedBy: currentUser.name,
                oldStart: a.realStartTime,
                oldEnd: a.realEndTime,
                newStart: newStartTime,
                newEnd: newEndTime
              }
            ]
          };
        }
        return a;
      });

      return {
        ...prev,
        activities: updatedActivities
      };
    });

    addAuditLog(
      "Correção de Horário Real",
      `Liturgia corrigiu horários de '${target.title}': Início=${newStartTime || target.realStartTime}, Fim=${newEndTime || target.realEndTime}. Histórico preservado.`
    );

    return { success: true };
  };

  // Encerrar Culto Manualmente (PRD 7.6, Cenários M15, M45)
  const finishService = () => {
    if (!isLiturgyLeader && !isAdmin) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => {
      const updatedActivities = prev.activities.map(a => {
        if (a.status === "em_execucao") {
          return { ...a, status: "concluida", realEndTime: timeStr };
        }
        return a;
      });

      return {
        ...prev,
        status: "encerrado",
        realEndTime: timeStr,
        currentActivityStatus: "concluida",
        inBreak: false,
        activities: updatedActivities,
        parallelServices: prev.parallelServices.map(s => ({
          ...s,
          status: "Finalizado"
        }))
      };
    });

    addAuditLog("Encerramento do Culto", `Culto encerrado oficialmente às ${timeStr} por ${currentUser.name}.`);
  };

  // REGRAS DE CONFLITO DE ESCALA (PRD 5.2, Cenários M22, M23, M24)
  // Verifica se uma alocação nominal cria incompatibilidade
  const checkAssignmentConflict = (memberId, targetRole, activityId) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return { hasConflict: false };

    const targetActivity = event.activities.find(a => a.id === activityId);
    const isLouvor = targetActivity?.category === "Louvor";

    if (isLouvor) {
      // Regra PRD 5.2: Durante o período de louvor, uma pessoa só pode exercer uma função entre cantar, tocar e dançar.
      const currentRoster = targetActivity.roster || [];
      const existingInRoster = currentRoster.find(r => r.memberId === memberId);

      if (existingInRoster) {
        return {
          hasConflict: true,
          reason: `Bloqueio Litúrgico (PRD 5.2): ${member.name} já está escalado(a) como "${existingInRoster.role}" no mesmo bloco de Louvor. Não é permitido acumular funções entre canto, instrumentos e dança no mesmo louvor.`,
          eligibleCandidates: members.filter(m => 
            m.active && 
            m.id !== memberId &&
            m.skills.some(s => s.toLowerCase().includes(targetRole.toLowerCase().split(' ')[0])) &&
            !currentRoster.some(r => r.memberId === m.id)
          )
        };
      }
    }

    // Regra: Membro escalado em Sonoplastia ou Transmissão ocupa todo o intervalo do culto
    const isAudioMediaTeam = member.teams.includes("Sonoplastia & Áudio") || member.teams.includes("Transmissão & Mídia");
    const isParallelService = event.parallelServices.some(s => s.volunteers.includes(memberId));
    if (isParallelService && targetActivity && targetActivity.category === "Louvor") {
      return {
        hasConflict: true,
        reason: `Bloqueio Litúrgico (PRD 5.2 / M24): ${member.name} está escalado(a) no serviço paralelo contínuo (Sonoplastia/Transmissão), que ocupa todo o culto.`,
        eligibleCandidates: members.filter(m => 
          m.active && 
          m.id !== memberId &&
          !event.parallelServices.some(s => s.volunteers.includes(m.id))
        )
      };
    }

    return { hasConflict: false };
  };

  // SUBSTITUIÇÃO E AUSÊNCIA (PRD 8, Cenários M20, M21)
  const replaceVolunteerInRoster = (activityId, oldMemberId, newMemberId, role) => {
    const act = event.activities.find(a => a.id === activityId);
    if (!act) return { success: false, error: "Atividade não encontrada." };

    // Regra PRD 8:
    // Se a atividade já começou (status === 'em_execucao'), apenas o Líder da Liturgia pode registrar substituições.
    // Antes de começar, o líder da própria equipe ou liturgia pode.
    if (act.status === "em_execucao" && !isLiturgyLeader) {
      return {
        success: false,
        error: "Bloqueio (PRD 8 / M21): Durante a execução da atividade, a substituição fica exclusivamente com o Líder da Liturgia."
      };
    }

    // Verificar se novo membro tem aptidão cadastrada
    const newMember = members.find(m => m.id === newMemberId);
    const oldMember = members.find(m => m.id === oldMemberId);

    // Verificar conflitos
    const conflict = checkAssignmentConflict(newMemberId, role, activityId);
    if (conflict.hasConflict) {
      return { success: false, error: conflict.reason };
    }

    setEvent(prev => {
      const updatedActivities = prev.activities.map(a => {
        if (a.id === activityId) {
          const updatedRoster = (a.roster || []).map(item => {
            if (item.memberId === oldMemberId) {
              return { ...item, memberId: newMemberId };
            }
            return item;
          });
          return { ...a, roster: updatedRoster };
        }
        return a;
      });

      return { ...prev, activities: updatedActivities };
    });

    addAuditLog(
      "Substituição de Voluntário",
      `Substituição registrada por ${currentUser.name} na atividade '${act.title}': ${oldMember?.name} substituído(a) por ${newMember?.name} (${role}). Combinado externamente, sem necessidade de aceite eletrônico.`
    );

    return { success: true };
  };

  // CHECKLIST DE PREPARAÇÃO (PRD 9.3, Cenário M46)
  const toggleChecklistItem = (checkId) => {
    const item = event.checklist.find(c => c.id === checkId);
    if (!item) return;

    // Regra PRD 9.3: Membros comuns não marcam checklist.
    if (!isAdmin && !isLiturgyLeader && !isTeamLeader) {
      alert("Apenas lideranças (liturgia e líderes de equipe autorizados) podem operar o checklist de preparação.");
      return;
    }

    setEvent(prev => {
      const updatedChecklist = prev.checklist.map(c => {
        if (c.id === checkId) {
          if (!c.isJoint) {
            // Item simples: toggle
            const newComp = !c.completed;
            return {
              ...c,
              completed: newComp,
              confirmedBy: newComp ? currentUser.id : null,
              confirmedAt: newComp ? new Date().toLocaleTimeString('pt-BR') : null
            };
          } else {
            // Item conjunto (Exige 2 validações, ex: Louvor + Sonoplastia)
            // Se o usuário atual for líder de louvor (Mariana) ou sonoplastia (Lucas)
            let v1 = c.validation1;
            let v2 = c.validation2;

            if (currentUser.id === c.assignedLeaderId || currentUser.teams.includes("Sonoplastia & Áudio")) {
              v2 = !v2;
            } else if (currentUser.id === c.secondLeaderId || currentUser.teams.includes("Louvor & Adoração")) {
              v1 = !v1;
            } else if (isAdmin || isLiturgyLeader) {
              // Liturgia pode validar caso necessário
              if (!v1) v1 = true;
              else if (!v2) v2 = true;
              else { v1 = false; v2 = false; }
            }

            return {
              ...c,
              validation1: v1,
              validation2: v2,
              completed: v1 && v2
            };
          }
        }
        return c;
      });

      return { ...prev, checklist: updatedChecklist };
    });

    addAuditLog("Checklist Atualizado", `Checklist '${item.title}' atualizado por ${currentUser.name}.`);
  };

  // ADMINISTRAÇÃO (PRD 3.2: Exclusivo Admin Web)
  const addCancelReason = (reason) => {
    if (!isAdmin) return;
    if (!reason || cancelReasons.includes(reason)) return;
    setCancelReasons(prev => [...prev, reason]);
    addAuditLog("Cadastro de Motivo", `Novo motivo de cancelamento cadastrado: "${reason}".`);
  };

  const sendAccessInvite = (email, memberName) => {
    if (!isAdmin) return;
    const newInv = {
      id: "inv-" + Date.now(),
      email,
      memberName,
      status: "Pendente",
      sentAt: new Date().toLocaleString('pt-BR')
    };
    setAccessInvites(prev => [newInv, ...prev]);
    addAuditLog("Convite de Acesso", `Convite de acesso à igreja enviado para ${email} (Membro: ${memberName}).`);
  };

  const designateLiturgyLeader = (newLeaderId) => {
    if (!isAdmin) return;
    const leader = members.find(m => m.id === newLeaderId);
    setEvent(prev => ({
      ...prev,
      liturgyLeaderId: newLeaderId
    }));
    addAuditLog(
      "Designação da Liturgia",
      `Pastor Marcos designou ${leader?.name} como Líder da Liturgia para este evento.`
    );
  };

  // Cálculos de Duração da Programação (PRD 6, Cenário M25 & M26)
  // Soma a sequência principal sem duplicar componentes do louvor ou serviços paralelos
  const totalPlannedDurationMinutes = event.activities.reduce((sum, act) => sum + (act.plannedDurationMinutes || 0), 0);
  const durationOverflowMinutes = Math.max(0, totalPlannedDurationMinutes - event.plannedDurationMinutes);

  return (
    <AppContext.Provider
      value={{
        church,
        members,
        teams,
        cancelReasons,
        accessInvites,
        auditLogs,
        currentUser,
        setCurrentUserId,
        isAdmin,
        isLiturgyLeader,
        isTeamLeader,
        event,
        setEvent,
        isOnline,
        setIsOnline,
        isDataStale,
        setIsDataStale,
        lastSyncTime,
        theme,
        setTheme,
        totalPlannedDurationMinutes,
        durationOverflowMinutes,
        breakElapsedSeconds,

        // Ações
        startService,
        startActivity,
        finishAndNextActivity,
        finishCurrentActivityOnly,
        returnToPending,
        cancelActivity,
        correctActivityTimes,
        finishService,
        checkAssignmentConflict,
        replaceVolunteerInRoster,
        toggleChecklistItem,
        addCancelReason,
        sendAccessInvite,
        designateLiturgyLeader,
        addAuditLog
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
