/**
 * Escala do Reino — churchCommandService.js
 *
 * Módulo de cliente para o ciclo de comandos de criação de igreja ("Criar minha igreja").
 * Garante idempotência, retenção de comando em voo, normalização NFC e classificação estrita
 * de respostas entre confirmações válidas, rejeições definitivas e respostas incertas.
 */

export const STORAGE_KEY_PREFIX = 'church_creation_cmd_';
const GOOGLE_MAPS_REGEX = /^https:\/\/(maps\.app\.goo\.gl\/|goo\.gl\/maps\/|(www\.)?google\.(com(\.[a-z]{2})?|[a-z]{2})\/maps|maps\.google\.(com(\.[a-z]{2})?|[a-z]{2})\/).*$/i;

/**
 * Normaliza um texto para a forma canônica pré-composta Unicode NFC e remove espaços extras nas pontas.
 */
export function normalizeNfcText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

/**
 * Valida e normaliza os dados de criação de uma igreja antes do envio.
 *
 * @param {object} input
 * @param {string} input.name - Nome da igreja (1 a 160 caracteres)
 * @param {string} input.creatorName - Nome do criador como membro (1 a 120 caracteres)
 * @param {string} input.timezone - Fuso horário IANA válido
 * @param {string} [input.address] - Endereço físico (máx. 500 caracteres)
 * @param {string} [input.googleMapsUrl] - Link do Google Maps (opcional)
 * @param {string} [input.defaultDurationPolicy] - 'warn' ou 'block' (padrão 'warn')
 * @returns {{ isValid: boolean, errors: Record<string, string>, normalizedData: object }}
 */
export function validateAndNormalizeChurchInput(input = {}) {
  const errors = {};

  const cleanName = normalizeNfcText(input.name || '');
  if (!cleanName) {
    errors.name = 'Nome da igreja é obrigatório.';
  } else if (cleanName.length > 160) {
    errors.name = 'Nome da igreja não pode exceder 160 caracteres.';
  }

  const cleanCreatorName = normalizeNfcText(input.creatorName || '');
  if (!cleanCreatorName) {
    errors.creatorName = 'Nome do criador é obrigatório.';
  } else if (cleanCreatorName.length > 120) {
    errors.creatorName = 'Nome do criador não pode exceder 120 caracteres.';
  }

  const cleanTimezone = (input.timezone || '').trim();
  if (!cleanTimezone) {
    errors.timezone = 'Fuso horário é obrigatório.';
  }

  let cleanAddress = null;
  if (input.address && typeof input.address === 'string') {
    const trimmedAddress = input.address.trim();
    if (trimmedAddress.length > 0) {
      if (trimmedAddress.length > 500) {
        errors.address = 'Endereço não pode exceder 500 caracteres.';
      } else {
        cleanAddress = trimmedAddress;
      }
    }
  }

  let cleanMapsUrl = null;
  if (input.googleMapsUrl && typeof input.googleMapsUrl === 'string') {
    const trimmedUrl = input.googleMapsUrl.trim();
    if (trimmedUrl.length > 0) {
      if (!GOOGLE_MAPS_REGEX.test(trimmedUrl)) {
        errors.googleMapsUrl = 'Link do Google Maps deve ser uma URL válida de compartilhamento do Google Maps.';
      } else {
        cleanMapsUrl = trimmedUrl;
      }
    }
  }

  const policy = (input.defaultDurationPolicy || 'warn').trim();
  if (policy !== 'warn' && policy !== 'block') {
    errors.defaultDurationPolicy = 'Política de duração deve ser "warn" ou "block".';
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    isValid,
    errors,
    normalizedData: {
      name: cleanName,
      creatorName: cleanCreatorName,
      timezone: cleanTimezone,
      address: cleanAddress,
      googleMapsUrl: cleanMapsUrl,
      defaultDurationPolicy: policy,
    },
  };
}

/**
 * Obtém a chave de armazenamento de sessão para um usuário.
 */
export function getChurchCommandStorageKey(userId) {
  if (!userId) return null;
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Salva um comando pendente no storage de sessão com isolamento por usuário.
 * Impede que um comando pendente seja silenciosamente substituído por outro commandId.
 */
export function savePendingChurchCommand(storage, userId, command) {
  if (!storage || !userId || !command) return false;
  try {
    const key = getChurchCommandStorageKey(userId);
    const existing = loadPendingChurchCommand(storage, userId);
    if (existing && existing.commandId && existing.commandId !== command.commandId) {
      console.warn('[churchCommandService] Tentativa de sobrescrever comando pendente bloqueada.');
      return false;
    }
    storage.setItem(key, JSON.stringify(command));
    return true;
  } catch (err) {
    console.error('[churchCommandService] Falha ao salvar comando pendente:', err);
    return false;
  }
}

/**
 * Carrega o comando pendente de criação de igreja para o usuário informado.
 */
export function loadPendingChurchCommand(storage, userId) {
  if (!storage || !userId) return null;
  try {
    const key = getChurchCommandStorageKey(userId);
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[churchCommandService] Falha ao carregar comando pendente:', err);
    return null;
  }
}

/**
 * Remove comando pendente do usuário.
 */
export function removePendingChurchCommand(storage, userId) {
  if (!storage || !userId) return;
  try {
    const key = getChurchCommandStorageKey(userId);
    storage.removeItem(key);
  } catch (err) {
    console.error('[churchCommandService] Falha ao remover comando pendente:', err);
  }
}

/**
 * Limpa todos os comandos pendentes de igreja de qualquer conta.
 */
export function clearAllChurchCommandStorage(storage) {
  if (!storage) return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => storage.removeItem(k));
  } catch (err) {
    console.error('[churchCommandService] Falha ao limpar storage de igreja:', err);
  }
}

/**
 * Classifica se um erro retornado pelo servidor é uma rejeição definitiva.
 */
export function isDefinitiveServerError(error) {
  if (!error) return false;
  const code = String(error.code || error.status || '');
  const message = String(error.message || '').toLowerCase();

  // Códigos Postgres comuns de regras de negócio
  if (['23505', '23514', '22004', '42501', '28000', 'P0002', 'P0004'].includes(code)) {
    return true;
  }

  // HTTP 4xx (exceto 408 Timeout)
  if (code.startsWith('4') && code !== '408') {
    return true;
  }

  // Mensagens típicas de validação ou restrição
  if (
    message.includes('inelegível') ||
    message.includes('já possui administração') ||
    message.includes('já executado com parâmetros diferentes') ||
    message.includes('não autorizado') ||
    message.includes('obrigatório') ||
    message.includes('inválido')
  ) {
    return true;
  }

  return false;
}

/**
 * Classifica se a resposta de uma chamada é incerta (ex.: queda de conexão, 5xx ou resposta vazia/incompleta).
 */
export function isUncertainResponse(error, data) {
  if (!error) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return true;
    }
    if (Array.isArray(data) && !isValidChurchCreationResponse(data[0])) {
      return true;
    }
    return false;
  }

  if (isDefinitiveServerError(error)) {
    return false;
  }

  const code = String(error.code || error.status || '');
  const message = String(error.message || '').toLowerCase();

  // Erros de rede, transporte ou timeouts
  if (
    code === '408' ||
    code.startsWith('5') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('failed to fetch') ||
    message.includes('aborted')
  ) {
    return true;
  }

  return true;
}

/**
 * Valida se um objeto retornado por create_my_church possui todos os identificadores e privilégios essenciais.
 */
export function isValidChurchCreationResponse(row) {
  if (!row || typeof row !== 'object') return false;
  if (!row.church_id || typeof row.church_id !== 'string') return false;
  if (!row.member_id || typeof row.member_id !== 'string') return false;
  if (row.is_admin !== true) return false;
  return true;
}

/**
 * Valida se um registro retornado por get_create_church_receipt possui identificadores e autorização ativos.
 */
export function isValidChurchReceiptRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (!record.church_id || typeof record.church_id !== 'string') return false;
  if (!record.member_id || typeof record.member_id !== 'string') return false;
  if (record.is_admin !== true) return false;
  return true;
}

/**
 * Classifica o resultado da checagem de recibo.
 * Não descarta o comando pendente se o recibo estiver incompleto ou se houver erro de consulta.
 */
export function classifyReceiptCheckResult(receiptData, receiptError) {
  if (receiptError) {
    if (isDefinitiveServerError(receiptError)) {
      return {
        status: 'RECEIPT_DEFINITIVE_ERROR',
        shouldRetainCommand: false,
        error: receiptError,
      };
    }
    return {
      status: 'RECEIPT_ERROR',
      shouldRetainCommand: true,
      error: receiptError,
    };
  }

  if (Array.isArray(receiptData) && receiptData.length > 0) {
    const row = receiptData[0];
    if (isValidChurchReceiptRecord(row)) {
      return {
        status: 'RECEIPT_FOUND',
        shouldRetainCommand: false,
        record: row,
      };
    }
    // Recibo retornado com dados insuficientes (ex.: apenas church_id sem member_id ou sem is_admin)
    return {
      status: 'RECEIPT_INCOMPLETE',
      shouldRetainCommand: true,
      record: null,
      error: 'Recibo retornado pelo servidor está incompleto ou sem privilégio administrativo ativo.',
    };
  }

  // Recibo ainda não encontrado ou comando não concluído
  return {
    status: 'RECEIPT_EMPTY',
    shouldRetainCommand: true,
    record: null,
  };
}

/**
 * Consulta a elegibilidade da conta autenticada para criar uma igreja.
 *
 * @param {object} supabaseClient
 * @returns {Promise<{ success: boolean, eligible: boolean, reason: string, activeAdminChurchName: string|null, activeAdminChurchId: string|null, error?: string }>}
 */
export async function checkChurchCreationEligibility(supabaseClient) {
  if (!supabaseClient) {
    return {
      success: false,
      eligible: false,
      reason: 'client_not_configured',
      activeAdminChurchName: null,
      activeAdminChurchId: null,
      error: 'Supabase não configurado.',
    };
  }

  try {
    const { data, error } = await supabaseClient
      .schema('public')
      .rpc('check_church_creation_eligibility');

    if (error) {
      console.error('[churchCommandService] Erro ao consultar elegibilidade:', error);
      return {
        success: false,
        eligible: false,
        reason: 'rpc_error',
        activeAdminChurchName: null,
        activeAdminChurchId: null,
        error: error.message || 'Falha ao consultar elegibilidade no servidor.',
      };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        eligible: false,
        reason: 'empty_response',
        activeAdminChurchName: null,
        activeAdminChurchId: null,
        error: 'Resposta vazia do servidor.',
      };
    }

    const row = data[0];
    return {
      success: true,
      eligible: Boolean(row.eligible),
      reason: row.reason || '',
      activeAdminChurchName: row.active_admin_church_name || null,
      activeAdminChurchId: row.active_admin_church_id || null,
    };
  } catch (unexpected) {
    console.error('[churchCommandService] Erro inesperado ao consultar elegibilidade:', unexpected);
    return {
      success: false,
      eligible: false,
      reason: 'unexpected_error',
      activeAdminChurchName: null,
      activeAdminChurchId: null,
      error: unexpected.message || 'Erro inesperado ao consultar elegibilidade.',
    };
  }
}

/**
 * Consulta recibo de comando de criação de igreja para recuperação.
 */
export async function checkChurchReceipt({ supabaseClient, commandId }) {
  if (!supabaseClient || !commandId) {
    return classifyReceiptCheckResult(null, new Error('Parâmetros inválidos para recibo.'));
  }

  try {
    const { data, error } = await supabaseClient
      .schema('public')
      .rpc('get_create_church_receipt', {
        p_command_id: commandId,
      });

    return classifyReceiptCheckResult(data, error);
  } catch (err) {
    return classifyReceiptCheckResult(null, err);
  }
}

/**
 * Ciclo completo de envio de comando de criação de igreja com idempotência.
 *
 * @param {object} params
 * @param {object} params.supabaseClient
 * @param {Storage} params.storage
 * @param {string} params.userId
 * @param {object} params.churchData
 * @returns {Promise<{ status: 'SUCCESS'|'UNCERTAIN'|'DEFINITIVE_ERROR'|'STORAGE_ERROR', data?: object, error?: string, commandId?: string }>}
 */
export async function dispatchChurchCreation({
  supabaseClient,
  storage,
  userId,
  churchData,
}) {
  if (!userId) {
    return { status: 'DEFINITIVE_ERROR', error: 'Usuário não autenticado.' };
  }

  const { isValid, errors, normalizedData } = validateAndNormalizeChurchInput(churchData);
  if (!isValid) {
    const firstMsg = Object.values(errors)[0] || 'Dados inválidos.';
    return { status: 'DEFINITIVE_ERROR', error: firstMsg };
  }

  // 1. Identifica se já existe comando pendente em voo para o usuário ou gera novo
  const pendingCmd = loadPendingChurchCommand(storage, userId);
  let commandId = pendingCmd?.commandId;
  let dataToSend = normalizedData;

  if (pendingCmd?.commandId && pendingCmd?.churchData) {
    commandId = pendingCmd.commandId;
    // Uma retentativa deve usar integralmente os parâmetros persistidos no storage
    dataToSend = pendingCmd.churchData;
  } else {
    commandId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });

    const saved = savePendingChurchCommand(storage, userId, {
      commandId,
      churchData: normalizedData,
      createdAt: new Date().toISOString(),
    });

    if (!saved) {
      return {
        status: 'STORAGE_ERROR',
        error: 'Não foi possível salvar o comando na sessão. Operação cancelada por segurança.',
      };
    }
    dataToSend = normalizedData;
  }

  // 2. Executa a chamada RPC no servidor
  try {
    const { data, error } = await supabaseClient
      .schema('public')
      .rpc('create_my_church', {
        p_command_id: commandId,
        p_name: dataToSend.name,
        p_creator_name: dataToSend.creatorName,
        p_timezone: dataToSend.timezone,
        p_address: dataToSend.address,
        p_google_maps_url: dataToSend.googleMapsUrl,
        p_default_duration_policy: dataToSend.defaultDurationPolicy,
      });

    if (error) {
      if (isDefinitiveServerError(error)) {
        removePendingChurchCommand(storage, userId);
        return {
          status: 'DEFINITIVE_ERROR',
          error: error.message || 'Erro definitivo ao criar igreja.',
          commandId,
        };
      }

      // Resposta incerta (queda de conexão, timeout, 5xx)
      return {
        status: 'UNCERTAIN',
        error: error.message || 'Resposta incerta do servidor. Verificando resultado...',
        commandId,
      };
    }

    if (!data || data.length === 0) {
      return {
        status: 'UNCERTAIN',
        error: 'Resposta vazia do servidor após criação.',
        commandId,
      };
    }

    const row = data[0];
    if (!isValidChurchCreationResponse(row)) {
      // Resposta com payload incompleto ou inesperado (ex.: data = [{}])
      return {
        status: 'UNCERTAIN',
        error: 'Resposta incompleta ou sem identificadores válidos do servidor.',
        commandId,
      };
    }

    // Sucesso confirmado com dados íntegros
    removePendingChurchCommand(storage, userId);
    return {
      status: 'SUCCESS',
      data: row,
      commandId,
    };
  } catch (unexpected) {
    if (isDefinitiveServerError(unexpected)) {
      removePendingChurchCommand(storage, userId);
      return {
        status: 'DEFINITIVE_ERROR',
        error: unexpected.message || 'Erro ao processar criação.',
        commandId,
      };
    }

    return {
      status: 'UNCERTAIN',
      error: unexpected.message || 'Conexão interrompida durante o envio.',
      commandId,
    };
  }
}
