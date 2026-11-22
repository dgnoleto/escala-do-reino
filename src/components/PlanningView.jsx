import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  EVENT_ITEMS_PERSISTENCE_NOTICE,
  PARALLEL_SERVICES_PERSISTENCE_NOTICE,
} from '../utils/eventItemService';
import {
  calculateEditionScaleConflicts,
  calculateParallelServiceWindow,
} from '../utils/eventPlanningService';
import {
  Sliders,
  Plus,
  Clock,
  AlertTriangle,
  AlertCircle,
  Music,
  Users,
  Check,
  ExternalLink,
  Trash2,
  Edit,
  Radio,
  Info,
  ArrowUp,
  ArrowDown,
  Save,
  Send,
  Calendar,
  ShieldCheck
} from 'lucide-react';

export function isProgramPublicationBlocked(durationPolicy, overflowMinutes) {
  const normalizedOverflow = Number(overflowMinutes);
  return durationPolicy === 'block'
    && Number.isFinite(normalizedOverflow)
    && normalizedOverflow > 0;
}

export default function PlanningView({ onBack } = {}) {
  const {
    event,
    setEvent,
    events = [],
    selectEvent,
    createEventEdition,
    addActivityToEvent,
    updateActivityInEvent,
    removeActivityFromEvent,
    loadEventProgram,
    isRemoteConfigured,
    moveActivityUpInEvent,
    moveActivityDownInEvent,
    setEventDurationPolicy,
    publishCurrentProgram,
    saveCurrentProgramDraft,
    totalPlannedDurationMinutes,
    durationOverflowMinutes,
    availableDurationMinutes,
    remainingDurationMinutes,
    currentUser,
    isLiturgyLeader,
    isAdmin,
    isTeamLeader,
    members,
    teams,
    membersLoadStatus,
    eventTypes = [],
    standardActivities = [],
    serviceTemplates = [],
    applyServiceTemplateToEvent,
    addParallelServiceToCurrentEvent,
    updateParallelServiceInCurrentEvent,
    removeParallelServiceFromCurrentEvent,
    checkAssignmentConflict,
    addAuditLog,
    isOnline,
    isDataStale,
    church,
    remoteLoading,
    remoteError,
    reloadRemoteData,
    pendingCreateEvent,
    retryPendingCreateEvent,
    teamsLoadStatus
  } = useApp();

  const canCreateEvent = isAdmin || isTeamLeader;
  const isTeamsCheckingForCreate = isRemoteConfigured && !isAdmin && (teamsLoadStatus === 'loading' || teamsLoadStatus === 'idle');
  const isTeamsUnavailableForCreate = isRemoteConfigured && !isAdmin && teamsLoadStatus === 'failed';
  const isTeamsStatusBlocking = isTeamsCheckingForCreate || isTeamsUnavailableForCreate;

  // Modal de Criação de Edição de Culto (Issue #28)
  const [createEventModalOpen, setCreateEventModalOpen] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventType, setNewEventType] = useState('');
  const [newEventStartDate, setNewEventStartDate] = useState('2026-10-25');
  const [newEventStartTime, setNewEventStartTime] = useState('19:00');
  const [newEventEndDate, setNewEventEndDate] = useState('2026-10-25');
  const [newEventEndTime, setNewEventEndTime] = useState('20:45');
  const [newEventTemplateId, setNewEventTemplateId] = useState('');
  const [newEventLiturgyLeader, setNewEventLiturgyLeader] = useState('');
  const [newEventDurationPolicy, setNewEventDurationPolicy] = useState('warn');
  const [createEventError, setCreateEventError] = useState('');
  const [createEventSuccess, setCreateEventSuccess] = useState('');
  const [createEventWarning, setCreateEventWarning] = useState('');
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);

  // Estados de Publicação e Rascunho (Issue #30)
  const [publishFeedback, setPublishFeedback] = useState('');
  const [publishError, setPublishError] = useState('');

  // Template de Culto Reutilizável (PRD §5 / M28 - Issue #27)
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateFeedback, setTemplateFeedback] = useState('');

  // Modais de Criação / Edição de Atividade
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('Liturgia');
  const [formDuration, setFormDuration] = useState(10);
  const [formResponsible, setFormResponsible] = useState(() => currentUser?.id || (members?.[0]?.id || ''));
  const [formNotes, setFormNotes] = useState('');
  const [formRequiresPlayback, setFormRequiresPlayback] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [isSavingActivity, setIsSavingActivity] = useState(false);

  // Modal de Adicionar Música (PRD 9.1)
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  const [targetActivityForMusic, setTargetActivityForMusic] = useState(null);
  const [songName, setSongName] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [songKey, setSongKey] = useState('G');
  const [songYoutube, setSongYoutube] = useState('');
  const [songNotes, setSongNotes] = useState('');

  // Modal de Conflito de Alocação de Escala (PRD 5.2 / Cenário M22)
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] = useState({ reason: '', candidates: [] });

  // Sinais de Conflito de Escala com Preparação Antecedente (Issue #29 CA03/CA04)
  const [scaleSignalNotice, setScaleSignalNotice] = useState('');
  const editionScaleConflictsResult = useMemo(() => {
    return calculateEditionScaleConflicts(event, event?.assignments || [], members);
  }, [event, members]);
  const editionScaleConflicts = editionScaleConflictsResult?.conflicts || [];

  // Modal de Criação / Edição de Apoio Paralelo (Issue #29 / #30)
  const [parallelModalOpen, setParallelModalOpen] = useState(false);
  const [editingParallelId, setEditingParallelId] = useState(null);
  const [parallelTitle, setParallelTitle] = useState('');
  const [parallelDuration, setParallelDuration] = useState(60);
  const [parallelPrepMinutes, setParallelPrepMinutes] = useState(15);
  const [parallelTeamId, setParallelTeamId] = useState('');
  const [parallelLeaderId, setParallelLeaderId] = useState('');
  const [parallelError, setParallelError] = useState('');
  const [isSavingParallel, setIsSavingParallel] = useState(false);

  const openNewParallelModal = () => {
    setEditingParallelId(null);
    setParallelTitle('');
    setParallelDuration(event?.plannedDurationMinutes && event.plannedDurationMinutes > 0 ? event.plannedDurationMinutes : 60);
    setParallelPrepMinutes(15);
    setParallelTeamId(teams?.[0]?.id || 'transmissao');
    setParallelLeaderId('');
    setParallelError('');
    setParallelModalOpen(true);
  };

  const openEditParallelModal = (serv) => {
    setEditingParallelId(serv.id);
    setParallelTitle(serv.name || serv.title || '');
    const durMin = serv.plannedDurationMinutes != null && serv.plannedDurationMinutes > 0
      ? serv.plannedDurationMinutes
      : (serv.plannedDurationSeconds && serv.plannedDurationSeconds > 0
        ? Math.round(serv.plannedDurationSeconds / 60)
        : (event?.plannedDurationMinutes || 60));
    setParallelDuration(durMin);
    setParallelPrepMinutes(serv.prepRequiredMinutes != null ? serv.prepRequiredMinutes : 15);
    setParallelTeamId(serv.teamId || teams?.[0]?.id || 'transmissao');
    setParallelLeaderId(serv.leaderId || '');
    setParallelError('');
    setParallelModalOpen(true);
  };

  const handleSaveParallel = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isSavingParallel || isProgramMutationsDisabled) return;
    if (!parallelTitle.trim()) {
      setParallelError('Informe o título do apoio paralelo.');
      return;
    }
    const durMin = Number(parallelDuration);
    if (isNaN(durMin) || durMin <= 0 || !Number.isInteger(durMin)) {
      setParallelError('A duração planejada do apoio paralelo deve ser um número inteiro maior que zero.');
      return;
    }
    const prepMin = Number(parallelPrepMinutes);
    if (isNaN(prepMin) || !Number.isInteger(prepMin) || prepMin < 0 || prepMin > 180) {
      setParallelError('O tempo de preparação antecedente deve ser um número inteiro entre 0 e 180 minutos.');
      return;
    }
    setIsSavingParallel(true);
    setParallelError('');
    let res;
    try {
      if (editingParallelId) {
        res = await updateParallelServiceInCurrentEvent(editingParallelId, {
          name: parallelTitle.trim(),
          plannedDurationMinutes: durMin,
          prepRequiredMinutes: prepMin,
          teamId: parallelTeamId || null,
          leaderId: parallelLeaderId || null,
        });
      } else {
        res = await addParallelServiceToCurrentEvent({
          name: parallelTitle.trim(),
          plannedDurationMinutes: durMin,
          prepRequiredMinutes: prepMin,
          teamId: parallelTeamId || null,
          leaderId: parallelLeaderId || null,
        });
      }
    } catch (err) {
      res = { success: false, error: err.message || 'Erro inesperado ao salvar apoio paralelo.' };
    } finally {
      setIsSavingParallel(false);
    }
    if (res && !res.success) {
      setParallelError(res.error || 'Erro ao salvar apoio paralelo.');
    } else {
      setParallelModalOpen(false);
    }
  };

  // Abertura do Modal de Atividade
  const openNewActivityModal = () => {
    setEditingActivityId(null);
    setFormTitle('');
    setFormCategory('Liturgia');
    setFormDuration(10);
    setFormResponsible(currentUser?.id || (members?.[0]?.id || ''));
    setFormNotes('');
    setFormRequiresPlayback(false);
    setActivityError('');
    setActivityModalOpen(true);
  };

  const openEditActivityModal = (act) => {
    setActivityError('');
    setEditingActivityId(act.id);
    setFormTitle(act.title);
    setFormCategory(act.category);
    setFormDuration(act.plannedDurationMinutes);
    setFormResponsible(act.responsibleMemberId);
    setFormNotes(act.notes || '');
    setFormRequiresPlayback(act.requiresPlayback || false);
    setActivityModalOpen(true);
  };

  // Estado de Remoção de Atividade (Issue #29)
  const [isDeletingActivity, setIsDeletingActivity] = useState(false);
  const [deleteActivityError, setDeleteActivityError] = useState('');
  const [isReorderingActivity, setIsReorderingActivity] = useState(false);
  const [reorderActivityError, setReorderActivityError] = useState('');
  const [isReorderResultUncertain, setIsReorderResultUncertain] = useState(false);
  const reorderInFlightRef = useRef(false);

  useEffect(() => {
    setReorderActivityError('');
    setIsReorderResultUncertain(false);
  }, [church?.id, event?.id]);

  const handleRemoveActivity = async (activityId) => {
    if (isDeletingActivity) return;
    setDeleteActivityError('');
    setIsDeletingActivity(true);
    try {
      const res = await Promise.resolve(removeActivityFromEvent(activityId));
      if (!res?.success) {
        setDeleteActivityError(res?.error || 'Não foi possível remover a etapa.');
      }
    } catch (err) {
      setDeleteActivityError(err?.message || 'Erro inesperado ao remover a etapa.');
    } finally {
      setIsDeletingActivity(false);
    }
  };

  const handleMoveActivity = async (activityId, direction) => {
    if (reorderInFlightRef.current || isReorderingActivity || isProgramMutationsDisabled) {
      return { success: false, error: 'A reordenação está temporariamente indisponível.' };
    }

    reorderInFlightRef.current = true;
    setReorderActivityError('');
    setIsReorderResultUncertain(false);
    setIsReorderingActivity(true);
    let res;
    try {
      res = direction === 'up'
        ? await moveActivityUpInEvent(activityId)
        : await moveActivityDownInEvent(activityId);

      if (!res?.success) {
        const uncertain = Boolean(res?.uncertain);
        const message = uncertain
          ? `Resultado incerto ao reordenar. Recarregue a programação para consultar o servidor ou repita exatamente o mesmo movimento. ${res?.error || ''}`.trim()
          : (res?.error || 'Não foi possível reordenar a etapa.');
        setIsReorderResultUncertain(uncertain);
        setReorderActivityError(message);
      }
    } catch (err) {
      res = {
        success: false,
        uncertain: true,
        error: err?.message || 'Não foi possível confirmar a reordenação no servidor.',
      };
      setIsReorderResultUncertain(true);
      setReorderActivityError(`Resultado incerto ao reordenar. Recarregue a programação para consultar o servidor ou repita exatamente o mesmo movimento. ${res.error}`);
    } finally {
      reorderInFlightRef.current = false;
      setIsReorderingActivity(false);
    }
    return res;
  };

  const handleSaveActivity = async () => {
    if (!formTitle || isSavingActivity || isProgramMutationsDisabled) return;
    setActivityError('');

    if (editingActivityId) {
      // Edição de Atividade (Issue #29)
      let durMin;
      if (formDuration === undefined || formDuration === null || formDuration === '') {
        const existingAct = event?.activities?.find(a => a.id === editingActivityId);
        durMin = existingAct?.plannedDurationMinutes;
      } else {
        const parsed = Number(formDuration);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          setActivityError('Duração da etapa deve ser um número inteiro maior que zero.');
          return;
        }
        durMin = parsed;
      }

      setIsSavingActivity(true);
      let res;
      try {
        res = await Promise.resolve(updateActivityInEvent(editingActivityId, {
          title: formTitle,
          category: formCategory,
          plannedDurationMinutes: durMin,
          responsibleMemberId: formResponsible,
          notes: formNotes,
          requiresPlayback: formRequiresPlayback
        }));
      } catch (err) {
        res = { success: false, error: err.message || 'Erro inesperado ao editar a etapa.' };
      } finally {
        setIsSavingActivity(false);
      }

      if (!res?.success) {
        setActivityError(res?.error || 'Não foi possível salvar a edição da etapa.');
        return;
      }
    } else {
      // Criação de Nova Atividade (Issue #29): no ambiente conectado, a etapa só aparece na lista
      // depois de gravada no servidor; se a gravação falhar, o erro é exibido e nada é simulado.
      const parsed = Number(formDuration);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setActivityError('Duração da etapa deve ser um número inteiro maior que zero.');
        return;
      }

      setIsSavingActivity(true);
      let res;
      try {
        res = await Promise.resolve(addActivityToEvent({
          title: formTitle,
          category: formCategory,
          plannedDurationMinutes: parsed,
          responsibleMemberId: formResponsible,
          responsibleTeamId: "liturgia",
          notes: formNotes,
          requiresPlayback: formRequiresPlayback
        }));
      } catch (err) {
        res = { success: false, error: err.message || 'Erro inesperado ao adicionar a etapa.' };
      } finally {
        setIsSavingActivity(false);
      }

      if (!res?.success) {
        setActivityError(res?.error || 'Não foi possível adicionar a etapa.');
        return;
      }
    }

    setActivityModalOpen(false);
  };

  // Salvar Música na Ficha da Atividade (PRD 9.1)
  const handleSaveMusic = () => {
    if (!songName || !targetActivityForMusic) return;

    const newMusic = {
      id: "m-" + Date.now(),
      name: songName,
      artist: songArtist,
      key: songKey,
      youtubeUrl: songYoutube,
      notes: songNotes
    };

    setEvent(prev => ({
      ...prev,
      activities: prev.activities.map(a => {
        if (a.id === targetActivityForMusic.id) {
          return {
            ...a,
            musics: [...(a.musics || []), newMusic]
          };
        }
        return a;
      })
    }));

    addAuditLog(
      "Música Adicionada",
      `Música '${songName}' (${songArtist}, Tom ${songKey}) vinculada à etapa '${targetActivityForMusic.title}'.`
    );

    setMusicModalOpen(false);
  };

  // Testar Simulação de Alocação de Escala com Conflito (PRD 5.2 & Cenário M22 / CA03)
  const simulateAssignVolunteer = (activityId, memberId, role) => {
    const conflict = checkAssignmentConflict(memberId, role, activityId);
    // Bloqueio Litúrgico estrito (M22: acumular funções canto/instrumento/dança no mesmo louvor)
    if (conflict.hasConflict) {
      setConflictData({
        reason: conflict.reason,
        candidates: conflict.eligibleCandidates || []
      });
      setConflictModalOpen(true);
      return;
    }

    // Sinal de Conflito de Escala com apoio/preparação (CA03/CA04): não bloqueia, registra aviso
    if (conflict.hasScaleSignal) {
      setScaleSignalNotice(conflict.signalReason || 'Sinal de sobreposição de escala detectado.');
    }

    // Se não tiver bloqueio, insere no roster
    setEvent(prev => ({
      ...prev,
      activities: (prev.activities || []).map(a => {
        if (a.id === activityId) {
          return {
            ...a,
            roster: [...(a.roster || []), { memberId, role }]
          };
        }
        return a;
      })
    }));

    addAuditLog("Voluntário Escalado", `Membro escalado como '${role}' na atividade.`);
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplateId) return;
    setTemplateFeedback(null);
    try {
      const res = await Promise.resolve(applyServiceTemplateToEvent(selectedTemplateId));
      if (!res.success) {
        setTemplateFeedback({
          type: 'error',
          message: res.error || 'Falha ao aplicar o modelo de culto.'
        });
        return;
      }

      const tpl = serviceTemplates.find(t => t.id === selectedTemplateId);
      const templateName = tpl?.name || 'Modelo';

      if (res.persisted === false) {
        // Modo local sem servidor (demonstração/testes): nada é gravado
        setTemplateFeedback({
          type: 'warning',
          title: `Prévia do modelo "${templateName}" carregada em memória`,
          message: res.warning || 'As atividades litúrgicas e serviços de apoio foram carregados apenas na memória desta sessão; nada foi gravado no servidor.'
        });
      } else if (res.warning) {
        // Etapas gravadas no servidor (Issue #29), com os limites exatos do que foi gravado
        setTemplateFeedback({
          type: 'warning',
          title: `Modelo "${templateName}": ${res.savedItemsCount ?? 0} etapa(s) gravada(s) no servidor`,
          message: res.warning
        });
      } else {
        setTemplateFeedback({
          type: 'success',
          message: `Modelo "${templateName}" aplicado e gravado com sucesso!`
        });
      }
    } catch (err) {
      setTemplateFeedback({
        type: 'error',
        message: err.message || 'Erro inesperado ao aplicar modelo ao culto.'
      });
    }
  };

  // Handlers para Edição de Culto e Publicação (Issues #28 e #30)
  const handleOpenCreateEventModal = () => {
    setNewEventTitle('');
    setNewEventType(eventTypes[0]?.name || (isRemoteConfigured ? '' : 'Celebração Geral'));
    setNewEventStartDate('2026-10-25');
    setNewEventStartTime('19:00');
    setNewEventEndDate('2026-10-25');
    setNewEventEndTime('20:45');
    setNewEventTemplateId('');
    setNewEventLiturgyLeader(isAdmin ? (currentUser?.id || (members?.[0]?.id || '')) : '');
    setNewEventDurationPolicy('warn');
    setCreateEventError('');
    setCreateEventSuccess('');
    setCreateEventWarning('');
    setCreateEventModalOpen(true);
  };

  const handleCreateEventEditionSubmit = async (e) => {
    e?.preventDefault?.();
    // Evita criar a mesma edição duas vezes: envio em andamento, edição já criada ou tentativa incerta pendente
    if (isCreatingEvent || createEventSuccess) return;
    if (pendingCreateEvent) {
      setCreateEventError('Há uma tentativa anterior sem confirmação do servidor. Use "Repetir tentativa anterior" para consultar o servidor com os mesmos dados.');
      return;
    }
    setCreateEventError('');
    setCreateEventSuccess('');
    setCreateEventWarning('');

    if (isRemoteConfigured && eventTypes.length === 0) {
      setCreateEventError('Nenhum tipo de evento cadastrado. Cadastre ao menos um tipo na Administração antes de criar uma edição de culto.');
      return;
    }

    if (!newEventType) {
      setCreateEventError('Selecione o tipo de evento antes de criar a edição de culto.');
      return;
    }

    const startIso = `${newEventStartDate}T${newEventStartTime}:00`;
    const endIso = `${newEventEndDate}T${newEventEndTime}:00`;

    // Carrega modelo se selecionado (sem voluntários - CA03 de #27 e CA04 de #28)
    let initialActs = [];
    let initialServices = [];
    if (newEventTemplateId) {
      const tpl = serviceTemplates.find(t => t.id === newEventTemplateId);
      if (tpl) {
        initialActs = (tpl.activities || []).map((a, i) => ({
          ...a,
          id: `act-${Date.now()}-${i}`,
          responsibleMemberId: null,
          roster: []
        }));
        initialServices = (tpl.parallelServices || []).map((s, i) => ({
          ...s,
          id: `serv-${Date.now()}-${i}`,
          leaderId: null,
          volunteers: [],
          status: 'Aguardando culto'
        }));
      }
    }

    // Data e hora digitadas são hora local no fuso da igreja; a conversão é feita no contexto (#28)
    setIsCreatingEvent(true);
    let res;
    try {
      res = await Promise.resolve(createEventEdition({
        title: newEventTitle,
        type: newEventType,
        plannedStartAt: startIso,
        plannedEndAt: endIso,
        liturgyLeaderId: isAdmin ? (newEventLiturgyLeader || null) : null,
        durationPolicy: newEventDurationPolicy,
        activities: initialActs,
        parallelServices: initialServices
      }));
    } catch (err) {
      res = { success: false, error: err.message || 'Erro inesperado ao criar a edição de culto.' };
    } finally {
      setIsCreatingEvent(false);
    }

    if (!res.success) {
      setCreateEventError(res.error);
    } else if (res.warning) {
      // Edição criada, com ressalvas sobre as etapas (Issue #29): o modal permanece aberto até o usuário ler
      setCreateEventSuccess(`Edição '${res.event.title}' criada com sucesso.`);
      setCreateEventWarning(res.warning);
    } else {
      setCreateEventSuccess(`Edição '${res.event.title}' criada com sucesso!`);
      setTimeout(() => {
        setCreateEventModalOpen(false);
        setCreateEventSuccess('');
      }, 1500);
    }
  };

  const handleRetryPendingCreateEvent = async () => {
    if (isCreatingEvent || !retryPendingCreateEvent) return;
    setCreateEventError('');
    setCreateEventSuccess('');
    setCreateEventWarning('');
    setIsCreatingEvent(true);
    let res;
    try {
      res = await Promise.resolve(retryPendingCreateEvent());
    } catch (err) {
      res = { success: false, error: err.message || 'Erro inesperado ao repetir a tentativa anterior.' };
    } finally {
      setIsCreatingEvent(false);
    }
    if (!res?.success) {
      setCreateEventError(res?.error || 'Não foi possível concluir a tentativa anterior.');
    } else if (res.warning) {
      setCreateEventModalOpen(true);
      setCreateEventSuccess(`Edição '${res.event.title}' criada com sucesso.`);
      setCreateEventWarning(res.warning);
    } else {
      setCreateEventModalOpen(false);
    }
  };

  const isPublicationBlockedByDuration = isProgramPublicationBlocked(
    event?.durationPolicy,
    durationOverflowMinutes
  );

  const handlePublishProgram = async () => {
    setPublishError('');
    setPublishFeedback('');
    if (isPublicationBlockedByDuration) {
      setPublishError(`A publicação está bloqueada: a programação excede o culto em ${durationOverflowMinutes} min no modo block.`);
      return;
    }
    const res = await publishCurrentProgram();
    if (!res.success) {
      setPublishError(res.error);
    } else {
      setPublishFeedback(`Programação publicada com sucesso (Versão ${event.programVersion ? event.programVersion + 1 : 2})!`);
      setTimeout(() => setPublishFeedback(''), 5000);
    }
  };

  const handleSaveDraft = async () => {
    setPublishError('');
    const res = await saveCurrentProgramDraft();
    if (res && !res.success) {
      setPublishError(res.error);
    } else {
      setPublishFeedback('Rascunho da programação salvo com sucesso.');
      setTimeout(() => setPublishFeedback(''), 4000);
    }
  };

  const handleChangeDurationPolicy = async (val) => {
    setPublishError('');
    const res = await setEventDurationPolicy(val);
    if (!res.success) {
      setPublishError(res.error);
    }
  };

  const isControlsDisabled = !isOnline || isDataStale;
  const isProgramMutationsDisabled =
    isControlsDisabled ||
    Boolean(event?.isProgramLoading) ||
    Boolean(event?.programLoadError) ||
    (Boolean(event?.loadedFromServer) && !event?.activitiesKnownInSession);

  return (
    <div className="planning-view-container">
      {/* Barra de Navegação Superior / Voltar ao Início */}
      {onBack && (
        <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            id="btn-back-to-home"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
          >
            ← Voltar ao Início da Igreja
          </button>
          <span className="badge badge-pending" style={{ fontSize: '0.85rem' }}>
            Igreja: {church?.name || 'Igreja Conectada'}
          </span>
        </div>
      )}

      {/* Banner de Erro na Carga da Programação (Issue #29 / #30) */}
      {event?.programLoadError && (
        <div
          id="banner-program-load-error"
          className="card"
          style={{
            borderLeft: '4px solid #ef4444',
            background: '#fef2f2',
            color: '#991b1b',
            marginBottom: '1.25rem',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertCircle size={20} color="#ef4444" />
            <span>Falha ao carregar a programação do evento</span>
          </div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            {event.programLoadError}
          </p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#b91c1c' }}>
            As mutações na programação deste evento estão bloqueadas até que a programação seja recarregada com sucesso, evitando inconsistências.
          </p>
          {loadEventProgram && (
            <button
              type="button"
              id="btn-retry-load-program"
              className="btn btn-secondary"
              onClick={() => loadEventProgram(event.id)}
              disabled={event?.isProgramLoading}
              style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              {event?.isProgramLoading ? 'Recarregando...' : 'Recarregar Programação'}
            </button>
          )}
        </div>
      )}

      {/* Banner de Erro na Remoção de Etapa Litúrgica */}
      {deleteActivityError && (
        <div
          id="banner-delete-activity-error"
          className="card"
          style={{
            borderLeft: '4px solid #ef4444',
            background: '#fef2f2',
            color: '#991b1b',
            marginBottom: '1.25rem',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertCircle size={20} color="#ef4444" />
            <span>Não foi possível remover a etapa litúrgica</span>
          </div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            {deleteActivityError}
          </p>
        </div>
      )}

      {reorderActivityError && (
        <div
          id="banner-reorder-activity-error"
          className="card"
          role="alert"
          style={{
            borderLeft: '4px solid #f59e0b',
            background: '#fffbeb',
            color: '#92400e',
            marginBottom: '1.25rem',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertTriangle size={20} color="#d97706" />
            <span>{isReorderResultUncertain ? 'Não foi possível confirmar a reordenação' : 'Não foi possível reordenar a etapa'}</span>
          </div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            {reorderActivityError}
          </p>
        </div>
      )}

      {/* Banner de Indisponibilidade Remota das Migrações 020-023 */}
      {remoteError && (
        <div
          id="banner-backend-unavailability"
          className="card"
          style={{
            borderLeft: '4px solid #f59e0b',
            background: '#fffbeb',
            color: '#92400e',
            marginBottom: '1.25rem',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertCircle size={20} color="#d97706" />
            <span>Indisponibilidade de Serviços de Planejamento no Supabase</span>
          </div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            {remoteError}
          </p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#b45309' }}>
            As tabelas ou RPCs das migrações 020 a 023 ainda não estão disponíveis no banco. A interface está em modo de visualização segura; novos eventos ou rascunhos não serão gravados localmente como falso sucesso.
          </p>
          {reloadRemoteData && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={reloadRemoteData}
              disabled={remoteLoading}
              style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              {remoteLoading ? 'Verificando conexão...' : 'Tentar reconectar'}
            </button>
          )}
        </div>
      )}

      {isTeamsStatusBlocking && (
        <div
          id="notice-teams-load-status"
          className="card"
          style={{
            borderLeft: '4px solid #3b82f6',
            background: '#eff6ff',
            color: '#1e3a8a',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <Info size={18} color="#2563eb" />
            <span>
              {isTeamsCheckingForCreate
                ? 'Carregando equipes da igreja para verificar sua liderança...'
                : 'Não foi possível carregar as equipes da igreja para verificar sua liderança.'}
            </span>
          </div>
          {reloadRemoteData && (
            <button
              type="button"
              id="btn-reload-teams-status"
              className="btn btn-secondary"
              onClick={reloadRemoteData}
              disabled={remoteLoading}
              style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              {remoteLoading ? 'Recarregando...' : 'Recarregar equipes'}
            </button>
          )}
        </div>
      )}

      {membersLoadStatus === 'failed' && (
        <div
          id="notice-members-load-failed"
          className="card"
          style={{
            borderLeft: '4px solid #f59e0b',
            background: '#fffbeb',
            color: '#92400e',
            marginBottom: '1rem',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertTriangle size={18} color="#d97706" />
            <span>Não foi possível carregar os nomes dos membros. Responsáveis podem aparecer como 'Responsável não identificado'.</span>
          </div>
        </div>
      )}

      {pendingCreateEvent && !createEventModalOpen && (
        <div
          id="banner-pending-create-event"
          className="card"
          style={{
            borderLeft: '4px solid #d97706',
            background: '#fffbeb',
            color: '#92400e',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertTriangle size={20} color="#d97706" />
            <span>Tentativa anterior de criação sem confirmação do servidor</span>
          </div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            Não é possível saber se a tentativa anterior foi gravada. Repetir consulta o servidor e, se ela não tiver sido gravada, será gravada com os dados abaixo:
          </p>
          <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', fontWeight: 600 }}>
            {pendingCreateEvent.summary?.title} — {pendingCreateEvent.summary?.type} ({pendingCreateEvent.summary?.date} às {pendingCreateEvent.summary?.scheduledStartTime})
          </p>
          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              id="btn-retry-pending-create-event"
              className="btn btn-primary"
              onClick={handleRetryPendingCreateEvent}
              disabled={isCreatingEvent}
            >
              {isCreatingEvent ? 'Consultando servidor...' : 'Repetir tentativa anterior'}
            </button>
          </div>
        </div>
      )}

      {(!event || events.length === 0) ? (
        <div className="card" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
          <Calendar size={48} color="var(--primary)" style={{ margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Nenhum Culto Cadastrado</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '500px', margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
            {isTeamsStatusBlocking
              ? 'Aguardando o carregamento das equipes da igreja para confirmar quem pode cadastrar novas edições.'
              : canCreateEvent
                ? 'Não existem edições de culto cadastradas para esta igreja. Clique abaixo para cadastrar a primeira edição e iniciar o planejamento litúrgico.'
                : 'Não existem edições de culto cadastradas para esta igreja no momento. O cronograma litúrgico estará disponível assim que a liderança cadastrar o culto.'}
          </p>
          {canCreateEvent && (
            <button
              type="button"
              id="btn-open-create-event-modal"
              className="btn btn-primary"
              onClick={handleOpenCreateEventModal}
              disabled={isControlsDisabled || isTeamsStatusBlocking}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto' }}
            >
              <Plus size={16} /> Nova Edição de Culto
            </button>
          )}
        </div>
      ) : (
        <>
          {/* SELETOR DE EDIÇÕES DE CULTO E NOVA EDIÇÃO (PRD §5 / Issue #28) */}
          <div className="card" id="planning-event-selector-bar" style={{ padding: '16px 20px', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Calendar size={18} color="var(--primary)" />
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)' }}>
              Edição do Culto Selecionada (Issue #28)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
              <select
                id="select-current-event"
                className="form-select"
                value={event.id}
                onChange={e => selectEvent(e.target.value)}
                style={{ fontWeight: 600, minWidth: '260px' }}
                disabled={isControlsDisabled}
              >
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} ({ev.date} às {ev.scheduledStartTime})
                  </option>
                ))}
              </select>

              <span className="badge badge-secondary" id="badge-event-timezone" style={{ fontSize: '12px' }}>
                Fuso: {event.timezone || church?.timezone || 'America/Sao_Paulo'}
              </span>

              <span className={`badge ${event.programStatus === 'published' ? 'badge-primary' : 'badge-pending'}`} id="badge-program-status">
                {event.programStatus === 'published'
                  ? `Publicado (v${event.programVersion || 1})`
                  : event.programStatus === 'draft'
                    ? 'Rascunho'
                    : 'Situação da programação não informada pelo servidor'}
              </span>
            </div>
          </div>
        </div>

        <div>
          <button
            type="button"
            id="btn-open-create-event-modal"
            className="btn btn-primary"
            onClick={handleOpenCreateEventModal}
            disabled={!canCreateEvent || isControlsDisabled || isTeamsStatusBlocking}
          >
            <Plus size={15} style={{ marginRight: '6px' }} /> Nova Edição de Culto
          </button>
        </div>
      </div>

      {/* Cabeçalho do Planejamento & Medidor de Duração (PRD 6) */}
      <div className="card planning-header-card">
        <div>
          <div className="tag-row">
            <span className="badge badge-primary">Planejamento Litúrgico (Web)</span>
            <span className="badge badge-pending">Sequência Principal</span>
          </div>
          <h1 className="planning-title">Planejamento da Ordem & Duração do Culto</h1>
          <p className="planning-subtitle">
            Estruture a sequência litúrgica, músicas e escalas nominais. Serviços paralelos (transmissão/som)
            e componentes simultâneos do louvor não duplicam a duração (PRD 6 & Cenário M25).
          </p>
        </div>

        {/* MEDIDOR E POLÍTICAS DE DURAÇÃO (PRD 6, Issues #29 e #30) */}
        <div className="duration-gauge-box">
          <div className="gauge-row">
            <div className="gauge-item">
              <span className="gauge-label">Previsto para o Culto:</span>
              <span className="gauge-val">{availableDurationMinutes || event.plannedDurationMinutes} min</span>
            </div>
            <div className="gauge-item">
              <span className="gauge-label">Soma da Sequência:</span>
              <span className={`gauge-val ${durationOverflowMinutes > 0 ? 'text-warning' : 'text-success'}`}>
                {totalPlannedDurationMinutes} min
              </span>
            </div>
            <div className="gauge-item">
              <span className="gauge-label">Saldo de Duração:</span>
              <span className={`gauge-val ${durationOverflowMinutes > 0 ? 'text-danger' : 'text-success'}`}>
                {durationOverflowMinutes > 0 ? `+${durationOverflowMinutes} min (Excesso)` : `${remainingDurationMinutes ?? (event.plannedDurationMinutes - totalPlannedDurationMinutes)} min livres`}
              </span>
            </div>
          </div>

          {/* Configuração da Política de Duração (Issue #30 CA02-CA04) */}
          <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Política de Duração:</span>
              <select
                id="select-duration-policy"
                className="form-select form-select-sm"
                value={event.durationPolicy === null ? '' : (event.durationPolicy || 'warn')}
                onChange={e => { if (e.target.value) handleChangeDurationPolicy(e.target.value); }}
                disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
                style={{ fontSize: '12px', padding: '4px 8px' }}
              >
                {event.durationPolicy === null && (
                  <option value="">Não informada pelo servidor — selecione para definir</option>
                )}
                <option value="warn">Modo Alerta (warn) — Permite salvar e publicar com excesso</option>
                <option value="block">Modo Bloqueio (block) — Bloqueia publicação se houver excesso</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                id="btn-save-program-draft"
                className="btn btn-sm btn-secondary"
                onClick={handleSaveDraft}
                disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
              >
                <Save size={13} style={{ marginRight: '4px' }} /> Salvar Rascunho
              </button>

              <button
                type="button"
                id="btn-publish-program"
                className="btn btn-sm btn-primary"
                onClick={handlePublishProgram}
                disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled || isPublicationBlockedByDuration}
                title={isPublicationBlockedByDuration ? 'Ajuste a duração da sequência principal antes de publicar.' : undefined}
              >
                <Send size={13} style={{ marginRight: '4px' }} /> Publicar Programação
              </button>
            </div>
          </div>

          {/* Alertas e Mensagens de Publicação */}
          {publishError && (
            <div id="msg-publish-error" className="alert alert-danger" style={{ marginTop: '10px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', borderRadius: 'var(--radius-sm)' }}>
              <AlertTriangle size={15} />
              <span>{publishError}</span>
            </div>
          )}

          {publishFeedback && (
            <div id="msg-publish-feedback" className="alert alert-success" style={{ marginTop: '10px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', borderRadius: 'var(--radius-sm)' }}>
              <Check size={15} />
              <span>{publishFeedback}</span>
            </div>
          )}

          {durationOverflowMinutes > 0 && !publishError && (
            <div id="msg-publish-warning" className="ignorable-overflow-banner" style={{ marginTop: '10px' }}>
              <AlertTriangle size={15} color="#fbbf24" />
              <span>
                {event.durationPolicy === null ? (
                  <>
                    <strong>Excesso de duração:</strong> A programação excede o culto em {durationOverflowMinutes} min.
                    A política de duração deste culto não foi informada pelo servidor; a publicação será aceita ou recusada conforme a política gravada nele.
                  </>
                ) : event.durationPolicy === 'block' ? (
                  <>
                    <strong>Bloqueio de Publicação (PRD 6 / M49 & Issue #30 CA03):</strong> A programação excede o culto em {durationOverflowMinutes} min.
                    No modo de bloqueio, você pode salvar rascunhos, mas a publicação só é permitida após ajustar a sequência principal.
                  </>
                ) : (
                  <>
                    <strong>Alerta Ignorável (PRD 6 / M26 & Issue #30 CA02):</strong> A programação excede o culto em {durationOverflowMinutes} min.
                    Você pode salvar e publicar normalmente sem exigir aprovação ou justificativa.
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SELETOR DE MODELO REUTILIZÁVEL (PRD §5 / M28 - Issue #27) */}
      <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', display: 'block', marginBottom: '2px' }}>
              Modelo Reutilizável de Culto (PRD §5 / #27)
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Carregue a estrutura padrão com atividades e apoios técnicos (portaria/transmissão) sem alocação automática de pessoas (CA03).
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <select
              id="select-service-template"
              className="form-select"
              value={selectedTemplateId}
              onChange={e => setSelectedTemplateId(e.target.value)}
              style={{ minWidth: '240px' }}
              disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
            >
              <option value="">-- Selecionar Modelo de Culto --</option>
              {serviceTemplates.filter(t => t.active !== false).map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.activities?.length || 0} etapas)
                </option>
              ))}
            </select>

            <button
              type="button"
              id="btn-apply-service-template"
              className="btn btn-secondary"
              onClick={handleApplyTemplate}
              disabled={!selectedTemplateId || (!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
            >
              Aplicar Modelo ao Culto
            </button>
          </div>
        </div>

        {templateFeedback && (
          <div
            id="template-feedback-banner"
            style={{
              marginTop: '10px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              fontWeight: 500,
              background: typeof templateFeedback === 'object' && templateFeedback?.type === 'warning'
                ? '#fffbeb'
                : typeof templateFeedback === 'object' && templateFeedback?.type === 'error'
                  ? 'rgba(239, 68, 68, 0.12)'
                  : 'rgba(16, 185, 129, 0.12)',
              border: `1px solid ${
                typeof templateFeedback === 'object' && templateFeedback?.type === 'warning'
                  ? '#fcd34d'
                  : typeof templateFeedback === 'object' && templateFeedback?.type === 'error'
                    ? 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(16, 185, 129, 0.3)'
              }`,
              color: typeof templateFeedback === 'object' && templateFeedback?.type === 'warning'
                ? '#92400e'
                : typeof templateFeedback === 'object' && templateFeedback?.type === 'error'
                  ? '#ef4444'
                  : '#10b981'
            }}
          >
            {typeof templateFeedback === 'object' && templateFeedback?.type === 'warning' ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <AlertTriangle size={16} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  {templateFeedback.title && <div style={{ fontWeight: 700, marginBottom: '2px' }}>{templateFeedback.title}</div>}
                  <div>{templateFeedback.message}</div>
                </div>
              </div>
            ) : typeof templateFeedback === 'object' && templateFeedback?.type === 'error' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0 }} />
                <div>{templateFeedback.message}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
                <div>{typeof templateFeedback === 'string' ? templateFeedback : templateFeedback?.message}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Barra de Ações & Lista de Atividades */}
      <div className="planning-actions-bar">
        <div className="actions-left">
          <h2>Etapas Planejadas ({event.activities.length})</h2>
        </div>

        <button
          id="btn-open-new-activity-modal"
          className="btn btn-primary"
          onClick={openNewActivityModal}
          disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
        >
          <Plus size={16} /> Adicionar Nova Etapa Litúrgica
        </button>
      </div>

      {/* Aviso exato sobre o que é gravado no servidor (Issue #29) */}
      {isRemoteConfigured && (
        <div
          id="notice-event-items-persistence"
          style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 'var(--radius-sm)', fontSize: '12px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}
        >
          <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>{EVENT_ITEMS_PERSISTENCE_NOTICE}</span>
        </div>
      )}

      <div className="planning-activities-list">
        {event.activities.map((act, index) => {
          const responsibleName = members?.find(m => m.id === act.responsibleMemberId)?.name || 'Responsável não identificado';
          return (
          <div key={act.id} className="card planning-activity-card">
            <div className="planning-act-left">
              <span className="act-index-pill">{index + 1}</span>
              <div>
                <div className="act-header-tags">
                  <span className="badge badge-primary">{act.category}</span>
                  <span className="act-duration-tag">
                    <Clock size={13} /> {act.plannedDurationMinutes} minutos
                  </span>
                  {act.requiresPlayback && (
                    <span className="badge badge-pending">
                      <Radio size={12} /> Requer Playback (Avisa Sonoplastia)
                    </span>
                  )}
                </div>
                <h3 className="planning-act-title">{act.title}</h3>
                {act.responsibleMemberId ? (
                  <div className="planning-act-meta">
                    Direção no altar: <strong>{responsibleName}</strong>
                  </div>
                ) : null}
                {act.notes && <p className="planning-notes-text">"{act.notes}"</p>}
              </div>
            </div>

            {/* Seção de Músicas & Escalas */}
            <div className="planning-act-right">
              {/* Ficha Musical (PRD 9.1) */}
              <div className="musics-planning-box">
                <div className="sec-small-title">
                  <span>Músicas Cadastradas ({act.musics?.length || 0})</span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setTargetActivityForMusic(act);
                      setSongName('');
                      setSongArtist('');
                      setSongKey('G');
                      setSongYoutube('');
                      setSongNotes('');
                      setMusicModalOpen(true);
                    }}
                    disabled={isControlsDisabled}
                  >
                    <Plus size={12} /> Adicionar Música
                  </button>
                </div>

                {act.musics && act.musics.length > 0 ? (
                  <div className="mini-music-chips">
                    {act.musics.map(m => (
                      <div key={m.id} className="planning-music-chip">
                        <div>
                          <strong>{m.name}</strong> • Tom {m.key} ({m.artist})
                        </div>
                        {m.youtubeUrl && (
                          <a href={m.youtubeUrl} target="_blank" rel="noreferrer" className="chip-link">
                            YouTube ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-music-hint">Nenhuma música vinculada.</div>
                )}
              </div>

              {/* Botões de Ação da Etapa */}
              <div className="act-manage-buttons">
                {/* Botões de Reordenação Litúrgica (Issue #29, CA01) */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    id={`btn-move-up-${act.id}`}
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleMoveActivity(act.id, 'up')}
                    disabled={index === 0 || (!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled || isReorderingActivity}
                    title="Mover para cima (Issue #29 CA01)"
                    style={{ padding: '4px 8px' }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    id={`btn-move-down-${act.id}`}
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleMoveActivity(act.id, 'down')}
                    disabled={index === event.activities.length - 1 || (!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled || isReorderingActivity}
                    title="Mover para baixo (Issue #29 CA01)"
                    style={{ padding: '4px 8px' }}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>

                <button
                  type="button"
                  id={`btn-edit-activity-${act.id}`}
                  className="btn btn-sm btn-secondary"
                  onClick={() => openEditActivityModal(act)}
                  disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
                >
                  <Edit size={13} /> Editar
                </button>

                <button
                  type="button"
                  id={`btn-remove-activity-${act.id}`}
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleRemoveActivity(act.id)}
                  disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled || isDeletingActivity}
                  title="Excluir etapa litúrgica"
                  style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                >
                  <Trash2 size={13} /> Excluir
                </button>

                {/* Botão de Demonstração de Conflito Litúrgico (PRD 5.2 / Cenário M22) */}
                {act.category === "Louvor" && (
                  <button
                    className="btn btn-sm btn-warning"
                    onClick={() => simulateAssignVolunteer(act.id, "beatriz", "Louvor - Canto")}
                    title="Simula tentar escalar Beatriz (já na Dança) para Canto no mesmo louvor (Cenário M22)"
                  >
                    Testar Conflito (M22)
                  </button>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* SEÇÃO DE SERVIÇOS PARALELOS E APOIOS DA EDIÇÃO (PRD §5, §7.7, M28 & CA01, CA02) */}
      <div className="card" id="section-parallel-services" style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 4px 0' }}>
              Serviços Paralelos & Apoios Técnicos desta Edição ({event.parallelServices?.length || 0})
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
              Acompanham os marcos do culto (início e término) sem cronômetro próprio. Conforme o <strong>PRD §5 e CA02</strong>,
              retirar a transmissão ou outro apoio desta edição específica não altera o modelo nem outros eventos.
            </p>
            {isRemoteConfigured && (
              <p id="notice-parallel-services-not-persisted" style={{ fontSize: '12px', color: '#92400e', margin: '6px 0 0 0', fontWeight: 600 }}>
                {PARALLEL_SERVICES_PERSISTENCE_NOTICE}
              </p>
            )}
          </div>
          <div>
            <button
              type="button"
              id="btn-open-new-parallel-service-modal"
              className="btn btn-sm btn-primary"
              onClick={openNewParallelModal}
              disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
            >
              <Plus size={13} style={{ marginRight: '4px' }} /> Adicionar Apoio Paralelo
            </button>
          </div>
        </div>

        {/* SINAIS DE CONFLITO DE ESCALA COM PREPARAÇÃO ANTECEDENTE (PRD §5.2, M24, M50 & Issue #29 CA03, CA04) */}
        {editionScaleConflicts.length > 0 && (
          <div
            id="panel-edition-scale-conflicts"
            style={{
              padding: '12px 16px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 'var(--radius-md)',
              marginBottom: '16px',
              color: '#92400e',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <AlertTriangle size={16} color="#d97706" />
              <strong style={{ fontSize: '13px' }}>
                Sinais de Conflito de Escala na Edição ({editionScaleConflicts.length})
              </strong>
            </div>
            <p style={{ fontSize: '12px', margin: '0 0 8px 0', color: '#78350f' }}>
              Conforme o <strong>PRD §5.2, Cenários M24, M50 e Issue #29 (CA03/CA04)</strong>: A preparação antecedente
              integra a janela de ocupação para detecção de conflitos. Os avisos abaixo são <strong>sinais informativos</strong>:
              não bloqueiam a escala nem realizam substituições automáticas de pessoas.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {editionScaleConflicts.map((conf, idx) => (
                <div
                  key={`conf-${conf.memberId}-${idx}`}
                  id={`scale-conflict-row-${conf.memberId}`}
                  style={{
                    padding: '8px 12px',
                    background: '#ffffff',
                    border: '1px solid #fef3c7',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <strong>Quem:</strong> <span className="conflict-member-name">{conf.memberName}</span>
                  </div>
                  <div>
                    <strong>Apoio / Serviço:</strong> <span className="conflict-service-name">{conf.serviceName}</span>
                    {conf.prepRequiredMinutes > 0 && ` (preparação antecedente: ${conf.prepRequiredMinutes} min)`}
                  </div>
                  <div>
                    <strong>Outro compromisso:</strong> <span className="conflict-other-name">{conf.otherName}</span>
                  </div>
                  <div>
                    <strong>Intervalo conflitante:</strong> <span className="conflict-interval">{conf.interval}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {scaleSignalNotice && (
          <div
            id="banner-scale-signal-notice"
            style={{
              padding: '10px 14px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 'var(--radius-md)',
              marginBottom: '16px',
              fontSize: '12px',
              color: '#1e40af',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{scaleSignalNotice}</span>
            <button
              type="button"
              onClick={() => setScaleSignalNotice('')}
              style={{ background: 'transparent', border: 'none', color: '#1e40af', cursor: 'pointer', fontWeight: 'bold' }}
            >
              ✕
            </button>
          </div>
        )}

        {(!event.parallelServices || event.parallelServices.length === 0) ? (
          <div style={{ padding: '16px', background: 'var(--bg-inset)', borderRadius: 'var(--radius-md)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            Nenhum apoio técnico ou serviço paralelo ativo nesta edição de culto.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {event.parallelServices.map(serv => (
              <div
                key={serv.id}
                style={{
                  padding: '14px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, margin: 0 }}>{serv.name}</h3>
                  <span className="badge badge-secondary" style={{ fontSize: '11px' }}>{serv.teamId}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Tempo de preparação: <strong>{serv.prepRequiredMinutes || 0} min</strong> antes do culto (Issue #29 CA03)
                </div>
                {(() => {
                  const plannedStart = event?.plannedStartAt || event?.planned_start_at;
                  const plannedEnd = event?.plannedEndAt || event?.planned_end_at;
                  const servWindow = calculateParallelServiceWindow(plannedStart, plannedEnd, serv.prepRequiredMinutes);
                  if (!servWindow) {
                    return (
                      <div className="parallel-service-occupancy-window" style={{ fontSize: '12px', color: '#b45309' }}>
                        Janela de ocupação não calculável por falta de horário previsto do evento.
                      </div>
                    );
                  }
                  const tz = event?.timezone || church?.timezone || 'America/Sao_Paulo';
                  const fmtOptions = { hour: '2-digit', minute: '2-digit' };
                  if (tz) {
                    try { fmtOptions.timeZone = tz; } catch { /* fallback */ }
                  }
                  const startFmt = new Date(servWindow.prepStartAt).toLocaleTimeString('pt-BR', fmtOptions);
                  const endFmt = new Date(servWindow.eventEndAt).toLocaleTimeString('pt-BR', fmtOptions);
                  return (
                    <div className="parallel-service-occupancy-window" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      <strong>Ocupação:</strong> {startFmt}–{endFmt}
                      {serv.prepRequiredMinutes > 0 ? ` (inclui ${serv.prepRequiredMinutes} min de preparação antes do culto)` : ''}
                    </div>
                  );
                })()}
                {serv.prepRequiredMinutes > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>
                    Intervalo ocupado nos conflitos: preparação antecedente integrada à janela do culto.
                  </div>
                )}
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Voluntários escalados: <strong>{serv.volunteers?.length || 0}</strong> (preenchimento nominal)
                </div>
                {(() => {
                  const servConflicts = editionScaleConflicts.filter(
                    c => (c.sourceId && c.sourceId === serv.id) ||
                         (c.serviceId && c.serviceId === serv.id) ||
                         (c.c1SourceId && c.c1SourceId === serv.id) ||
                         (c.c2SourceId && c.c2SourceId === serv.id) ||
                         c.serviceName === serv.name ||
                         c.otherName === serv.name
                  );
                  if (servConflicts.length === 0) return null;
                  return (
                    <div
                      className="service-conflict-warning"
                      style={{
                        padding: '8px 10px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '11px',
                        color: '#92400e',
                        lineHeight: '1.4',
                      }}
                    >
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                        <AlertTriangle size={12} color="#d97706" /> Sinal de Conflito de Escala:
                      </div>
                      {servConflicts.map((sc, scIdx) => {
                        const otherLabel = sc.c1SourceId === serv.id ? sc.c2Window?.name
                                         : sc.c2SourceId === serv.id ? sc.c1Window?.name
                                         : (sc.otherName === serv.name ? sc.serviceName : sc.otherName);
                        return (
                          <div key={scIdx} className="service-conflict-item">
                            <strong>{sc.memberName}</strong>: sobreposição com {otherLabel} ({sc.interval})
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                  <button
                    type="button"
                    id={`btn-edit-parallel-service-${serv.id}`}
                    className="btn btn-sm btn-secondary"
                    onClick={() => openEditParallelModal(serv)}
                    disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
                    style={{ fontSize: '11px' }}
                    title="Editar apoio paralelo"
                  >
                    <Edit size={12} style={{ marginRight: '4px' }} /> Editar
                  </button>

                  <button
                    type="button"
                    id={`btn-test-prep-conflict-${serv.teamId || serv.id}`}
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      simulateAssignVolunteer('act-2', serv.volunteers?.[0] || 'lucas', 'Louvor - Canto');
                    }}
                    style={{ fontSize: '11px' }}
                    title="Testa conflito de voluntário deste apoio no louvor (CA03/CA04)"
                  >
                    Testar Conflito (CA03)
                  </button>

                  <button
                    type="button"
                    id={`btn-remove-parallel-service-${serv.teamId || serv.id}`}
                    className="btn btn-sm btn-secondary"
                    onClick={() => removeParallelServiceFromCurrentEvent(serv.id)}
                    disabled={(!isLiturgyLeader && !isAdmin) || isProgramMutationsDisabled}
                    style={{ color: '#ef4444', fontSize: '11px' }}
                    title="Retira este serviço apenas desta edição de culto (PRD CA02)"
                  >
                    <Trash2 size={12} style={{ marginRight: '4px' }} /> Retirar Desta Edição (CA02)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE ATIVIDADE */}
      {activityModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">
                {editingActivityId ? 'Editar Etapa Litúrgica' : 'Nova Etapa Litúrgica'}
              </h3>
              <button className="close-btn" onClick={() => setActivityModalOpen(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Preencher a partir de Atividade Padrão:</label>
              <select
                id="select-standard-activity-template"
                className="form-select"
                onChange={e => {
                  const selected = standardActivities.find(a => a.id === e.target.value);
                  if (selected) {
                    setFormTitle(selected.name);
                    setFormDuration(selected.defaultDurationMinutes);
                    if (selected.category) setFormCategory(selected.category);
                    if (selected.description && !formNotes) setFormNotes(selected.description);
                  }
                }}
                defaultValue=""
              >
                <option value="">-- Selecione uma atividade padrão ou digite livremente --</option>
                {standardActivities
                  .filter(a => a.active !== false)
                  .map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.defaultDurationMinutes} min • {a.category || 'Liturgia'})
                    </option>
                  ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Título da Atividade:</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Cânticos Congregacionais"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Categoria / Bloco:</label>
                <select
                  className="form-select"
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                >
                  <option value="Liturgia">Liturgia</option>
                  <option value="Louvor">Louvor & Adoração</option>
                  <option value="Música Especial">Música Especial / Solo</option>
                  <option value="Mensagem">Mensagem da Palavra</option>
                  <option value="Oração">Oração / Apelo</option>
                  <option value="Avisos">Comunicação e Avisos</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Duração Planejada (Minutos):</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max="120"
                  value={formDuration}
                  onChange={e => setFormDuration(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Responsável pela Direção no Altar:</label>
              <select
                className="form-select"
                value={formResponsible}
                onChange={e => setFormResponsible(e.target.value)}
              >
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.teams.join(', ')})</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Observações / Orientações:</label>
              <textarea
                className="form-textarea"
                rows="2"
                placeholder="Orientações aos voluntários..."
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
              ></textarea>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={formRequiresPlayback}
                  onChange={e => setFormRequiresPlayback(e.target.checked)}
                />
                <span><strong>Requer Playback de Apoio</strong> (Dispara aviso automático para a Sonoplastia, PRD 9.2)</span>
              </label>
            </div>

            {editingActivityId && isRemoteConfigured && (
              <div id="notice-activity-edit-local" style={{ marginBottom: '12px', padding: '8px 12px', fontSize: '12px', background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: '6px' }}>
                Ao salvar uma etapa já sincronizada, título, duração e responsável são gravados no servidor. Em etapas ainda locais, as alterações permanecem somente nesta sessão. Categoria, observações e playback também permanecem somente nesta sessão.
              </div>
            )}

            {activityError && (
              <div id="msg-activity-error" className="alert alert-danger" style={{ marginBottom: '12px', padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{activityError}</span>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActivityModalOpen(false)}>
                Cancelar
              </button>
              <button id="btn-save-activity" className="btn btn-primary" onClick={handleSaveActivity} disabled={isSavingActivity || isProgramMutationsDisabled}>
                {isSavingActivity ? 'Gravando etapa...' : 'Salvar Etapa no Planejamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ADICIONAR MÚSICA (PRD 9.1 & Cenário M30) */}
      {musicModalOpen && targetActivityForMusic && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Ficha Simples de Música — {targetActivityForMusic.title}</h3>
              <button className="close-btn" onClick={() => setMusicModalOpen(false)}>✕</button>
            </div>

            <p className="modal-desc">
              Cadastre nome, intérprete de referência, tom de execução e URL do YouTube (PRD 9.1).
              A miniatura é exibida automaticamente se disponível; na indisponibilidade, o link e título continuam funcionais (M30).
            </p>

            <div className="form-group">
              <label className="form-label">Nome da Música:</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Bondade de Deus"
                value={songName}
                onChange={e => setSongName(e.target.value)}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Cantor / Intérprete de Referência:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: Isaías Saad"
                  value={songArtist}
                  onChange={e => setSongArtist(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tom Escolhido para o Culto:</label>
                <select
                  className="form-select"
                  value={songKey}
                  onChange={e => setSongKey(e.target.value)}
                >
                  {["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B", "Em", "Am", "Dm"].map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">URL do YouTube:</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={songYoutube}
                onChange={e => setSongYoutube(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Observação Curta de Arranjo / Dinâmica:</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Entrar suave com teclado e violão..."
                value={songNotes}
                onChange={e => setSongNotes(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMusicModalOpen(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSaveMusic}>
                Vincular Música ao Bloco
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE INTERCEPTAÇÃO DE CONFLITO LITÚRGICO (PRD 5.2 & Cenário M22) */}
      {conflictModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} /> Bloqueio de Conflito de Escala (PRD 5.2)
              </h3>
              <button className="close-btn" onClick={() => setConflictModalOpen(false)}>✕</button>
            </div>

            <div className="error-banner">
              {conflictData.reason}
            </div>

            <p className="modal-desc">
              Conforme o <strong>PRD 5.2 (Cenário M22)</strong>: Ao tentar escalar alguém para cantar no louvor quando já está
              na dança, o sistema <strong>bloqueia essa alocação</strong>, explica o impedimento e lista os habilitados
              para cantar sem conflito na escala.
            </p>

            <div className="sugg-header">
              <Info size={14} color="var(--primary)" />
              <span>Candidatos habilitados sem conflito conhecido na escala:</span>
            </div>

            <div className="eligible-candidates-list">
              {conflictData.candidates.length > 0 ? (
                conflictData.candidates.map(cand => (
                  <div key={cand.id} className="candidate-card-row">
                    <img src={cand.avatar} alt={cand.name} className="cand-avatar" />
                    <div className="cand-info">
                      <div className="cand-name">{cand.name}</div>
                      <div className="cand-skills">Aptidões: {cand.skills.join(', ')}</div>
                    </div>
                    <span className="badge badge-primary">Apto e Livre</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Nenhum outro candidato com essa aptidão encontrado no cadastro.
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setConflictModalOpen(false)}>
                Entendido, Manter Regra Litúrgica
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CRIAÇÃO DE NOVA EDIÇÃO DE CULTO (Issue #28, CA01 a CA04) */}
      {createEventModalOpen && (
        <div className="modal-overlay" id="modal-create-event">
          <div className="modal-content" style={{ maxWidth: '580px' }}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Calendar size={18} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'middle', color: 'var(--primary)' }} />
                Criar Nova Edição de Culto (Issue #28)
              </h3>
              <button className="close-btn" onClick={() => setCreateEventModalOpen(false)}>✕</button>
            </div>

            {createEventError && (
              <div className="alert alert-danger" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px' }}>
                <AlertTriangle size={16} />
                <span>{createEventError}</span>
              </div>
            )}

            {createEventSuccess && (
              <div className="alert alert-success" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '6px' }}>
                <Check size={16} />
                <span>{createEventSuccess}</span>
              </div>
            )}

            {createEventWarning && (
              <div id="msg-create-event-warning" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: '6px' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{createEventWarning}</span>
              </div>
            )}

            {pendingCreateEvent && (
              <div
                id="banner-pending-create-event"
                style={{ marginBottom: '14px', padding: '10px 12px', fontSize: '13px', background: '#fffbeb', border: '1px solid #f59e0b', color: '#92400e', borderRadius: '6px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                  <AlertTriangle size={16} />
                  <span>Tentativa anterior sem confirmação do servidor</span>
                </div>
                <p style={{ margin: '6px 0 0 0' }}>
                  Não é possível saber se a tentativa anterior foi gravada. Repetir consulta o servidor e, se ela não tiver sido gravada, será gravada com os dados abaixo:
                </p>
                <p style={{ margin: '4px 0 0 0', fontWeight: 600 }}>
                  {pendingCreateEvent.summary?.title} — {pendingCreateEvent.summary?.type} ({pendingCreateEvent.summary?.date} às {pendingCreateEvent.summary?.scheduledStartTime})
                </p>
                <button
                  type="button"
                  id="btn-retry-pending-create-event"
                  className="btn btn-primary"
                  onClick={handleRetryPendingCreateEvent}
                  disabled={isCreatingEvent}
                  style={{ marginTop: '8px' }}
                >
                  {isCreatingEvent ? 'Consultando servidor...' : 'Repetir tentativa anterior'}
                </button>
              </div>
            )}

            <form onSubmit={handleCreateEventEditionSubmit}>
              <div className="form-group">
                <label className="form-label">Título da Edição do Culto:</label>
                <input
                  type="text"
                  id="event-title"
                  className="form-input"
                  placeholder="Ex: Culto de Celebração de Domingo Noite"
                  value={newEventTitle}
                  onChange={e => setNewEventTitle(e.target.value)}
                  maxLength={200}
                  required
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Tipo de Evento:</label>
                  <select
                    id="event-type"
                    className="form-select"
                    value={newEventType}
                    onChange={e => setNewEventType(e.target.value)}
                  >
                    {eventTypes.map(t => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    ))}
                    {eventTypes.length === 0 && isRemoteConfigured && (
                      <option value="">-- Nenhum tipo de evento cadastrado --</option>
                    )}
                    {eventTypes.length === 0 && !isRemoteConfigured && (
                      <option value="Celebração Geral">Celebração Geral</option>
                    )}
                  </select>
                  {eventTypes.length === 0 && isRemoteConfigured && (
                    <span id="event-type-empty-notice" style={{ fontSize: '11px', color: 'var(--warning, #d97706)', display: 'block', marginTop: '4px' }}>
                      Cadastre ao menos um tipo de evento na Administração antes de criar uma edição.
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Fuso Horário da Igreja:</label>
                  <input
                    type="text"
                    className="form-input"
                    value={church?.timezone || 'America/Sao_Paulo'}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Data e Hora de Início Previsto:</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="date"
                      id="event-start-date"
                      className="form-input"
                      value={newEventStartDate}
                      onChange={e => setNewEventStartDate(e.target.value)}
                      required
                    />
                    <input
                      type="time"
                      id="event-start-time"
                      className="form-input"
                      value={newEventStartTime}
                      onChange={e => setNewEventStartTime(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Data e Hora de Término Previsto:</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="date"
                      id="event-end-date"
                      className="form-input"
                      value={newEventEndDate}
                      onChange={e => setNewEventEndDate(e.target.value)}
                      required
                    />
                    <input
                      type="time"
                      id="event-end-time"
                      className="form-input"
                      value={newEventEndTime}
                      onChange={e => setNewEventEndTime(e.target.value)}
                      required
                    />
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Aceita virada de meia-noite com datas completas (CA01).
                  </span>
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Modelo Reutilizável Inicial (Opcional):</label>
                  <select
                    id="event-template"
                    className="form-select"
                    value={newEventTemplateId}
                    onChange={e => setNewEventTemplateId(e.target.value)}
                  >
                    <option value="">-- Em branco (sem modelo) --</option>
                    {serviceTemplates.filter(t => t.active !== false).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Líder da Liturgia Designado:</label>
                  <select
                    id="event-liturgy-leader"
                    className="form-select"
                    value={isAdmin ? newEventLiturgyLeader : ''}
                    onChange={e => setNewEventLiturgyLeader(e.target.value)}
                    disabled={!isAdmin}
                  >
                    {!isAdmin && <option value="">-- A definir pelo administrador --</option>}
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.roles.join(', ')})
                      </option>
                    ))}
                  </select>
                  {!isAdmin && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Somente administradores podem designar o líder da liturgia. A edição será criada sem dirigente designado (Opção B).
                    </span>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Política de Duração do Culto:</label>
                <select
                  id="event-duration-policy"
                  className="form-select"
                  value={newEventDurationPolicy}
                  onChange={e => setNewEventDurationPolicy(e.target.value)}
                >
                  <option value="warn">Modo Alerta (warn) — Padrão do piloto, permite salvar/publicar com excesso</option>
                  <option value="block">Modo Bloqueio (block) — Impede publicar a programação se exceder a janela</option>
                </select>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setCreateEventModalOpen(false)}>
                  {createEventSuccess ? 'Fechar' : 'Cancelar'}
                </button>
                <button
                  type="submit"
                  id="btn-submit-create-event"
                  className="btn btn-primary"
                  disabled={isCreatingEvent || Boolean(createEventSuccess) || Boolean(pendingCreateEvent) || (isRemoteConfigured && eventTypes.length === 0)}
                >
                  {isCreatingEvent ? 'Criando edição...' : 'Criar Edição de Culto (CA01-CA04)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE APOIO PARALELO */}
      {parallelModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3 className="modal-title">
                {editingParallelId ? 'Editar Apoio Paralelo' : 'Novo Apoio Paralelo'}
              </h3>
              <button className="close-btn" onClick={() => setParallelModalOpen(false)}>✕</button>
            </div>

            {parallelError && (
              <div id="msg-parallel-service-error" className="alert alert-danger" style={{ marginBottom: '12px', padding: '8px 12px', fontSize: '12px' }}>
                <AlertCircle size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                {parallelError}
              </div>
            )}

            <form onSubmit={handleSaveParallel}>
              <div className="form-group">
                <label className="form-label">Título / Serviço:</label>
                <input
                  type="text"
                  id="input-parallel-title"
                  className="form-input"
                  placeholder="Ex: Transmissão ao Vivo, Sonoplastia, Mídia"
                  value={parallelTitle}
                  onChange={e => setParallelTitle(e.target.value)}
                  maxLength={150}
                  required
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Duração Planejada (min):</label>
                  <input
                    type="number"
                    id="input-parallel-duration"
                    className="form-input"
                    value={parallelDuration}
                    onChange={e => setParallelDuration(e.target.value)}
                    min={1}
                    step={1}
                    required
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Maior que zero (minutos)</span>
                </div>

                <div className="form-group">
                  <label className="form-label">Preparação Antecedente (min):</label>
                  <input
                    type="number"
                    id="input-parallel-prep"
                    className="form-input"
                    value={parallelPrepMinutes}
                    onChange={e => setParallelPrepMinutes(e.target.value)}
                    min={0}
                    max={180}
                    step={1}
                    required
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Entre 0 e 180 min</span>
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Equipe Responsável:</label>
                  <select
                    id="select-parallel-team"
                    className="form-select"
                    value={parallelTeamId}
                    onChange={e => setParallelTeamId(e.target.value)}
                  >
                    <option value="">-- Nenhuma / Geral --</option>
                    {(teams || []).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Líder / Responsável:</label>
                  <select
                    id="select-parallel-leader"
                    className="form-select"
                    value={parallelLeaderId}
                    onChange={e => setParallelLeaderId(e.target.value)}
                  >
                    <option value="">-- Selecionar voluntário --</option>
                    {(members || []).map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  id="btn-cancel-parallel-service"
                  className="btn btn-secondary"
                  onClick={() => setParallelModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  id="btn-save-parallel-service"
                  className="btn btn-primary"
                  disabled={isSavingParallel || isProgramMutationsDisabled}
                >
                  {isSavingParallel ? 'Salvando...' : (editingParallelId ? 'Atualizar Apoio' : 'Adicionar Apoio')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .planning-view-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .planning-header-card {
          padding: 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .planning-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .planning-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 650px;
          line-height: 1.5;
        }

        .duration-gauge-box {
          background: var(--bg-inset);
          border: 1px solid var(--border-subtle);
          padding: 16px 20px;
          border-radius: var(--radius-lg);
          min-width: 320px;
        }

        .gauge-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
        }

        .gauge-item {
          display: flex;
          flex-direction: column;
        }

        .gauge-label {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 600;
        }

        .gauge-val {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .ignorable-overflow-banner {
          margin-top: 10px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-sm);
          font-size: 11px;
          color: #fbbf24;
          line-height: 1.4;
        }

        .planning-actions-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-top: 8px;
        }

        .planning-actions-bar h2 {
          font-size: 20px;
          font-weight: 700;
        }

        .planning-activities-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .planning-activity-card {
          padding: 24px;
          display: flex;
          justify-content: space-between;
          gap: 24px;
          flex-wrap: wrap;
        }

        .planning-act-left {
          display: flex;
          gap: 16px;
          flex: 1;
          min-width: 300px;
        }

        .act-index-pill {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--primary-surface);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 14px;
        }

        .act-header-tags {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }

        .act-duration-tag {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .planning-act-title {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .planning-act-meta {
          font-size: 13px;
          color: var(--text-muted);
        }

        .planning-notes-text {
          font-size: 12px;
          color: var(--text-secondary);
          font-style: italic;
          margin-top: 8px;
        }

        .planning-act-right {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 320px;
        }

        .musics-planning-box {
          background: var(--bg-inset);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px;
        }

        .sec-small-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          margin-bottom: 8px;
        }

        .mini-music-chips {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .planning-music-chip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--bg-surface);
          border-radius: var(--radius-sm);
          font-size: 12px;
        }

        .chip-link {
          color: #ef4444;
          text-decoration: none;
          font-weight: 600;
          font-size: 11px;
        }

        .no-music-hint {
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }

        .act-manage-buttons {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }

        .eligible-candidates-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 16px 0;
        }

        .candidate-card-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .cand-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
        }

        .cand-info {
          flex: 1;
        }

        .cand-name {
          font-size: 14px;
          font-weight: 700;
        }

        .cand-skills {
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
