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
  if (error.code === '42501' || error.code === '28000') {
    return 'Permissão insuficiente. Apenas administradores autorizados podem gerenciar motivos de cancelamento.';
  }
  if (error.code === '23505' || error.code === 'duplicate') {
    return 'Já existe um motivo de cancelamento cadastrado com este nome nesta igreja.';
  }
  if (error.code === '23503' || error.code === 'reason_in_use') {
    return 'Este motivo já foi utilizado em cancelamentos históricos e não pode ser excluído. Desative-o em vez de excluir.';
  }
  if (error.code === '23514' || error.code === '22023') {
    return 'Descrição do motivo inválida. Informe entre 1 e 120 caracteres.';
  }
  return error.message || 'Falha na operação de motivos de cancelamento.';
}
