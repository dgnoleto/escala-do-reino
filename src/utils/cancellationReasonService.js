/**
 * cancellationReasonService.js
 * Regras de validação, normalização e integridade para motivos de cancelamento (Issue #26).
 * Alinhado ao PRD §4 e §7.3 (Cenários M11 e M12).
 */

export const MAX_REASON_LENGTH = 120;
export const MIN_REASON_LENGTH = 1;

/**
 * Normaliza o texto com Unicode NFC e remove espaços nas extremidades (trim).
 */
export function normalizeNfcReason(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

/**
 * Converte um item (string ou objeto) para o formato padronizado de motivo.
 */
export function toReasonObject(item, index = 0) {
  if (!item) return null;
  if (typeof item === 'string') {
    return {
      id: `cr-legacy-${index + 1}`,
      name: normalizeNfcReason(item),
      active: true,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    id: item.id || `cr-${Date.now()}-${index}`,
    name: normalizeNfcReason(item.name || ''),
    active: item.active !== false,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
  };
}

/**
 * Filtra apenas motivos ativos disponíveis para seleção operacional na liturgia.
 */
export function getActiveReasons(reasons = []) {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map((r, idx) => (typeof r === 'object' ? r : toReasonObject(r, idx)))
    .filter(r => r && r.active !== false);
}

/**
 * Valida a descrição de um motivo de cancelamento.
 * - Obrigatório (1 a 120 caracteres)
 * - Normalizado em NFC e sem espaços redundantes
 * - Verificação de duplicidade por igreja (insensível a maiúsculas/minúsculas)
 */
export function validateCancellationReason(name, existingReasons = [], currentId = null) {
  const cleanName = normalizeNfcReason(name);

  if (!cleanName || cleanName.length < MIN_REASON_LENGTH) {
    return {
      valid: false,
      error: 'Descrição do motivo de cancelamento é obrigatória.',
      cleanName: '',
    };
  }

  if (cleanName.length > MAX_REASON_LENGTH) {
    return {
      valid: false,
      error: `O motivo deve ter no máximo ${MAX_REASON_LENGTH} caracteres.`,
      cleanName,
    };
  }

  const cleanLower = cleanName.toLowerCase();
  const isDuplicate = existingReasons.some(r => {
    const rObj = typeof r === 'object' ? r : { id: null, name: r };
    if (currentId && rObj.id === currentId) {
      return false;
    }
    const existingClean = normalizeNfcReason(rObj.name || '').toLowerCase();
    return existingClean === cleanLower;
  });

  if (isDuplicate) {
    return {
      valid: false,
      error: 'Já existe um motivo de cancelamento cadastrado com este nome nesta igreja.',
      cleanName,
    };
  }

  return {
    valid: true,
    error: null,
    cleanName,
  };
}

/**
 * Verifica se um motivo já foi utilizado em cancelamentos históricos de atividades.
 */
export function isReasonUsedInActivities(reasonIdOrName, activities = []) {
  if (!reasonIdOrName || !Array.isArray(activities)) return false;

  const targetId = typeof reasonIdOrName === 'object' ? reasonIdOrName.id : reasonIdOrName;
  const targetName = typeof reasonIdOrName === 'object'
    ? normalizeNfcReason(reasonIdOrName.name).toLowerCase()
    : normalizeNfcReason(reasonIdOrName).toLowerCase();

  return activities.some(act => {
    if (!act) return false;
    const isCancelled = act.status === 'cancelada' || Boolean(act.cancellationReason);
    if (!isCancelled) return false;

    if (act.cancellationReasonId && targetId && act.cancellationReasonId === targetId) {
      return true;
    }

    if (act.cancellationReason) {
      const actReasonName = normalizeNfcReason(act.cancellationReason).toLowerCase();
      if (actReasonName === targetName) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Avalia se o motivo pode ser excluído fisicamente ou se deve ser preservado via desativação.
 * CA03: Alterar ou desativar um motivo preserva a interpretação e referência dos cancelamentos históricos.
 */
export function canDeleteCancellationReason(reason, activities = []) {
  if (!reason) {
    return { canDelete: false, message: 'Motivo não informado.' };
  }

  const isUsed = isReasonUsedInActivities(reason, activities);
  if (isUsed) {
    return {
      canDelete: false,
      message: 'Este motivo já foi utilizado em cancelamentos históricos e não pode ser excluído; você pode desativá-lo para que não seja mais selecionado.',
    };
  }

  return {
    canDelete: true,
    message: null,
  };
}

/**
 * Mensagem padronizada de erro para operações de motivo de cancelamento.
 */
export function cancellationReasonErrorMessage(error) {
  if (!error) return 'Ocorreu um erro ao processar o motivo de cancelamento.';
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
    return 'Serviço de motivos temporariamente indisponível no servidor. Verifique se as migrações foram aplicadas.';
  }

  if (code === '42501' || code === '28000') {
    return 'Permissão insuficiente. Apenas administradores autorizados podem gerenciar motivos de cancelamento.';
  }
  if (code === '23505' || code === 'duplicate') {
    return 'Já existe um motivo de cancelamento cadastrado com este nome nesta igreja.';
  }
  if (code === '23503' || code === 'reason_in_use') {
    return 'Este motivo já foi utilizado em cancelamentos históricos e não pode ser excluído. Desative-o em vez de excluir.';
  }
  if (code === '23514' || code === '22023') {
    return 'Descrição do motivo inválida. Informe entre 1 e 120 caracteres.';
  }
  return error.message || 'Falha na operação de motivos de cancelamento.';
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
 * Consulta motivos de cancelamento persistidos da igreja no Supabase.
 */
export async function fetchCancellationReasonsRemote(supabaseClient, churchId, includeInactive = true) {
  if (!churchId) {
    return { success: false, data: [], error: 'Identificador da igreja não informado.' };
  }
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'list_cancellation_reasons', {
      p_church_id: churchId,
      p_only_active: !includeInactive,
    });
    if (error) {
      return { success: false, data: [], error: cancellationReasonErrorMessage(error), rawError: error };
    }
    const list = Array.isArray(data)
      ? data.map((item, idx) => toReasonObject(item, idx)).filter(Boolean)
      : [];
    return { success: true, data: list, error: null };
  } catch (err) {
    return { success: false, data: [], error: cancellationReasonErrorMessage(err), rawError: err };
  }
}

/**
 * Cria motivo de cancelamento remotamente no Supabase.
 */
export async function createCancellationReasonRemote(supabaseClient, churchIdOrOpts, maybeName = null) {
  let churchId, commandId, name;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, name } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    name = maybeName;
  }

  if (!churchId) {
    return { success: false, error: 'Identificador da igreja não informado.' };
  }
  const validation = validateCancellationReason(name);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_cancellation_reason', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_name: validation.cleanName,
    });
    if (error) {
      return { success: false, error: cancellationReasonErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const createdId = receipt?.id || receipt?.result_entity_id || receipt?.result_payload?.reason_id || `cr-${Date.now()}`;
    const reasonObj = {
      id: createdId,
      name: validation.cleanName,
      active: true,
      createdAt: receipt?.created_at || new Date().toISOString(),
      updatedAt: receipt?.created_at || new Date().toISOString(),
    };
    return { success: true, reason: reasonObj, data: reasonObj, receipt, error: null };
  } catch (err) {
    return { success: false, error: cancellationReasonErrorMessage(err), rawError: err };
  }
}

/**
 * Atualiza descrição de motivo de cancelamento no Supabase.
 */
export async function updateCancellationReasonRemote(supabaseClient, churchIdOrOpts, maybeReasonId = null, maybeName = null) {
  let churchId, commandId, reasonId, name;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, reasonId, name } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    reasonId = maybeReasonId;
    name = maybeName;
  }

  if (!churchId || !reasonId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const validation = validateCancellationReason(name);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'update_cancellation_reason', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_reason_id: reasonId,
      p_new_name: validation.cleanName,
    });
    if (error) {
      return { success: false, error: cancellationReasonErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: cancellationReasonErrorMessage(err), rawError: err };
  }
}

/**
 * Alterna status (ativo/inativo) de motivo no Supabase.
 */
export async function toggleCancellationReasonStatusRemote(supabaseClient, churchIdOrOpts, maybeReasonId = null, maybeActive = null) {
  let churchId, commandId, reasonId, active;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, reasonId, active = null } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    reasonId = maybeReasonId;
    active = maybeActive;
  }

  if (!churchId || !reasonId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'toggle_cancellation_reason_status', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_reason_id: reasonId,
      p_active: active !== null && active !== undefined ? Boolean(active) : true,
    });
    if (error) {
      return { success: false, error: cancellationReasonErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    const resolvedActive = receipt?.result_payload?.active ?? active;
    return { success: true, active: resolvedActive, receipt, error: null };
  } catch (err) {
    return { success: false, error: cancellationReasonErrorMessage(err), rawError: err };
  }
}

/**
 * Exclui fisicamente motivo sem histórico no Supabase.
 */
export async function deleteCancellationReasonRemote(supabaseClient, churchIdOrOpts, maybeReasonId = null) {
  let churchId, commandId, reasonId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, reasonId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    reasonId = maybeReasonId;
  }

  if (!churchId || !reasonId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'delete_cancellation_reason', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_reason_id: reasonId,
    });
    if (error) {
      return { success: false, error: cancellationReasonErrorMessage(error), rawError: error };
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    return { success: true, receipt, error: null };
  } catch (err) {
    return { success: false, error: cancellationReasonErrorMessage(err), rawError: err };
  }
}
