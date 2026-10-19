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
 * Converte um item para o formato padronizado de Atividade do Modelo.
 * Garante que NÃO contenha pessoas escaladas nem voluntários (CA03).
 */
export function toTemplateActivity(item, index = 0) {
  if (!item) return null;
  const duration = parseInt(item.plannedDurationMinutes || item.defaultDurationMinutes, 10);
  return {
    id: item.id || `ta-${Date.now()}-${index}`,
    standardActivityId: item.standardActivityId || null,
    title: normalizeNfcText(item.title || item.name || 'Nova Etapa'),
    category: normalizeNfcText(item.category || 'Liturgia'),
    plannedDurationMinutes: !isNaN(duration) && duration >= MIN_DURATION_MINUTES && duration <= MAX_DURATION_MINUTES ? duration : 10,
    displayOrder: typeof item.displayOrder === 'number' ? item.displayOrder : index + 1,
    notes: normalizeNfcText(item.notes || item.description || ''),
    requiresPlayback: Boolean(item.requiresPlayback),
  };
}

/**
 * Converte um item para o formato padronizado de Serviço Paralelo / Apoio do Modelo.
 * Garante que NÃO contenha pessoas escaladas nem voluntários (CA03).
 */
export function toTemplateParallelService(item, index = 0) {
  if (!item) return null;
  const prep = parseInt(item.prepRequiredMinutes, 10);
  return {
    id: item.id || `tps-${Date.now()}-${index}`,
    teamId: normalizeNfcText(item.teamId || 'apoio'),
    serviceName: normalizeNfcText(item.serviceName || item.name || 'Serviço de Apoio'),
    prepRequiredMinutes: !isNaN(prep) && prep >= 0 && prep <= MAX_PREP_MINUTES ? prep : 0,
    isDefaultActive: item.isDefaultActive !== false,
    displayOrder: typeof item.displayOrder === 'number' ? item.displayOrder : index + 1,
  };
}

/**
 * Converte um item para o formato padronizado de Modelo de Culto.
 */
export function toServiceTemplateObject(item, index = 0) {
  if (!item) return null;

  const activities = Array.isArray(item.activities)
    ? item.activities.map((a, i) => toTemplateActivity(a, i)).filter(Boolean)
    : [];

  const parallelServices = Array.isArray(item.parallelServices)
    ? item.parallelServices.map((s, i) => toTemplateParallelService(s, i)).filter(Boolean)
    : [];

  return {
    id: item.id || `st-${Date.now()}-${index}`,
    eventTypeId: item.eventTypeId || null,
    name: normalizeNfcText(item.name || ''),
    description: normalizeNfcText(item.description || ''),
    active: item.active !== false,
    activities,
    parallelServices,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
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
  const cleanName = normalizeNfcText(data.name || '');
  const cleanDesc = normalizeNfcText(data.description || '');

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
  const isDuplicate = existingTemplates.some(t => {
    if (!t) return false;
    if (currentId && t.id === currentId) return false;
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
      return { success: true, data: [], error: null };
    }
    const list = await Promise.all(
      data.map(async (item, idx) => {
        try {
          const detail = await getServiceTemplateRemote(supabaseClient, { templateId: item.id });
          if (detail.success && detail.template) {
            return detail.template;
          }
        } catch {
          // fallback para objeto resumido
        }
        return toServiceTemplateObject(item, idx);
      })
    );
    return { success: true, data: list.filter(Boolean), error: null };
  } catch (err) {
    return { success: false, data: [], error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Busca modelo de culto por ID no Supabase.
 */
export async function getServiceTemplateRemote(supabaseClient, { templateId } = {}) {
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
    return { success: true, template: toServiceTemplateObject(row), error: null };
  } catch (err) {
    return { success: false, template: null, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Cadastra modelo de culto no Supabase.
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
  const cleanActs = (activities || []).map((a, i) => toTemplateActivity(a, i)).filter(Boolean);
  const cleanServices = (parallelServices || []).map((s, i) => toTemplateParallelService(s, i)).filter(Boolean);

  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_service_template', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_name: validation.cleanName,
      p_description: validation.cleanDesc || null,
      p_event_type_id: eventTypeId || null,
      p_activities: cleanActs,
      p_parallel_services: cleanServices,
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
      name: validation.cleanName,
      description: validation.cleanDesc || '',
      eventTypeId,
      active: true,
      activities: cleanActs,
      parallelServices: cleanServices,
      createdAt: receipt?.created_at || new Date().toISOString(),
      updatedAt: receipt?.created_at || new Date().toISOString(),
    };
    return { success: true, template: templateObj, data: templateObj, receipt, error: null };
  } catch (err) {
    return { success: false, error: serviceTemplateErrorMessage(err), rawError: err };
  }
}

/**
 * Atualiza modelo de culto no Supabase.
 */
export async function updateServiceTemplateRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeTemplateId = null,
  maybeData = {}
) {
  let churchId, commandId, templateId, name, description, eventTypeId, activities, parallelServices;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      templateId,
      name,
      description = '',
      eventTypeId = null,
      activities = [],
      parallelServices = [],
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    templateId = maybeTemplateId;
    ({
      name,
      description = '',
      eventTypeId = null,
      activities = [],
      parallelServices = [],
      commandId,
    } = maybeData || {});
  }

  if (!churchId || !templateId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const validation = validateServiceTemplate({ name, description, activities, parallelServices });
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  const cleanActs = (activities || []).map((a, i) => toTemplateActivity(a, i)).filter(Boolean);
  const cleanServices = (parallelServices || []).map((s, i) => toTemplateParallelService(s, i)).filter(Boolean);

  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'update_service_template', {
      p_command_id: cmdId,
      p_template_id: templateId,
      p_event_type_id: eventTypeId || null,
      p_name: validation.cleanName,
      p_description: validation.cleanDesc || null,
      p_activities: cleanActs,
      p_parallel_services: cleanServices,
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
