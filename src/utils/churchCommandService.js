/**
 * churchCommandService.js — Lógica de comando, validação, idempotência e elegibilidade
 * para o fluxo "Criar minha igreja".
 *
 * Princípios de segurança e confiabilidade:
 * - Validação e normalização canônica Unicode (NFC) no cliente antes do envio.
 * - Idempotência protegida por UUID (command_id) persistido no sessionStorage antes da RPC.
 * - Classificação estrita entre erros definitivos (rejeições de regras) e respostas incertas (rede/timeout).
 * - Reconciliação transparente de recibos para recuperação de conexões perdidas.
 * - Consulta e revalidação de elegibilidade no servidor (não assume permissão em caso de falha).
 */

export const STORAGE_KEY_PREFIX = 'escala_pending_church_cmd_';

/**
 * Valida e normaliza as entradas do formulário de criação de igreja.
 *
 * @param {object} input
 * @param {string} input.name - Nome da igreja (1 a 160 caracteres)
 * @param {string} input.creatorName - Nome do criador como membro (1 a 120 caracteres)
 * @param {string} input.timezone - Fuso horário IANA (obrigatório)
 * @param {string} [input.address] - Endereço (opcional, até 500 caracteres)
 * @param {string} [input.googleMapsUrl] - Link do Maps (opcional)
 * @param {string} [input.defaultDurationPolicy] - 'warn' ou 'block' (padrão 'warn')
 * @returns {{ isValid: boolean, errors: Record<string, string>, normalizedData: object }}
 */
export function validateAndNormalizeChurchInput(input = {}) {
  const errors = {};
  const rawName = input.name ?? '';
  const rawCreatorName = input.creatorName ?? '';
  const rawTimezone = input.timezone ?? '';
  const rawAddress = input.address ?? '';
  const rawMapsUrl = input.googleMapsUrl ?? '';
  const rawPolicy = input.defaultDurationPolicy ?? 'warn';

  // 1. Nome da igreja: normalização em NFC e limites 1-160
  const normalizedName = typeof rawName === 'string'
    ? rawName.normalize('NFC').trim()
    : '';

  if (!normalizedName) {
    errors.name = 'O nome da igreja é obrigatório.';
  } else if (normalizedName.length > 160) {
    errors.name = 'O nome da igreja deve ter no máximo 160 caracteres.';
  }

  // 2. Nome do criador como membro: normalização em NFC e limites 1-120
  const normalizedCreatorName = typeof rawCreatorName === 'string'
    ? rawCreatorName.normalize('NFC').trim()
    : '';

  if (!normalizedCreatorName) {
    errors.creatorName = 'Seu nome como membro é obrigatório.';
  } else if (normalizedCreatorName.length > 120) {
    errors.creatorName = 'Seu nome deve ter no máximo 120 caracteres.';
  }

  // 3. Fuso horário IANA: obrigatório
  const normalizedTimezone = typeof rawTimezone === 'string'
    ? rawTimezone.trim()
    : '';

  if (!normalizedTimezone) {
    errors.timezone = 'O fuso horário é obrigatório.';
  }

  // 4. Endereço: opcional, máximo 500 caracteres
  let normalizedAddress = null;
  if (typeof rawAddress === 'string') {
    const trimmed = rawAddress.normalize('NFC').trim();
    if (trimmed.length > 500) {
      errors.address = 'O endereço deve ter no máximo 500 caracteres.';
    } else if (trimmed.length > 0) {
      normalizedAddress = trimmed;
    }
  }

  // 5. Link Google Maps: opcional
  let normalizedMapsUrl = null;
  if (typeof rawMapsUrl === 'string') {
    const trimmed = rawMapsUrl.trim();
    if (trimmed.length > 0) {
      // Validação básica se começar com protocolo válido quando informado
      if (!/^https?:\/\//i.test(trimmed)) {
        errors.googleMapsUrl = 'O link do Google Maps deve começar com http:// ou https://';
      } else {
        normalizedMapsUrl = trimmed;
      }
    }
  }

  // 6. Política padrão de duração: 'warn' ou 'block'
  let normalizedPolicy = 'warn';
  if (rawPolicy === 'block') {
    normalizedPolicy = 'block';
  } else if (rawPolicy === 'warn') {
    normalizedPolicy = 'warn';
  } else {
    errors.defaultDurationPolicy = 'A política de duração deve ser "warn" (alerta) ou "block" (bloqueio).';
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    isValid,
    errors,
    normalizedData: {
      name: normalizedName,
      creatorName: normalizedCreatorName,
      timezone: normalizedTimezone,
      address: normalizedAddress,
      googleMapsUrl: normalizedMapsUrl,
      defaultDurationPolicy: normalizedPolicy,
    },
  };
}

/**
 * Obtém a chave de armazenamento de comando de igreja no sessionStorage.
 */
export function getChurchCommandStorageKey(userId) {
  if (!userId) return null;
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Salva um comando pendente de criação de igreja no storage de sessão.
 */
export function savePendingChurchCommand(storage, userId, command) {
  if (!storage || !userId || !command) return false;
  try {
    const key = getChurchCommandStorageKey(userId);
    storage.setItem(key, JSON.stringify(command));
    return true;
  } catch (err) {
    console.error('[churchCommandService] Falha ao salvar comando pendente:', err);
    return false;
  }
}

/**
 * Carrega comando pendente do usuário.
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
 * Classifica se a resposta de uma chamada é incerta (ex.: queda de conexão ou timeout).
 */
export function isUncertainResponse(error, data) {
  if (!error) {
    if (!data || (Array.isArray(data) && data.length === 0)) {
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
 * Classifica o resultado da checagem de recibo.
 */
export function classifyReceiptCheckResult(receiptData, receiptError) {
  if (receiptError) {
    return {
      status: 'RECEIPT_ERROR',
      shouldRetainCommand: true,
      error: receiptError,
    };
  }

  if (Array.isArray(receiptData) && receiptData.length > 0 && receiptData[0]?.church_id) {
    return {
      status: 'RECEIPT_FOUND',
      shouldRetainCommand: false,
      record: receiptData[0],
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
 * @returns {Promise<{ success: boolean, eligible: boolean, reason: string, activeAdminChurchName: string|null, error?: string }>}
 */
export async function checkChurchCreationEligibility(supabaseClient) {
  if (!supabaseClient) {
    return {
      success: false,
      eligible: false,
      reason: 'client_not_configured',
      activeAdminChurchName: null,
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
        error: error.message || 'Falha ao consultar elegibilidade no servidor.',
      };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        eligible: false,
        reason: 'empty_response',
        activeAdminChurchName: null,
        error: 'Resposta vazia do servidor.',
      };
    }

    const row = data[0];
    return {
      success: true,
      eligible: Boolean(row.eligible),
      reason: row.reason || '',
      activeAdminChurchName: row.active_admin_church_name || null,
    };
  } catch (unexpected) {
    console.error('[churchCommandService] Erro inesperado ao consultar elegibilidade:', unexpected);
    return {
      success: false,
      eligible: false,
      reason: 'unexpected_error',
      activeAdminChurchName: null,
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
  let pendingCmd = loadPendingChurchCommand(storage, userId);
  let commandId = pendingCmd?.commandId;

  if (!commandId) {
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
  }

  // 2. Executa a chamada RPC no servidor
  try {
    const { data, error } = await supabaseClient
      .schema('public')
      .rpc('create_my_church', {
        p_command_id: commandId,
        p_name: normalizedData.name,
        p_creator_name: normalizedData.creatorName,
        p_timezone: normalizedData.timezone,
        p_address: normalizedData.address,
        p_google_maps_url: normalizedData.googleMapsUrl,
        p_default_duration_policy: normalizedData.defaultDurationPolicy,
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

    // Sucesso confirmado
    removePendingChurchCommand(storage, userId);
    return {
      status: 'SUCCESS',
      data: data[0],
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
