/**
 * eventTypeActivityService.js
 * Regras de validação, normalização e integridade para tipos de evento e atividades padrão (Issue #25).
 * Alinhado ao PRD §4, §5 e §6 (Critérios CA01 a CA04).
 */

export const MAX_NAME_LENGTH = 100;
export const MIN_NAME_LENGTH = 1;
export const MAX_DESC_LENGTH = 255;
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 720; // 12 horas

/**
 * Normaliza o texto com Unicode NFC e remove espaços nas extremidades (trim).
 */
export function normalizeNfcText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

/**
 * Converte um item (string ou objeto) para o formato padronizado de Tipo de Evento.
 */
export function toEventTypeObject(item, index = 0) {
  if (!item) return null;
  if (typeof item === 'string') {
    return {
      id: `et-legacy-${index + 1}`,
      name: normalizeNfcText(item),
      description: '',
      active: true,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    id: item.id || `et-${Date.now()}-${index}`,
    name: normalizeNfcText(item.name || ''),
    description: normalizeNfcText(item.description || ''),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

/**
 * Converte um item (objeto) para o formato padronizado de Atividade Padrão.
 */
export function toStandardActivityObject(item, index = 0) {
  if (!item) return null;
  const duration = parseInt(item.defaultDurationMinutes || item.plannedDurationMinutes, 10);
  return {
    id: item.id || `sa-${Date.now()}-${index}`,
    name: normalizeNfcText(item.name || item.title || ''),
    defaultDurationMinutes: !isNaN(duration) && duration > 0 ? duration : 10,
    category: normalizeNfcText(item.category || 'Liturgia'),
    description: normalizeNfcText(item.description || item.notes || ''),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

/**
 * Filtra itens ativos.
 */
export function getActiveItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => item && item.active !== false);
}

/**
 * Validação de Tipo de Evento.
 */
export function validateEventType(name, description = '', existingTypes = [], currentId = null) {
  const cleanName = normalizeNfcText(name);
  const cleanDesc = normalizeNfcText(description);

  if (!cleanName || cleanName.length < MIN_NAME_LENGTH) {
    return {
      valid: false,
      error: 'Nome do tipo de evento é obrigatório.',
      cleanName: '',
      cleanDesc: '',
    };
  }

  if (cleanName.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `O nome do tipo de evento deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`,
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

  const cleanLower = cleanName.toLowerCase();
  const isDuplicate = existingTypes.some(t => {
    const tObj = typeof t === 'object' ? t : { id: null, name: t };
    if (currentId && tObj.id === currentId) {
      return false;
    }
    const existingClean = normalizeNfcText(tObj.name || '').toLowerCase();
    return existingClean === cleanLower;
  });

  if (isDuplicate) {
    return {
      valid: false,
      error: 'Já existe um tipo de evento cadastrado com este nome nesta igreja.',
      cleanName,
      cleanDesc,
    };
  }

  return {
    valid: true,
    error: null,
    cleanName,
    cleanDesc,
  };
}

/**
 * Validação de Atividade Padrão com Duração Configurável (CA02).
 */
export function validateStandardActivity(
  name,
  durationMinutes,
  category = '',
  description = '',
  existingActivities = [],
  currentId = null
) {
  const cleanName = normalizeNfcText(name);
  const cleanCat = normalizeNfcText(category) || 'Liturgia';
  const cleanDesc = normalizeNfcText(description);
  const parsedDuration = parseInt(durationMinutes, 10);

  if (!cleanName || cleanName.length < MIN_NAME_LENGTH) {
    return {
      valid: false,
      error: 'Nome da atividade é obrigatório.',
      cleanName: '',
      cleanCat: '',
      cleanDesc: '',
      cleanDuration: 0,
    };
  }

  if (cleanName.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `O nome da atividade deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`,
      cleanName,
      cleanCat,
      cleanDesc,
      cleanDuration: parsedDuration,
    };
  }

  if (isNaN(parsedDuration) || parsedDuration < MIN_DURATION_MINUTES || parsedDuration > MAX_DURATION_MINUTES) {
    return {
      valid: false,
      error: `A duração padrão deve ser um número inteiro entre ${MIN_DURATION_MINUTES} e ${MAX_DURATION_MINUTES} minutos.`,
      cleanName,
      cleanCat,
      cleanDesc,
      cleanDuration: parsedDuration,
    };
  }

  if (cleanDesc.length > MAX_DESC_LENGTH) {
    return {
      valid: false,
      error: `A descrição deve ter no máximo ${MAX_DESC_LENGTH} caracteres.`,
      cleanName,
      cleanCat,
      cleanDesc,
      cleanDuration: parsedDuration,
    };
  }

  const cleanLower = cleanName.toLowerCase();
  const isDuplicate = existingActivities.some(a => {
    const aObj = typeof a === 'object' ? a : { id: null, name: a };
    if (currentId && aObj.id === currentId) {
      return false;
    }
    const existingClean = normalizeNfcText(aObj.name || aObj.title || '').toLowerCase();
    return existingClean === cleanLower;
  });

  if (isDuplicate) {
    return {
      valid: false,
      error: 'Já existe uma atividade cadastrada com este nome nesta igreja.',
      cleanName,
      cleanCat,
      cleanDesc,
      cleanDuration: parsedDuration,
    };
  }

  return {
    valid: true,
    error: null,
    cleanName,
    cleanCat,
    cleanDesc,
    cleanDuration: parsedDuration,
  };
}

/**
 * Verifica se um tipo de evento está em uso em eventos (passados ou planejados).
 */
export function isEventTypeUsed(typeIdOrName, events = []) {
  if (!typeIdOrName || !Array.isArray(events)) return false;

  const targetId = typeof typeIdOrName === 'object' ? typeIdOrName.id : typeIdOrName;
  const targetName = typeof typeIdOrName === 'object'
    ? normalizeNfcText(typeIdOrName.name).toLowerCase()
    : normalizeNfcText(typeIdOrName).toLowerCase();

  return events.some(ev => {
    if (!ev) return false;
    if (ev.eventTypeId && targetId && ev.eventTypeId === targetId) return true;
    if (ev.type && normalizeNfcText(ev.type).toLowerCase() === targetName) return true;
    if (ev.title && normalizeNfcText(ev.title).toLowerCase() === targetName) return true;
    return false;
  });
}

/**
 * Verifica se uma atividade padrão está em uso em atividades de cultos (passados ou planejados).
 */
export function isStandardActivityUsed(activityIdOrName, activities = []) {
  if (!activityIdOrName || !Array.isArray(activities)) return false;

  const targetId = typeof activityIdOrName === 'object' ? activityIdOrName.id : activityIdOrName;
  const targetName = typeof activityIdOrName === 'object'
    ? normalizeNfcText(activityIdOrName.name).toLowerCase()
    : normalizeNfcText(activityIdOrName).toLowerCase();

  return activities.some(act => {
    if (!act) return false;
    if (act.standardActivityId && targetId && act.standardActivityId === targetId) return true;
    if (act.title && normalizeNfcText(act.title).toLowerCase() === targetName) return true;
    return false;
  });
}

/**
 * Avalia se o tipo de evento pode ser excluído fisicamente ou se deve ser desativado.
 * CA03: Preservação de referências e histórico existentes.
 */
export function canDeleteEventType(type, events = []) {
  if (!type) {
    return { canDelete: false, message: 'Tipo de evento não informado.' };
  }

  const isUsed = isEventTypeUsed(type, events);
  if (isUsed) {
    return {
      canDelete: false,
      message: 'Este tipo de evento já foi referenciado em cultos planejados ou realizados e não pode ser excluído fisicamente. Desative-o para que não seja mais selecionado em novos planejamentos.',
    };
  }

  return {
    canDelete: true,
    message: null,
  };
}

/**
 * Avalia se a atividade padrão pode ser excluída fisicamente ou se deve ser desativada.
 * CA03: Preservação de referências e histórico existentes.
 */
export function canDeleteStandardActivity(activity, activities = []) {
  if (!activity) {
    return { canDelete: false, message: 'Atividade não informada.' };
  }

  const isUsed = isStandardActivityUsed(activity, activities);
  if (isUsed) {
    return {
      canDelete: false,
      message: 'Esta atividade já foi utilizada em cultos planejados ou realizados e não pode ser excluída fisicamente. Desative-a para que não seja mais selecionada em novos planejamentos.',
    };
  }

  return {
    canDelete: true,
    message: null,
  };
}

/**
 * Mensagem padronizada de erro.
 */
export function eventTypeActivityErrorMessage(error) {
  if (!error) return 'Ocorreu um erro ao processar a operação.';
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
    return 'Serviço temporariamente indisponível no servidor. Verifique se as migrações foram aplicadas.';
  }

  if (code === '42501' || code === '28000') {
    return 'Permissão insuficiente. Apenas administradores autorizados podem gerenciar tipos e atividades.';
  }
  if (code === '23505' || code === 'duplicate') {
    return 'Já existe um cadastro com este nome nesta igreja.';
  }
  if (code === '23503' || error.code === 'reference_in_use') {
    return 'Este item já foi utilizado em cultos históricos e não pode ser excluído. Desative-o em vez de excluir.';
  }
  if (code === '23514' || code === '22023') {
    return 'Dados informados inválidos. Verifique os campos preenchidos e a duração em minutos.';
  }
  return error.message || 'Falha na operação de tipos de evento e atividades.';
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
 * Consulta tipos de evento da igreja no Supabase.
 */
export async function fetchEventTypesRemote(supabaseClient, churchId, includeInactive = true) {
  if (!churchId) {
    return { success: false, data: [], error: 'Identificador da igreja não informado.' };
  }
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'list_event_types', {
      p_church_id: churchId,
      p_include_inactive: includeInactive,
    });
    if (error) {
      return { success: false, data: [], error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const list = Array.isArray(data)
      ? data.map((item, idx) => toEventTypeObject(item, idx)).filter(Boolean)
      : [];
    return { success: true, data: list, error: null };
  } catch (err) {
    return { success: false, data: [], error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Cadastra tipo de evento no Supabase.
 */
export async function createEventTypeRemote(supabaseClient, churchIdOrOpts, maybeName = null, maybeDescription = null) {
  let churchId, commandId, name, description;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, name, description = null } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    name = maybeName;
    description = maybeDescription;
  }

  if (!churchId) {
    return { success: false, error: 'Identificador da igreja não informado.' };
  }
  const validation = validateEventType(name, description);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_event_type', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_name: validation.cleanName,
      p_description: validation.cleanDesc || null,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const createdId = receipt?.result_entity_id || receipt?.result_payload?.type_id || `et-${Date.now()}`;
    const typeObj = {
      id: createdId,
      name: validation.cleanName,
      description: validation.cleanDesc || '',
      active: true,
      createdAt: receipt?.created_at || new Date().toISOString(),
      updatedAt: receipt?.created_at || new Date().toISOString(),
    };
    return { success: true, eventType: typeObj, data: typeObj, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Atualiza tipo de evento no Supabase.
 */
export async function updateEventTypeRemote(supabaseClient, churchIdOrOpts, maybeTypeId = null, maybeName = null, maybeDescription = null) {
  let churchId, commandId, typeId, name, description;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, typeId, name, description = null } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    typeId = maybeTypeId;
    name = maybeName;
    description = maybeDescription;
  }

  if (!churchId || !typeId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const validation = validateEventType(name, description);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'update_event_type', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_type_id: typeId,
      p_name: validation.cleanName,
      p_description: validation.cleanDesc || null,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Alterna status (ativo/inativo) de tipo de evento no Supabase.
 */
export async function toggleEventTypeStatusRemote(supabaseClient, churchIdOrOpts, maybeTypeId = null, maybeActive = null) {
  let churchId, commandId, typeId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, typeId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    typeId = maybeTypeId;
  }

  if (!churchId || !typeId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'toggle_event_type_status', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_type_id: typeId,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const active = receipt?.result_payload?.active ?? maybeActive;
    return { success: true, active, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Exclui fisicamente tipo de evento sem histórico no Supabase.
 */
export async function deleteEventTypeRemote(supabaseClient, churchIdOrOpts, maybeTypeId = null) {
  let churchId, commandId, typeId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, typeId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    typeId = maybeTypeId;
  }

  if (!churchId || !typeId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'delete_event_type', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_type_id: typeId,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Consulta atividades padrão da igreja no Supabase.
 */
export async function fetchStandardActivitiesRemote(supabaseClient, churchId, includeInactive = true) {
  if (!churchId) {
    return { success: false, data: [], error: 'Identificador da igreja não informado.' };
  }
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'list_standard_activities', {
      p_church_id: churchId,
      p_include_inactive: includeInactive,
    });
    if (error) {
      return { success: false, data: [], error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const list = Array.isArray(data)
      ? data.map((item, idx) => toStandardActivityObject(item, idx)).filter(Boolean)
      : [];
    return { success: true, data: list, error: null };
  } catch (err) {
    return { success: false, data: [], error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Cadastra atividade padrão no Supabase.
 */
export async function createStandardActivityRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeName = null,
  maybeDefaultDuration = null,
  maybeCategory = 'Liturgia',
  maybeDescription = null
) {
  let churchId, commandId, name, defaultDurationMinutes, category, description;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      name,
      defaultDurationMinutes,
      category = 'Liturgia',
      description = null,
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    name = maybeName;
    defaultDurationMinutes = maybeDefaultDuration;
    category = maybeCategory || 'Liturgia';
    description = maybeDescription;
  }

  if (!churchId) {
    return { success: false, error: 'Identificador da igreja não informado.' };
  }
  const validation = validateStandardActivity(name, defaultDurationMinutes, category, description);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_standard_activity', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_name: validation.cleanName,
      p_default_duration_minutes: validation.cleanDuration,
      p_category: validation.cleanCat,
      p_description: validation.cleanDesc || null,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const createdId = receipt?.result_entity_id || receipt?.result_payload?.activity_id || `sa-${Date.now()}`;
    const actObj = {
      id: createdId,
      name: validation.cleanName,
      defaultDurationMinutes: validation.cleanDuration,
      category: validation.cleanCat,
      description: validation.cleanDesc || '',
      active: true,
      createdAt: receipt?.created_at || new Date().toISOString(),
      updatedAt: receipt?.created_at || new Date().toISOString(),
    };
    return { success: true, activity: actObj, data: actObj, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Atualiza atividade padrão no Supabase.
 */
export async function updateStandardActivityRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeActivityId = null,
  maybeName = null,
  maybeDefaultDuration = null,
  maybeCategory = 'Liturgia',
  maybeDescription = null
) {
  let churchId, commandId, activityId, name, defaultDurationMinutes, category, description;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      activityId,
      name,
      defaultDurationMinutes,
      category = 'Liturgia',
      description = null,
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    activityId = maybeActivityId;
    name = maybeName;
    defaultDurationMinutes = maybeDefaultDuration;
    category = maybeCategory || 'Liturgia';
    description = maybeDescription;
  }

  if (!churchId || !activityId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const validation = validateStandardActivity(name, defaultDurationMinutes, category, description);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'update_standard_activity', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_activity_id: activityId,
      p_name: validation.cleanName,
      p_default_duration_minutes: validation.cleanDuration,
      p_category: validation.cleanCat,
      p_description: validation.cleanDesc || null,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Alterna status (ativo/inativo) de atividade padrão no Supabase.
 */
export async function toggleStandardActivityStatusRemote(supabaseClient, churchIdOrOpts, maybeActivityId = null, maybeActive = null) {
  let churchId, commandId, activityId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, activityId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    activityId = maybeActivityId;
  }

  if (!churchId || !activityId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'toggle_standard_activity_status', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_activity_id: activityId,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const active = receipt?.result_payload?.active ?? maybeActive;
    return { success: true, active, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}

/**
 * Exclui fisicamente atividade padrão sem histórico no Supabase.
 */
export async function deleteStandardActivityRemote(supabaseClient, churchIdOrOpts, maybeActivityId = null) {
  let churchId, commandId, activityId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, activityId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    activityId = maybeActivityId;
  }

  if (!churchId || !activityId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'delete_standard_activity', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_activity_id: activityId,
    });
    if (error) {
      return { success: false, error: eventTypeActivityErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: eventTypeActivityErrorMessage(err), rawError: err };
  }
}
