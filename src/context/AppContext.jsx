import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase as defaultSupabaseClient } from '../lib/supabaseClient';
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
  normalizeNfcText,
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
  hasTemplateChangedRemotely,
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
  getEventProgramRemote,
  updateEventItemRemote,
  removeEventItemRemote,
  reorderEventItemsRemote,
  setEventDurationPolicyRemote,
  publishEventProgramRemote,
  saveEventProgramDraftRemote,
  eventPlanningErrorMessage,
  extractChurchEventsFromRpc,
  toPlanningEventFromServer,
  mergeServerEventsWithSession,
  generateCommandUuid,
  calculateParallelServiceWindow,
  checkScaleConflictWithParallelPrep,
  getEventAssignmentsRemote,
  calculateEditionScaleConflicts,
  DEFAULT_TIMEZONE,
} from '../utils/eventPlanningService';
import {
  buildLiturgicalItemDrafts,
  buildParallelServiceDrafts,
  buildEventItemDraftKey,
  buildEventItemUpdateKey,
  buildEventItemRemoveKey,
  saveEventItemsSequentially,
  describeEventItemsOutcome,
  toPersistedActivities,
  toPersistedParallelServices,
  EVENT_ITEMS_PERSISTENCE_NOTICE,
  PARALLEL_SERVICES_PERSISTENCE_NOTICE,
  TEMPLATE_APPEND_NOTICE,
  UNKNOWN_SERVER_ITEMS_BLOCK_REASON,
  canAppendEventItemsToEvent,
  getAppendEventItemsBlockReason,
} from '../utils/eventItemService';
import {
  assignEventLiturgyLeader,
} from '../utils/liturgicalCommandService';

export const AppContext = createContext(null);

export function AppProvider({
  children,
  initialUserId = "carlos",
  churchId: propChurchId = null,
  supabaseClient: propSupabaseClient = null,
  allowMemoryFallback = undefined,
}) {
  let authContext = null;
  try {
    authContext = useAuth();
  } catch {
    authContext = null;
  }
  const effectiveChurchId = propChurchId || authContext?.churchAccess?.church_id || null;
  const effectiveClient = propSupabaseClient || (authContext ? defaultSupabaseClient : null);

  // Diferenciação estrita entre ambiente real autenticado e testes/demonstração
  const isRealAuthSession = Boolean(authContext?.churchAccess);

  const isMemoryFallbackAllowed = allowMemoryFallback === false
    ? false
    : allowMemoryFallback === true
      ? true
      : Boolean(!isRealAuthSession);

  const isRealEnvironment = isRealAuthSession;
  const isRemoteConfigured = Boolean(effectiveClient && effectiveChurchId);

  const previousChurchIdRef = useRef(effectiveChurchId);
  const loadRequestSeqRef = useRef(0);
  const lastSuccessfulSyncSeqRef = useRef(0);
  const editingDraftsRef = useRef(new Map());
  // Comandos de gravação de etapa sem confirmação do servidor, para repetir com o mesmo command_id (Issue #29)
  const pendingEventItemCommandsRef = useRef(new Map());
  // Comandos de atualização e remoção sem confirmação do servidor (idempotência pós-026)
  const pendingUpdateCommandsRef = useRef(new Map());
  const pendingRemoveCommandsRef = useRef(new Map());
  // Comandos de reordenação sem confirmação, indexados por evento e ordem pretendida.
  const pendingReorderCommandsRef = useRef(new Map());
  // Comandos de ciclo de vida da programação sem confirmação (idempotência B3)
  const pendingProgramLifecycleCommandsRef = useRef(new Map());
  // Mapa de requisições ativas de carregamento indexado por churchId:eventId
  const programLoadRequestsRef = useRef(new Map());
  const currentEventIdRef = useRef(null);
  // Comando de criação de edição sem confirmação do servidor, para evitar duplicação (Issue #28)
  const pendingCreateEventCommandRef = useRef(null);
  const [pendingCreateEvent, setPendingCreateEvent] = useState(null);
  const setPendingCreateCommand = useCallback((entry) => {
    pendingCreateEventCommandRef.current = entry;
    setPendingCreateEvent(entry ? { commandId: entry.commandId, summary: entry.summary } : null);
  }, []);

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
  const [church, setChurch] = useState(() => {
    if (authContext?.churchAccess) {
      return {
        id: authContext.churchAccess.church_id,
        name: authContext.churchAccess.church_name,
        timezone: authContext.churchAccess.timezone || 'America/Sao_Paulo',
        defaultDurationPolicy: authContext.churchAccess.default_duration_policy || 'warn',
      };
    }
    return INITIAL_CHURCH;
  });

  useEffect(() => {
    if (authContext?.churchAccess) {
      setChurch({
        id: authContext.churchAccess.church_id,
        name: authContext.churchAccess.church_name,
        timezone: authContext.churchAccess.timezone || 'America/Sao_Paulo',
        defaultDurationPolicy: authContext.churchAccess.default_duration_policy || 'warn',
      });
    }
  }, [authContext?.churchAccess]);

  const [members, setMembers] = useState(() => (isRealEnvironment ? [] : INITIAL_MEMBERS));
  const [teams, setTeams] = useState(() => (isRealEnvironment ? [] : INITIAL_TEAMS));
  const [cancelReasons, setCancelReasons] = useState(() =>
    isRealEnvironment ? [] : INITIAL_CANCEL_REASONS.map((r, idx) => toReasonObject(r, idx))
  );
  const [eventTypes, setEventTypes] = useState(() =>
    isRealEnvironment ? [] : INITIAL_EVENT_TYPES.map((t, idx) => toEventTypeObject(t, idx))
  );
  const [standardActivities, setStandardActivities] = useState(() =>
    isRealEnvironment ? [] : INITIAL_STANDARD_ACTIVITIES.map((a, idx) => toStandardActivityObject(a, idx))
  );
  const [serviceTemplates, setServiceTemplates] = useState(() =>
    isRealEnvironment ? [] : INITIAL_SERVICE_TEMPLATES.map((st, idx) => toServiceTemplateObject(st, idx))
  );
  const [accessInvites, setAccessInvites] = useState(() => (isRealEnvironment ? [] : INITIAL_ACCESS_INVITES));
  const [auditLogs, setAuditLogs] = useState(() => (isRealEnvironment ? [] : INITIAL_AUDIT_LOGS));

  // Estados de Sincronização Remota com Supabase (Issues #25 a #30)
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(null);
  const [teamsLoadStatus, setTeamsLoadStatus] = useState(() => (effectiveClient && effectiveChurchId ? 'loading' : 'loaded'));
  const [membersLoadStatus, setMembersLoadStatus] = useState(() => (effectiveClient && effectiveChurchId ? 'loading' : 'loaded'));

  // Isolamento Multi-Tenant: Limpa estado e cancela requisições em voo na troca de igreja
  useEffect(() => {
    if (previousChurchIdRef.current !== effectiveChurchId) {
      previousChurchIdRef.current = effectiveChurchId;
      loadRequestSeqRef.current += 1;
      setPendingCreateCommand(null);
      pendingEventItemCommandsRef.current.clear();
      pendingReorderCommandsRef.current.clear();
      setTeamsLoadStatus(effectiveClient && effectiveChurchId ? 'loading' : 'loaded');
      setMembersLoadStatus(effectiveClient && effectiveChurchId ? 'loading' : 'loaded');
      if (effectiveChurchId) {
        setCancelReasons([]);
        setEventTypes([]);
        setStandardActivities([]);
        setServiceTemplates([]);
        setEvents([]);
      }
    }
  }, [effectiveChurchId, effectiveClient, setPendingCreateCommand]);

  const reloadRemoteData = useCallback(async () => {
    if (!effectiveClient || !effectiveChurchId) return;
    const currentSeq = ++loadRequestSeqRef.current;
    setRemoteLoading(true);
    setRemoteError(null);
    setTeamsLoadStatus('loading');
    setMembersLoadStatus('loading');
    try {
      const [reasonsRes, typesRes, actsRes, templatesRes] = await Promise.all([
        fetchCancellationReasonsRemote(effectiveClient, effectiveChurchId, true),
        fetchEventTypesRemote(effectiveClient, effectiveChurchId, true),
        fetchStandardActivitiesRemote(effectiveClient, effectiveChurchId, true),
        fetchServiceTemplatesRemote(effectiveClient, effectiveChurchId, true),
      ]);

      if (loadRequestSeqRef.current !== currentSeq) return;

      // Domínio: Motivos de cancelamento
      if (reasonsRes.success) {
        setCancelReasons(reasonsRes.data);
        setIsReasonsStale(false);
      } else {
        setIsReasonsStale(true);
        setCancelReasons(prev => prev.map(r => ({ ...r, isStale: true })));
      }

      // Domínio: Tipos de evento
      if (typesRes.success) {
        setEventTypes(typesRes.data);
        setIsEventTypesStale(false);
      } else {
        setIsEventTypesStale(true);
        setEventTypes(prev => prev.map(t => ({ ...t, isStale: true })));
      }

      // Domínio: Atividades padrão
      if (actsRes.success) {
        setStandardActivities(actsRes.data);
        setIsActivitiesStale(false);
      } else {
        setIsActivitiesStale(true);
        setStandardActivities(prev => prev.map(a => ({ ...a, isStale: true })));
      }

      // Domínio: Modelos de culto
      if (templatesRes.success) {
        setServiceTemplates(templatesRes.data);
        setIsTemplatesStale(false);

        // Se houver rascunhos em edição, atualiza a referência de origem se os dados remotos forem idênticos
        if (editingDraftsRef.current && editingDraftsRef.current.size > 0 && Array.isArray(templatesRes.data)) {
          for (const [draftId, draftOrigin] of editingDraftsRef.current.entries()) {
            const remoteTpl = templatesRes.data.find(t => t.id === draftId);
            if (remoteTpl && !hasTemplateChangedRemotely(draftOrigin, remoteTpl)) {
              draftOrigin.syncSeq = currentSeq;
              draftOrigin.updatedAt = remoteTpl.updatedAt || draftOrigin.updatedAt;
            }
          }
        }
      } else {
        setIsTemplatesStale(true);
        setServiceTemplates(prev => prev.map(t => ({ ...t, isStale: true })));
      }

      // Problema A3: O sinal global isDataStale SÓ é liberado se TODAS as consultas forem bem-sucedidas!
      const hasAnyDomainFailed = !reasonsRes.success || !typesRes.success || !actsRes.success || !templatesRes.success;
      setIsDataStale(hasAnyDomainFailed);
      if (!hasAnyDomainFailed) {
        lastSuccessfulSyncSeqRef.current = currentSeq;
      }

      const firstFailed = [reasonsRes, typesRes, actsRes, templatesRes].find(r => !r.success);
      if (firstFailed) {
        setRemoteError(firstFailed.error);
      } else {
        setRemoteError(null);
      }

      // Consulta complementar de membros e equipes reais da igreja se disponível
      try {
        if (authContext?.churchAccess?.is_admin) {
          const { data: membersData, error: membersErr } = await effectiveClient.rpc('list_church_members', {
            p_church_id: effectiveChurchId,
            p_limit: 100,
            p_offset: 0
          });
          if (loadRequestSeqRef.current === currentSeq) {
            if (!membersErr && Array.isArray(membersData)) {
              const mappedMembers = membersData.map(m => ({
                id: m.member_id,
                name: m.display_name,
                roles: ['membro'],
                active: m.status === 'active',
                skills: [],
                teams: []
              }));
              if (authContext?.churchAccess?.is_admin && authContext?.churchAccess?.member_id) {
                const foundMe = mappedMembers.find(m => m.id === authContext.churchAccess.member_id);
                if (foundMe) {
                  foundMe.roles = ['admin', 'membro'];
                } else {
                  mappedMembers.unshift({
                    id: authContext.churchAccess.member_id,
                    name: authContext.churchAccess.display_name,
                    roles: ['admin', 'membro'],
                    active: true,
                    skills: [],
                    teams: []
                  });
                }
              }
              if (mappedMembers.length > 0) {
                setMembers(mappedMembers);
              }
              setMembersLoadStatus('loaded');
            } else {
              setMembersLoadStatus('failed');
            }
          }
        } else {
          const { data: membersData, error: membersErr } = await effectiveClient.rpc('list_church_members_for_team', {
            p_church_id: effectiveChurchId
          });
          if (loadRequestSeqRef.current === currentSeq) {
            const row = Array.isArray(membersData) ? membersData[0] : membersData;
            const raw = row?.members;
            if (!membersErr && Array.isArray(raw)) {
              const mappedMembers = raw.map(m => ({
                id: m.member_id ?? m.id,
                name: m.display_name,
                roles: ['membro'],
                active: true,
                skills: [],
                teams: []
              }));
              setMembers(mappedMembers);
              setMembersLoadStatus('loaded');
            } else {
              setMembersLoadStatus('failed');
            }
          }
        }
      } catch {
        if (loadRequestSeqRef.current === currentSeq) {
          setMembersLoadStatus('failed');
        }
      }

      try {
        const { data: teamsData, error: teamsErr } = await effectiveClient.rpc('list_church_teams', {
          p_church_id: effectiveChurchId
        });
        if (loadRequestSeqRef.current === currentSeq) {
          if (!teamsErr && Array.isArray(teamsData) && teamsData.length === 0) {
            setTeams([]);
            setTeamsLoadStatus('loaded');
          } else {
            const row = Array.isArray(teamsData) ? teamsData[0] : teamsData;
            const rawTeams = row?.teams;
            if (!teamsErr && Array.isArray(rawTeams)) {
              const mappedTeams = rawTeams.map(t => ({
                id: t.id ?? t.team_id,
                name: t.name,
                leaderId: t.leader_member_id || null
              }));
              setTeams(mappedTeams);
              setTeamsLoadStatus('loaded');
            } else {
              setTeamsLoadStatus('failed');
            }
          }
        }
      } catch {
        if (loadRequestSeqRef.current === currentSeq) {
          setTeamsLoadStatus('failed');
        }
      }

      try {
        const { data: eventsData, error: eventsErr } = await effectiveClient.rpc('list_church_events', {
          p_church_id: effectiveChurchId,
          p_status_filter: null,
          p_limit: 50,
          p_offset: 0
        });
        // Issue #28: a RPC devolve uma linha { events: [...], total_count }, não a lista de eventos.
        // A carga só é válida sem erro, com formato reconhecido e na sequência de carga mais recente.
        const serverEvents = (!eventsErr && loadRequestSeqRef.current === currentSeq)
          ? extractChurchEventsFromRpc(eventsData)
          : null;
        if (serverEvents !== null) {
          if (serverEvents.length > 0) {
            const fallbackTimezone = authContext?.churchAccess?.timezone || DEFAULT_TIMEZONE;
            const mappedEvents = serverEvents
              .map(ev => toPlanningEventFromServer(ev, fallbackTimezone))
              .filter(Boolean);
            if (mappedEvents.length > 0) {
              // Etapas, apoios, política e situação da programação não vêm do servidor:
              // mantém o que esta sessão já conhece do mesmo evento e deixa o restante como não informado.
              setEvents(prev => mergeServerEventsWithSession(mappedEvents, prev));
              setCurrentEventId(prevId => (
                mappedEvents.some(ev => ev.id === prevId) ? prevId : mappedEvents[0].id
              ));
            } else {
              setEvents([]);
              setCurrentEventId(null);
            }
          } else {
            setEvents([]);
            setCurrentEventId(null);
          }
        }
        // Em erro ou formato não reconhecido: preserva o estado atual para não apagar dados em falha transitória.
      } catch {
        // Consulta auxiliar não-bloqueante
      }
    } catch (err) {
      if (loadRequestSeqRef.current === currentSeq) {
        setRemoteError(err.message || 'Falha ao sincronizar dados remotos.');
        setTeamsLoadStatus(prev => (prev === 'loading' ? 'failed' : prev));
        setMembersLoadStatus(prev => (prev === 'loading' ? 'failed' : prev));
      }
    } finally {
      if (loadRequestSeqRef.current === currentSeq) {
        setRemoteLoading(false);
      }
    }
  }, [effectiveClient, effectiveChurchId, authContext?.churchAccess]);

  useEffect(() => {
    if (effectiveClient && effectiveChurchId) {
      reloadRemoteData();
    }
  }, [effectiveClient, effectiveChurchId, reloadRemoteData]);

  // Usuário Atual Ativo (Sessão real se autenticado, ou fallback controlado para testes)
  const [currentUserId, setCurrentUserId] = useState(() => {
    if (authContext?.churchAccess?.member_id) {
      return authContext.churchAccess.member_id;
    }
    return initialUserId;
  });

  // Estado dos Eventos da Igreja (Issue #28)
  const [events, setEvents] = useState(() => (isRealEnvironment ? [] : [INITIAL_EVENT]));
  const [currentEventId, setCurrentEventId] = useState(() => (isRealEnvironment ? null : INITIAL_EVENT.id));

  useEffect(() => {
    currentEventIdRef.current = currentEventId;
  }, [currentEventId]);

  const getProgramMutationBlockReason = (ev) => {
    if (!ev) return "Nenhum evento selecionado.";
    if (ev.isProgramLoading) {
      return "A programação do evento está sendo carregada do servidor. Aguarde a conclusão antes de realizar alterações.";
    }
    if (ev.programLoadError) {
      return `A programação do evento não foi carregada com sucesso (${ev.programLoadError}). Mutações bloqueadas para evitar inconsistências.`;
    }
    if (ev.loadedFromServer && !ev.activitiesKnownInSession) {
      return "Não é possível realizar mutações antes de carregar com sucesso o programa existente do servidor. Recarregue a página.";
    }
    return null;
  };

  // Evento Ativo
  const event = events.find(e => e.id === currentEventId) || events[0] || (isRealEnvironment ? null : INITIAL_EVENT);

  const setEvent = (updater) => {
    setEvents(prevEvents => {
      const targetId = currentEventId;
      const targetEvent = prevEvents.find(e => e.id === targetId) || prevEvents[0] || (isRealEnvironment ? null : INITIAL_EVENT);
      if (!targetEvent) return prevEvents;
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
  const [isTemplatesStale, setIsTemplatesStale] = useState(false);
  const [isEventTypesStale, setIsEventTypesStale] = useState(false);
  const [isActivitiesStale, setIsActivitiesStale] = useState(false);
  const [isReasonsStale, setIsReasonsStale] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(new Date().toLocaleTimeString('pt-BR'));

  const beginEditingTemplate = useCallback((id) => {
    const tpl = serviceTemplates.find(t => t.id === id);
    if (!tpl) return null;
    const origin = {
      id,
      syncSeq: loadRequestSeqRef.current,
      name: tpl.name,
      description: tpl.description || '',
      eventTypeId: tpl.eventTypeId || null,
      active: tpl.active !== false,
      updatedAt: tpl.updatedAt || null,
      parallelServicesCount: tpl.parallelServices?.length ?? tpl.parallelServicesCount ?? 0,
      activitiesCount: tpl.activities?.length ?? tpl.activitiesCount ?? 0,
      parallelServices: (tpl.parallelServices || []).map(s => ({ ...s })),
      activities: (tpl.activities || []).map(a => ({ ...a }))
    };
    editingDraftsRef.current.set(id, origin);
    return origin;
  }, [serviceTemplates]);

  const cancelEditingTemplate = useCallback((id) => {
    editingDraftsRef.current.delete(id);
  }, []);

  // Tema Visual (Dark Litúrgico vs Light)
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement?.setAttribute) {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const currentUser = React.useMemo(() => {
    if (authContext?.churchAccess) {
      return {
        id: authContext.churchAccess.member_id,
        name: authContext.churchAccess.display_name,
        roles: authContext.churchAccess.is_admin ? ['admin', 'membro'] : ['membro'],
        active: true,
        skills: [],
        teams: []
      };
    }
    return members.find(m => m.id === currentUserId) || members[0] || {
      id: 'default-user',
      name: 'Membro',
      roles: ['membro'],
      active: true,
      skills: [],
      teams: []
    };
  }, [authContext?.churchAccess, members, currentUserId]);

  // Helper de Permissões (PRD 3.2 & 4)
  const isAdmin = authContext?.churchAccess != null
    ? Boolean(authContext.churchAccess.is_admin)
    : (currentUser?.roles?.includes("admin") ?? false);

  const isLiturgyLeader = event ? event.liturgyLeaderId === currentUser.id : false;
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
    if (event?.status === "em_andamento" && event?.currentActivityStatus === "em_execucao") {
      interval = setInterval(() => {
        setEvent(prev => {
          if (!prev) return prev;
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
  }, [event?.status, event?.currentActivityStatus]);

  // Contagem de Intervalo entre Atividades (PRD 7.5)
  const [breakElapsedSeconds, setBreakElapsedSeconds] = useState(0);
  useEffect(() => {
    let interval = null;
    if (event?.inBreak) {
      interval = setInterval(() => {
        setBreakElapsedSeconds(sec => sec + 1);
      }, 1000);
    } else {
      setBreakElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [event?.inBreak]);

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

    // Regra: Membro escalado em apoio técnico ocupa todo o intervalo com preparação antecedente (PRD §5.2 / M24, M50 & Issue #29 CA03, CA04).
    // Conflito de apoio com preparação é SINAL: não bloqueia e não substitui pessoa.
    // O intervalo é derivado exclusivamente pela função pura calculateParallelServiceWindow / checkScaleConflictWithParallelPrep.
    const plannedStart = event.plannedStartAt || event.planned_start_at;
    const plannedEnd = event.plannedEndAt || event.planned_end_at;
    if (plannedStart && plannedEnd && targetActivity) {
      const candWindow = {
        startAt: plannedStart,
        endAt: plannedEnd,
      };
      const prepConflict = checkScaleConflictWithParallelPrep(memberId, candWindow, event, targetRole);
      if (prepConflict.hasConflict) {
        return {
          hasConflict: false, // Conflito de apoio é SINAL: não bloqueia a alocação!
          hasScaleSignal: true,
          isLiturgicalBlock: false,
          signalReason: `Sinal de Conflito de Escala (PRD §5.2 / M24 & Issue #29 CA03): ${prepConflict.reason}`,
          scaleConflict: prepConflict,
        };
      }
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
    if (isDataStale || isReasonsStale) {
      const detail = remoteError ? `: ${remoteError}` : '. Reconcilie a conexão antes de cadastrar.';
      return {
        success: false,
        error: `Falha de sincronização: os dados de motivos de cancelamento estão desatualizados${detail}`
      };
    }
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
          const createdId = res.data?.id || res.reason?.id;
          if (!createdId) {
            return {
              success: false,
              error: "Criação não confirmada pelo servidor: identificador persistido ausente. Confira os dados antes de tentar novamente."
            };
          }
          const newReason = {
            id: createdId,
            name: validation.cleanName,
            active: true,
            createdAt: res.data?.createdAt || res.data?.created_at || new Date().toISOString(),
            updatedAt: res.data?.updatedAt || res.data?.updated_at || new Date().toISOString()
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
    if (isDataStale || isReasonsStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de motivos de cancelamento estão desatualizados. Reconcilie a conexão antes de alterar o motivo."
      };
    }
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
    if (isDataStale || isReasonsStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de motivos de cancelamento estão desatualizados. Reconcilie a conexão antes de alterar o status."
      };
    }
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
    if (isDataStale || isReasonsStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de motivos de cancelamento estão desatualizados. Reconcilie a conexão antes de excluir."
      };
    }
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
    if (isDataStale || isEventTypesStale) {
      const detail = remoteError ? `: ${remoteError}` : '. Reconcilie a conexão antes de cadastrar.';
      return {
        success: false,
        error: `Falha de conexão ou sincronização: os dados de tipos de evento estão desatualizados${detail}`
      };
    }
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
          const createdId = res.data?.id;
          if (!createdId) {
            return { success: false, error: "O banco de dados não retornou o identificador persistido do tipo de evento criado." };
          }
          const newType = {
            id: createdId,
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
    if (isDataStale || isEventTypesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de tipos de evento estão desatualizados. Reconcilie a conexão antes de alterar o tipo de evento."
      };
    }
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
    if (isDataStale || isEventTypesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de tipos de evento estão desatualizados. Reconcilie a conexão antes de alterar o status."
      };
    }
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
    if (isDataStale || isEventTypesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de tipos de evento estão desatualizados. Reconcilie a conexão antes de excluir."
      };
    }
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
    if (isDataStale || isActivitiesStale) {
      const detail = remoteError ? `: ${remoteError}` : '. Reconcilie a conexão antes de cadastrar.';
      return {
        success: false,
        error: `Falha de sincronização: os dados de atividades padrão estão desatualizados${detail}`
      };
    }
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
          const createdId = res.data?.id;
          if (!createdId) {
            return { success: false, error: "O banco de dados não retornou o identificador persistido da atividade padrão criada." };
          }
          const newActivity = {
            id: createdId,
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
    if (isDataStale || isActivitiesStale || target?.isStale) {
      const detail = remoteError ? `: ${remoteError}` : '. Reconcilie a conexão antes de alterar a atividade.';
      return {
        success: false,
        error: `Falha de sincronização: os dados de atividades padrão estão desatualizados${detail}`
      };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!authCheck.inMemory && typeof id === 'string' && id.startsWith('sa-')) {
      return {
        success: false,
        error: 'Identificador de atividade padrão inválido ou não sincronizado com o banco de dados. Recarregue os dados da igreja antes de editar.'
      };
    }

    if (!target) return { success: false, error: "Atividade padrão não encontrada." };
    const validation = validateStandardActivity(newName, newDurationMinutes, newCategory, newDescription, standardActivities, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

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
    if (isDataStale || isActivitiesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de atividades padrão estão desatualizados. Reconcilie a conexão antes de alterar o status."
      };
    }
    const authCheck = ensureAuthorizedContext();

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
    if (isDataStale || isActivitiesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados de atividades padrão estão desatualizados. Reconcilie a conexão antes de excluir."
      };
    }
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
    // Problema A3: Bloqueio de criação de modelo durante estado de desatualização
    if (isDataStale || isTemplatesStale) {
      return {
        success: false,
        error: "Não é possível cadastrar novos modelos enquanto os dados estiverem desatualizados. Reconcilie a conexão antes de cadastrar."
      };
    }
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
          const createdId = res.data?.id;
          if (!createdId) {
            return { success: false, error: "O banco de dados não retornou o identificador persistido do modelo de culto criado." };
          }
          const newTemplate = {
            id: createdId,
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

  const updateServiceTemplate = (id, data, options = {}) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar modelos de culto." };
    const target = serviceTemplates.find(t => t.id === id);
    if (!target) return { success: false, error: "Modelo de culto não encontrado." };

    // Atualização originada por reconciliação / sincronização remota
    if (options.syncUpdate) {
      lastSuccessfulSyncSeqRef.current += 1;
      setServiceTemplates(prev =>
        prev.map(t => t.id === id ? {
          ...t,
          ...data,
          parallelServices: data.parallelServices || t.parallelServices,
          activities: data.activities || t.activities,
          parallelServicesCount: (data.parallelServices || t.parallelServices || []).length,
          activitiesCount: (data.activities || t.activities || []).length,
          isStale: false,
          updatedAt: data.updatedAt || new Date().toISOString()
        } : t)
      );
      return { success: true, syncUpdate: true };
    }

    // Regra B3: Um modelo incompleto não pode ser editado ou salvo
    if (target.isComplete === false || (target.activitiesCount > 0 && (!target.activities || target.activities.length === 0))) {
      return {
        success: false,
        error: "Não é possível atualizar modelo de culto com detalhes incompletos. Recarregue os dados da igreja antes de editar."
      };
    }

    // Problema B & A3: Proteção contra escrita desatualizada
    if (isDataStale || isTemplatesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados do modelo de culto estão desatualizados devido a uma falha na última sincronização. Reconcilie a conexão antes de alterar o modelo."
      };
    }

    // Problema A2: Proteção de integridade contra salvamento de formulário antigo após alteração remota real
    const draftOrigin = options?.originSnapshot || editingDraftsRef.current.get(id);
    if (draftOrigin) {
      const hasChanged = hasTemplateChangedRemotely(draftOrigin, target);
      if (hasChanged) {
        return {
          success: false,
          conflict: true,
          error: "Os dados deste modelo foram atualizados no servidor por outra sessão ou sincronização. Reabra o modelo para carregar as alterações mais recentes antes de salvar."
        };
      } else {
        // Se não houve alteração remota efetiva, atualizar a referência de origem do rascunho e permitir o salvamento, preservando as alterações locais.
        draftOrigin.syncSeq = lastSuccessfulSyncSeqRef.current;
        draftOrigin.updatedAt = target.updatedAt || draftOrigin.updatedAt;
      }
    }

    const originParallelCount = typeof options.originParallelServicesCount === 'number'
      ? options.originParallelServicesCount
      : undefined;
    if (typeof originParallelCount === 'number') {
      const currentParallelCount = target.parallelServices?.length ?? target.parallelServicesCount ?? 0;
      if (currentParallelCount !== originParallelCount) {
        return {
          success: false,
          conflict: true,
          error: "A quantidade de apoios deste modelo foi modificada no servidor por outra sessão ou sincronização. Reabra o modelo para carregar as alterações mais recentes antes de salvar."
        };
      }
    }

    const originActsCount = typeof options.originActivitiesCount === 'number'
      ? options.originActivitiesCount
      : undefined;
    if (typeof originActsCount === 'number') {
      const currentActsCount = target.activities?.length ?? target.activitiesCount ?? 0;
      if (currentActsCount !== originActsCount) {
        return {
          success: false,
          conflict: true,
          error: "A quantidade de atividades deste modelo foi modificada no servidor por outra sessão ou sincronização. Reabra o modelo para carregar as alterações mais recentes antes de salvar."
        };
      }
    }

    const validation = validateServiceTemplate(data, serviceTemplates, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const previousName = target.name;

    // Regra C: Resolução de campos escalares com preservação do conteúdo existente quando omitidos
    const resolvedDescription = data.description !== undefined
      ? (data.description === null || data.description === '' ? '' : normalizeNfcText(data.description))
      : (target.description ?? '');

    const resolvedEventTypeId = data.eventTypeId !== undefined
      ? (data.eventTypeId || null)
      : (target.eventTypeId ?? null);

    // Regra D: Distinguir campo omitido (undefined) de lista vazia intencional ([])
    const activities = data.activities !== undefined
      ? (Array.isArray(data.activities) ? data.activities.map((a, i) => toTemplateActivity(a, i)).filter(Boolean) : [])
      : undefined;
    const parallelServices = data.parallelServices !== undefined
      ? (Array.isArray(data.parallelServices) ? data.parallelServices.map((s, i) => toTemplateParallelService(s, i)).filter(Boolean) : [])
      : undefined;

    const resolvedActivities = activities !== undefined ? activities : (target.activities || []);
    const resolvedParallelServices = parallelServices !== undefined ? parallelServices : (target.parallelServices || []);

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const res = await updateServiceTemplateRemote(effectiveClient, effectiveChurchId, id, {
            ...data,
            name: validation.cleanName,
            description: resolvedDescription,
            eventTypeId: resolvedEventTypeId,
            activities,
            parallelServices,
            existingTemplate: target
          });
          if (!res.success) {
            return { success: false, error: res.error };
          }
          setServiceTemplates(prev =>
            prev.map(t => t.id === id ? {
              ...t,
              eventTypeId: resolvedEventTypeId,
              name: validation.cleanName,
              description: resolvedDescription,
              activities: resolvedActivities,
              parallelServices: resolvedParallelServices,
              activitiesCount: resolvedActivities.length,
              parallelServicesCount: resolvedParallelServices.length,
              totalDurationMinutes: resolvedActivities.reduce((acc, a) => acc + (a.plannedDurationMinutes || 0), 0),
              isComplete: true,
              isStale: false,
              updatedAt: new Date().toISOString()
            } : t)
          );
          editingDraftsRef.current.delete(id);
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
        eventTypeId: resolvedEventTypeId,
        name: validation.cleanName,
        description: resolvedDescription,
        activities: resolvedActivities,
        parallelServices: resolvedParallelServices,
        activitiesCount: resolvedActivities.length,
        parallelServicesCount: resolvedParallelServices.length,
        totalDurationMinutes: resolvedActivities.reduce((acc, a) => acc + (a.plannedDurationMinutes || 0), 0),
        isComplete: true,
        isStale: false,
        updatedAt: new Date().toISOString()
      } : t)
    );
    editingDraftsRef.current.delete(id);
    addAuditLog("Alteração de Modelo de Culto", `Modelo de culto alterado de "${previousName}" para "${validation.cleanName}".`);
    return { success: true };
  };

  const toggleServiceTemplateStatus = (id) => {
    if (!isAdmin) return { success: false, error: "Apenas administradores podem alterar o status de modelos de culto." };
    const target = serviceTemplates.find(t => t.id === id);
    if (!target) return { success: false, error: "Modelo de culto não encontrado." };

    // Problema B & A3: Proteção contra escrita desatualizada
    if (isDataStale || isTemplatesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados do modelo de culto estão desatualizados devido a uma falha na última sincronização. Reconcilie a conexão antes de alterar o modelo."
      };
    }

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

    // Problema B & A3: Proteção contra escrita desatualizada
    if (isDataStale || isTemplatesStale || target.isStale) {
      return {
        success: false,
        error: "Os dados do modelo de culto estão desatualizados devido a uma falha na última sincronização. Reconcilie a conexão antes de alterar o modelo."
      };
    }

    const deleteCheck = canDeleteServiceTemplate(
      target,
      Array.isArray(events) ? [event, ...events] : [event]
    );
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

    if (template.active === false) {
      return {
        success: false,
        error: "Não é possível aplicar um modelo de culto desativado em novos planejamentos."
      };
    }

    // Problema B & A3: Proteção contra escrita desatualizada
    if (isDataStale || isTemplatesStale || template.isStale) {
      return {
        success: false,
        error: "Não é possível aplicar um modelo de culto com dados desatualizados. Reconcilie a conexão antes de aplicar."
      };
    }

    // Regra B3: Modelo incompleto não pode ser aplicado
    if (template.isComplete === false || (template.activitiesCount > 0 && (!template.activities || template.activities.length === 0))) {
      return {
        success: false,
        error: "Não é possível aplicar modelo de culto com detalhes incompletos. Recarregue os dados da igreja."
      };
    }

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const targetEv = event;
    const mutationBlock = getProgramMutationBlockReason(targetEv);
    if (mutationBlock) return { success: false, error: mutationBlock };

    const updatedEvent = {
      ...instantiateTemplateForEvent(template, targetEv),
      isDraftPreview: true,
      templateApplied: true,
    };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          // Issue #29: bloqueia acréscimo em evento carregado do servidor sem leitura (B2) ou com comando incerto pendente.
          const blockReason = getAppendEventItemsBlockReason(targetEv, pendingEventItemCommandsRef.current);
          if (blockReason) {
            return { success: false, persisted: false, error: blockReason };
          }
          // Issue #29: instantiate_service_template(p_command_id, p_church_id, p_template_id) não recebe evento
          // e devolve a estrutura canônica atual do modelo no servidor; cada item é gravado com create_event_item.
          const targetEventId = targetEv.id;
          const existingActivities = Array.isArray(targetEv.activities) ? targetEv.activities : [];
          const existingParallelServices = Array.isArray(targetEv.parallelServices) ? targetEv.parallelServices : [];

          const res = await instantiateServiceTemplateRemote(effectiveClient, effectiveChurchId, templateId);
          if (!res.success) {
            return { success: false, error: res.error };
          }

          const templateActivities = Array.isArray(res.activities) ? res.activities : [];
          const templateParallelServices = Array.isArray(res.parallelServices) ? res.parallelServices : [];

          let eventWindowDurationSeconds = null;
          if (templateParallelServices.length > 0) {
            if (!targetEv?.plannedStartAt || !targetEv?.plannedEndAt) {
              return {
                success: false,
                error: "O evento não possui data/hora de início e término planejadas para derivar a duração dos apoios do modelo."
              };
            }
            const startMs = new Date(targetEv.plannedStartAt).getTime();
            const endMs = new Date(targetEv.plannedEndAt).getTime();
            if (isNaN(startMs) || isNaN(endMs)) {
              return {
                success: false,
                error: "O evento possui formato inválido de início ou término para derivar a duração dos apoios do modelo."
              };
            }
            if (endMs <= startMs) {
              return {
                success: false,
                error: "A janela de planejamento do evento é inválida (término anterior ou igual ao início) para derivar a duração dos apoios do modelo."
              };
            }
            eventWindowDurationSeconds = Math.round((endMs - startMs) / 1000);
            if (eventWindowDurationSeconds <= 0) {
              return {
                success: false,
                error: "A janela de duração planejada do evento deve ser estritamente positiva para derivar a duração dos apoios do modelo."
              };
            }
          }

          // Transforma etapas litúrgicas e apoios paralelos em drafts com sequência própria
          const liturgicalDrafts = buildLiturgicalItemDrafts(templateActivities, existingActivities.length);
          const parallelDrafts = buildParallelServiceDrafts(templateParallelServices, existingParallelServices.length, {
            fallbackDurationSeconds: eventWindowDurationSeconds,
          });
          const allDrafts = [...liturgicalDrafts, ...parallelDrafts];

          const outcome = await saveEventItemsSequentially({
            supabase: effectiveClient,
            churchId: effectiveChurchId,
            eventId: targetEventId,
            drafts: allDrafts,
            pendingCommandIds: pendingEventItemCommandsRef.current,
          });

          const savedLiturgical = outcome.saved.filter(s => s.draft?.itemNature === 'liturgical');
          const savedParallel = outcome.saved.filter(s => s.draft?.itemNature === 'parallel_support');

          const savedActivities = toPersistedActivities(savedLiturgical);
          const savedParallelServices = toPersistedParallelServices(savedParallel);

          const hasFailure = Boolean(outcome.failed);
          const appended = existingActivities.length > 0;

          if (savedActivities.length > 0 || savedParallelServices.length > 0) {
            setEvents(prev => prev.map(ev => ev.id === targetEventId ? {
              ...ev,
              templateId: updatedEvent.templateId,
              templateName: updatedEvent.templateName,
              templateApplied: true,
              activities: [...(ev.activities || []), ...savedActivities],
              parallelServices: [...(ev.parallelServices || []), ...savedParallelServices],
            } : ev));
          }

          const details = describeEventItemsOutcome(outcome);
          if (hasFailure) {
            addAuditLog(
              "Aplicação de Modelo no Culto",
              `Modelo '${template.name}' aplicado parcialmente: ${outcome.saved.length} de ${allDrafts.length} item(ns) gravado(s) no servidor.`
            );
            return {
              success: false,
              remote: true,
              persisted: outcome.saved.length > 0 ? 'partial' : false,
              itemsOutcome: outcome,
              error: `O modelo não foi aplicado por completo. ${details}`
                + (outcome.saved.length > 0 && !outcome.failed?.uncertain
                  ? ' Não reaplique o modelo inteiro: os itens já gravados seriam duplicados. Adicione os itens faltantes manualmente.'
                  : outcome.saved.length > 0
                    ? ' Não reaplique o modelo inteiro: os itens já gravados seriam duplicados.'
                    : '')
            };
          }

          addAuditLog(
            "Aplicação de Modelo no Culto",
            `Modelo '${template.name}': ${savedActivities.length} etapa(s) e ${savedParallelServices.length} apoio(s) gravados no servidor.`
          );
          const notices = [EVENT_ITEMS_PERSISTENCE_NOTICE];
          if (appended && savedActivities.length > 0) notices.unshift(TEMPLATE_APPEND_NOTICE);
          if (savedParallelServices.length > 0) {
            notices.push(PARALLEL_SERVICES_PERSISTENCE_NOTICE);
          }
          return {
            success: true,
            remote: true,
            persisted: true,
            appended,
            savedItemsCount: savedActivities.length,
            savedParallelCount: savedParallelServices.length,
            parallelServicesPersisted: true,
            itemsOutcome: outcome,
            warning: notices.join(' ')
          };
        } catch (err) {
          return { success: false, error: err.message || "Falha ao aplicar modelo de culto no servidor." };
        }
      })();
    }

    setEvent(updatedEvent);
    addAuditLog(
      "Aplicação de Modelo no Culto",
      `Modelo '${template.name}' aplicado ao planejamento local.`
    );
    return { success: true, persisted: false };
  };

  // Criação de Apoio Paralelo Persistente (Issue #29, #30, #51)
  const addParallelServiceToCurrentEvent = async (serviceData, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem adicionar apoios." };
    }
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const title = normalizeNfcText(serviceData?.name || serviceData?.title || '');
    if (!title) return { success: false, error: "Título do apoio paralelo é obrigatório." };

    const rawMinutes = serviceData?.durationMinutes ?? serviceData?.plannedDurationMinutes;
    const minutes = Number.isFinite(Number(rawMinutes)) ? Number(rawMinutes) : NaN;
    const durationSeconds = Number.isFinite(Number(serviceData?.plannedDurationSeconds)) && Number(serviceData.plannedDurationSeconds) > 0
      ? Math.round(Number(serviceData.plannedDurationSeconds))
      : (Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0);

    if (durationSeconds <= 0) {
      return { success: false, error: "A duração planejada do apoio paralelo deve ser um número inteiro maior que zero." };
    }

    const rawPrep = serviceData?.prepRequiredMinutes ?? serviceData?.prepLeadMinutes;
    let prepMinutes = 0;
    if (rawPrep !== undefined && rawPrep !== null && rawPrep !== '') {
      const parsed = Number(rawPrep);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 180) {
        return { success: false, error: "Tempo de preparação antecedente deve ser um número inteiro entre 0 e 180 minutos." };
      }
      prepMinutes = parsed;
    }

    const isValidUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const teamId = isValidUuid(serviceData?.teamId) ? serviceData.teamId : (isValidUuid(serviceData?.responsibleTeamId) ? serviceData.responsibleTeamId : null);
    const leaderId = isValidUuid(serviceData?.leaderId) ? serviceData.leaderId : (isValidUuid(serviceData?.responsibleMemberId) ? serviceData.responsibleMemberId : null);

    const existingParallel = Array.isArray(targetEv?.parallelServices) ? targetEv.parallelServices : [];
    const seqOrder = existingParallel.length + 1;

    const draft = {
      localId: `serv-${Date.now()}`,
      title,
      itemNature: 'parallel_support',
      sequenceOrder: seqOrder,
      plannedDurationSeconds: durationSeconds,
      prepRequiredMinutes: prepMinutes,
      designatedTeamId: teamId,
      nominalLeaderMemberId: leaderId,
      source: serviceData,
    };

    if (!authCheck.inMemory) {
      try {
        const draftKeyVal = buildEventItemDraftKey(targetId, draft);
        const appendBlock = getAppendEventItemsBlockReason(targetEv, pendingEventItemCommandsRef.current, draftKeyVal);
        if (appendBlock) {
          return { success: false, error: appendBlock };
        }

        const outcome = await saveEventItemsSequentially({
          supabase: effectiveClient,
          churchId: effectiveChurchId,
          eventId: targetId,
          drafts: [draft],
          pendingCommandIds: pendingEventItemCommandsRef.current,
        });

        if (outcome.failed) {
          return {
            success: false,
            uncertain: outcome.failed.uncertain,
            error: outcome.failed.message,
          };
        }

        const savedItem = toPersistedParallelServices(outcome.saved)[0];
        setEvents(prev => prev.map(ev => ev.id === targetId ? {
          ...ev,
          parallelServices: [...(ev.parallelServices || []), savedItem],
        } : ev));

        addAuditLog("Apoio Paralelo", `Apoio '${title}' adicionado ao evento '${targetEv.title}'.`);
        return { success: true, remote: true, service: savedItem };
      } catch (err) {
        return { success: false, error: err.message || "Erro ao gravar apoio paralelo." };
      }
    }

    const localService = {
      id: draft.localId,
      name: title,
      title,
      teamId,
      leaderId,
      prepLeadMinutes: prepMinutes,
      prepRequiredMinutes: prepMinutes,
      durationMinutes: Math.round(durationSeconds / 60),
      plannedDurationSeconds: durationSeconds,
      sequenceOrder: seqOrder,
      itemNature: 'parallel_support',
      persisted: false,
      status: 'Aguardando culto',
      volunteers: [],
    };

    setEvents(prev => prev.map(ev => ev.id === targetId ? {
      ...ev,
      parallelServices: [...(ev.parallelServices || []), localService],
    } : ev));

    return { success: true, service: localService };
  };

  // Edição de Apoio Paralelo Persistente (Issue #29, #30, #51)
  const updateParallelServiceInCurrentEvent = async (serviceId, updatedData, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem editar apoios." };
    }
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const serv = targetEv?.parallelServices?.find(s => s.id === serviceId);
    if (!serv) return { success: false, error: "Serviço de apoio não encontrado." };

    const title = normalizeNfcText(updatedData?.name || updatedData?.title || serv.name || serv.title || '');
    if (!title) return { success: false, error: "Título do apoio paralelo é obrigatório." };

    const rawMinutes = updatedData?.durationMinutes ?? updatedData?.plannedDurationMinutes;
    const minutes = Number.isFinite(Number(rawMinutes)) ? Number(rawMinutes) : NaN;
    let durationSeconds = 0;
    if (updatedData?.plannedDurationSeconds !== undefined) {
      durationSeconds = Number.isFinite(Number(updatedData.plannedDurationSeconds)) && Number(updatedData.plannedDurationSeconds) > 0
        ? Math.round(Number(updatedData.plannedDurationSeconds))
        : 0;
    } else if (rawMinutes !== undefined) {
      durationSeconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
    } else {
      durationSeconds = serv.plannedDurationSeconds || Math.round((serv.durationMinutes || 0) * 60);
    }

    if (durationSeconds <= 0) {
      return { success: false, error: "A duração planejada do apoio paralelo deve ser um número inteiro maior que zero." };
    }

    const rawPrep = updatedData?.prepRequiredMinutes ?? updatedData?.prepLeadMinutes;
    let prepMinutes = serv.prepRequiredMinutes ?? 0;
    if (rawPrep !== undefined && rawPrep !== null && rawPrep !== '') {
      const parsed = Number(rawPrep);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 180) {
        return { success: false, error: "Tempo de preparação antecedente deve ser um número inteiro entre 0 e 180 minutos." };
      }
      prepMinutes = parsed;
    }

    const isValidUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const teamId = isValidUuid(updatedData?.teamId) ? updatedData.teamId : (isValidUuid(updatedData?.responsibleTeamId) ? updatedData.responsibleTeamId : (serv.teamId || null));
    const leaderId = isValidUuid(updatedData?.leaderId) ? updatedData.leaderId : (isValidUuid(updatedData?.responsibleMemberId) ? updatedData.responsibleMemberId : (serv.leaderId || null));

    if (!authCheck.inMemory && serv.persisted) {
      const payload = {
        title,
        plannedDurationSeconds: durationSeconds,
        prepRequiredMinutes: prepMinutes,
        designatedTeamId: teamId,
        nominalLeaderMemberId: leaderId,
      };
      const updateKey = buildEventItemUpdateKey(targetId, serviceId, payload, serv.updatedAt);
      const pendingCmd = pendingUpdateCommandsRef.current.get(serviceId);
      let commandId;
      if (pendingCmd) {
        if (pendingCmd.key !== updateKey) {
          return {
            success: false,
            error: "Existe uma alteração pendente de confirmação para este apoio. Aguarde ou repita a alteração idêntica.",
          };
        }
        commandId = pendingCmd.commandId;
      } else {
        commandId = generateCommandUuid();
      }

      try {
        const res = await updateEventItemRemote(effectiveClient, {
          churchId: effectiveChurchId,
          commandId,
          eventId: targetId,
          itemId: serviceId,
          title,
          itemNature: 'parallel_support',
          plannedDurationSeconds: durationSeconds,
          prepRequiredMinutes: prepMinutes,
          designatedTeamId: teamId,
          nominalLeaderMemberId: leaderId,
          expectedUpdatedAt: serv.updatedAt,
        });

        if (res.uncertain) {
          pendingUpdateCommandsRef.current.set(serviceId, { key: updateKey, commandId });
          return { success: false, uncertain: true, error: res.error };
        }

        pendingUpdateCommandsRef.current.delete(serviceId);

        if (!res.success) {
          return { success: false, error: res.error, concurrencyConflict: res.concurrencyConflict };
        }

        const newUpdatedAt = res.updatedAt || serv.updatedAt;
        setEvents(prev => prev.map(ev => ev.id === targetId ? {
          ...ev,
          parallelServices: (ev.parallelServices || []).map(s => s.id === serviceId ? {
            ...s,
            name: title,
            title,
            teamId,
            leaderId,
            prepLeadMinutes: prepMinutes,
            prepRequiredMinutes: prepMinutes,
            durationMinutes: Math.round(durationSeconds / 60),
            plannedDurationSeconds: durationSeconds,
            updatedAt: newUpdatedAt,
          } : s),
        } : ev));

        addAuditLog("Edição de Apoio", `Apoio '${title}' atualizado no servidor.`);
        return { success: true, remote: true, updatedAt: newUpdatedAt };
      } catch (err) {
        pendingUpdateCommandsRef.current.set(serviceId, { key: updateKey, commandId });
        return { success: false, uncertain: true, error: err.message || "Erro inesperado ao atualizar apoio." };
      }
    }

    setEvents(prev => prev.map(ev => ev.id === targetId ? {
      ...ev,
      parallelServices: (ev.parallelServices || []).map(s => s.id === serviceId ? {
        ...s,
        name: title,
        title,
        teamId,
        leaderId,
        prepLeadMinutes: prepMinutes,
        prepRequiredMinutes: prepMinutes,
        durationMinutes: Math.round(durationSeconds / 60),
        plannedDurationSeconds: durationSeconds,
      } : s),
    } : ev));

    return { success: true, remote: false };
  };

  const removeParallelServiceFromCurrentEvent = async (serviceId, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Permissão insuficiente." };
    }
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!targetEv) return { success: false, error: "Nenhum evento selecionado." };
    const serv = targetEv.parallelServices?.find(s => s.id === serviceId);
    if (!serv) return { success: false, error: "Serviço de apoio não encontrado." };

    if (!authCheck.inMemory && serv?.persisted) {
      const removeKey = buildEventItemRemoveKey(targetId, serviceId, serv.updatedAt);
      const pendingCmd = pendingRemoveCommandsRef.current.get(serviceId);
      let commandId;
      if (pendingCmd) {
        if (pendingCmd.key !== removeKey) {
          return {
            success: false,
            error: "Existe uma remoção pendente de confirmação para este apoio.",
          };
        }
        commandId = pendingCmd.commandId;
      } else {
        commandId = generateCommandUuid();
      }

      try {
        const res = await removeEventItemRemote(effectiveClient, {
          churchId: effectiveChurchId,
          commandId,
          eventId: targetEv.id,
          itemId: serviceId,
          expectedUpdatedAt: serv.updatedAt,
        });

        if (res.uncertain) {
          pendingRemoveCommandsRef.current.set(serviceId, { key: removeKey, commandId });
          return { success: false, uncertain: true, error: res.error };
        }

        pendingRemoveCommandsRef.current.delete(serviceId);

        if (!res.success) {
          return {
            success: false,
            error: res.error,
            concurrencyConflict: res.concurrencyConflict,
            blockedByAssignment: res.blockedByAssignment,
          };
        }

        const updatedEvent = removeParallelServiceFromEvent(targetEv, serviceId);
        setEvent(updatedEvent);
        setEvents(prev => prev.map(ev => ev.id === targetEv.id ? updatedEvent : ev));
        addAuditLog(
          "Ajuste de Apoio no Culto",
          `Serviço de apoio removido do servidor sem alterar o modelo original.`
        );
        return { success: true, remote: true };
      } catch (err) {
        pendingRemoveCommandsRef.current.set(serviceId, { key: removeKey, commandId });
        return { success: false, uncertain: true, error: err.message || "Falha ao remover apoio do servidor." };
      }
    }

    const updatedEvent = removeParallelServiceFromEvent(targetEv, serviceId);
    setEvent(updatedEvent);
    setEvents(prev => prev.map(ev => ev.id === targetEv.id ? updatedEvent : ev));
    addAuditLog(
      "Ajuste de Apoio no Culto",
      `Serviço de apoio removido desta edição do culto sem alterar o modelo original (PRD CA02).`
    );
    return { success: true, remote: false };
  };

  const sendAccessInvite = (email, memberName) => {
    if (!isAdmin) return;
    if (isRealEnvironment) {
      return { success: false, error: 'Convite local indisponível no ambiente real. Use Membros → Convites.' };
    }
    const newInv = {
      id: "inv-" + Date.now(),
      email,
      memberName,
      status: "Pendente",
      sentAt: new Date().toLocaleString('pt-BR')
    };
    setAccessInvites(prev => [newInv, ...prev]);
    addAuditLog("Convite de Acesso", `Convite de acesso à igreja enviado para ${email} (Membro: ${memberName}).`);
    return { success: true };
  };

  const designateLiturgyLeader = async (newLeaderId, targetEventId = null, explicitExpectedVersion = undefined) => {
    if (!isAdmin) {
      return { success: false, error: "Apenas administradores podem designar a liderança da liturgia." };
    }
    const targetId = targetEventId || event?.id || events?.[0]?.id;
    if (!targetId) {
      return { success: false, error: "Nenhum evento selecionado para designação." };
    }
    if (!newLeaderId) {
      return { success: false, error: "Nenhum líder da liturgia selecionado." };
    }

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const targetEv = events.find(ev => ev.id === targetId) || (event?.id === targetId ? event : null);
    const expectedVersion = explicitExpectedVersion !== undefined
      ? explicitExpectedVersion
      : (targetEv?.version ?? null);

    if (!authCheck.inMemory) {
      if (expectedVersion === null || expectedVersion === undefined) {
        return {
          success: false,
          error: "Versão do evento não informada. Recarregue os dados antes de designar a liderança.",
        };
      }

      const commandKey = `assign-leader:${effectiveChurchId}:${targetId}:${newLeaderId}`;
      let cmdId = pendingProgramLifecycleCommandsRef.current.get(commandKey);
      if (!cmdId) {
        cmdId = generateCommandUuid();
      }

      try {
        const res = await assignEventLiturgyLeader({
          supabase: effectiveClient,
          churchId: effectiveChurchId,
          commandId: cmdId,
          eventId: targetId,
          newLiturgyLeaderMemberId: newLeaderId,
          expectedVersion,
        });

        if (res.status === 'UNCERTAIN' || res.uncertain) {
          pendingProgramLifecycleCommandsRef.current.set(commandKey, cmdId);
          return {
            success: false,
            uncertain: true,
            error: res.message || res.error?.message || "Operação não confirmada pelo servidor. Tente novamente para confirmar.",
          };
        }

        // Em sucesso ou erro definitivo: apaga a chave de comando pendente
        pendingProgramLifecycleCommandsRef.current.delete(commandKey);

        if (res.status === 'SUCCESS' || res.success) {
          await reloadRemoteData();
          return { success: true };
        }

        // Erro definitivo
        const errCode = String(res.code || res.error?.code || '');
        const errMsg = res.message || res.error?.message || '';
        const lowerMsg = errMsg.toLowerCase();

        let friendlyError = errMsg || "Falha ao designar liderança da liturgia no servidor.";
        if (errCode === '42501' || lowerMsg.includes('não autorizado') || lowerMsg.includes('apenas administradores') || lowerMsg.includes('permissão insuficiente')) {
          friendlyError = "Permissão insuficiente. Apenas administradores ativos podem designar a liderança da liturgia.";
        } else if ((errCode === 'P0020' && (lowerMsg.includes('versão') || lowerMsg.includes('conflito'))) || lowerMsg.includes('versão esperada divergente')) {
          friendlyError = "Versão esperada divergente da versão atual do evento. Recarregue os dados e tente novamente.";
        }

        return {
          success: false,
          error: friendlyError,
        };
      } catch (err) {
        pendingProgramLifecycleCommandsRef.current.set(commandKey, cmdId);
        return {
          success: false,
          uncertain: true,
          error: err?.message || "Falha na comunicação com o servidor ao designar liturgia.",
        };
      }
    }

    // Modo sem conexão com memória permitida (inMemory === true)
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
      `${currentUser?.name || 'Administrador'} designou ${leader?.name || 'Membro'} como Líder da Liturgia para o evento.`
    );
    return { success: true };
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
            if (!isAdmin) {
              if (teamsLoadStatus === 'loading' || teamsLoadStatus === 'idle') {
                return {
                  success: false,
                  unavailable: true,
                  error: 'As equipes da igreja ainda estão carregando para confirmar sua liderança. Aguarde ou recarregue os dados antes de criar a edição.',
                };
              }
              if (teamsLoadStatus === 'failed') {
                return {
                  success: false,
                  unavailable: true,
                  error: 'Não foi possível carregar as equipes da igreja para confirmar sua liderança. Recarregue os dados antes de tentar criar a edição.',
                };
              }
              if (!isTeamLeader) {
                return {
                  success: false,
                  error: 'Apenas administradores ou líderes de equipe podem criar edições de culto.',
                };
              }
            }

            // Issue #28: tipo escolhido enviado pelo nome (p_event_type text), sem padrão silencioso;
            // início e fim como instantes no fuso da igreja (newEvent já foi calculado nesse fuso).
            const selectedEventType = normalizeNfcText(eventData.type || '');
            if (!selectedEventType) {
              return { success: false, error: "Selecione o tipo de evento antes de criar a edição de culto." };
            }

            // Validação de apoios paralelos antes da criação do evento (se houver apoios)
            let eventWindowDurationSeconds = 0;
            const requestedParallelServices = newEvent.parallelServices || [];
            if (requestedParallelServices.length > 0) {
              if (!newEvent.plannedStartAt || !newEvent.plannedEndAt) {
                return {
                  success: false,
                  error: 'O evento precisa de horário de início e término definidos para derivar a duração dos apoios paralelos.',
                };
              }
              const startMs = new Date(newEvent.plannedStartAt).getTime();
              const endMs = new Date(newEvent.plannedEndAt).getTime();
              if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
                return {
                  success: false,
                  error: 'A janela de planejamento do evento é inválida (término anterior ou igual ao início) para derivar a duração dos apoios paralelos.',
                };
              }
              eventWindowDurationSeconds = Math.round((endMs - startMs) / 1000);
              if (eventWindowDurationSeconds <= 0 || !Number.isInteger(eventWindowDurationSeconds)) {
                return {
                  success: false,
                  error: 'A duração calculada da janela do evento deve ser um número inteiro maior que zero para os apoios.',
                };
              }
            }

            // Opção B (#28): somente administrador designa dirigente (validação acima já recusa valor preenchido por não-admin).
            const effectiveLiturgyLeaderId = isAdmin ? (eventData.liturgyLeaderId || null) : null;
            const creationFingerprint = JSON.stringify([
              effectiveChurchId,
              newEvent.title,
              selectedEventType,
              newEvent.plannedStartAt,
              newEvent.plannedEndAt,
              newEvent.durationPolicy,
              effectiveLiturgyLeaderId,
            ]);

            const pendingCreate = pendingCreateEventCommandRef.current;
            if (pendingCreate && pendingCreate.fingerprint !== creationFingerprint) {
              return {
                success: false,
                uncertain: true,
                pendingSummary: pendingCreate.summary,
                error: 'Havia uma tentativa anterior de criação sem confirmação do servidor. Repita a tentativa anterior com os mesmos dados para consultar o servidor (se ela ainda não foi gravada, será gravada com aqueles dados).',
              };
            }

            const commandId = pendingCreate ? pendingCreate.commandId : generateCommandUuid();
            const pendingPayload = { ...eventData, type: selectedEventType };
            const pendingSummary = {
              title: newEvent.title,
              type: selectedEventType,
              plannedStartAt: newEvent.plannedStartAt,
              plannedEndAt: newEvent.plannedEndAt,
              date: newEvent.date,
              scheduledStartTime: newEvent.scheduledStartTime,
            };
            setPendingCreateCommand({
              fingerprint: creationFingerprint,
              commandId,
              payload: pendingPayload,
              summary: pendingSummary,
            });

            const res = await createChurchEventEditionRemote(effectiveClient, effectiveChurchId, {
              commandId,
              title: newEvent.title,
              eventType: selectedEventType,
              plannedStartAt: newEvent.plannedStartAt,
              plannedEndAt: newEvent.plannedEndAt,
              timezone: newEvent.timezone,
              liturgyLeaderMemberId: effectiveLiturgyLeaderId,
              durationPolicy: eventData.durationPolicy || 'warn'
            });

            if (!res.success) {
              if (res.uncertain === false) {
                setPendingCreateCommand(null);
              }
              return { success: false, uncertain: res.uncertain !== false, error: res.error };
            }

            setPendingCreateCommand(null);

            // Issue #29, #30, #51: etapas litúrgicas e apoios paralelos informados na criação são gravados
            // sequencialmente com create_event_item, cada qual com sua sequência independente iniciada em 1.
            // No estado do evento ficam apenas os itens confirmados pelo servidor com os IDs devolvidos por ele.
            const requestedActivities = newEvent.activities || [];
            const serverEventId = res.eventId || res.receipt?.result_entity_id || null;
            const liturgicalDrafts = buildLiturgicalItemDrafts(requestedActivities, 0);
            const parallelDrafts = buildParallelServiceDrafts(requestedParallelServices, 0, {
              fallbackDurationSeconds: eventWindowDurationSeconds,
            });
            const allDrafts = [...liturgicalDrafts, ...parallelDrafts];
            let outcome = { saved: [], failed: null, notAttempted: [] };
            let itemsWarning = null;

            if (allDrafts.length > 0 && !isAdmin) {
              outcome = { saved: [], failed: null, notAttempted: allDrafts };
              itemsWarning = 'A edição foi criada sem dirigente de liturgia designado. Os itens iniciais não foram enviados e poderão ser gravados depois que o administrador designar o dirigente.';
            } else if (allDrafts.length > 0 && !serverEventId) {
              outcome = { saved: [], failed: null, notAttempted: allDrafts };
              itemsWarning = "O servidor não devolveu o identificador do evento criado; os itens não foram enviados. " + describeEventItemsOutcome(outcome);
            } else if (allDrafts.length > 0) {
              outcome = await saveEventItemsSequentially({
                supabase: effectiveClient,
                churchId: effectiveChurchId,
                eventId: serverEventId,
                drafts: allDrafts,
                pendingCommandIds: pendingEventItemCommandsRef.current,
              });
              if (outcome.failed) {
                itemsWarning = "A edição foi criada, mas nem todos os itens foram gravados. " + describeEventItemsOutcome(outcome)
                  + (!outcome.failed.uncertain ? " Adicione os itens faltantes manualmente." : "");
              }
            }

            const savedLiturgical = outcome.saved.filter(s => s.draft?.itemNature === 'liturgical');
            const savedParallel = outcome.saved.filter(s => s.draft?.itemNature === 'parallel_support');

            const savedActivities = toPersistedActivities(savedLiturgical);
            const savedParallelServices = toPersistedParallelServices(savedParallel);

            const notices = [];
            if (itemsWarning) notices.push(itemsWarning);
            if (savedActivities.length > 0) notices.push(EVENT_ITEMS_PERSISTENCE_NOTICE);
            if (savedParallelServices.length > 0) notices.push(PARALLEL_SERVICES_PERSISTENCE_NOTICE);

            const createdEvent = {
              ...newEvent,
              id: res.eventId || res.data?.id || newEvent.id,
              type: selectedEventType,
              loadedFromServer: false,
              activitiesKnownInSession: true,
              activities: savedActivities,
              parallelServices: savedParallelServices,
            };

            setEvents(prev => [createdEvent, ...prev]);
            setCurrentEventId(createdEvent.id);
            addAuditLog(
              "Criação de Edição de Culto",
              `${currentUser.name} criou a edição '${createdEvent.title}' (${createdEvent.date} às ${createdEvent.scheduledStartTime}, duração prevista: ${createdEvent.plannedDurationMinutes} min; etapas gravadas no servidor: ${savedActivities.length} de ${liturgicalDrafts.length}; apoios gravados no servidor: ${savedParallelServices.length} de ${parallelDrafts.length}).`
            );
            return {
              success: true,
              event: createdEvent,
              remote: true,
              itemsOutcome: outcome,
              itemsFailed: Boolean(itemsWarning),
              warning: notices.length > 0 ? notices.join(' ') : null,
              liturgicalSavedCount: savedActivities.length,
              liturgicalRequestedCount: liturgicalDrafts.length,
              parallelSavedCount: savedParallelServices.length,
              parallelRequestedCount: parallelDrafts.length,
            };
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

  const retryPendingCreateEvent = async () => {
    const pending = pendingCreateEventCommandRef.current;
    if (!pending?.payload) {
      return {
        success: false,
        error: 'Não há tentativa anterior pendente para repetir.',
      };
    }
    return createEventEdition(pending.payload);
  };

  // Adicionar Etapa Litúrgica a um Evento Já Criado (Issue #29)
  // No ambiente conectado, a etapa só entra no estado depois do recibo do servidor (create_event_item),
  // já com o identificador devolvido por ele. Sem confirmação, nada é exibido como gravado.
  const addActivityToEvent = (activityData, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem adicionar etapas." };
    }
    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const targetId = targetEventId || event?.id;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    if (!targetEv) return { success: false, error: "Nenhum evento selecionado para receber a etapa." };

    const mutationBlock = getProgramMutationBlockReason(targetEv);
    if (mutationBlock) return { success: false, error: mutationBlock };

    const title = normalizeNfcText(activityData?.title || '');
    if (!title) return { success: false, error: "Título da etapa é obrigatório." };

    const rawMinutes = activityData?.plannedDurationMinutes;
    const parsedMinutes = Number(rawMinutes);
    if (!Number.isInteger(parsedMinutes) || parsedMinutes <= 0) {
      return { success: false, error: "Duração planejada da etapa litúrgica é obrigatória e deve ser um número inteiro maior que zero." };
    }
    const durationMinutes = parsedMinutes;
    const durationSeconds = durationMinutes * 60;

    const localActivity = {
      id: "act-" + Date.now(),
      title,
      category: activityData?.category || 'Liturgia',
      plannedDurationMinutes: durationMinutes,
      plannedDurationSeconds: durationSeconds,
      responsibleMemberId: activityData?.responsibleMemberId || null,
      responsibleTeamId: activityData?.responsibleTeamId || null,
      status: "pendente",
      notes: activityData?.notes || '',
      requiresPlayback: Boolean(activityData?.requiresPlayback),
      musics: [],
      roster: []
    };

    if (!authCheck.inMemory) {
      return (async () => {
        try {
          const existingCount = Array.isArray(targetEv.activities) ? targetEv.activities.length : 0;
          const drafts = buildLiturgicalItemDrafts([localActivity], existingCount);
          const nextDraftKey = buildEventItemDraftKey(targetId, drafts[0]);
          const blockReason = getAppendEventItemsBlockReason(targetEv, pendingEventItemCommandsRef.current, nextDraftKey);
          if (blockReason) {
            return { success: false, persisted: false, error: blockReason };
          }
          const outcome = await saveEventItemsSequentially({
            supabase: effectiveClient,
            churchId: effectiveChurchId,
            eventId: targetId,
            drafts,
            pendingCommandIds: pendingEventItemCommandsRef.current,
          });
          if (outcome.failed || outcome.saved.length === 0) {
            return {
              success: false,
              persisted: false,
              uncertain: Boolean(outcome.failed?.uncertain),
              error: describeEventItemsOutcome(outcome) || "O servidor não confirmou a gravação da etapa."
            };
          }
          const [savedActivity] = toPersistedActivities(outcome.saved);
          setEvents(prev => prev.map(ev => ev.id === targetId
            ? { ...ev, activities: [...(ev.activities || []), savedActivity] }
            : ev));
          addAuditLog(
            "Nova Atividade Planejada",
            `Atividade '${title}' (${localActivity.plannedDurationMinutes} min) gravada no servidor na edição '${targetEv.title}'.`
          );
          return { success: true, remote: true, persisted: true, activity: savedActivity, notice: EVENT_ITEMS_PERSISTENCE_NOTICE };
        } catch (err) {
          return { success: false, persisted: false, error: err.message || "Falha ao gravar a etapa no servidor." };
        }
      })();
    }

    setEvents(prev => prev.map(ev => ev.id === targetId
      ? { ...ev, activities: [...(ev.activities || []), localActivity] }
      : ev));
    addAuditLog("Nova Atividade Planejada", `Atividade '${title}' (${localActivity.plannedDurationMinutes} min) adicionada à ordem.`);
    return { success: true, persisted: false, activity: localActivity };
  };

  // Carrega e hidrata o programa de evento remoto (pós-026 / B2)
  const loadEventProgram = useCallback(async (eventId, targetChurchId = null, options = {}) => {
    const { force = false } = options;
    const cid = targetChurchId || effectiveChurchId;
    if (!effectiveClient || !cid || !eventId || authContext?.isLocalAuth) {
      return { success: true, inMemory: true };
    }

    const key = `${cid}:${eventId}`;
    const existingReq = programLoadRequestsRef.current.get(key);

    if (existingReq && !force) {
      return existingReq.promise;
    }

    const nextSeq = (existingReq?.seq || 0) + 1;

    setEvents(prev => prev.map(ev => ev.id === eventId
      ? { ...ev, isProgramLoading: true, programLoadError: null }
      : ev));

    const loadPromise = (async () => {
      try {
        const res = await getEventProgramRemote(effectiveClient, cid, eventId);
        const currentEntry = programLoadRequestsRef.current.get(key);
        if (!currentEntry || nextSeq < currentEntry.seq) {
          return { success: false, error: 'Carregamento substituído por solicitação mais recente.' };
        }

        if (!res.success) {
          setEvents(prev => prev.map(ev => ev.id === eventId
            ? { ...ev, programLoadError: res.error, activitiesKnownInSession: false }
            : ev));
          return { success: false, error: res.error };
        }

        const serverEvent = res.event || {};
        const rawItems = Array.isArray(res.items) ? res.items : [];

        for (const item of rawItems) {
          const durSec = Number(item.planned_duration_seconds);
          if (!Number.isFinite(durSec) || durSec <= 0 || !Number.isInteger(durSec)) {
            const err = `Item '${item.title || item.id}' possui duração inválida (${item.planned_duration_seconds}s). O programa do evento foi rejeitado.`;
            setEvents(prev => prev.map(ev => ev.id === eventId
              ? { ...ev, programLoadError: err, activitiesKnownInSession: false }
              : ev));
            return { success: false, error: err };
          }
        }

        const liturgicalItems = rawItems
          .filter(item => item.item_nature === 'liturgical')
          .sort((a, b) => a.sequence_order - b.sequence_order)
          .map(item => ({
            id: item.id,
            title: item.title,
            category: 'Liturgia',
            plannedDurationMinutes: Math.round(item.planned_duration_seconds / 60),
            plannedDurationSeconds: item.planned_duration_seconds,
            prepRequiredMinutes: 0,
            responsibleTeamId: item.designated_team_id || null,
            responsibleMemberId: item.nominal_leader_member_id || null,
            sequenceOrder: item.sequence_order,
            updatedAt: item.updated_at,
            createdAt: item.created_at,
            status: item.status === 'pending' ? 'pendente' : (item.status || 'pendente'),
            persisted: true,
            itemNature: 'liturgical',
            notes: '',
            requiresPlayback: false,
            musics: [],
            roster: []
          }));

        const parallelServices = rawItems
          .filter(item => item.item_nature === 'parallel_support')
          .sort((a, b) => a.sequence_order - b.sequence_order)
          .map(item => ({
            id: item.id,
            name: item.title,
            title: item.title,
            teamId: item.designated_team_id || null,
            leaderId: item.nominal_leader_member_id || null,
            designatedTeamId: item.designated_team_id || null,
            nominalLeaderMemberId: item.nominal_leader_member_id || null,
            prepLeadMinutes: item.prep_required_minutes || 0,
            prepRequiredMinutes: item.prep_required_minutes || 0,
            durationMinutes: Math.round(item.planned_duration_seconds / 60),
            plannedDurationSeconds: item.planned_duration_seconds,
            sequenceOrder: item.sequence_order,
            updatedAt: item.updated_at,
            createdAt: item.created_at,
            serverStatus: item.status,
            persisted: true,
            itemNature: 'parallel_support',
            roster: []
          }));

        setEvents(prev => prev.map(ev => {
          if (ev.id !== eventId) return ev;
          return {
            ...ev,
            programStatus: serverEvent.program_status || ev.programStatus || 'draft',
            durationPolicy: serverEvent.duration_policy || ev.durationPolicy || 'warn',
            programVersion: serverEvent.program_version ?? ev.programVersion ?? 1,
            publishedAt: serverEvent.published_at || ev.publishedAt || null,
            publishedByMemberId: serverEvent.published_by_member_id || ev.publishedByMemberId || null,
            activities: liturgicalItems,
            parallelServices: parallelServices,
            activitiesKnownInSession: true,
            programLoadedFromServer: true,
            programLoadError: null,
          };
        }));

        return {
          success: true,
          event: serverEvent,
          activities: liturgicalItems,
          parallelServices
        };
      } catch (err) {
        const currentEntry = programLoadRequestsRef.current.get(key);
        if (currentEntry && nextSeq >= currentEntry.seq) {
          setEvents(prev => prev.map(ev => ev.id === eventId
            ? { ...ev, programLoadError: err.message, activitiesKnownInSession: false }
            : ev));
        }
        return { success: false, error: err.message };
      } finally {
        const currentEntry = programLoadRequestsRef.current.get(key);
        if (currentEntry && currentEntry.seq === nextSeq) {
          programLoadRequestsRef.current.delete(key);
          setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, isProgramLoading: false } : ev));
        }
      }
    })();

    programLoadRequestsRef.current.set(key, { seq: nextSeq, promise: loadPromise });
    return loadPromise;
  }, [effectiveClient, effectiveChurchId, authContext?.isLocalAuth]);

  // Consulta as alocações da edição via RPC list_event_assignments (SQL 015)
  const loadEventAssignments = useCallback(async (eventId, targetChurchId = null) => {
    const cid = targetChurchId || effectiveChurchId;
    if (!effectiveClient || !cid || !eventId || authContext?.isLocalAuth) {
      return { success: true, inMemory: true, assignments: [] };
    }
    try {
      const assignments = await getEventAssignmentsRemote(effectiveClient, cid, eventId);
      setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, assignments } : ev));
      return { success: true, assignments };
    } catch (err) {
      return { success: false, error: err.message || 'Falha ao consultar alocações da edição.' };
    }
  }, [effectiveClient, effectiveChurchId, authContext?.isLocalAuth]);

  useEffect(() => {
    if (currentEventId && effectiveClient && !authContext?.isLocalAuth) {
      const currentEv = events.find(e => e.id === currentEventId);
      if (currentEv && currentEv.loadedFromServer && !currentEv.programLoadedFromServer && !currentEv.programLoadError && !currentEv.isProgramLoading) {
        loadEventProgram(currentEventId);
        loadEventAssignments(currentEventId);
      }
    }
  }, [currentEventId, effectiveClient, authContext?.isLocalAuth, events, loadEventProgram, loadEventAssignments]);

  // Selecionar Edição Ativa (Issue #28)
  const selectEvent = (eventId) => {
    const target = events.find(e => e.id === eventId);
    if (target) {
      setCurrentEventId(eventId);
      if (effectiveClient && !authContext?.isLocalAuth && !target.programLoadedFromServer && !target.isProgramLoading) {
        loadEventProgram(eventId);
      }
    }
  };

  const executeRemoteActivityReorder = async (targetEventId, itemIds) => {
    const reorderKey = JSON.stringify({
      eventId: targetEventId,
      itemNature: 'liturgical',
      itemIds,
    });
    const pendingCommand = pendingReorderCommandsRef.current.get(targetEventId);
    let commandId;

    if (pendingCommand) {
      if (pendingCommand.key !== reorderKey) {
        return {
          success: false,
          uncertain: true,
          pendingConflict: true,
          error: 'Existe uma reordenação pendente de confirmação para este evento. Recarregue a programação ou repita exatamente o mesmo movimento.',
        };
      }
      commandId = pendingCommand.commandId;
    } else {
      commandId = generateCommandUuid();
    }

    try {
      const res = await reorderEventItemsRemote(effectiveClient, {
        churchId: effectiveChurchId,
        commandId,
        eventId: targetEventId,
        itemIds,
        itemNature: 'liturgical',
      });

      if (res.uncertain) {
        pendingReorderCommandsRef.current.set(targetEventId, { key: reorderKey, commandId });
        return { ...res, success: false, uncertain: true };
      }

      pendingReorderCommandsRef.current.delete(targetEventId);
      return res;
    } catch (err) {
      pendingReorderCommandsRef.current.set(targetEventId, { key: reorderKey, commandId });
      return {
        success: false,
        uncertain: true,
        commandId,
        error: err.message || 'Não foi possível confirmar a reordenação no servidor.',
      };
    }
  };

  // Reordenação de Atividades na Programação (Issue #29, CA01)
  const reorderActivities = async (fromIndexOrOrderedIds, toIndex) => {
    const targetEv = event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    let nextActivities;
    if (Array.isArray(fromIndexOrOrderedIds)) {
      const orderedIds = fromIndexOrOrderedIds;
      const actMap = new Map((targetEv.activities || []).map(a => [a.id, a]));
      nextActivities = orderedIds.map(id => actMap.get(id)).filter(Boolean);
      for (const act of targetEv.activities || []) {
        if (!orderedIds.includes(act.id)) {
          nextActivities.push(act);
        }
      }
    } else {
      nextActivities = reorderEventActivities(targetEv.activities, fromIndexOrOrderedIds, toIndex);
    }

    if (!authCheck.inMemory) {
      try {
        const itemIds = nextActivities.map(act => act.id);
        const res = await executeRemoteActivityReorder(targetEv.id, itemIds);
        if (!res.success) {
          return res;
        }
        setEvent(prev => ({
          ...prev,
          activities: nextActivities
        }));
        addAuditLog("Reordenação de Atividades", `Sequência de atividades reordenada na edição '${targetEv.title}'.`);

        const reloadRes = await loadEventProgram(targetEv.id, effectiveChurchId, { force: true });
        if (!reloadRes.success) {
          return {
            success: true,
            remote: true,
            syncError: reloadRes.error,
            warning: 'Reordenação gravada no servidor, mas a atualização dos tokens falhou. Recarregue a página antes de editar as etapas.'
          };
        }

        return { success: true, remote: true };
      } catch (err) {
        return { success: false, error: err.message || "Falha ao sincronizar reordenação com o servidor." };
      }
    }

    setEvent(prev => ({
      ...prev,
      activities: nextActivities
    }));
    addAuditLog("Reordenação de Atividades", `Sequência de atividades reordenada na edição '${targetEv.title}'.`);
    return { success: true };
  };

  const moveActivityUpInEvent = async (activityId, targetEventId = null) => {
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const reordered = moveActivityUp(targetEv.activities, activityId);

    if (!authCheck.inMemory) {
      try {
        const itemIds = reordered.map(act => act.id);
        const res = await executeRemoteActivityReorder(targetId, itemIds);
        if (!res.success) {
          return res;
        }
        setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));

        const reloadRes = await loadEventProgram(targetId, effectiveChurchId, { force: true });
        if (!reloadRes.success) {
          return {
            success: true,
            remote: true,
            syncError: reloadRes.error,
            warning: 'Reordenação gravada no servidor, mas a atualização dos tokens falhou. Recarregue a página antes de editar as etapas.'
          };
        }

        return { success: true, remote: true };
      } catch (err) {
        return { success: false, error: err.message || "Falha ao mover atividade no servidor." };
      }
    }

    setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));
    return { success: true };
  };

  const moveActivityDownInEvent = async (activityId, targetEventId = null) => {
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    const reordered = moveActivityDown(targetEv.activities, activityId);

    if (!authCheck.inMemory) {
      try {
        const itemIds = reordered.map(act => act.id);
        const res = await executeRemoteActivityReorder(targetId, itemIds);
        if (!res.success) {
          return res;
        }
        setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));

        const reloadRes = await loadEventProgram(targetId, effectiveChurchId, { force: true });
        if (!reloadRes.success) {
          return {
            success: true,
            remote: true,
            syncError: reloadRes.error,
            warning: 'Reordenação gravada no servidor, mas a atualização dos tokens falhou. Recarregue a página antes de editar as etapas.'
          };
        }

        return { success: true, remote: true };
      } catch (err) {
        return { success: false, error: err.message || "Falha ao mover atividade no servidor." };
      }
    }

    setEvents(prev => prev.map(ev => ev.id === targetId ? { ...ev, activities: reordered } : ev));
    return { success: true };
  };

  // Edição de Atividade no Planejamento (Issue #29)
  const updateActivityInEvent = async (activityId, updatedData, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem editar etapas." };
    }
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!targetEv) return { success: false, error: "Nenhum evento selecionado para editar a etapa." };

    const existingAct = targetEv.activities?.find(a => a.id === activityId);
    if (!existingAct) {
      return { success: false, error: "Atividade não encontrada no evento." };
    }

    const title = normalizeNfcText(updatedData?.title || existingAct.title);
    if (!title) return { success: false, error: "Título da etapa é obrigatório." };

    let durationMinutes;
    if (updatedData?.plannedDurationMinutes === undefined || updatedData?.plannedDurationMinutes === null || updatedData?.plannedDurationMinutes === '') {
      durationMinutes = existingAct.plannedDurationMinutes;
    } else {
      const parsed = Number(updatedData.plannedDurationMinutes);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { success: false, error: "Duração planejada da etapa litúrgica deve ser um número inteiro maior que zero." };
      }
      durationMinutes = parsed;
    }
    const durationSeconds = durationMinutes * 60;
    const prepMinutes = 0; // Etapas litúrgicas sempre têm preparação 0
    const isValidUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const teamId = isValidUuid(updatedData?.responsibleTeamId) ? updatedData.responsibleTeamId : (isValidUuid(existingAct.responsibleTeamId) ? existingAct.responsibleTeamId : null);
    const leaderId = isValidUuid(updatedData?.responsibleMemberId) ? updatedData.responsibleMemberId : (isValidUuid(existingAct.responsibleMemberId) ? existingAct.responsibleMemberId : null);

    if (!authCheck.inMemory && existingAct.persisted) {
      const payload = {
        title,
        plannedDurationSeconds: durationSeconds,
        prepRequiredMinutes: prepMinutes,
        designatedTeamId: teamId,
        nominalLeaderMemberId: leaderId,
      };
      const updateKey = buildEventItemUpdateKey(targetId, activityId, payload, existingAct.updatedAt);
      const pendingCmd = pendingUpdateCommandsRef.current.get(activityId);
      let commandId;
      if (pendingCmd) {
        if (pendingCmd.key !== updateKey) {
          return {
            success: false,
            error: "Existe uma alteração pendente de confirmação para esta etapa. Aguarde ou repita a alteração idêntica.",
          };
        }
        commandId = pendingCmd.commandId;
      } else {
        commandId = generateCommandUuid();
      }

      try {
        const res = await updateEventItemRemote(effectiveClient, {
          churchId: effectiveChurchId,
          commandId,
          eventId: targetId,
          itemId: activityId,
          title,
          itemNature: 'liturgical',
          plannedDurationSeconds: durationSeconds,
          prepRequiredMinutes: prepMinutes,
          designatedTeamId: teamId,
          nominalLeaderMemberId: leaderId,
          expectedUpdatedAt: existingAct.updatedAt,
        });

        if (res.uncertain) {
          pendingUpdateCommandsRef.current.set(activityId, { key: updateKey, commandId });
          return { success: false, uncertain: true, error: res.error };
        }

        pendingUpdateCommandsRef.current.delete(activityId);

        if (!res.success) {
          return {
            success: false,
            error: res.error,
            concurrencyConflict: res.concurrencyConflict
          };
        }

        const newUpdatedAt = res.updatedAt || existingAct.updatedAt;
        const updatedActivity = {
          ...existingAct,
          title,
          category: updatedData?.category || existingAct.category,
          plannedDurationMinutes: durationMinutes,
          plannedDurationSeconds: durationSeconds,
          prepRequiredMinutes: prepMinutes,
          responsibleTeamId: teamId,
          responsibleMemberId: leaderId,
          notes: updatedData?.notes ?? existingAct.notes,
          requiresPlayback: updatedData?.requiresPlayback !== undefined ? updatedData.requiresPlayback : existingAct.requiresPlayback,
          updatedAt: newUpdatedAt,
        };

        setEvents(prev => prev.map(ev => ev.id === targetId
          ? {
              ...ev,
              activities: ev.activities.map(a => a.id === activityId ? updatedActivity : a)
            }
          : ev));

        addAuditLog("Edição de Atividade", `Atividade '${title}' atualizada no servidor.`);
        return { success: true, remote: true, activity: updatedActivity };
      } catch (err) {
        pendingUpdateCommandsRef.current.set(activityId, { key: updateKey, commandId });
        return { success: false, uncertain: true, error: err.message || "Falha ao atualizar atividade no servidor." };
      }
    }

    // Modo local / em memória
    const updatedActivity = {
      ...existingAct,
      title,
      category: updatedData?.category || existingAct.category,
      plannedDurationMinutes: durationMinutes,
      plannedDurationSeconds: durationSeconds,
      prepRequiredMinutes: prepMinutes,
      responsibleTeamId: teamId,
      responsibleMemberId: leaderId,
      notes: updatedData?.notes ?? existingAct.notes,
      requiresPlayback: updatedData?.requiresPlayback !== undefined ? updatedData.requiresPlayback : existingAct.requiresPlayback,
    };

    setEvents(prev => prev.map(ev => ev.id === targetId
      ? {
          ...ev,
          activities: ev.activities.map(a => a.id === activityId ? updatedActivity : a)
        }
      : ev));

    addAuditLog("Edição de Atividade", `Atividade '${title}' atualizada localmente.`);
    return { success: true, remote: false, activity: updatedActivity };
  };

  // Remoção de Atividade no Planejamento (Issue #29)
  const removeActivityFromEvent = async (activityId, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem remover etapas." };
    }
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(ev => ev.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    if (!targetEv) return { success: false, error: "Nenhum evento selecionado para remover a etapa." };

    const existingAct = targetEv.activities?.find(a => a.id === activityId);
    if (!existingAct) {
      return { success: false, error: "Atividade não encontrada no evento." };
    }

    if (!authCheck.inMemory && existingAct.persisted) {
      const removeKey = buildEventItemRemoveKey(targetId, activityId, existingAct.updatedAt);
      const pendingCmd = pendingRemoveCommandsRef.current.get(activityId);
      let commandId;
      if (pendingCmd) {
        if (pendingCmd.key !== removeKey) {
          return {
            success: false,
            error: "Existe uma remoção pendente de confirmação para esta etapa.",
          };
        }
        commandId = pendingCmd.commandId;
      } else {
        commandId = generateCommandUuid();
      }

      try {
        const res = await removeEventItemRemote(effectiveClient, {
          churchId: effectiveChurchId,
          commandId,
          eventId: targetId,
          itemId: activityId,
          expectedUpdatedAt: existingAct.updatedAt,
        });

        if (res.uncertain) {
          pendingRemoveCommandsRef.current.set(activityId, { key: removeKey, commandId });
          return { success: false, uncertain: true, error: res.error };
        }

        pendingRemoveCommandsRef.current.delete(activityId);

        if (!res.success) {
          return {
            success: false,
            error: res.error,
            concurrencyConflict: res.concurrencyConflict,
            blockedByAssignment: res.blockedByAssignment
          };
        }

        setEvents(prev => prev.map(ev => ev.id === targetId
          ? {
              ...ev,
              activities: ev.activities.filter(a => a.id !== activityId)
            }
          : ev));

        addAuditLog("Remoção de Atividade", `Atividade '${existingAct.title}' removida do servidor.`);
        return { success: true, remote: true };
      } catch (err) {
        pendingRemoveCommandsRef.current.set(activityId, { key: removeKey, commandId });
        return { success: false, uncertain: true, error: err.message || "Falha ao remover atividade no servidor." };
      }
    }

    // Modo local / em memória
    setEvents(prev => prev.map(ev => ev.id === targetId
      ? {
          ...ev,
          activities: ev.activities.filter(a => a.id !== activityId)
        }
      : ev));

    addAuditLog("Remoção de Atividade", `Atividade '${existingAct.title}' removida localmente.`);
    return { success: true, remote: false };
  };

  // Configuração da Política de Duração do Evento (Issue #30, CA04)
  const setEventDurationPolicy = (newPolicy, targetEventId = null) => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Permissão insuficiente para alterar a política de duração." };
    }
    const targetId = targetEventId || currentEventId;
    const targetEv = events.find(e => e.id === targetId) || event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };

    try {
      const updated = updateEventDurationPolicy(targetEv, newPolicy, isAdmin || isLiturgyLeader);

      if (!authCheck.inMemory) {
        return (async () => {
          const lifecycleKey = `policy:${effectiveChurchId}:${targetId}`;
          let cmdId = pendingProgramLifecycleCommandsRef.current.get(lifecycleKey);
          if (!cmdId) {
            cmdId = generateCommandUuid();
          }

          try {
            const res = await setEventDurationPolicyRemote(
              effectiveClient,
              {
                churchId: effectiveChurchId,
                commandId: cmdId,
                eventId: targetId,
                durationPolicy: newPolicy,
              }
            );

            if (res.uncertain) {
              pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
              return { success: false, uncertain: true, error: res.error };
            }

            pendingProgramLifecycleCommandsRef.current.delete(lifecycleKey);

            if (!res.success) {
              return { success: false, error: res.error };
            }

            setEvents(prev => prev.map(ev => ev.id === targetId ? updated : ev));
            addAuditLog("Política de Duração", `Política de duração alterada para '${newPolicy}'.`);
            return { success: true, remote: true, receipt: res.receipt };
          } catch (err) {
            pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
            return { success: false, uncertain: true, error: err.message || "Falha ao atualizar política de duração no servidor." };
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
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem publicar a programação." };
    }
    const targetEv = event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };
    if (!targetEv) return { success: false, error: 'Nenhum evento selecionado para publicação.' };

    try {
      const published = publishEventProgram(targetEv, currentUser?.id);

      if (!authCheck.inMemory) {
        return (async () => {
          const lifecycleKey = `publish:${effectiveChurchId}:${targetEv.id}`;
          let cmdId = pendingProgramLifecycleCommandsRef.current.get(lifecycleKey);
          if (!cmdId) {
            cmdId = generateCommandUuid();
          }

          try {
            const res = await publishEventProgramRemote(
              effectiveClient,
              {
                churchId: effectiveChurchId,
                commandId: cmdId,
                eventId: targetEv.id,
                expectedVersion: targetEv.programVersion || 1,
              }
            );

            if (res.uncertain) {
              pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
              return { success: false, uncertain: true, error: res.error };
            }

            if (!res.success) {
              pendingProgramLifecycleCommandsRef.current.delete(lifecycleKey);
              return { success: false, error: res.error };
            }

            const payload = res.payload || {};
            const nextVersion = payload.program_version;
            if (typeof nextVersion !== 'number' || !Number.isInteger(nextVersion) || nextVersion <= 0) {
              pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
              return {
                success: false,
                uncertain: true,
                error: 'Resposta remota de publicação sem program_version válido retornado pelo servidor.',
              };
            }

            pendingProgramLifecycleCommandsRef.current.delete(lifecycleKey);

            const serverPublished = {
              ...published,
              programStatus: 'published',
              programVersion: nextVersion,
              publishedAt: payload.published_at || res.receipt?.created_at,
              publishedByMemberId: payload.published_by_member_id || currentUser?.id,
              updatedAt: payload.updated_at || res.receipt?.created_at || targetEv.updatedAt,
            };
            setEvent(serverPublished);
            setEvents(prev => prev.map(ev => ev.id === targetEv.id ? serverPublished : ev));
            addAuditLog(
              "Publicação da Programação",
              `Programação litúrgica da edição '${targetEv.title}' publicada com sucesso (Versão ${nextVersion}).`
            );
            return { success: true, remote: true, receipt: res.receipt };
          } catch (err) {
            pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
            return { success: false, uncertain: true, error: err.message || "Falha ao publicar programação no servidor." };
          }
        })();
      }

      setEvent(published);
      addAuditLog(
        "Publicação da Programação",
        `Programação litúrgica da edição '${targetEv.title}' publicada com sucesso (Versão ${published.programVersion}).`
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Salvar Rascunho da Programação (Issue #30, CA02 e CA03)
  const saveCurrentProgramDraft = () => {
    if (!isAdmin && !isLiturgyLeader) {
      return { success: false, error: "Apenas administradores ou líderes da liturgia podem salvar rascunho da programação." };
    }
    const targetEv = event;
    const blockReason = getProgramMutationBlockReason(targetEv);
    if (blockReason) return { success: false, error: blockReason };

    const authCheck = ensureAuthorizedContext();
    if (!authCheck.allowed) return { success: false, error: authCheck.error };
    if (!targetEv) return { success: false, error: 'Nenhum evento selecionado para salvar rascunho.' };

    try {
      const draft = saveEventProgramDraft(targetEv);

      if (!authCheck.inMemory) {
        return (async () => {
          const lifecycleKey = `draft:${effectiveChurchId}:${targetEv.id}`;
          let cmdId = pendingProgramLifecycleCommandsRef.current.get(lifecycleKey);
          if (!cmdId) {
            cmdId = generateCommandUuid();
          }

          try {
            const res = await saveEventProgramDraftRemote(
              effectiveClient,
              {
                churchId: effectiveChurchId,
                commandId: cmdId,
                eventId: targetEv.id,
              }
            );

            if (res.uncertain) {
              pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
              return { success: false, uncertain: true, error: res.error };
            }

            if (!res.success) {
              pendingProgramLifecycleCommandsRef.current.delete(lifecycleKey);
              return { success: false, error: res.error };
            }

            const payload = res.payload || {};
            const draftVersion = payload.program_version;
            if (typeof draftVersion !== 'number' || !Number.isInteger(draftVersion) || draftVersion <= 0) {
              pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
              return {
                success: false,
                uncertain: true,
                error: 'Resposta do servidor sem program_version válido.',
              };
            }

            pendingProgramLifecycleCommandsRef.current.delete(lifecycleKey);

            const serverDraft = {
              ...draft,
              programStatus: 'draft',
              programVersion: draftVersion,
              updatedAt: payload.updated_at || payload.draft_saved_at || res.receipt?.created_at || targetEv.updatedAt,
            };
            setEvent(serverDraft);
            setEvents(prev => prev.map(ev => ev.id === targetEv.id ? serverDraft : ev));
            addAuditLog(
              "Rascunho da Programação",
              `Rascunho da programação da edição '${targetEv.title}' salvo com sucesso.`
            );
            return { success: true, remote: true, receipt: res.receipt };
          } catch (err) {
            pendingProgramLifecycleCommandsRef.current.set(lifecycleKey, cmdId);
            return { success: false, uncertain: true, error: err.message || "Falha ao salvar rascunho no servidor." };
          }
        })();
      }

      setEvent(draft);
      addAuditLog(
        "Rascunho da Programação",
        `Rascunho da programação da edição '${targetEv.title}' salvo com sucesso.`
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
        setMembers,
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
        isRealEnvironment,
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
        pendingCreateEvent,
        retryPendingCreateEvent,
        teamsLoadStatus,
        membersLoadStatus,
        loadEventProgram,
        loadEventAssignments,
        getEventAssignmentsRemote,
        calculateEditionScaleConflicts,
        addActivityToEvent,
        updateActivityInEvent,
        removeActivityFromEvent,
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
        isTemplatesStale,
        isEventTypesStale,
        isActivitiesStale,
        isReasonsStale,
        beginEditingTemplate,
        cancelEditingTemplate,
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
        addParallelServiceToCurrentEvent,
        updateParallelServiceInCurrentEvent,
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
