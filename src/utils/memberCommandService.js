/**
 * memberCommandService.js — Serviços e utilitários compartilhados para o ciclo de comando de membros.
 *
 * Centraliza a lógica de:
 * 1. Normalização e validação de nomes (Unicode NFC);
 * 2. Classificação de erros definitivos vs incertos;
 * 3. Gestão de persistência e isolamento no sessionStorage por conta e igreja;
 * 4. Determinação de transição de sessão no AuthContext (diferenciando restauração inicial de troca de conta);
 * 5. Reconciliação e preservação de comandos incertos após falhas ou consultas de recibo.
 */

/**
 * Classifica erros retornados pelo servidor ou PostgREST/Postgres.
 * Rejeições definitivas encerram o ciclo do comando; erros de transporte/rede retêm o comando para reconciliação.
 *
 * @param {object|Error|null} error - Objeto retornado na chave error do SDK ou capturado em catch
 * @returns {boolean} true se o erro for uma rejeição definitiva pelo servidor
 */
export function isDefinitiveServerError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const status = Number(error.status || 0);

  // Códigos Postgres de validação, restrição, privilégio ou regra de negócio
  // 42501 = privilégio insuficiente / não autorizado
  // 23514 = check constraint (comprimento de nome inválido)
  // 22004 = parâmetro obrigatório nulo
  // 23505 = violação de unicidade / parâmetros divergentes para mesmo command_id
  // P0002 = igreja não encontrada ou inativa
  // P0004 = limite de requisições excedido
  if (['42501', '23514', '22004', '23505', 'P0002', 'P0004'].includes(code)) {
    return true;
  }

  // HTTP 4xx (exceto 408 Request Timeout)
  if (status >= 400 && status < 500 && status !== 408) {
    return true;
  }

  const msg = String(error.message || '').toLowerCase();
  if (
    msg.includes('não autenticado') ||
    msg.includes('não autorizado') ||
    msg.includes('entre 1 e 120') ||
    msg.includes('parâmetros diferentes') ||
    msg.includes('obrigatório') ||
    msg.includes('não encontrada ou inativa') ||
    msg.includes('limite de requisições excedido')
  ) {
    return true;
  }

  return false;
}

/**
 * Avalia se o resultado de uma criação RPC representa uma resposta incerta.
 *
 * @param {object|Error|null} error - Erro retornado ou capturado
 * @param {Array|null} data - Dados retornados pelo endpoint
 * @returns {boolean} true se a resposta for incerta (falha de rede, timeout, 5xx ou payload malformado)
 */
export function isUncertainResponse(error, data) {
  if (error) {
    return !isDefinitiveServerError(error);
  }
  // Se não houve erro, mas a resposta de sucesso esperada está ausente ou vazia: formato inválido
  if (!Array.isArray(data) || data.length === 0 || !data[0]?.member_id) {
    return true;
  }
  return false;
}

/**
 * Normaliza o nome do membro em Unicode canônico (NFC) e valida limites de comprimento (1 a 120 caracteres).
 * Preserva acentos, cedilhas e apóstrofos intactos.
 *
 * @param {string} rawName
 * @returns {{ valid: boolean, normalizedName: string, error?: string }}
 */
export function validateAndNormalizeMemberName(rawName) {
  if (typeof rawName !== 'string') {
    return { valid: false, normalizedName: '', error: 'Informe o nome do membro.' };
  }
  const trimmed = rawName.trim();
  if (!trimmed) {
    return { valid: false, normalizedName: '', error: 'Informe o nome do membro.' };
  }
  const normalized = trimmed.normalize('NFC');
  if (normalized.length < 1 || normalized.length > 120) {
    return { valid: false, normalizedName: normalized, error: 'O nome deve ter entre 1 e 120 caracteres.' };
  }
  return { valid: true, normalizedName: normalized };
}

/**
 * Constrói a chave de armazenamento isolada por usuário e igreja.
 *
 * @param {string} userId - UID do usuário autenticado
 * @param {string} churchId - UUID da igreja
 * @returns {string|null}
 */
export function getMemberCommandStorageKey(userId, churchId) {
  if (!userId || !churchId) return null;
  return `escala_pending_member_cmd:${userId}:${churchId}`;
}

/**
 * Salva com segurança um comando de criação de membro pendente no storage de sessão.
 *
 * @param {Storage|object} storage - window.sessionStorage ou mock nos testes
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.churchId
 * @param {string} params.commandId
 * @param {string} params.displayName
 * @returns {boolean} true se gravado com sucesso
 */
export function savePendingMemberCommand(storage, { userId, churchId, commandId, displayName }) {
  if (!storage || !userId || !churchId || !commandId || !displayName) return false;
  const key = getMemberCommandStorageKey(userId, churchId);
  if (!key) return false;
  try {
    const payload = {
      commandId,
      userId,
      churchId,
      displayName,
      createdAt: new Date().toISOString(),
    };
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('[memberCommandService] Falha ao salvar comando pendente:', err);
    return false;
  }
}

/**
 * Recupera um comando pendente do storage, validando que pertence ao usuário e à igreja atuais.
 *
 * @param {Storage|object} storage
 * @param {string} userId
 * @param {string} churchId
 * @returns {object|null}
 */
export function loadPendingMemberCommand(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return null;
  const key = getMemberCommandStorageKey(userId, churchId);
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.commandId &&
      parsed?.churchId === churchId &&
      parsed?.userId === userId &&
      parsed?.displayName
    ) {
      return parsed;
    }
    // Dado inválido, malformado ou de outra conta: remove
    storage.removeItem(key);
    return null;
  } catch {
    try { storage.removeItem(key); } catch {}
    return null;
  }
}

/**
 * Remove o comando pendente para a conta e igreja especificadas.
 *
 * @param {Storage|object} storage
 * @param {string} userId
 * @param {string} churchId
 * @returns {boolean}
 */
export function removePendingMemberCommand(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return false;
  const key = getMemberCommandStorageKey(userId, churchId);
  if (!key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove todos os comandos pendentes de membros no storage de sessão.
 * Chamado estritamente em logout ou em troca efetiva de conta.
 *
 * @param {Storage|object} storage
 */
export function clearAllMemberCommandStorage(storage) {
  if (!storage) return;
  try {
    const keysToRemove = [];
    const len = storage.length || 0;
    for (let i = 0; i < len; i++) {
      const key = storage.key(i);
      if (key && key.startsWith('escala_pending_member_cmd:')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => storage.removeItem(k));
  } catch (err) {
    console.warn('[memberCommandService] Falha ao limpar storage de sessão de membros:', err);
  }
}

/**
 * Determina o tipo de transição de autenticação e se o storage de comandos deve ser limpo.
 * Distingue rigorosamente a restauração inicial de sessão (recarga da página) de uma troca
 * efetiva de conta ou logout, evitando apagar comandos pendentes da mesma conta.
 *
 * @param {object} params
 * @param {string|null} params.previousUserId - ID do usuário anteriormente registrado no ref
 * @param {string|null} params.newUserId - ID do usuário da nova sessão
 * @param {number} params.currentGen - Geração do evento de autenticação disparado
 * @param {number} params.authGen - Geração mais recente conhecida
 * @returns {{ type: 'STALE_EVENT'|'LOGOUT'|'UNAUTHENTICATED'|'INITIAL_SESSION'|'SAME_USER'|'ACCOUNT_SWITCH', isStale: boolean, shouldClearMemberStorage: boolean }}
 */
export function determineAuthTransition({ previousUserId, newUserId, currentGen, authGen }) {
  if (currentGen < authGen) {
    return { type: 'STALE_EVENT', isStale: true, shouldClearMemberStorage: false };
  }

  // 1. Deslogado / Logout
  if (!newUserId) {
    return {
      type: previousUserId ? 'LOGOUT' : 'UNAUTHENTICATED',
      isStale: false,
      shouldClearMemberStorage: !!previousUserId,
    };
  }

  // 2. Restauração inicial de sessão (montagem do app ou F5/recarga com conta logada)
  // previousUserId é null porque o ref inicia em null.
  // NÃO deve limpar o storage para preservar comandos pendentes de reconciliação da mesma conta.
  if (previousUserId === null) {
    return {
      type: 'INITIAL_SESSION',
      isStale: false,
      shouldClearMemberStorage: false,
    };
  }

  // 3. Mesma conta (ex.: renovação de token pelo SDK)
  if (previousUserId === newUserId) {
    return {
      type: 'SAME_USER',
      isStale: false,
      shouldClearMemberStorage: false,
    };
  }

  // 4. Troca efetiva de conta (usuário A para usuário B)
  // Deve limpar o storage para garantir isolamento e evitar que o usuário B veja dados do A.
  return {
    type: 'ACCOUNT_SWITCH',
    isStale: false,
    shouldClearMemberStorage: true,
  };
}

/**
 * Classifica o resultado da consulta do recibo de criação de membro (public.get_create_member_receipt).
 *
 * REGRA CRÍTICA: Falha na consulta (seja erro de transporte ou erro do servidor) NÃO comprova que
 * a criação anterior deixou de ocorrer. O comando DEVE ser preservado para nova verificação ou
 * reexecução idempotente.
 *
 * @param {object|Error|null} error - Erro retornado pelo SDK
 * @param {Array|null} data - Array retornado pela RPC
 * @returns {{ status: 'CONFIRMED'|'EMPTY_RECEIPT'|'ERROR', member?: object, shouldPreserveCommand: boolean, message?: string }}
 */
export function classifyReceiptCheckResult(error, data) {
  if (error) {
    // Falha na consulta do recibo NÃO descarta o comando!
    return {
      status: 'ERROR',
      shouldPreserveCommand: true,
      error,
      message:
        'Falha ao consultar o recibo no servidor (' +
        (error.message || 'erro de rede') +
        '). A identidade da operação pendente foi preservada. ' +
        'Você pode tentar verificar novamente ou reexecutar o cadastro com segurança.',
    };
  }

  if (Array.isArray(data) && data.length > 0 && data[0]?.member_id) {
    return {
      status: 'CONFIRMED',
      member: data[0],
      shouldPreserveCommand: false,
    };
  }

  // Retorno vazio: recibo ainda não localizado. NÃO comprova que a criação não ocorreu.
  return {
    status: 'EMPTY_RECEIPT',
    shouldPreserveCommand: true,
    message:
      'O recibo ainda não consta no banco de dados. O registro pode estar em processamento ou não ter sido recebido. ' +
      'Você pode verificar novamente ou reexecutar o cadastro com segurança usando a mesma chave.',
  };
}
