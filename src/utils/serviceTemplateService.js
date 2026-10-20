/**
 * serviceTemplateService.js
 * Regras de validação, integridade e instanciação de Modelos Reutilizáveis de Culto (Issue #27).
 * Alinhado ao PRD §4, §5 e M28 (Critérios CA01 a CA04).
 */

export const MAX_NAME_LENGTH = 100;
export const MIN_NAME_LENGTH = 1;
export const MAX_DESC_LENGTH = 255;
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 720; // 12 horas
export const MAX_PREP_MINUTES = 180; // 3 horas

/**
 * Normaliza o texto com Unicode NFC e remove espaços nas extremidades (trim).
 */
export function normalizeNfcText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

/**
 * Converte um item para o formato padronizado de Atividade do Modelo (Frontend).
 * Garante que NÃO contenha pessoas escaladas nem voluntários (CA03).
 * Suporta leitura tanto em camelCase (memória) quanto em snake_case (banco Postgres SQL 022).
 */
export function toTemplateActivity(item, index = 0) {
  if (!item) return null;
  const rawDuration = item.plannedDurationMinutes ?? item.planned_duration_minutes ?? item.defaultDurationMinutes ?? item.default_duration_minutes;
  const duration = parseInt(rawDuration, 10);
  const displayOrder = item.displayOrder ?? item.display_order;
  return {
    id: item.id || `ta-${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`,
    standardActivityId: item.standardActivityId ?? item.standard_activity_id ?? null,
    title: normalizeNfcText(item.title || item.name || 'Nova Etapa'),
    category: normalizeNfcText(item.category || 'Liturgia'),
    plannedDurationMinutes: !isNaN(duration) && duration >= MIN_DURATION_MINUTES && duration <= MAX_DURATION_MINUTES ? duration : 10,
    displayOrder: typeof displayOrder === 'number' ? displayOrder : index + 1,
    notes: normalizeNfcText(item.notes || item.description || ''),
    requiresPlayback: Boolean(item.requiresPlayback ?? item.requires_playback),
  };
}

/**
 * Converte um item para o formato padronizado de Serviço Paralelo / Apoio do Modelo (Frontend).
 * Garante que NÃO contenha pessoas escaladas nem voluntários (CA03).
 * Suporta leitura tanto em camelCase quanto em snake_case (banco Postgres SQL 022).
 */
export function toTemplateParallelService(item, index = 0) {
  if (!item) return null;
  const rawPrep = item.prepRequiredMinutes ?? item.prep_required_minutes;
  const prep = parseInt(rawPrep, 10);
  const isDefaultActive = item.isDefaultActive ?? item.is_default_active;
  const displayOrder = item.displayOrder ?? item.display_order;
  return {
    id: item.id || `tps-${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`,
    teamId: normalizeNfcText(item.teamId ?? item.team_id ?? 'apoio'),
    serviceName: normalizeNfcText(item.serviceName ?? item.service_name ?? item.name ?? 'Serviço de Apoio'),
    prepRequiredMinutes: !isNaN(prep) && prep >= 0 && prep <= MAX_PREP_MINUTES ? prep : 0,
    isDefaultActive: isDefaultActive !== false,
    displayOrder: typeof displayOrder === 'number' ? displayOrder : index + 1,
  };
}

/**
 * Converte uma atividade do modelo para os atributos JSON snake_case exigidos pelo contrato PostgreSQL (SQL 022).
 */
export function serializeTemplateActivityForSql(item, index) {
  if (!item) return null;
  const rawDuration = item.plannedDurationMinutes ?? item.planned_duration_minutes ?? item.defaultDurationMinutes ?? item.default_duration_minutes;
  const duration = parseInt(rawDuration, 10);
  const displayOrder = item.displayOrder ?? item.display_order;
  const cleanTitle = normalizeNfcText(item.title || item.name || 'Nova Etapa');
  const cleanCategory = normalizeNfcText(item.category || 'Liturgia');
  const cleanNotes = normalizeNfcText(item.notes || item.description || '');

  const computedOrder = typeof index === 'number'
    ? index + 1
    : (typeof displayOrder === 'number' ? displayOrder : 1);

  return {
    standard_activity_id: item.standardActivityId ?? item.standard_activity_id ?? null,
    title: cleanTitle || 'Etapa',
    category: cleanCategory || 'Liturgia',
    planned_duration_minutes: !isNaN(duration) && duration >= MIN_DURATION_MINUTES && duration <= MAX_DURATION_MINUTES ? duration : 10,
    display_order: computedOrder,
    notes: cleanNotes ? cleanNotes : null,
    requires_playback: Boolean(item.requiresPlayback ?? item.requires_playback),
  };
}

/**
 * Converte um serviço paralelo para os atributos JSON snake_case exigidos pelo contrato PostgreSQL (SQL 022).
 */
export function serializeTemplateParallelServiceForSql(item, index) {
  if (!item) return null;
  const rawPrep = item.prepRequiredMinutes ?? item.prep_required_minutes;
  const prep = parseInt(rawPrep, 10);
  const isDefaultActive = item.isDefaultActive ?? item.is_default_active;
  const displayOrder = item.displayOrder ?? item.display_order;

  const computedOrder = typeof index === 'number'
    ? index + 1
    : (typeof displayOrder === 'number' ? displayOrder : 1);

  return {
    team_id: normalizeNfcText(item.teamId ?? item.team_id ?? 'apoio') || 'apoio',
    service_name: normalizeNfcText(item.serviceName ?? item.service_name ?? item.name ?? 'Serviço de Apoio') || 'Serviço de Apoio',
    prep_required_minutes: !isNaN(prep) && prep >= 0 && prep <= MAX_PREP_MINUTES ? prep : 0,
    is_default_active: isDefaultActive !== false,
    display_order: computedOrder,
  };
}

/**
 * Converte um item para o formato padronizado de Modelo de Culto.
 * Normaliza campos retornados pelo SQL 022 e preserva integridade multi-tenant.
 */
export function toServiceTemplateObject(item, index = 0) {
  if (!item) return null;

  const rawActivities = item.activities;
  const rawParallel = item.parallelServices ?? item.parallel_services;

  const activities = Array.isArray(rawActivities)
    ? rawActivities.map((a, i) => toTemplateActivity(a, i)).filter(Boolean)
    : [];

  const parallelServices = Array.isArray(rawParallel)
    ? rawParallel.map((s, i) => toTemplateParallelService(s, i)).filter(Boolean)
    : [];

  const actsCount = typeof (item.activitiesCount ?? item.activities_count) === 'number'
    ? (item.activitiesCount ?? item.activities_count)
    : (Array.isArray(rawActivities) ? activities.length : 0);

  const parallelCount = typeof (item.parallelServicesCount ?? item.parallel_services_count) === 'number'
    ? (item.parallelServicesCount ?? item.parallel_services_count)
    : (Array.isArray(rawParallel) ? parallelServices.length : 0);

  const totalDur = typeof (item.totalDurationMinutes ?? item.total_duration_minutes) === 'number'
    ? (item.totalDurationMinutes ?? item.total_duration_minutes)
    : activities.reduce((acc, a) => acc + (a.plannedDurationMinutes || 0), 0);

  const isComplete = Boolean(
    item.isComplete !== false &&
    Array.isArray(rawActivities) &&
    Array.isArray(rawParallel)
  );

  return {
    id: item.id || `st-${Date.now()}-${index}`,
    churchId: item.churchId ?? item.church_id ?? null,
    eventTypeId: item.eventTypeId ?? item.event_type_id ?? null,
    eventTypeName: item.eventTypeName ?? item.event_type_name ?? null,
    name: normalizeNfcText(item.name || ''),
    description: normalizeNfcText(item.description || ''),
    active: item.active !== false,
    activities,
    parallelServices,
    activitiesCount: actsCount,
    parallelServicesCount: parallelCount,
    totalDurationMinutes: totalDur,
    usedInHistory: Boolean(item.usedInHistory ?? item.used_in_history),
    isComplete,
    createdAt: item.createdAt ?? item.created_at ?? null,
    updatedAt: item.updatedAt ?? item.updated_at ?? null,
  };
}

/**
 * Filtra modelos ativos.
 */
export function getActiveTemplates(templates = []) {
  if (!Array.isArray(templates)) return [];
  return templates.filter(t => t && t.active !== false);
}

/**
 * Validação de Modelo de Culto.
 */
export function validateServiceTemplate(data = {}, existingTemplates = [], currentId = null) {
  const templateList = Array.isArray(existingTemplates) ? existingTemplates : [];
  let current = null;
  if (currentId && templateList.length > 0) {
    current = templateList.find(t => t && t.id === currentId) || null;
  } else if (existingTemplates && typeof existingTemplates === 'object' && !Array.isArray(existingTemplates)) {
    current = existingTemplates.current || (existingTemplates.name ? existingTemplates : null);
  }

  const rawName = data.name !== undefined ? data.name : current?.name;
  const cleanName = normalizeNfcText(rawName || '');
  const rawDesc = data.description !== undefined ? data.description : current?.description;
  const cleanDesc = normalizeNfcText(rawDesc || '');

  if (!cleanName || cleanName.length < MIN_NAME_LENGTH) {
    return {
      valid: false,
      error: 'Nome do modelo é obrigatório.',
      cleanName: '',
      cleanDesc: '',
    };
  }

  if (cleanName.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `O nome do modelo deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`,
      cleanName,
      cleanDesc,
    };
  }

  if (cleanDesc.length > MAX_DESC_LENGTH) {
    return {
      valid: false,
      error: `A descrição deve ter no máximo ${MAX_DESC_LENGTH} caracteres.`,
      cleanName,
      cleanDesc,
    };
  }

  // Verificar duplicidade de nome (case-insensitive)
  const isDuplicate = templateList.some(t => {
    if (!t) return false;
    if (currentId && t.id === currentId) return false;
    if (current?.id && t.id === current.id) return false;
    return normalizeNfcText(t.name).toLowerCase() === cleanName.toLowerCase();
  });

  if (isDuplicate) {
    return {
      valid: false,
      error: 'Já existe um modelo de culto com este nome cadastrado.',
      cleanName,
      cleanDesc,
    };
  }

  // Validação de atividades (se fornecidas)
  if (Array.isArray(data.activities)) {
    for (let i = 0; i < data.activities.length; i++) {
      const act = data.activities[i];
      const title = normalizeNfcText(act.title || act.name || '');
      if (!title || title.length < 1) {
        return {
          valid: false,
          error: `Atividade na posição ${i + 1} deve ter um título.`,
          cleanName,
          cleanDesc,
        };
      }
      const duration = parseInt(act.plannedDurationMinutes || act.defaultDurationMinutes, 10);
      if (isNaN(duration) || duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
        return {
          valid: false,
          error: `Duração da atividade '${title}' deve estar entre ${MIN_DURATION_MINUTES} e ${MAX_DURATION_MINUTES} minutos.`,
          cleanName,
          cleanDesc,
        };
      }
    }
  }

  // Validação de apoios / serviços paralelos (se fornecidos)
  if (Array.isArray(data.parallelServices)) {
    for (let i = 0; i < data.parallelServices.length; i++) {
      const serv = data.parallelServices[i];
      const sName = normalizeNfcText(serv.serviceName || serv.name || '');
      if (!sName || sName.length < 1) {
        return {
          valid: false,
          error: `Serviço de apoio na posição ${i + 1} deve ter um nome.`,
          cleanName,
          cleanDesc,
        };
      }
      const prep = parseInt(serv.prepRequiredMinutes, 10);
      if (!isNaN(prep) && (prep < 0 || prep > MAX_PREP_MINUTES)) {
        return {
          valid: false,
          error: `Tempo de preparação de '${sName}' deve estar entre 0 e ${MAX_PREP_MINUTES} minutos.`,
          cleanName,
          cleanDesc,
        };
      }
    }
  }

  return {
    valid: true,
    error: null,
    cleanName,
    cleanDesc,
  };
}

/**
 * Instancia um Modelo de Culto para um Evento / Edição específica (CA01, CA02, CA03, CA04).
 *
 * Invariantes rigorosas:
 * 1. Clona profundamente as atividades e apoios em novas entidades com novos IDs.
 * 2. CA03: O modelo NÃO escala pessoas:
 *    - `roster: []` nas atividades (sem participantes escalados).
 *    - `responsibleMemberId: null` ou indefinido.
 *    - `volunteers: []` nos serviços paralelos (sem voluntários escalados).
 *    - `leaderId: null` ou indefinido nos serviços paralelos.
 * 3. CA02: O evento resultante é completamente independente do modelo e de outros eventos.
 * 4. Preserva os dados do evento existente (id, título, data, horários, liderança da liturgia).
 */
export function instantiateTemplateForEvent(template, targetEvent = {}) {
  if (!template) return targetEvent;

  if (
    template.isComplete === false ||
    (template.activitiesCount > 0 && (!template.activities || template.activities.length === 0))
  ) {
    throw new Error(
      `Não é possível aplicar o modelo "${template.name || 'desconhecido'}" com detalhes incompletos. Recarregue os dados da igreja.`
    );
  }

  const activities = (template.activities || []).map((a, idx) => ({
    id: `act-${Date.now()}-${idx + 1}-${Math.floor(Math.random() * 1000)}`,
    title: a.title,
    category: a.category || 'Liturgia',
    plannedDurationMinutes: a.plannedDurationMinutes || 10,
    responsibleMemberId: null, // CA03: Não escala pessoas automaticamente
    responsibleTeamId: null,
    status: 'pendente',
    realStartTime: null,
    realEndTime: null,
    cancellationReason: null,
    notes: a.notes || '',
    requiresPlayback: Boolean(a.requiresPlayback),
    musics: [],
    roster: [], // CA03: Sem pessoas escaladas
  }));

  const parallelServices = (template.parallelServices || [])
    .filter(s => s.isDefaultActive !== false)
    .map((s, idx) => ({
      id: `serv-${Date.now()}-${idx + 1}-${Math.floor(Math.random() * 1000)}`,
      name: s.serviceName,
      teamId: s.teamId,
      leaderId: null, // CA03: Sem líderes pré-escalados
      volunteers: [], // CA03: Sem voluntários pré-alocados
      status: 'Aguardando culto',
      prepRequiredMinutes: s.prepRequiredMinutes || 0,
    }));

  return {
    ...targetEvent,
    templateId: template.id,
    templateName: template.name,
    activities,
    parallelServices,
  };
}

/**
 * Remove um serviço paralelo específico da edição de um evento (CA02).
 * Exemplo: retirar transmissão daquele culto por decisão operacional ou pane técnica.
 * A remoção altera APENAS o evento fornecido; o modelo original e outros eventos permanecem intocados.
 */
export function removeParallelServiceFromEvent(event, serviceId) {
  if (!event || !Array.isArray(event.parallelServices)) return event;
  return {
    ...event,
    parallelServices: event.parallelServices.filter(s => s.id !== serviceId),
  };
}

/**
 * Adiciona ou substitui um serviço paralelo na edição de um evento (CA02).
 */
export function addParallelServiceToEvent(event, service) {
  if (!event) return event;
  const currentServices = Array.isArray(event.parallelServices) ? event.parallelServices : [];
  const newService = {
    id: service.id || `serv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: normalizeNfcText(service.name || service.serviceName || 'Serviço de Apoio'),
    teamId: normalizeNfcText(service.teamId || 'apoio'),
    leaderId: service.leaderId || null,
    volunteers: Array.isArray(service.volunteers) ? [...service.volunteers] : [],
    status: service.status || 'Aguardando culto',
    prepRequiredMinutes: typeof service.prepRequiredMinutes === 'number' ? service.prepRequiredMinutes : 0,
  };

  return {
    ...event,
    parallelServices: [...currentServices, newService],
  };
}

/**
 * Verifica se um modelo está referenciado em eventos existentes (CA04).
 */
export function isTemplateUsedInEvents(templateId, events = []) {
  if (!templateId) return false;
  const eventList = Array.isArray(events) ? events : [events];
  return eventList.some(e => {
    if (!e) return false;
    return e.templateId === templateId || e.metadata?.template_id === templateId;
  });
}

/**
 * Determina se um modelo pode ser excluído fisicamente com segurança ou se deve ser desativado (CA04).
 */
export function canDeleteServiceTemplate(template, events = []) {
  if (!template) return { canDelete: false, reason: 'Modelo inválido.' };
  if (isTemplateUsedInEvents(template.id, events)) {
    return {
      canDelete: false,
      reason: 'Este modelo já foi utilizado no planejamento de eventos existentes. Para preservar o histórico, desative-o em vez de excluí-lo.',
    };
  }
  return { canDelete: true, reason: null };
}

/**
 * Mensagem padronizada de erro para modelos de culto.
 */
export function serviceTemplateErrorMessage(error) {
  if (!error) return 'Ocorreu um erro ao processar o modelo de culto.';
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
    return 'Serviço de modelos temporariamente indisponível no servidor. Verifique se as migrações foram aplicadas.';
  }

  if (code === '42501' || code === '28000') {
    return 'Permissão insuficiente. Apenas administradores autorizados podem gerenciar modelos de culto.';
  }
  if (code === '23505' || code === 'duplicate') {
    return 'Já existe um modelo de culto cadastrado com este nome nesta igreja.';
  }
  if (code === '23503' || error.code === 'template_in_use') {
    return 'Este modelo já foi utilizado em eventos históricos e não pode ser excluído. Desative-o em vez de excluir.';
  }
  if (code === '23514' || code === '22023') {
    return 'Dados do modelo de culto inválidos. Verifique os campos e durações preenchidos.';
  }
  if (code === '22P02' || lower.includes('invalid input syntax for type uuid')) {
    return 'Identificador inválido fornecido para a operação. Atualize a página e tente novamente.';
  }
  return error.message || 'Falha na operação de modelos de culto.';
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
 * Consulta modelos de culto da igreja no Supabase.
 * Regra B: Não converte erros de leitura de detalhes em listas vazias de sucesso.
 */
export async function fetchServiceTemplatesRemote(supabaseClient, churchId, includeInactive = true) {
  if (!churchId) {
    return { success: false, data: [], error: 'Identificador da igreja não informado.' };
  }
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'list_service_templates', {
      p_church_id: churchId,
      p_only_active: !includeInactive,
    });
    if (error) {
      return { success: false, data: [], error: serviceTemplateErrorMessage(error), rawError: error };
    }
    if (!Array.isArray(data)) {
      return {
        success: false,
        data: [],
        error: 'Resposta remota estruturalmente inválida: esperava-se um array de modelos de culto.',
        rawError: data
      };
    }

    const list = [];
    for (let idx = 0; idx < data.length; idx++) {
      const item = data[idx];
      const detail = await getServiceTemplateRemote(supabaseClient, { templateId: item.id });
      if (!detail.success || !detail.template) {
        // Regra B1 & B2: Erro remoto não pode ser convertido em sucesso e resumo não equivale a detalhes
        return {
          success: false,
          data: [],
          templates: [],
          error: `Falha ao carregar detalhes do modelo de culto "${item.name}": ${detail.error || 'Erro remoto'}`,
          rawError: detail.rawError || detail.error
        };
      }
      list.push(detail.template);
    }
    return { success: true, data: list, templates: list, error: null };
  } catch (err) {
    return { success: false, data: [], templates: [], error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Busca modelo de culto por ID no Supabase com detalhes completos.
 */
export async function getServiceTemplateRemote(supabaseClient, churchIdOrOpts, maybeTemplateId = null) {
  let templateId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ templateId } = churchIdOrOpts);
  } else if (maybeTemplateId) {
    templateId = maybeTemplateId;
  } else {
    templateId = churchIdOrOpts;
  }

  if (!templateId) {
    return { success: false, template: null, error: 'Parâmetros obrigatórios ausentes.' };
  }
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'get_service_template', {
      p_template_id: templateId,
    });
    if (error) {
      return { success: false, template: null, error: serviceTemplateErrorMessage(error), rawError: error };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { success: false, template: null, error: 'Modelo de culto não encontrado.' };
    }

    const rawActivities = row.activities ?? row.activities_list;
    const rawParallel = row.parallel_services ?? row.parallelServices;

    // Problema G: Validar a presença e o formato dos arrays obrigatórios de atividades e serviços paralelos
    if (!Array.isArray(rawActivities) || !Array.isArray(rawParallel)) {
      const incompleteTemplate = toServiceTemplateObject({
        ...row,
        isComplete: false
      });
      return {
        success: false,
        template: incompleteTemplate,
        error: 'Resposta remota incompleta: a estrutura de atividades ou serviços paralelos é inválida ou ausente.',
        rawError: row
      };
    }

    const templateObj = toServiceTemplateObject({
      ...row,
      isComplete: true
    });
    return { success: true, template: templateObj, error: null };
  } catch (err) {
    return { success: false, template: null, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Cadastra modelo de culto no Supabase serializando atributos para snake_case (SQL 022).
 */
export async function createServiceTemplateRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeData = {}
) {
  let churchId, commandId, name, description, eventTypeId, activities, parallelServices;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      name,
      description = '',
      eventTypeId = null,
      activities = [],
      parallelServices = [],
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    ({
      name,
      description = '',
      eventTypeId = null,
      activities = [],
      parallelServices = [],
      commandId,
    } = maybeData || {});
  }

  if (!churchId) {
    return { success: false, error: 'Identificador da igreja não informado.' };
  }
  const validation = validateServiceTemplate({ name, description, activities, parallelServices });
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();

  // Serializa explicitamente para os atributos snake_case exigidos pelo SQL 022
  const sqlActs = (activities || []).map((a, i) => serializeTemplateActivityForSql(a, i)).filter(Boolean);
  const sqlServices = (parallelServices || []).map((s, i) => serializeTemplateParallelServiceForSql(s, i)).filter(Boolean);

  // Objetos normalizados para o frontend
  const cleanActs = (activities || []).map((a, i) => toTemplateActivity(a, i)).filter(Boolean);
  const cleanServices = (parallelServices || []).map((s, i) => toTemplateParallelService(s, i)).filter(Boolean);

  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_service_template', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_name: validation.cleanName,
      p_description: validation.cleanDesc || null,
      p_event_type_id: eventTypeId || null,
      p_activities: sqlActs,
      p_parallel_services: sqlServices,
    });
    if (error) {
      return { success: false, error: serviceTemplateErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const createdId = receipt?.template_id || receipt?.id || receipt?.result_entity_id || receipt?.result_payload?.template_id;
    if (!createdId) {
      return { success: false, error: 'Identificador do modelo de culto não retornado pelo servidor.', rawError: data };
    }
    const templateObj = {
      id: createdId,
      churchId,
      name: validation.cleanName,
      description: validation.cleanDesc || '',
      eventTypeId,
      active: true,
      activities: cleanActs,
      parallelServices: cleanServices,
      activitiesCount: cleanActs.length,
      parallelServicesCount: cleanServices.length,
      totalDurationMinutes: cleanActs.reduce((acc, a) => acc + (a.plannedDurationMinutes || 0), 0),
      usedInHistory: false,
      isComplete: true,
      createdAt: receipt?.created_at || new Date().toISOString(),
      updatedAt: receipt?.created_at || new Date().toISOString(),
    };
    return { success: true, templateId: createdId, template: templateObj, data: templateObj, receipt, error: null };
  } catch (err) {
    return { success: false, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Atualiza modelo de culto no Supabase.
 * Regra D: Preserva campos omitidos (undefined -> null no SQL) e não apaga atividades/serviços involuntariamente.
 */
export async function updateServiceTemplateRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeTemplateId = null,
  maybeData = {}
) {
  let churchId, commandId, templateId, name, description, eventTypeId, activities, parallelServices, existingTemplate;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      templateId,
      name,
      description,
      eventTypeId,
      activities,
      parallelServices,
      existingTemplate,
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    templateId = maybeTemplateId;
    ({
      name,
      description,
      eventTypeId,
      activities,
      parallelServices,
      existingTemplate,
      commandId,
    } = maybeData || {});
  }

  if (!churchId || !templateId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }

  // Resolução de campos escalares com preservação dos valores existentes quando omitidos:
  const finalName = name !== undefined ? name : existingTemplate?.name;

  let finalDesc;
  if (description === undefined) {
    finalDesc = existingTemplate ? (existingTemplate.description ?? null) : null;
  } else if (description === null || description === '') {
    finalDesc = null;
  } else {
    finalDesc = normalizeNfcText(description);
  }

  let finalEventTypeId;
  if (eventTypeId === undefined) {
    finalEventTypeId = existingTemplate ? (existingTemplate.eventTypeId ?? null) : null;
  } else if (eventTypeId === null || eventTypeId === '') {
    finalEventTypeId = null;
  } else {
    finalEventTypeId = eventTypeId;
  }

  const validation = validateServiceTemplate(
    { name: finalName, description: finalDesc, activities, parallelServices },
    [],
    templateId
  );
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();

  // Distinguir explicitamente:
  // - activities === undefined (omitido): enviar null para preservar registros no SQL
  // - activities é Array ([] ou preenchido): serializar para snake_case com index sequencial
  let sqlActs = null;
  if (Array.isArray(activities)) {
    sqlActs = activities.map((a, i) => serializeTemplateActivityForSql(a, i)).filter(Boolean);
  }

  let sqlServices = null;
  if (Array.isArray(parallelServices)) {
    sqlServices = parallelServices.map((s, i) => serializeTemplateParallelServiceForSql(s, i)).filter(Boolean);
  }

  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'update_service_template', {
      p_command_id: cmdId,
      p_template_id: templateId,
      p_event_type_id: finalEventTypeId,
      p_name: validation.cleanName,
      p_description: finalDesc,
      p_activities: sqlActs,
      p_parallel_services: sqlServices,
    });
    if (error) {
      return { success: false, error: serviceTemplateErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Alterna status (ativo/inativo) de modelo no Supabase.
 */
export async function toggleServiceTemplateStatusRemote(supabaseClient, churchIdOrOpts, maybeTemplateId = null, maybeActive = null) {
  let churchId, commandId, templateId, active;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, templateId, active = null } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    templateId = maybeTemplateId;
    active = maybeActive;
  }

  if (!templateId || active === null || active === undefined) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'toggle_service_template_status', {
      p_command_id: cmdId,
      p_template_id: templateId,
      p_active: Boolean(active),
    });
    if (error) {
      return { success: false, error: serviceTemplateErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const resolvedActive = receipt?.result_payload?.active ?? active;
    return { success: true, active: resolvedActive, receipt, error: null };
  } catch (err) {
    return { success: false, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Exclui fisicamente modelo de culto sem histórico no Supabase.
 */
export async function deleteServiceTemplateRemote(supabaseClient, churchIdOrOpts, maybeTemplateId = null) {
  let churchId, commandId, templateId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, templateId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    templateId = maybeTemplateId;
  }

  if (!templateId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'delete_service_template', {
      p_command_id: cmdId,
      p_template_id: templateId,
    });
    if (error) {
      return { success: false, error: serviceTemplateErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Aplica modelo a uma edição de evento no Supabase.
 */
export async function instantiateServiceTemplateRemote(supabaseClient, churchIdOrOpts, maybeTemplateId = null) {
  let churchId, commandId, templateId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, templateId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    templateId = maybeTemplateId;
  }

  if (!churchId || !templateId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'instantiate_service_template', {
      p_command_id: cmdId,
      p_church_id: churchId,
      p_template_id: templateId,
    });
    if (error) {
      return { success: false, error: serviceTemplateErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}
