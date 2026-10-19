import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AuthContext } from './AuthContext';
import { supabase as defaultSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  INITIAL_CHURCH,
  INITIAL_MEMBERS,
  INITIAL_TEAMS,
  INITIAL_CANCEL_REASONS,
  INITIAL_EVENT_TYPES,
  INITIAL_STANDARD_ACTIVITIES,
  INITIAL_SERVICE_TEMPLATES,
  INITIAL_ACCESS_INVITES,
  INITIAL_EVENT,
  INITIAL_AUDIT_LOGS
} from '../data/initialData';
import {
  toReasonObject,
  validateCancellationReason,
  canDeleteCancellationReason,
  fetchCancellationReasonsRemote,
  createCancellationReasonRemote,
  updateCancellationReasonRemote,
  toggleCancellationReasonStatusRemote,
  deleteCancellationReasonRemote,
  cancellationReasonErrorMessage,
} from '../utils/cancellationReasonService';
import {
  toEventTypeObject,
  toStandardActivityObject,
  validateEventType,
  validateStandardActivity,
  canDeleteEventType,
  canDeleteStandardActivity,
  fetchEventTypesRemote,
  createEventTypeRemote,
  updateEventTypeRemote,
  toggleEventTypeStatusRemote,
  deleteEventTypeRemote,
  fetchStandardActivitiesRemote,
  createStandardActivityRemote,
  updateStandardActivityRemote,
  toggleStandardActivityStatusRemote,
  deleteStandardActivityRemote,
  eventTypeActivityErrorMessage,
} from '../utils/eventTypeActivityService';
import {
  toServiceTemplateObject,
  toTemplateActivity,
  toTemplateParallelService,
  validateServiceTemplate,
  instantiateTemplateForEvent,
  removeParallelServiceFromEvent,
  canDeleteServiceTemplate,
  fetchServiceTemplatesRemote,
  createServiceTemplateRemote,
  updateServiceTemplateRemote,
  toggleServiceTemplateStatusRemote,
  deleteServiceTemplateRemote,
  instantiateServiceTemplateRemote,
  serviceTemplateErrorMessage,
} from '../utils/serviceTemplateService';
import {
  createEventEditionObject,
  validateEventEdition,
  reorderEventActivities,
  moveActivityUp,
  moveActivityDown,
  calculateProgramDurations,
  validateProgramPublication,
  publishEventProgram,
  saveEventProgramDraft,
  updateEventDurationPolicy,
  createChurchEventEditionRemote,
  reorderEventItemsRemote,
  setEventDurationPolicyRemote,
  publishEventProgramRemote,
  saveEventProgramDraftRemote,
  eventPlanningErrorMessage,
} from '../utils/eventPlanningService';

const AppContext = createContext(null);

export function AppProvider({
  children,
  initialUserId = "carlos",
  churchId: propChurchId = null,
  supabaseClient: propSupabaseClient = null,
  allowMemoryFallback = undefined,
}) {
  const authContext = useContext(AuthContext);
  const effectiveChurchId = propChurchId || authContext?.churchAccess?.church_id || null;
  const effectiveClient = propSupabaseClient || (authContext ? defaultSupabaseClient : null);

  // Diferenciação estrita entre ambiente real e testes/demonstração intencional
  const isExplicitDemo = allowMemoryFallback === true;
  const isNodeTest = typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || Boolean(process.env?.NODE_TEST_CONTEXT));

  const isMemoryFallbackAllowed = allowMemoryFallback === false
    ? false
    : allowMemoryFallback === true
      ? true
      : Boolean(isNodeTest && !propSupabaseClient && !propChurchId && !authContext);

  const isRealEnvironment = !isMemoryFallbackAllowed;
  const isRemoteConfigured = Boolean(effectiveClient && effectiveChurchId);

  const previousChurchIdRef = useRef(effectiveChurchId);
  const loadRequestSeqRef = useRef(0);

  const ensureAuthorizedContext = () => {
    if (!effectiveClient || !effectiveChurchId) {
      if (!isMemoryFallbackAllowed) {
        return {
          allowed: false,
          error: "Operação não permitida: ambiente sem conexão autorizada ao Supabase ou igreja não identificada. Gravação bloqueada."
        };
      }
      return { allowed: true, inMemory: true };
    }
    return { allowed: true, inMemory: false };
  };

  // Configurações e Dados Base
  const [church] = useState(INITIAL_CHURCH);
  const [members, setMembers] = useState(INITIAL_MEMBERS);
  const [teams, setTeams] = useState(INITIAL_TEAMS);
  const [cancelReasons, setCancelReasons] = useState(() =>
    INITIAL_CANCEL_REASONS.map((r, idx) => toReasonObject(r, idx))
  );
  const [eventTypes, setEventTypes] = useState(() =>
    INITIAL_EVENT_TYPES.map((t, idx) => toEventTypeObject(t, idx))
  );
  const [standardActivities, setStandardActivities] = useState(() =>
    INITIAL_STANDARD_ACTIVITIES.map((a, idx) => toStandardActivityObject(a, idx))
  );
  const [serviceTemplates, setServiceTemplates] = useState(() =>
    INITIAL_SERVICE_TEMPLATES.map((st, idx) => toServiceTemplateObject(st, idx))
  );
  const [accessInvites, setAccessInvites] = useState(INITIAL_ACCESS_INVITES);
  const [auditLogs, setAuditLogs] = useState(INITIAL_AUDIT_LOGS);

  // Estados de Sincronização Remota com Supabase (Issues #25 a #30)
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(null);

  // Isolamento Multi-Tenant: Limpa estado e cancela requisições em voo na troca de igreja
  useEffect(() => {
    if (previousChurchIdRef.current !== effectiveChurchId) {
      previousChurchIdRef.current = effectiveChurchId;
      loadRequestSeqRef.current += 1;
      if (effectiveChurchId) {
        setCancelReasons([]);
        setEventTypes([]);
        setStandardActivities([]);
        setServiceTemplates([]);
        setEvents([]);
      }
    }
  }, [effectiveChurchId]);

  const reloadRemoteData = useCallback(async () => {
    if (!effectiveClient || !effectiveChurchId) return;
    const currentSeq = ++loadRequestSeqRef.current;
    setRemoteLoading(true);
    setRemoteError(null);
    try {
      const [reasonsRes, typesRes, actsRes, templatesRes] = await Promise.all([
        fetchCancellationReasonsRemote(effectiveClient, effectiveChurchId, true),
        fetchEventTypesRemote(effectiveClient, effectiveChurchId, true),
        fetchStandardActivitiesRemote(effectiveClient, effectiveChurchId, true),
        fetchServiceTemplatesRemote(effectiveClient, effectiveChurchId, true),
      ]);

      if (loadRequestSeqRef.current !== currentSeq) return;

      if (reasonsRes.success) setCancelReasons(reasonsRes.data);
      if (typesRes.success) setEventTypes(typesRes.data);
      if (actsRes.success) setStandardActivities(actsRes.data);
      if (templatesRes.success) setServiceTemplates(templatesRes.data);
    } catch (err) {
      if (loadRequestSeqRef.current === currentSeq) {
        setRemoteError(err.message || 'Falha ao sincronizar dados remotos.');
      }
    } finally {
      if (loadRequestSeqRef.current === currentSeq) {
        setRemoteLoading(false);
      }
    }
  }, [effectiveClient, effectiveChurchId]);

  useEffect(() => {
    if (effectiveClient && effectiveChurchId) {
      reloadRemoteData();
    }
  }, [effectiveClient, effectiveChurchId, reloadRemoteData]);

  // Usuário Atual Ativo (Simulação de Perfis para avaliação de papéis)
  // Padrão: Carlos Oliveira (Líder da Liturgia do Culto)
  const [currentUserId, setCurrentUserId] = useState(initialUserId);

  // Estado dos Eventos da Igreja (Issue #28)
  const [events, setEvents] = useState([INITIAL_EVENT]);
  const [currentEventId, setCurrentEventId] = useState(INITIAL_EVENT.id);

  // Evento Ativo
  const event = events.find(e => e.id === currentEventId) || events[0] || INITIAL_EVENT;

  const setEvent = (updater) => {
    setEvents(prevEvents => {
      const targetId = currentEventId;
      const targetEvent = prevEvents.find(e => e.id === targetId) || prevEvents[0] || INITIAL_EVENT;
      const nextEvent = typeof updater === 'function' ? updater(targetEvent) : updater;
      const exists = prevEvents.some(e => e.id === nextEvent.id);
      if (exists) {
        return prevEvents.map(e => e.id === nextEvent.id ? nextEvent : e);
      }
      return prevEvents.map(e => e.id === targetId ? nextEvent : e);
    });
  };

  // Simulação de Rede / Conexão (PRD 10.3)
  const [isOnline, setIsOnline] = useState(true);
  const [isDataStale, setIsDataStale] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(new Date().toLocaleTimeString('pt-BR'));

  // Tema Visual (Dark Litúrgico vs Light)
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement?.setAttribute) {
      document.documentElement.setAttribute('data-theme', theme);
    }
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
  const cancelActivity = (reasonInput) => {
    if (!isLiturgyLeader) return { success: false, error: "Apenas o líder da liturgia pode cancelar a atividade." };
    if (!reasonInput) return { success: false, error: "Motivo de cancelamento obrigatório." };

    const currentIndex = event.currentActivityIndex;
    const act = event.activities[currentIndex];
    if (!act) return { success: false, error: "Nenhuma atividade em andamento para cancelar." };

    let reasonObj = null;
    if (typeof reasonInput === 'object') {
      reasonObj = reasonInput;
    } else {
      reasonObj = cancelReasons.find(r => r.id === reasonInput || r.name === reasonInput);
    }

    if (reasonObj && reasonObj.active === false) {
      return { success: false, error: "Não é permitido cancelar atividade com um motivo desativado." };
    }

    const reasonName = reasonObj ? reasonObj.name : reasonInput;
    const reasonId = reasonObj ? reasonObj.id : null;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setEvent(prev => {
      const updatedActivities = [...prev.activities];
      updatedActivities[currentIndex] = {
        ...updatedActivities[currentIndex],
        status: "cancelada",
        realEndTime: timeStr,
        cancellationReason: reasonName,
        cancellationReasonId: reasonId,
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
      `Atividade '${act.title}' cancelada por ${currentUser.name}. Motivo obrigatório registrado: "${reasonName}".`
    );
    return { success: true };
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

    // Regra: Membro escalado em Sonoplastia, Transmissão ou outro apoio ocupa todo o intervalo com preparação antecedente (PRD 5.2 / M24, M50 & Issue #29 CA03)
    const parallelService = (event.parallelServices || []).find(s =>
      (s.volunteers || []).includes(memberId) || s.leaderId === memberId
    );
    if (parallelService && targetActivity && targetActivity.category === "Louvor") {
      const prepNote = parallelService.prepRequiredMinutes > 0
        ? ` (ocupação contínua incluindo ${parallelService.prepRequiredMinutes} min de preparação antecedente)`
        : ' (ocupação contínua durante todo o culto)';
      return {
        hasConflict: true,
        reason: `Bloqueio Litúrgico (PRD 5.2 / M24 & Issue #29 CA03): ${member.name} está escalado(a) no serviço de apoio '${parallelService.name}'${prepNote}.`,
        eligibleCandidates: members.filter(m => 
          m.active && 
          m.id !== memberId &&
          !(event.parallelServices || []).some(s => (s.volunteers || []).includes(m.id) || s.leaderId === m.id)
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
  const addCancelReason = (reasonText) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem cadastrar motivos de cancelamento." };
    const validation = validateCancellationReason(reasonText, cancelReasons);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await createCancellationReasonRemote(effectiveClient, effectiveChurchId, validation.cleanName);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          const newReason = {
            id: res.data?.id || `cr-${Date.now()}`,
            name: validation.cleanName,
            active: true,
            createdAt: res.data?.created_at || new Date().toISOString(),
            updatedAt: res.data?.updated_at || new Date().toISOString()
          };
          setCancelReasons(prev => [...prev, newReason]);
          addAuditLog("Cadastro de Motivo", `Novo motivo de cancelamento cadastrado: "${validation.cleanName}".`);
          return { success: true, reason: newReason, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    const newReason = {
      id: `cr-${Date.now()}`,
      name: validation.cleanName,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setCancelReasons(prev => [...prev, newReason]);
    addAuditLog("Cadastro de Motivo", `Novo motivo de cancelamento cadastrado: "${validation.cleanName}".`);
    return { success: true, reason: newReason };
  };

  const updateCancelReason = (id, newName) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar motivos de cancelamento." };
    const target = cancelReasons.find(r => r.id === id);
    if (!target) return { success: false, error: "Motivo não encontrado." };
    const validation = validateCancellationReason(newName, cancelReasons, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const previousName = target.name;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await updateCancellationReasonRemote(effectiveClient, effectiveChurchId, id, validation.cleanName);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setCancelReasons(prev =>
            prev.map(r => r.id === id ? { ...r, name: validation.cleanName, updatedAt: new Date().toISOString() } : r)
          );
          addAuditLog("Alteração de Motivo", `Motivo de cancelamento alterado de "${previousName}" para "${validation.cleanName}".`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setCancelReasons(prev =>
      prev.map(r => r.id === id ? { ...r, name: validation.cleanName, updatedAt: new Date().toISOString() } : r)
    );
    addAuditLog("Alteração de Motivo", `Motivo de cancelamento alterado de "${previousName}" para "${validation.cleanName}".`);
    return { success: true };
  };

  const toggleCancelReasonStatus = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar o status de motivos." };
    const target = cancelReasons.find(r => r.id === id);
    if (!target) return { success: false, error: "Motivo não encontrado." };
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const nextActive = !target.active;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await toggleCancellationReasonStatusRemote(effectiveClient, effectiveChurchId, id, nextActive);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setCancelReasons(prev =>
            prev.map(r => r.id === id ? { ...r, active: nextActive, updatedAt: new Date().toISOString() } : r)
          );
          addAuditLog(
            nextActive ? "Reativação de Motivo" : "Desativação de Motivo",
            `Motivo de cancelamento "${target.name}" foi ${nextActive ? "reativado" : "desativado"}.`
          );
          return { success: true, active: nextActive, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setCancelReasons(prev =>
      prev.map(r => r.id === id ? { ...r, active: nextActive, updatedAt: new Date().toISOString() } : r)
    );
    addAuditLog(
      nextActive ? "Reativação de Motivo" : "Desativação de Motivo",
      `Motivo de cancelamento "${target.name}" foi ${nextActive ? "reativado" : "desativado"}.`
    );
    return { success: true, active: nextActive };
  };

  const deleteCancelReason = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem excluir motivos de cancelamento." };
    const target = cancelReasons.find(r => r.id === id);
    if (!target) return { success: false, error: "Motivo não encontrado." };
    const deleteCheck = canDeleteCancellationReason(target, event.activities);
    if (!deleteCheck.canDelete) {
      return { success: false, error: deleteCheck.message };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await deleteCancellationReasonRemote(effectiveClient, effectiveChurchId, id);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setCancelReasons(prev => prev.filter(r => r.id !== id));
          addAuditLog("Exclusão de Motivo", `Motivo de cancelamento "${target.name}" foi removido do cadastro.`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setCancelReasons(prev => prev.filter(r => r.id !== id));
    addAuditLog("Exclusão de Motivo", `Motivo de cancelamento "${target.name}" foi removido do cadastro.`);
    return { success: true };
  };

  // Gerenciamento de Tipos de Evento (PRD §5 - Issue #25)
  const addEventType = (name, description = '') => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem cadastrar tipos de evento." };
    const validation = validateEventType(name, description, eventTypes);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await createEventTypeRemote(effectiveClient, effectiveChurchId, validation.cleanName, validation.cleanDesc);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          const newType = {
            id: res.data?.id || `et-${Date.now()}`,
            name: validation.cleanName,
            description: validation.cleanDesc,
            active: true,
            createdAt: res.data?.created_at || new Date().toISOString(),
            updatedAt: res.data?.updated_at || new Date().toISOString()
          };
          setEventTypes(prev => [...prev, newType]);
          addAuditLog("Cadastro de Tipo de Evento", `Novo tipo de evento cadastrado: "${validation.cleanName}".`);
          return { success: true, eventType: newType, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    const newType = {
      id: `et-${Date.now()}`,
      name: validation.cleanName,
      description: validation.cleanDesc,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setEventTypes(prev => [...prev, newType]);
    addAuditLog("Cadastro de Tipo de Evento", `Novo tipo de evento cadastrado: "${validation.cleanName}".`);
    return { success: true, eventType: newType };
  };

  const updateEventType = (id, newName, newDescription = '') => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar tipos de evento." };
    const target = eventTypes.find(t => t.id === id);
    if (!target) return { success: false, error: "Tipo de evento não encontrado." };
    const validation = validateEventType(newName, newDescription, eventTypes, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const previousName = target.name;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await updateEventTypeRemote(effectiveClient, effectiveChurchId, id, validation.cleanName, validation.cleanDesc);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setEventTypes(prev =>
            prev.map(t => t.id === id ? {
              ...t,
              name: validation.cleanName,
              description: validation.cleanDesc,
              updatedAt: new Date().toISOString()
            } : t)
          );
          addAuditLog("Alteração de Tipo de Evento", `Tipo de evento alterado de "${previousName}" para "${validation.cleanName}".`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setEventTypes(prev =>
      prev.map(t => t.id === id ? {
        ...t,
        name: validation.cleanName,
        description: validation.cleanDesc,
        updatedAt: new Date().toISOString()
      } : t)
    );
    addAuditLog("Alteração de Tipo de Evento", `Tipo de evento alterado de "${previousName}" para "${validation.cleanName}".`);
    return { success: true };
  };

  const toggleEventTypeStatus = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar o status de tipos de evento." };
    const target = eventTypes.find(t => t.id === id);
    if (!target) return { success: false, error: "Tipo de evento não encontrado." };
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const nextActive = !target.active;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await toggleEventTypeStatusRemote(effectiveClient, effectiveChurchId, id, nextActive);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setEventTypes(prev =>
            prev.map(t => t.id === id ? { ...t, active: nextActive, updatedAt: new Date().toISOString() } : t)
          );
          addAuditLog(
            nextActive ? "Reativação de Tipo de Evento" : "Desativação de Tipo de Evento",
            `Tipo de evento "${target.name}" foi ${nextActive ? "reativado" : "desativado"}.`
          );
          return { success: true, active: nextActive, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setEventTypes(prev =>
      prev.map(t => t.id === id ? { ...t, active: nextActive, updatedAt: new Date().toISOString() } : t)
    );
    addAuditLog(
      nextActive ? "Reativação de Tipo de Evento" : "Desativação de Tipo de Evento",
      `Tipo de evento "${target.name}" foi ${nextActive ? "reativado" : "desativado"}.`
    );
    return { success: true, active: nextActive };
  };

  const deleteEventType = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem excluir tipos de evento." };
    const target = eventTypes.find(t => t.id === id);
    if (!target) return { success: false, error: "Tipo de evento não encontrado." };
    const deleteCheck = canDeleteEventType(target, [event]);
    if (!deleteCheck.canDelete) {
      return { success: false, error: deleteCheck.message };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await deleteEventTypeRemote(effectiveClient, effectiveChurchId, id);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setEventTypes(prev => prev.filter(t => t.id !== id));
          addAuditLog("Exclusão de Tipo de Evento", `Tipo de evento "${target.name}" foi removido do cadastro.`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setEventTypes(prev => prev.filter(t => t.id !== id));
    addAuditLog("Exclusão de Tipo de Evento", `Tipo de evento "${target.name}" foi removido do cadastro.`);
    return { success: true };
  };

  // Gerenciamento de Atividades Padrão com Duração (PRD §5 - Issue #25)
  const addStandardActivity = (name, defaultDurationMinutes, category = 'Liturgia', description = '') => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem cadastrar atividades padrão." };
    const validation = validateStandardActivity(name, defaultDurationMinutes, category, description, standardActivities);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await createStandardActivityRemote(
            effectiveClient,
            effectiveChurchId,
            validation.cleanName,
            validation.cleanDuration,
            validation.cleanCat,
            validation.cleanDesc
          );
          if (!res.success) {
            return { success: false, error: res.error };
          }
          const newActivity = {
            id: res.data?.id || `sa-${Date.now()}`,
            name: validation.cleanName,
            defaultDurationMinutes: validation.cleanDuration,
            category: validation.cleanCat,
            description: validation.cleanDesc,
            active: true,
            createdAt: res.data?.created_at || new Date().toISOString(),
            updatedAt: res.data?.updated_at || new Date().toISOString()
          };
          setStandardActivities(prev => [...prev, newActivity]);
          addAuditLog(
            "Cadastro de Atividade Padrão",
            `Nova atividade padrão cadastrada: "${validation.cleanName}" (${validation.cleanDuration} min).`
          );
          return { success: true, activity: newActivity, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    const newActivity = {
      id: `sa-${Date.now()}`,
      name: validation.cleanName,
      defaultDurationMinutes: validation.cleanDuration,
      category: validation.cleanCat,
      description: validation.cleanDesc,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setStandardActivities(prev => [...prev, newActivity]);
    addAuditLog(
      "Cadastro de Atividade Padrão",
      `Nova atividade padrão cadastrada: "${validation.cleanName}" (${validation.cleanDuration} min).`
    );
    return { success: true, activity: newActivity };
  };

  const updateStandardActivity = (id, newName, newDurationMinutes, newCategory = 'Liturgia', newDescription = '') => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar atividades padrão." };
    const target = standardActivities.find(a => a.id === id);
    if (!target) return { success: false, error: "Atividade padrão não encontrada." };
    const validation = validateStandardActivity(newName, newDurationMinutes, newCategory, newDescription, standardActivities, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const previousName = target.name;
    const previousDuration = target.defaultDurationMinutes;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await updateStandardActivityRemote(
            effectiveClient,
            effectiveChurchId,
            id,
            validation.cleanName,
            validation.cleanDuration,
            validation.cleanCat,
            validation.cleanDesc
          );
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setStandardActivities(prev =>
            prev.map(a => a.id === id ? {
              ...a,
              name: validation.cleanName,
              defaultDurationMinutes: validation.cleanDuration,
              category: validation.cleanCat,
              description: validation.cleanDesc,
              updatedAt: new Date().toISOString()
            } : a)
          );
          addAuditLog(
            "Alteração de Atividade Padrão",
            `Atividade padrão "${previousName}" (${previousDuration} min) alterada para "${validation.cleanName}" (${validation.cleanDuration} min).`
          );
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setStandardActivities(prev =>
      prev.map(a => a.id === id ? {
        ...a,
        name: validation.cleanName,
        defaultDurationMinutes: validation.cleanDuration,
        category: validation.cleanCat,
        description: validation.cleanDesc,
        updatedAt: new Date().toISOString()
      } : a)
    );
    addAuditLog(
      "Alteração de Atividade Padrão",
      `Atividade padrão "${previousName}" (${previousDuration} min) alterada para "${validation.cleanName}" (${validation.cleanDuration} min).`
    );
    return { success: true };
  };

  const toggleStandardActivityStatus = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar o status de atividades padrão." };
    const target = standardActivities.find(a => a.id === id);
    if (!target) return { success: false, error: "Atividade padrão não encontrada." };
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const nextActive = !target.active;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await toggleStandardActivityStatusRemote(effectiveClient, effectiveChurchId, id, nextActive);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setStandardActivities(prev =>
            prev.map(a => a.id === id ? { ...a, active: nextActive, updatedAt: new Date().toISOString() } : a)
          );
          addAuditLog(
            nextActive ? "Reativação de Atividade Padrão" : "Desativação de Atividade Padrão",
            `Atividade padrão "${target.name}" foi ${nextActive ? "reativada" : "desativada"}.`
          );
          return { success: true, active: nextActive, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setStandardActivities(prev =>
      prev.map(a => a.id === id ? { ...a, active: nextActive, updatedAt: new Date().toISOString() } : a)
    );
    addAuditLog(
      nextActive ? "Reativação de Atividade Padrão" : "Desativação de Atividade Padrão",
      `Atividade padrão "${target.name}" foi ${nextActive ? "reativada" : "desativada"}.`
    );
    return { success: true, active: nextActive };
  };

  const deleteStandardActivity = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem excluir atividades padrão." };
    const target = standardActivities.find(a => a.id === id);
    if (!target) return { success: false, error: "Atividade padrão não encontrada." };
    const deleteCheck = canDeleteStandardActivity(target, event.activities);
    if (!deleteCheck.canDelete) {
      return { success: false, error: deleteCheck.message };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await deleteStandardActivityRemote(effectiveClient, effectiveChurchId, id);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setStandardActivities(prev => prev.filter(a => a.id !== id));
          addAuditLog("Exclusão de Atividade Padrão", `Atividade padrão "${target.name}" foi removida do cadastro.`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setStandardActivities(prev => prev.filter(a => a.id !== id));
    addAuditLog("Exclusão de Atividade Padrão", `Atividade padrão "${target.name}" foi removida do cadastro.`);
    return { success: true };
  };

  // Gerenciamento de Modelos Reutilizáveis de Culto (PRD §5, M28 - Issue #27)
  const addServiceTemplate = (data) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem cadastrar modelos de culto." };
    const validation = validateServiceTemplate(data, serviceTemplates);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const activities = Array.isArray(data.activities)
      ? data.activities.map((a, i) => toTemplateActivity(a, i)).filter(Boolean)
      : [];
    const parallelServices = Array.isArray(data.parallelServices)
      ? data.parallelServices.map((s, i) => toTemplateParallelService(s, i)).filter(Boolean)
      : [];

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await createServiceTemplateRemote(effectiveClient, effectiveChurchId, {
            ...data,
            name: validation.cleanName,
            description: validation.cleanDesc,
            activities,
            parallelServices
          });
          if (!res.success) {
            return { success: false, error: res.error };
          }
          const newTemplate = {
            id: res.data?.id || `st-${Date.now()}`,
            eventTypeId: data.eventTypeId || null,
            name: validation.cleanName,
            description: validation.cleanDesc,
            active: true,
            activities,
            parallelServices,
            createdAt: res.data?.created_at || new Date().toISOString(),
            updatedAt: res.data?.updated_at || new Date().toISOString()
          };
          setServiceTemplates(prev => [...prev, newTemplate]);
          addAuditLog("Cadastro de Modelo de Culto", `Novo modelo de culto cadastrado: "${validation.cleanName}".`);
          return { success: true, template: newTemplate, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    const newTemplate = {
      id: `st-${Date.now()}`,
      eventTypeId: data.eventTypeId || null,
      name: validation.cleanName,
      description: validation.cleanDesc,
      active: true,
      activities,
      parallelServices,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setServiceTemplates(prev => [...prev, newTemplate]);
    addAuditLog("Cadastro de Modelo de Culto", `Novo modelo de culto cadastrado: "${validation.cleanName}".`);
    return { success: true, template: newTemplate };
  };

  const updateServiceTemplate = (id, data) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar modelos de culto." };
    const target = serviceTemplates.find(t => t.id === id);
    if (!target) return { success: false, error: "Modelo de culto não encontrado." };
    const validation = validateServiceTemplate(data, serviceTemplates, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const previousName = target.name;
    const activities = Array.isArray(data.activities)
      ? data.activities.map((a, i) => toTemplateActivity(a, i)).filter(Boolean)
      : target.activities;
    const parallelServices = Array.isArray(data.parallelServices)
      ? data.parallelServices.map((s, i) => toTemplateParallelService(s, i)).filter(Boolean)
      : target.parallelServices;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await updateServiceTemplateRemote(effectiveClient, effectiveChurchId, id, {
            ...data,
            name: validation.cleanName,
            description: validation.cleanDesc,
            activities,
            parallelServices
          });
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setServiceTemplates(prev =>
            prev.map(t => t.id === id ? {
              ...t,
              eventTypeId: data.eventTypeId !== undefined ? data.eventTypeId : t.eventTypeId,
              name: validation.cleanName,
              description: validation.cleanDesc,
              activities,
              parallelServices,
              updatedAt: new Date().toISOString()
            } : t)
          );
          addAuditLog("Alteração de Modelo de Culto", `Modelo de culto alterado de "${previousName}" para "${validation.cleanName}".`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setServiceTemplates(prev =>
      prev.map(t => t.id === id ? {
        ...t,
        eventTypeId: data.eventTypeId !== undefined ? data.eventTypeId : t.eventTypeId,
        name: validation.cleanName,
        description: validation.cleanDesc,
        activities,
        parallelServices,
        updatedAt: new Date().toISOString()
      } : t)
    );
    addAuditLog("Alteração de Modelo de Culto", `Modelo de culto alterado de "${previousName}" para "${validation.cleanName}".`);
    return { success: true };
  };

  const toggleServiceTemplateStatus = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar o status de modelos de culto." };
    const target = serviceTemplates.find(t => t.id === id);
    if (!target) return { success: false, error: "Modelo de culto não encontrado." };
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const nextActive = !target.active;

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await toggleServiceTemplateStatusRemote(effectiveClient, effectiveChurchId, id, nextActive);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setServiceTemplates(prev =>
            prev.map(t => t.id === id ? { ...t, active: nextActive, updatedAt: new Date().toISOString() } : t)
          );
          addAuditLog(
            nextActive ? "Reativação de Modelo de Culto" : "Desativação de Modelo de Culto",
            `Modelo de culto "${target.name}" foi ${nextActive ? "reativado" : "desativado"}.`
          );
          return { success: true, active: nextActive, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setServiceTemplates(prev =>
      prev.map(t => t.id === id ? { ...t, active: nextActive, updatedAt: new Date().toISOString() } : t)
    );
    addAuditLog(
      nextActive ? "Reativação de Modelo de Culto" : "Desativação de Modelo de Culto",
      `Modelo de culto "${target.name}" foi ${nextActive ? "reativado" : "desativado"}.`
    );
    return { success: true, active: nextActive };
  };

  const deleteServiceTemplate = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem excluir modelos de culto." };
    const target = serviceTemplates.find(t => t.id === id);
    if (!target) return { success: false, error: "Modelo de culto não encontrado." };
    const deleteCheck = canDeleteServiceTemplate(target, [event]);
    if (!deleteCheck.canDelete) {
      return { success: false, error: deleteCheck.reason };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await deleteServiceTemplateRemote(effectiveClient, effectiveChurchId, id);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setServiceTemplates(prev => prev.filter(t => t.id !== id));
          addAuditLog("Exclusão de Modelo de Culto", `Modelo de culto "${target.name}" foi removido do cadastro.`);
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha na comunicação com o servidor." };
        }
      })();
    }

    setServiceTemplates(prev => prev.filter(t => t.id !== id));
    addAuditLog("Exclusão de Modelo de Culto", `Modelo de culto "${target.name}" foi removido do cadastro.`);
    return { success: true };
  };

  const applyServiceTemplateToEvent = (templateId) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem aplicar modelos de culto." };
    }
    const template = serviceTemplates.find(t => t.id === templateId);
    if (!template) {
      return { success: false, error: "Modelo de culto não encontrado." };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const updatedEvent = instantiateTemplateForEvent(template, event);

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await instantiateServiceTemplateRemote(effectiveClient, effectiveChurchId, templateId, event.id);
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setEvent(updatedEvent);
          addAuditLog(
            "Aplicação de Modelo no Culto",
            `Modelo '${template.name}' aplicado ao planejamento. Atividades litúrgicas e apoios padrão configurados sem alocação nominal de pessoas (PRD §5 / M28).`
          );
          return { success: true, remote: true };
        } catch (err) {
          return { success: false, error: err.message || "Falha ao aplicar modelo de culto no servidor." };
        }
      })();
    }

    setEvent(updatedEvent);
    addAuditLog(
      "Aplicação de Modelo no Culto",
      `Modelo '${template.name}' aplicado ao planejamento. Atividades litúrgicas e apoios padrão configurados sem alocação nominal de pessoas (PRD §5 / M28).`
    );
    return { success: true };
  };

  const removeParallelServiceFromCurrentEvent = (serviceId) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Permissão insuficiente." };
    }
    const updatedEvent = removeParallelServiceFromEvent(event, serviceId);
    setEvent(updatedEvent);
    addAuditLog(
      "Ajuste de Apoio no Culto",
      `Serviço de apoio removido desta edição do culto sem alterar o modelo original (PRD CA02).`
    );
    return { success: true };
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

  const designateLiturgyLeader = (newLeaderId, targetEventId = null) => {
    if (!isAdmin) return;
    const targetId = targetEventId || event.id;
    const leader = members.find(m => m.id === newLeaderId);
    setEvents(prev => prev.map(ev => {
      if (ev.id === targetId) {
        return {
          ...ev,
          liturgyLeaderId: newLeaderId
        };
      }
      return ev;
    }));
    addAuditLog(
      "Designação da Liturgia",
      `Pastor Marcos designou ${leader?.name || 'Membro'} como Líder da Liturgia para o evento.`
    );
  };

  // Criação de Nova Edição de Culto (Issue #28)
  const createEventEdition = (eventData) => {
    try {
      const authCheck = ensureAuthorizedContext();
      if (!authCheck.allowed) return { success: false, error: authCheck.error };

      const newEvent = createEventEditionObject(
        eventData,
        church,
        currentUser,
        eventData.activities || [],
        eventData.parallelServices || []
      );

      if (!authCheck.inMemory) {
        return (async () => {
          try {
            const res = await createChurchEventEditionRemote(effectiveClient, effectiveChurchId, {
              title: newEvent.title,
              event_date: newEvent.date,
              start_time: newEvent.scheduledStartTime,
              event_type_id: eventData.eventTypeId || null,
              service_template_id: eventData.serviceTemplateId || null,
              liturgy_leader_id: eventData.liturgyLeaderId || null,
              duration_policy: eventData.durationPolicy || 'warn',
              target_end_time: eventData.targetEndTime || null,
              planned_duration_minutes: newEvent.plannedDurationMinutes || 105,
              items: (eventData.activities || []).map((a, idx) => ({
                title: a.title,
                position: idx + 1,
                planned_duration_minutes: a.plannedDurationMinutes || 5,
                category: a.category || 'Liturgia',
                standard_activity_id: a.standardActivityId || null
              }))
            });

            if (!res.success) {
              return { success: false, error: res.error };
            }

            const createdEvent = {
              ...newEvent,
              id: res.data?.id || newEvent.id
            };

            setEvents(prev => [createdEvent, ...prev]);
            setCurrentEventId(createdEvent.id);
            addAuditLog(
              "Criação de Edição de Culto",
              `${currentUser.name} criou a edição '${createdEvent.title}' (${createdEvent.date} às ${createdEvent.scheduledStartTime}, duração prevista: ${createdEvent.plannedDurationMinutes} min).`
            );
            return { success: true, event: createdEvent, remote: true };
          } catch (err) {
            return { success: false, error: err.message || "Falha ao criar edição de evento no servidor." };
          }
        })();
      }

      setEvents(prev => [newEvent, ...prev]);
      setCurrentEventId(newEvent.id);
      addAuditLog(
        "Criação de Edição de Culto",
        `${currentUser.name} criou a edição '${newEvent.title}' (${newEvent.date} às ${newEvent.scheduledStartTime}, duração prevista: ${newEvent.plannedDurationMinutes} min).`
      );
      return { success: true, event: newEvent };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Selecionar Edição Ativa (Issue #28)
  const selectEvent = (eventId) => {
    const target = events.find(e => e.id === eventId);
    if (target) {
      setCurrentEventId(eventId);
    }
  };

  // Reordenação de Atividades na Programação (Issue #29, CA01)
  const reorderActivities = async (fromIndex, toIndex) => {
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const nextActivities = reorderEventActivities(event.activities, fromIndex, toIndex);

    if (!authCheck.inMemory) {
      try {
        const itemOrders = nextActivities.map((act, idx) => ({
          item_id: act.id,
          new_position: idx + 1
        }));
        const res = await reorderEventItemsRemote(effectiveClient, effectiveChurchId, event.id, itemOrders);
        if (!res.success) {
          return { success: false, error: res.error };
        }
        setEvent(prev => ({
          ...prev,
          activities: nextActivities
        }));
        addAuditLog("Reordenação de Atividades", `Sequência de atividades reordenada na edição '${event.title}'.`);
        return { success: true, remote: true };
      } catch (err) {
        return { success: false, error: err.message || "Falha ao sincronizar reordenação com o servidor." };
      }
    }

    setEvent(prev => ({
      ...prev,
      activities: nextActivities
    }));
    addAuditLog("Reordenação de Atividades", `Sequência de atividades reordenada na edição '${event.title}'.`);
    return { success: true };
  };

  const moveActivityUpInEvent = async (activityId, targetEventId = null) => {
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const reordered = moveActivityUp(targetEv.activities, activityId);

    if (!authCheck.inMemory) {
      try {
        const itemOrders = reordered.map((act, idx) => ({
          item_id: act.id,
          new_position: idx + 1
        }));
        const res = await reorderEventItemsRemote(effectiveClient, effectiveChurchId, targetId, itemOrders);
        if (!res.success) {
          return { success: false, error: res.error };
        }
        setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));
        return { success: true, remote: true };
      } catch (err) {
        return { success: false, error: err.message || "Falha ao mover atividade no servidor." };
      }
    }

    setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));
    return { success: true };
  };

  const moveActivityDownInEvent = async (activityId, targetEventId = null) => {
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const reordered = moveActivityDown(targetEv.activities, activityId);

    if (!authCheck.inMemory) {
      try {
        const itemOrders = reordered.map((act, idx) => ({
          item_id: act.id,
          new_position: idx + 1
        }));
        const res = await reorderEventItemsRemote(effectiveClient, effectiveChurchId, targetId, itemOrders);
        if (!res.success) {
          return { success: false, error: res.error };
        }
        setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));
        return { success: true, remote: true };
      } catch (err) {
        return { success: false, error: err.message || "Falha ao mover atividade no servidor." };
      }
    }

    setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));
    return { success: true };
  };

  // Configuração da Política de Duração do Evento (Issue #30, CA04)
  const setEventDurationPolicy = (newPolicy, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Permissão insuficiente para alterar a política de duração." };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    try {
      const targetId = targetEventId || currentEventId;
      const targetEv = events.find(e => e.id === targetId) || event;
      const updated = updateEventDurationPolicy(targetEv, newPolicy, isAdmin || isLiturgyLeader);

      if (!authCheck.inMemory) {
        return (async () => {
          try {
            const res = await setEventDurationPolicyRemote(
              effectiveClient,
              effectiveChurchId,
              targetId,
              newPolicy,
              updated.targetEndTime || null
            );
            if (!res.success) {
              return { success: false, error: res.error };
            }
            setEvents(prev => prev.map(ev => ev.id === targetId ? updated : ev));
            addAuditLog("Política de Duração", `Política de duração alterada para '${newPolicy}'.`);
            return { success: true, remote: true };
          } catch (err) {
            return { success: false, error: err.message || "Falha ao atualizar política de duração no servidor." };
          }
        })();
      }

      setEvents(prev => prev.map(ev => {
        if (ev.id === targetId) {
          return updated;
        }
        return ev;
      }));
      addAuditLog("Política de Duração", `Política de duração alterada para '${newPolicy}'.`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Publicar Programação Litúrgica (Issue #30, CA01 a CA04)
  const publishCurrentProgram = () => {
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    try {
      const published = publishEventProgram(event, currentUser.id);

      if (!authCheck.inMemory) {
        return (async () => {
          try {
            const res = await publishEventProgramRemote(
              effectiveClient,
              effectiveChurchId,
              event.id,
              event.programVersion || 1,
              event.activities || []
            );
            if (!res.success) {
              return { success: false, error: res.error };
            }
            setEvent(published);
            addAuditLog(
              "Publicação da Programação",
              `Programação litúrgica da edição '${event.title}' publicada com sucesso (Versão ${published.programVersion}).`
            );
            return { success: true, remote: true };
          } catch (err) {
            return { success: false, error: err.message || "Falha ao publicar programação no servidor." };
          }
        })();
      }

      setEvent(published);
      addAuditLog(
        "Publicação da Programação",
        `Programação litúrgica da edição '${event.title}' publicada com sucesso (Versão ${published.programVersion}).`
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Salvar Rascunho da Programação (Issue #30, CA02 e CA03)
  const saveCurrentProgramDraft = () => {
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    try {
      const draft = saveEventProgramDraft(event);

      if (!authCheck.inMemory) {
        return (async () => {
          try {
            const res = await saveEventProgramDraftRemote(
              effectiveClient,
              effectiveChurchId,
              event.id,
              event.activities || []
            );
            if (!res.success) {
              return { success: false, error: res.error };
            }
            setEvent(draft);
            addAuditLog(
              "Rascunho da Programação",
              `Rascunho da programação da edição '${event.title}' salvo com sucesso.`
            );
            return { success: true, remote: true };
          } catch (err) {
            return { success: false, error: err.message || "Falha ao salvar rascunho no servidor." };
          }
        })();
      }

      setEvent(draft);
      addAuditLog(
        "Rascunho da Programação",
        `Rascunho da programação da edição '${event.title}' salvo com sucesso.`
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Cálculos de Duração da Programação (PRD 6, Cenários M25 & M26, Issues #29 e #30)
  // Soma a sequência principal sem duplicar componentes do louvor ou serviços paralelos
  const durations = calculateProgramDurations(event);
  const totalPlannedDurationMinutes = durations.occupiedMinutes;
  const durationOverflowMinutes = durations.overflowMinutes;
  const availableDurationMinutes = durations.availableMinutes;
  const remainingDurationMinutes = durations.remainingMinutes;

  return (
    <AppContext.Provider
      value={{
        church,
        members,
        teams,
        cancelReasons,
        eventTypes,
        setEventTypes,
        standardActivities,
        setStandardActivities,
        serviceTemplates,
        setServiceTemplates,
        accessInvites,
        auditLogs,
        currentUser,
        setCurrentUserId,
        isAdmin,
        isLiturgyLeader,
        isTeamLeader,
        event,
        setEvent,
        events,
        setEvents,
        currentEventId,
        setCurrentEventId,
        selectEvent,
        createEventEdition,
        reorderActivities,
        moveActivityUpInEvent,
        moveActivityDownInEvent,
        setEventDurationPolicy,
        publishCurrentProgram,
        saveCurrentProgramDraft,
        isOnline,
        setIsOnline,
        isDataStale,
        setIsDataStale,
        lastSyncTime,
        theme,
        setTheme,
        totalPlannedDurationMinutes,
        durationOverflowMinutes,
        availableDurationMinutes,
        remainingDurationMinutes,
        breakElapsedSeconds,

        // Sincronização Remota com Supabase (Issues #25 a #30)
        reloadRemoteData,
        remoteLoading,
        remoteError,
        effectiveChurchId,
        isRemoteConfigured: Boolean(effectiveClient && effectiveChurchId),
        isMemoryFallbackAllowed,

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
        updateCancelReason,
        toggleCancelReasonStatus,
        deleteCancelReason,
        addEventType,
        updateEventType,
        toggleEventTypeStatus,
        deleteEventType,
        addStandardActivity,
        updateStandardActivity,
        toggleStandardActivityStatus,
        deleteStandardActivity,
        addServiceTemplate,
        updateServiceTemplate,
        toggleServiceTemplateStatus,
        deleteServiceTemplate,
        applyServiceTemplateToEvent,
        removeParallelServiceFromCurrentEvent,
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
