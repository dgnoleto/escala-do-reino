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
  if (error.code === '42501' || error.code === '28000') {
    return 'Permissão insuficiente. Apenas administradores autorizados podem gerenciar tipos e atividades.';
  }
  if (error.code === '23505' || error.code === 'duplicate') {
    return 'Já existe um cadastro com este nome nesta igreja.';
  }
  if (error.code === '23503' || error.code === 'reference_in_use') {
    return 'Este item já foi utilizado em cultos históricos e não pode ser excluído. Desative-o em vez de excluir.';
  }
  if (error.code === '23514' || error.code === '22023') {
    return 'Dados informados inválidos. Verifique os campos preenchidos e a duração em minutos.';
  }
  return error.message || 'Falha na operação de tipos de evento e atividades.';
}
