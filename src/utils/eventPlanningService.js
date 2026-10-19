/**
 * eventPlanningService.js
 * Regras de validação, integridade, cálculo de duração e publicação da programação litúrgica.
 * Atende às Issues #28, #29 e #30 e aos critérios do PRD §3.2, §5, §6 e §7.7 (Cenários M05, M06, M24-M26, M28, M47-M50).
 */

export const MAX_TITLE_LENGTH = 200;
export const MIN_TITLE_LENGTH = 1;
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DURATION_POLICIES = ['warn', 'block'];
export const PROGRAM_STATUSES = ['draft', 'published'];
export const MIN_EVENT_DURATION_MINUTES = 1;
export const MAX_EVENT_DURATION_MINUTES = 1440; // 24 horas

/**
 * Normaliza o texto com Unicode NFC e remove espaços nas extremidades (trim).
 */
export function normalizeNfcText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

/**
 * Calcula a duração disponível em minutos a partir de duas datas completas (data + hora).
 * Suporta travessia de meia-noite (CA01 de #28 e PRD §6 / M48).
 * Rejeita fim anterior ou igual ao início.
 */
export function calculateAvailableDurationMinutes(plannedStartAt, plannedEndAt) {
  if (!plannedStartAt || !plannedEndAt) {
    return {
      valid: false,
      minutes: 0,
      error: 'Data/hora de início e término são obrigatórias.'
    };
  }

  const start = new Date(plannedStartAt);
  const end = new Date(plannedEndAt);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {
      valid: false,
      minutes: 0,
      error: 'Formato de data/hora inválido.'
    };
  }

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    return {
      valid: false,
      minutes: 0,
      error: 'Data/hora de término planejada deve ser posterior ao início.'
    };
  }

  const minutes = Math.round(diffMs / (1000 * 60));
  if (minutes < MIN_EVENT_DURATION_MINUTES) {
    return {
      valid: false,
      minutes: 0,
      error: 'A duração mínima do evento deve ser de pelo menos 1 minuto.'
    };
  }

  return {
    valid: true,
    minutes,
    error: null
  };
}

/**
 * Valida os dados de cadastro de uma edição de culto (Issue #28, CA01 a CA04).
 */
export function validateEventEdition(eventData, church = {}, caller = {}) {
  const title = normalizeNfcText(eventData?.title);
  if (!title) {
    return { valid: false, error: 'Título do evento é obrigatório.' };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `Título do evento deve ter no máximo ${MAX_TITLE_LENGTH} caracteres.` };
  }

  const durationCheck = calculateAvailableDurationMinutes(
    eventData?.plannedStartAt,
    eventData?.plannedEndAt
  );
  if (!durationCheck.valid) {
    return { valid: false, error: durationCheck.error };
  }

  // Fuso da igreja (CA02 de #28 e PRD §3.3 / M47)
  const timezone = church?.timezone || DEFAULT_TIMEZONE;

  // Política de duração (Issue #30)
  const durationPolicy = eventData?.durationPolicy || 'warn';
  if (!DURATION_POLICIES.includes(durationPolicy)) {
    return { valid: false, error: "Política de duração inválida. Opções: 'warn' ou 'block'." };
  }

  // Designação da liderança da liturgia (CA03 de #28 e PRD §3.2 / M05, M40)
  // Somente administrador da igreja pode designar/trocar
  const isCallerAdmin = Boolean(
    caller?.roles?.includes('admin') ||
    caller?.isAdmin === true
  );

  if (eventData?.liturgyLeaderId && !isCallerAdmin && caller?.id) {
    return {
      valid: false,
      error: 'Somente o administrador pode designar ou alterar a liderança da liturgia para este evento.'
    };
  }

  return {
    valid: true,
    error: null,
    title,
    timezone,
    plannedDurationMinutes: durationCheck.minutes,
    durationPolicy
  };
}

/**
 * Cria um objeto padronizado de nova edição de culto (Issue #28).
 * Garante que criar o evento não inicia execução nem escala integrantes automaticamente (CA04).
 */
export function createEventEditionObject(eventData, church = {}, caller = {}, initialActivities = [], initialParallelServices = []) {
  const validation = validateEventEdition(eventData, church, caller);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const now = new Date().toISOString();
  const id = eventData?.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startDateStr = new Date(eventData.plannedStartAt).toISOString().split('T')[0];
  const startTimeStr = new Date(eventData.plannedStartAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Assegura que atividades não possuem escalas nominais de voluntários (CA04 de #28 e CA03 de #27)
  const cleanActivities = initialActivities.map((act, idx) => ({
    id: act.id || `act-${Date.now()}-${idx}`,
    title: normalizeNfcText(act.title || act.name || 'Nova Etapa'),
    category: normalizeNfcText(act.category || 'Liturgia'),
    plannedDurationMinutes: parseInt(act.plannedDurationMinutes || act.defaultDurationMinutes, 10) || 10,
    responsibleMemberId: null, // Sem alocação automática (CA04)
    responsibleTeamId: act.responsibleTeamId || act.targetTeamId || null,
    status: 'pendente',
    realStartTime: null,
    realEndTime: null,
    cancellationReason: null,
    notes: normalizeNfcText(act.notes || ''),
    requiresPlayback: Boolean(act.requiresPlayback),
    musics: Array.isArray(act.musics) ? [...act.musics] : [],
    roster: [] // Sem voluntários escalados automaticamente (CA04)
  }));

  // Assegura que apoios paralelos não possuem escalas nominais de voluntários
  const cleanParallelServices = initialParallelServices.map((serv, idx) => ({
    id: serv.id || `serv-${Date.now()}-${idx}`,
    name: normalizeNfcText(serv.name || serv.serviceName || 'Serviço de Apoio'),
    teamId: normalizeNfcText(serv.teamId || 'apoio'),
    leaderId: null, // Sem liderança automática
    volunteers: [], // Sem voluntários escalados automaticamente (CA04)
    status: 'Aguardando culto',
    prepRequiredMinutes: parseInt(serv.prepRequiredMinutes, 10) || 0
  }));

  return {
    id,
    churchId: church?.id || eventData?.churchId || 'church-piloto-01',
    title: validation.title,
    type: normalizeNfcText(eventData?.type || 'Culto'),
    date: startDateStr,
    scheduledStartTime: startTimeStr,
    plannedStartAt: new Date(eventData.plannedStartAt).toISOString(),
    plannedEndAt: new Date(eventData.plannedEndAt).toISOString(),
    timezone: validation.timezone,
    plannedDurationMinutes: validation.plannedDurationMinutes,
    liturgyLeaderId: eventData?.liturgyLeaderId || null,
    durationPolicy: validation.durationPolicy, // 'warn' ou 'block'
    programStatus: 'draft', // 'draft' ou 'published' (CA03 de #30)
    programVersion: 1,
    publishedAt: null,
    publishedByMemberId: null,
    status: 'pronto', // 'pronto', 'em_andamento', 'encerrado' (CA04: não inicia execução)
    realStartTime: null,
    realEndTime: null,
    currentActivityIndex: 0,
    currentActivityStatus: 'pendente',
    activityStartTime: null,
    activityElapsedSeconds: 0,
    inBreak: false,
    breakStartTime: null,
    lastSyncTimestamp: now,
    activities: cleanActivities,
    parallelServices: cleanParallelServices,
    checklist: [],
    internalAlerts: []
  };
}

/**
 * Reordena uma atividade na programação litúrgica (Issue #29, CA01).
 * Permite mover para cima ou para baixo sem alterar outras edições ou o modelo original.
 */
export function reorderEventActivities(activities = [], fromIndex, toIndex) {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  if (fromIndex < 0 || fromIndex >= activities.length) return [...activities];
  if (toIndex < 0 || toIndex >= activities.length) return [...activities];
  if (fromIndex === toIndex) return [...activities];

  const cloned = [...activities];
  const [moved] = cloned.splice(fromIndex, 1);
  cloned.splice(toIndex, 0, moved);
  return cloned;
}

/**
 * Move uma atividade para cima na ordem litúrgica (Issue #29, CA01).
 */
export function moveActivityUp(activities = [], activityId) {
  const index = activities.findIndex(a => a.id === activityId);
  if (index <= 0) return activities;
  return reorderEventActivities(activities, index, index - 1);
}

/**
 * Move uma atividade para baixo na ordem litúrgica (Issue #29, CA01).
 */
export function moveActivityDown(activities = [], activityId) {
  const index = activities.findIndex(a => a.id === activityId);
  if (index === -1 || index >= activities.length - 1) return activities;
  return reorderEventActivities(activities, index, index + 1);
}

/**
 * Calcula os tempos de duração da programação litúrgica (Issue #29 CA02 e Issue #30 CA01).
 * Regras:
 * - Duração disponível deriva da janela prevista (plannedDurationMinutes).
 * - Componentes simultâneos do louvor (canto, instrumentos, dança) compartilham a duração do bloco
 *   e somam apenas uma vez na sequência principal (CA02 de #29 e PRD §6 / M25).
 * - Apoios paralelos (sonoplastia, transmissão, etc.) NÃO somam na sequência principal (CA02 de #29 e PRD §6 / M28).
 * - Retorna disponível, ocupado e excedente.
 */
export function calculateProgramDurations(event) {
  if (!event) {
    return {
      availableMinutes: 0,
      occupiedMinutes: 0,
      overflowMinutes: 0,
      remainingMinutes: 0
    };
  }

  // Duração disponível derivada da janela prevista
  let availableMinutes = event.plannedDurationMinutes;
  if (!availableMinutes && event.plannedStartAt && event.plannedEndAt) {
    const calc = calculateAvailableDurationMinutes(event.plannedStartAt, event.plannedEndAt);
    if (calc.valid) availableMinutes = calc.minutes;
  }
  availableMinutes = availableMinutes || 0;

  // Soma da sequência principal de atividades (ignora apoios paralelos)
  const activities = Array.isArray(event.activities) ? event.activities : [];
  const occupiedMinutes = activities.reduce((sum, act) => {
    // Se a atividade for classificada como apoio paralelo na lista, não soma na sequência principal
    if (act.itemNature === 'parallel_support' || act.isParallelSupport === true) {
      return sum;
    }
    const duration = parseInt(act.plannedDurationMinutes, 10);
    return sum + (!isNaN(duration) && duration > 0 ? duration : 0);
  }, 0);

  const overflowMinutes = Math.max(0, occupiedMinutes - availableMinutes);
  const remainingMinutes = Math.max(0, availableMinutes - occupiedMinutes);

  return {
    availableMinutes,
    occupiedMinutes,
    overflowMinutes,
    remainingMinutes
  };
}

/**
 * Calcula a janela de ocupação de um serviço paralelo com tempo de preparação antecedente (Issue #29, CA03).
 * A preparação pode começar antes do horário previsto de início do culto (PRD §6 e §7.7 / M50).
 */
export function calculateParallelServiceWindow(eventPlannedStartAt, eventPlannedEndAt, prepRequiredMinutes = 0) {
  const start = new Date(eventPlannedStartAt);
  const end = new Date(eventPlannedEndAt);
  const prep = Math.max(0, parseInt(prepRequiredMinutes, 10) || 0);

  const prepStart = new Date(start.getTime() - (prep * 60 * 1000));

  return {
    prepStartAt: prepStart.toISOString(),
    eventStartAt: start.toISOString(),
    eventEndAt: end.toISOString(),
    prepRequiredMinutes: prep,
    totalOccupiedMinutes: Math.round((end.getTime() - prepStart.getTime()) / (1000 * 60))
  };
}

/**
 * Verifica se uma alocação em serviço paralelo ou atividade gera conflito de escala (Issue #29, CA03 e CA04).
 * Sinaliza compromissos e lideranças envolvidas sem substituir pessoas silenciosamente.
 */
export function checkScaleConflictWithParallelPrep(memberId, candidateWindow, event, targetRole = '') {
  if (!memberId || !event) return { hasConflict: false };

  const candStart = new Date(candidateWindow.startAt || candidateWindow.prepStartAt).getTime();
  const candEnd = new Date(candidateWindow.endAt || candidateWindow.eventEndAt).getTime();

  // Verifica se o membro já está alocado em algum serviço paralelo da edição
  const parallelServices = Array.isArray(event.parallelServices) ? event.parallelServices : [];
  for (const serv of parallelServices) {
    const isVol = Array.isArray(serv.volunteers) && serv.volunteers.includes(memberId);
    const isLead = serv.leaderId === memberId;
    if (isVol || isLead) {
      const servWindow = calculateParallelServiceWindow(
        event.plannedStartAt || `${event.date}T${event.scheduledStartTime}:00`,
        event.plannedEndAt || `${event.date}T21:00:00`,
        serv.prepRequiredMinutes
      );
      const servStart = new Date(servWindow.prepStartAt).getTime();
      const servEnd = new Date(servWindow.eventEndAt).getTime();

      // Sobreposição de horários
      if (Math.max(candStart, servStart) < Math.min(candEnd, servEnd)) {
        return {
          hasConflict: true,
          conflictingService: serv.name,
          reason: `Membro já está escalado no apoio '${serv.name}' (ocupação com preparação antecedente das ${new Date(servStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} até ${new Date(servEnd).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}).`
        };
      }
    }
  }

  return { hasConflict: false };
}

/**
 * Validação de publicação da programação conforme a política de duração do evento (Issue #30, CA01 a CA04).
 * - Em 'warn': alerta ignorável se exceder, publicação permitida sem justificativa (CA02).
 * - Em 'block': bloqueia terminantemente publicar se exceder (CA03). Salvar rascunho é sempre permitido.
 */
export function validateProgramPublication(event) {
  const durations = calculateProgramDurations(event);
  const policy = event?.durationPolicy || 'warn';

  if (policy === 'block' && durations.overflowMinutes > 0) {
    return {
      canPublish: false,
      policy: 'block',
      overflowMinutes: durations.overflowMinutes,
      error: `A programação excede a janela do culto em ${durations.overflowMinutes} min. No modo de bloqueio (block), a programação não pode ser publicada até que a duração seja ajustada à janela prevista.`
    };
  }

  if (policy === 'warn' && durations.overflowMinutes > 0) {
    return {
      canPublish: true,
      policy: 'warn',
      overflowMinutes: durations.overflowMinutes,
      warning: `A programação excede o culto em ${durations.overflowMinutes} min. Publicação permitida conforme a política de alerta (warn) do evento.`
    };
  }

  return {
    canPublish: true,
    policy,
    overflowMinutes: 0,
    warning: null,
    error: null
  };
}

/**
 * Publica a programação da edição do evento (Issue #30).
 * Rejeita se estiver em modo 'block' e com duração excedida (CA03).
 */
export function publishEventProgram(event, publishedByMemberId = null) {
  const check = validateProgramPublication(event);
  if (!check.canPublish) {
    throw new Error(check.error);
  }

  const now = new Date().toISOString();
  return {
    ...event,
    programStatus: 'published',
    publishedAt: now,
    publishedByMemberId,
    programVersion: (event.programVersion || 1) + 1,
    lastSyncTimestamp: now
  };
}

/**
 * Salva a programação da edição do evento como rascunho (Issue #30).
 * Sempre permitido em 'warn' e 'block', mesmo com duração excedida (CA02 e CA03).
 */
export function saveEventProgramDraft(event) {
  const now = new Date().toISOString();
  return {
    ...event,
    programStatus: 'draft',
    lastSyncTimestamp: now
  };
}

/**
 * Atualiza a política de duração de um evento existente (Issue #30, CA04).
 * Somente administradores (ou líder da liturgia designado) podem alterar.
 */
export function updateEventDurationPolicy(event, newPolicy, isCallerAuthorized = false) {
  if (!isCallerAuthorized) {
    throw new Error('Somente liderança autorizada (administrador ou líder da liturgia) pode alterar a política de duração do evento.');
  }
  if (!DURATION_POLICIES.includes(newPolicy)) {
    throw new Error("Política de duração inválida. Opções aceitas: 'warn' ou 'block'.");
  }

  return {
    ...event,
    durationPolicy: newPolicy,
    lastSyncTimestamp: new Date().toISOString()
  };
}

/**
 * Mensagem padronizada de erro para planejamento de eventos.
 */
export function eventPlanningErrorMessage(error) {
  if (!error) return 'Ocorreu um erro ao processar o planejamento do evento.';
  const rawMsg = typeof error === 'string' ? error : String(error?.message || '');
  const lower = rawMsg.toLowerCase();
  const code = String(error?.code || '');

  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('abort') ||
    lower.includes('conexão') ||
    lower.includes('offline')
  ) {
    return 'Falha de conexão com o servidor. Verifique sua rede e tente novamente.';
  }

  if (code === 'PGRST202' || lower.includes('could not find the function') || lower.includes('schema cache')) {
    return 'Serviço de planejamento temporariamente indisponível no servidor. Verifique se as migrações foram aplicadas.';
  }

  if (code === '42501' || code === '28000') {
    return 'Permissão insuficiente. Apenas administradores ou líderes da liturgia autorizados podem executar esta ação.';
  }
  if (code === '22000') {
    return error.message || 'Dados inválidos. Verifique as datas, horários e a política de duração do evento.';
  }
  if (code === '22004') {
    return 'Parâmetros obrigatórios ausentes para a operação de evento.';
  }
  if (code === '23503') {
    return 'Referência a membro ou igreja inexistente ou inativa.';
  }
  if (code === 'P0002') {
    return 'Evento litúrgico não encontrado.';
  }
  return error.message || 'Falha na operação de planejamento litúrgico.';
}

/**
 * Utilitário para executar RPCs compatível com versões recentes do cliente Supabase.
 */
async function invokeSupabaseRpc(supabaseClient, rpcName, params = {}) {
  if (!supabaseClient) {
    throw new Error('Cliente Supabase não fornecido.');
  }
  const builder = typeof supabaseClient.schema === 'function'
    ? supabaseClient.schema('public').rpc(rpcName, params)
    : supabaseClient.rpc(rpcName, params);
  return await builder;
}

/**
 * Gera identificador UUIDv4 para idempotência de comandos.
 */
export function generateCommandUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Cria edição concreta de culto no Supabase.
 */
export async function createChurchEventEditionRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventData = {}
) {
  let churchId, commandId, title, eventType, plannedStartAt, plannedEndAt, liturgyLeaderMemberId, durationPolicy;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      title,
      eventType = 'Culto',
      plannedStartAt,
      plannedEndAt,
      liturgyLeaderMemberId = null,
      durationPolicy = 'warn',
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    const d = maybeEventData || {};
    title = d.title;
    eventType = d.eventType || d.event_type || 'Culto';
    plannedStartAt = d.plannedStartAt || d.planned_start_at || (d.event_date && d.start_time ? `${d.event_date}T${d.start_time}:00` : null);
    plannedEndAt = d.plannedEndAt || d.planned_end_at || (d.event_date && d.target_end_time ? `${d.event_date}T${d.target_end_time}:00` : null) || (plannedStartAt ? new Date(new Date(plannedStartAt).getTime() + (d.planned_duration_minutes || 105) * 60000).toISOString() : null);
    liturgyLeaderMemberId = d.liturgyLeaderMemberId || d.liturgy_leader_id || d.liturgyLeaderId || null;
    durationPolicy = d.durationPolicy || d.duration_policy || 'warn';
    commandId = d.commandId;
  }

  if (!churchId) {
    return { success: false, error: 'Identificador da igreja não informado.' };
  }
  const durationCheck = calculateAvailableDurationMinutes(plannedStartAt, plannedEndAt);
  if (!durationCheck.valid) {
    return { success: false, error: durationCheck.error };
  }
  const cleanTitle = normalizeNfcText(title);
  if (!cleanTitle || cleanTitle.length < MIN_TITLE_LENGTH || cleanTitle.length > MAX_TITLE_LENGTH) {
    return { success: false, error: `Título deve ter entre ${MIN_TITLE_LENGTH} e ${MAX_TITLE_LENGTH} caracteres.` };
  }
  const cleanPolicy = durationPolicy ? String(durationPolicy).toLowerCase().trim() : 'warn';
  if (!DURATION_POLICIES.includes(cleanPolicy)) {
    return { success: false, error: "Política de duração inválida. Opções aceitas: 'warn' ou 'block'." };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_church_event_edition', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_title: cleanTitle,
      p_event_type: eventType,
      p_planned_start_at: plannedStartAt,
      p_planned_end_at: plannedEndAt,
      p_liturgy_leader_member_id: liturgyLeaderMemberId || null,
      p_duration_policy: cleanPolicy,
    });
    if (error) {
      return { success: false, error: eventPlanningErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const eventId = receipt?.result_entity_id || receipt?.result_payload?.event_id || `ev-${Date.now()}`;
    return {
      success: true,
      eventId,
      data: { id: eventId, ...(receipt?.result_payload || {}) },
      payload: receipt?.result_payload,
      receipt,
      error: null,
    };
  } catch (err) {
    return { success: false, error: eventPlanningErrorMessage(err), rawError: err };
  }
}

/**
 * Reordena atividades litúrgicas no Supabase.
 */
export async function reorderEventItemsRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybeItemOrders = []
) {
  let churchId, commandId, eventId, orderedItemIds;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId, orderedItemIds = [] } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
    orderedItemIds = Array.isArray(maybeItemOrders)
      ? maybeItemOrders.map(item => (typeof item === 'object' ? item.item_id || item.id : item)).filter(Boolean)
      : [];
  }

  if (!churchId || !eventId || !Array.isArray(orderedItemIds) || orderedItemIds.length === 0) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'reorder_event_items', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
      p_ordered_item_ids: orderedItemIds,
    });
    if (error) {
      return { success: false, error: eventPlanningErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventPlanningErrorMessage(err), rawError: err };
  }
}

/**
 * Configura política de duração do evento no Supabase.
 */
export async function setEventDurationPolicyRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybePolicy = null,
  maybeTargetEndTime = null
) {
  let churchId, commandId, eventId, durationPolicy;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId, durationPolicy } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
    durationPolicy = maybePolicy;
  }

  if (!churchId || !eventId || !durationPolicy) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  if (!DURATION_POLICIES.includes(durationPolicy)) {
    return { success: false, error: "Política inválida. Opções aceitas: 'warn' ou 'block'." };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'set_event_duration_policy', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
      p_duration_policy: durationPolicy,
    });
    if (error) {
      return { success: false, error: eventPlanningErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, durationPolicy, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventPlanningErrorMessage(err), rawError: err };
  }
}

/**
 * Publica a programação litúrgica no Supabase.
 */
export async function publishEventProgramRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybeVersion = null,
  maybeItems = []
) {
  let churchId, commandId, eventId, expectedVersion;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId, expectedVersion } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
    expectedVersion = maybeVersion;
  }

  if (!churchId || !eventId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'publish_event_program', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
    });
    if (error) {
      return { success: false, error: eventPlanningErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, payload: receipt?.result_payload, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventPlanningErrorMessage(err), rawError: err };
  }
}

/**
 * Salva rascunho da programação no Supabase.
 */
export async function saveEventProgramDraftRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybeItems = []
) {
  let churchId, commandId, eventId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
  }

  if (!churchId || !eventId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'save_event_program_draft', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
    });
    if (error) {
      return { success: false, error: eventPlanningErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, payload: receipt?.result_payload, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventPlanningErrorMessage(err), rawError: err };
  }
}
