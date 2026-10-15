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
  // P0018 = vínculo ativo legado nesta igreja (restauração bloqueada)
  // P0019 = conflito de estado/revisão (membro já ativo ou modificado por outro operador)
  // P0021 = funcionalidade indisponível (módulo de escalas / liturgia pendente)
  if (['42501', '23514', '22004', '23505', 'P0002', 'P0004', 'P0018', 'P0019', 'P0021'].includes(code)) {
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
    msg.includes('limite de requisições excedido') ||
    msg.includes('vínculo ativo legado') ||
    msg.includes('acesso ativo legado') ||
    msg.includes('p0018') ||
    msg.includes('modificado por outro operador') ||
    msg.includes('já se encontra ativo') ||
    msg.includes('p0019') ||
    msg.includes('módulo de escalas') ||
    msg.includes('exclusão indisponível') ||
    msg.includes('p0021')
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
export function isUncertainResponse(error, data, expectedContext = null) {
  if (error) {
    return !isDefinitiveServerError(error);
  }
  if (!Array.isArray(data) || data.length === 0 || !data[0] || typeof data[0] !== 'object') {
    return true;
  }
  const item = data[0];

  // Caso de ciclo de vida (restore_member ou deactivate_member):
  // exige command_id, action, church_id, result_member_id e result_payload
  if (
    expectedContext?.action === 'restore_member' ||
    expectedContext?.action === 'deactivate_member' ||
    expectedContext?.operation === 'lifecycle' ||
    item.action === 'restore_member' ||
    item.action === 'deactivate_member'
  ) {
    if (expectedContext?.commandId && item.command_id !== expectedContext.commandId) return true;
    if (expectedContext?.action && item.action !== expectedContext.action) return true;
    if (expectedContext?.churchId && item.church_id !== expectedContext.churchId) return true;
    if (expectedContext?.memberId && item.result_member_id !== expectedContext.memberId) return true;

    const payload = item.result_payload;
    if (
      !item.command_id ||
      !item.action ||
      !item.church_id ||
      !item.result_member_id ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      return true;
    }

    if (item.action === 'restore_member') {
      if (
        payload.member_id !== item.result_member_id ||
        payload.status !== 'active' ||
        typeof payload.updated_at !== 'string' ||
        !payload.updated_at.trim() ||
        typeof payload.has_revoked_access !== 'boolean'
      ) {
        return true;
      }
    }
    return false;
  }

  // Caso de criação de membro (padrão):
  // member_id é estritamente obrigatório. Retorno contendo apenas command_id (ex.: { command_id: 'outro-comando' })
  // NÃO é aceito como sucesso e permanece incerto.
  if (expectedContext?.commandId && item.command_id && item.command_id !== expectedContext.commandId) {
    return true;
  }
  if (expectedContext?.churchId && item.church_id && item.church_id !== expectedContext.churchId) {
    return true;
  }
  if (!item.member_id) {
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
 * Não sobrescreve comando anterior não resolvido com commandId diferente.
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
    const existingRaw = storage.getItem(key);
    if (existingRaw !== null && existingRaw !== undefined) {
      let existing;
      try {
        existing = JSON.parse(existingRaw);
      } catch (parseErr) {
        console.warn('[memberCommandService] Conteúdo ilegível/corrompido no storage de sessão. Envio bloqueado para preservar a chave sem sobrescrevê-la.', parseErr);
        return false;
      }
      if (existing?.commandId) {
        if (existing.commandId !== commandId) {
          console.warn('[memberCommandService] Tentativa de sobrescrever comando de criação anterior. Operação bloqueada.');
          return false;
        }
        // Recusa alteração de parâmetros do mesmo command_id
        if (
          existing.userId !== userId ||
          existing.churchId !== churchId ||
          existing.displayName !== displayName
        ) {
          console.warn('[memberCommandService] Tentativa de alterar parâmetros para o mesmo commandId de criação. Operação bloqueada.');
          return false;
        }
        // Reenvio idêntico preservado
        return true;
      }
    }
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
 * Falhas de leitura do storage ou exceções de parsing NÃO apagam a chave.
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
    return null;
  } catch (err) {
    console.warn('[memberCommandService] Falha ao ler comando pendente do storage:', err);
    return null;
  }
}

/**
 * Remove o comando pendente para a conta e igreja especificadas.
 * Se expectedCommandId for informado, remove apenas se o comando no storage corresponder.
 *
 * @param {Storage|object} storage
 * @param {string} userId
 * @param {string} churchId
 * @param {string|null} [expectedCommandId]
 * @returns {boolean}
 */
export function removePendingMemberCommand(storage, userId, churchId, expectedCommandId = null) {
  if (!storage || !userId || !churchId) return false;
  const key = getMemberCommandStorageKey(userId, churchId);
  if (!key) return false;
  try {
    if (expectedCommandId) {
      const raw = storage.getItem(key);
      if (!raw) return true;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.commandId && parsed.commandId !== expectedCommandId) {
          console.warn('[memberCommandService] Tentativa de remover comando pendente com commandId divergente do armazenado. Remoção bloqueada.');
          return false;
        }
      } catch {
        // Se corrompido, não remover indiscriminadamente por correspondência de comando
        return false;
      }
    }
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
      if (
        key &&
        (key.startsWith('escala_pending_member_cmd:') ||
          key.startsWith('escala_pending_member_lifecycle_cmd:'))
      ) {
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

/**
 * Executa o fluxo de envio do comando de criação de membro garantindo que:
 * 1. O comando é persistido no storage antes da RPC;
 * 2. Se a persistência falhar (storage indisponível, quota esgotada ou erro), a execução é
 *    estritamente interrompida ANTES de chamar a RPC;
 * 3. Se persistido, executa a RPC e classifica a resposta (incerta, erro definitivo ou sucesso).
 *
 * @param {object} params
 * @param {Storage|object|null} params.storage - window.sessionStorage ou mock
 * @param {Function} params.rpcCaller - Função assíncrona que executa a RPC no Supabase
 * @param {string} params.churchId - UUID da igreja
 * @param {string} params.userId - UID do usuário autenticado
 * @param {string} params.commandId - UUID único do comando
 * @param {string} params.displayName - Nome normalizado do membro
 * @returns {Promise<{
 *   status: 'STORAGE_FAILED'|'UNCERTAIN'|'DEFINITIVE_ERROR'|'SUCCESS'|'ABORTED',
 *   pendingCmd?: object,
 *   created?: object,
 *   rpcError?: object|Error,
 *   message: string,
 *   rpcCalled: boolean
 * }>}
 */
export async function dispatchMemberCreation({
  storage,
  rpcCaller,
  churchId,
  userId,
  commandId,
  displayName,
  isCurrentContext,
}) {
  if (!churchId || !userId || !commandId || !displayName) {
    return {
      status: 'ABORTED',
      rpcCalled: false,
      message: 'Parâmetros obrigatórios ausentes para criação de membro.',
    };
  }

  const pendingCmd = {
    commandId,
    churchId,
    userId,
    displayName,
    timestamp: Date.now(),
  };

  // 1. Tenta persistir no storage ANTES de qualquer envio de rede
  const isSaved = savePendingMemberCommand(storage, pendingCmd);
  if (!isSaved) {
    // Interrompe ANTES da RPC! Não envia operação cuja identidade não possa ser recuperada.
    return {
      status: 'STORAGE_FAILED',
      rpcCalled: false,
      pendingCmd,
      message:
        'Armazenamento local da sessão indisponível. Não foi possível registrar a identidade ' +
        'da operação para garantir sua recuperação caso ocorra recarga ou falha de rede. O envio foi cancelado.',
    };
  }

  // 2. Dispara a chamada RPC
  let rpcData = null;
  let rpcError = null;

  try {
    const res = await rpcCaller({
      p_church_id: churchId,
      p_command_id: commandId,
      p_display_name: displayName,
    });
    rpcData = res?.data;
    rpcError = res?.error;
  } catch (networkErr) {
    rpcError = networkErr;
  }

  // Proteção de contexto ativo após await: se o contexto mudou na tela, encerra sem efeitos colaterais
  if (typeof isCurrentContext === 'function' && !isCurrentContext()) {
    return {
      status: 'CONTEXT_CHANGED',
      rpcCalled: true,
      pendingCmd,
      message: 'O contexto ativo mudou durante a criação do membro.',
    };
  }

  // 3. Avalia resposta incerta (queda de conexão, timeout, 5xx ou payload malformado)
  const expectedContext = { commandId, churchId, operation: 'creation' };
  if (isUncertainResponse(rpcError, rpcData, expectedContext)) {
    return {
      status: 'UNCERTAIN',
      rpcCalled: true,
      pendingCmd,
      rpcError,
      message:
        'A confirmação do cadastro não chegou devido a uma oscilação na rede ou formato de resposta. ' +
        'O comando foi retido para verificação segura sem gerar duplicidade.',
    };
  }

  // 4. Rejeição definitiva pelo servidor (permissão, constraints, quota, etc.)
  if (rpcError) {
    removePendingMemberCommand(storage, userId, churchId, commandId);
    return {
      status: 'DEFINITIVE_ERROR',
      rpcCalled: true,
      rpcError,
      message: rpcError.message || 'Falha ao cadastrar membro.',
    };
  }

  // 5. Sucesso confirmado
  const created = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (
    !created?.member_id ||
    (created?.command_id && created.command_id !== commandId) ||
    (created?.church_id && created.church_id !== churchId)
  ) {
    return {
      status: 'UNCERTAIN',
      rpcCalled: true,
      pendingCmd,
      message:
        'A confirmação do cadastro retornou dados incompletos ou divergentes da criação. ' +
        'O comando foi retido para verificação segura sem gerar duplicidade.',
    };
  }
  removePendingMemberCommand(storage, userId, churchId, commandId);
  return {
    status: 'SUCCESS',
    rpcCalled: true,
    created,
    message: created?.already_existed
      ? `Membro "${created?.display_name || displayName}" já constava como cadastrado.`
      : `Membro "${created?.display_name || displayName}" cadastrado com sucesso!`,
  };
}

/**
 * 5.1. Gestão de Comandos de Ciclo de Vida (Restauração e Exclusão)
 */

/**
 * Constrói a chave de armazenamento isolada para comandos de ciclo de vida.
 *
 * @param {string} userId - UID do usuário autenticado
 * @param {string} churchId - UUID da igreja
 * @param {string} memberId - UUID do membro alvo
 * @param {string} action - Ação do comando ('restore_member' ou 'deactivate_member')
 * @returns {string|null}
 */
export function getMemberLifecycleStorageKey(userId, churchId, memberId, action) {
  if (!userId || !churchId || !memberId || !action) return null;
  return `escala_pending_member_lifecycle_cmd:${userId}:${churchId}:${memberId}:${action}`;
}

/**
 * Salva com segurança um comando de ciclo de vida pendente no storage de sessão.
 * Não sobrescreve comando anterior não resolvido com commandId diferente.
 *
 * @param {Storage|object} storage
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.churchId
 * @param {string} params.memberId
 * @param {string} params.action
 * @param {string} params.commandId
 * @param {string} params.expectedUpdatedAt - String opaca UTC com microssegundos
 * @param {string} [params.displayName]
 * @returns {boolean} true se gravado com sucesso
 */
export function savePendingLifecycleCommand(
  storage,
  { userId, churchId, memberId, action, commandId, expectedUpdatedAt, displayName }
) {
  if (!storage || !userId || !churchId || !memberId || !action || !commandId || !expectedUpdatedAt) {
    return false;
  }
  const key = getMemberLifecycleStorageKey(userId, churchId, memberId, action);
  if (!key) return false;
  try {
    const existingRaw = storage.getItem(key);
    if (existingRaw !== null && existingRaw !== undefined) {
      let existing;
      try {
        existing = JSON.parse(existingRaw);
      } catch (parseErr) {
        console.warn('[memberCommandService] Conteúdo ilegível/corrompido no storage de ciclo de vida. Envio bloqueado para preservar a chave sem sobrescrevê-la.', parseErr);
        return false;
      }
      if (existing?.commandId) {
        if (existing.commandId !== commandId) {
          console.warn('[memberCommandService] Tentativa de sobrescrever comando de ciclo de vida anterior com commandId diferente. Operação bloqueada.');
          return false;
        }
        // Recusa alteração de parâmetros do mesmo command_id
        if (
          existing.userId !== userId ||
          existing.churchId !== churchId ||
          existing.memberId !== memberId ||
          existing.action !== action ||
          existing.expectedUpdatedAt !== expectedUpdatedAt
        ) {
          console.warn('[memberCommandService] Tentativa de alterar parâmetros para o mesmo commandId de ciclo de vida. Operação bloqueada.');
          return false;
        }
        // Reenvio idêntico preservado
        return true;
      }
    }
    const payload = {
      commandId,
      userId,
      churchId,
      memberId,
      action,
      expectedUpdatedAt, // Preservada estritamente como string opaca
      displayName: displayName || null,
      createdAt: new Date().toISOString(),
    };
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn('[memberCommandService] Falha ao salvar comando pendente de ciclo de vida:', err);
    return false;
  }
}

/**
 * Recupera um comando de ciclo de vida pendente do storage.
 * Falhas de leitura do storage ou exceções de parsing NÃO apagam a chave.
 *
 * @param {Storage|object} storage
 * @param {string} userId
 * @param {string} churchId
 * @param {string} memberId
 * @param {string} action
 * @returns {object|null}
 */
export function loadPendingLifecycleCommand(storage, userId, churchId, memberId, action) {
  if (!storage || !userId || !churchId || !memberId || !action) return null;
  const key = getMemberLifecycleStorageKey(userId, churchId, memberId, action);
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.commandId &&
      parsed?.churchId === churchId &&
      parsed?.userId === userId &&
      parsed?.memberId === memberId &&
      parsed?.action === action &&
      parsed?.expectedUpdatedAt
    ) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn('[memberCommandService] Falha ao ler comando de ciclo de vida do storage:', err);
    return null;
  }
}

/**
 * Remove o comando de ciclo de vida do storage de sessão.
 * Se expectedCommandId for informado, remove apenas se o comando no storage corresponder.
 *
 * @param {Storage|object} storage
 * @param {string} userId
 * @param {string} churchId
 * @param {string} memberId
 * @param {string} action
 * @param {string|null} [expectedCommandId]
 * @returns {boolean}
 */
export function removePendingLifecycleCommand(storage, userId, churchId, memberId, action, expectedCommandId = null) {
  if (!storage || !userId || !churchId || !memberId || !action) return false;
  const key = getMemberLifecycleStorageKey(userId, churchId, memberId, action);
  if (!key) return false;
  try {
    if (expectedCommandId) {
      const raw = storage.getItem(key);
      if (!raw) return true;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.commandId && parsed.commandId !== expectedCommandId) {
          console.warn('[memberCommandService] Tentativa de remover comando de ciclo de vida com commandId divergente do armazenado. Remoção bloqueada.');
          return false;
        }
      } catch {
        return false;
      }
    }
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recupera qualquer comando pendente (criação ou ciclo de vida) associado ao usuário e igreja atuais.
 * Usado na inicialização da página e após recarga (F5) para recuperar comandos com resposta incerta.
 *
 * @param {Storage|object} storage
 * @param {string} userId
 * @param {string} churchId
 * @returns {object|null}
 */
export function loadAnyPendingMemberCommand(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return null;

  // 1. Prioridade: comando de criação de membro
  const creationCmd = loadPendingMemberCommand(storage, userId, churchId);
  if (creationCmd) {
    return { ...creationCmd, action: 'create_member' };
  }

  // 2. Comandos de ciclo de vida (restore_member ou deactivate_member)
  try {
    const prefix = `escala_pending_member_lifecycle_cmd:${userId}:${churchId}:`;
    const len = storage.length || 0;
    for (let i = 0; i < len; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        const raw = storage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (
              parsed?.commandId &&
              parsed?.userId === userId &&
              parsed?.churchId === churchId &&
              parsed?.memberId &&
              parsed?.action &&
              parsed?.expectedUpdatedAt
            ) {
              return parsed;
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn('[memberCommandService] Falha ao varrer comandos de ciclo de vida no storage:', err);
  }

  return null;
}

/**
 * Classifica o resultado da consulta do recibo de ciclo de vida (public.get_member_lifecycle_receipt).
 * Confere command_id, action, church_id, result_member_id e payload.
 *
 * @param {object|Error|null} error
 * @param {Array|null} data
 * @param {object|null} [expectedContext]
 * @returns {{ status: 'CONFIRMED'|'EMPTY_RECEIPT'|'ERROR', receipt?: object, shouldPreserveCommand: boolean, message?: string }}
 */
export function classifyLifecycleReceiptCheckResult(error, data, expectedContext = null) {
  if (error) {
    return {
      status: 'ERROR',
      shouldPreserveCommand: true,
      error,
      message:
        'Falha ao consultar o recibo no servidor (' +
        (error.message || 'erro de rede') +
        '). A identidade da operação pendente foi preservada. ' +
        'Você pode tentar verificar novamente com segurança.',
    };
  }

  if (Array.isArray(data) && data.length > 0 && data[0]) {
    const receipt = data[0];
    const payload = receipt.result_payload;

    const hasBaseContract =
      receipt.command_id &&
      receipt.action &&
      receipt.church_id &&
      receipt.result_member_id &&
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload);

    const matchesExpected =
      (!expectedContext?.commandId || receipt.command_id === expectedContext.commandId) &&
      (!expectedContext?.action || receipt.action === expectedContext.action) &&
      (!expectedContext?.churchId || receipt.church_id === expectedContext.churchId) &&
      (!expectedContext?.memberId || receipt.result_member_id === expectedContext.memberId);

    let isPayloadValid = Boolean(hasBaseContract);
    if (hasBaseContract && receipt.action === 'restore_member') {
      const isMemberCoherent = payload.member_id === receipt.result_member_id;
      const isActive = payload.status === 'active';
      const hasOpaqueRevision = typeof payload.updated_at === 'string' && payload.updated_at.trim().length > 0;
      const hasRevocationFlag = typeof payload.has_revoked_access === 'boolean';

      if (!isMemberCoherent || !isActive || !hasOpaqueRevision || !hasRevocationFlag) {
        isPayloadValid = false;
      }
    }

    if (hasBaseContract && matchesExpected && isPayloadValid) {
      return {
        status: 'CONFIRMED',
        receipt,
        shouldPreserveCommand: false,
      };
    }

    // Se o retorno está incompleto ou divergente do esperado, retém o comando como incerto
    return {
      status: 'ERROR',
      shouldPreserveCommand: true,
      message:
        'O recibo retornado pelo servidor possui dados incompletos ou divergentes da operação. ' +
        'O comando foi retido para segurança.',
    };
  }

  return {
    status: 'EMPTY_RECEIPT',
    shouldPreserveCommand: true,
    message:
      'O recibo de ciclo de vida ainda não consta no banco de dados. ' +
      'Você pode verificar novamente ou reexecutar a operação com segurança.',
  };
}

/**
 * Dispara o comando de restauração de membro elegível garantindo:
 * 1. Persistência no storage de sessão antes da chamada de rede;
 * 2. Bloqueio prévio se o storage falhar;
 * 3. Preservação de expectedUpdatedAt como string opaca integral;
 * 4. Tratamento de resposta incerta (mantém comando no storage);
 * 5. Tratamento de rejeição definitiva (P0018, P0019, 42501, 23505 removem comando);
 * 6. Sucesso confirmado remove comando e retorna dados do recibo.
 *
 * @param {object} params
 * @param {Storage|object|null} params.storage
 * @param {Function} params.rpcCaller
 * @param {string} params.churchId
 * @param {string} params.userId
 * @param {string} params.commandId
 * @param {string} params.memberId
 * @param {string} params.expectedUpdatedAt
 * @param {string} [params.displayName]
 * @returns {Promise<{
 *   status: 'STORAGE_FAILED'|'UNCERTAIN'|'DEFINITIVE_ERROR'|'SUCCESS'|'ABORTED',
 *   pendingCmd?: object,
 *   restored?: object,
 *   rpcError?: object|Error,
 *   message: string,
 *   rpcCalled: boolean
 * }>}
 */
export async function dispatchMemberRestoration({
  storage,
  rpcCaller,
  churchId,
  userId,
  commandId,
  memberId,
  expectedUpdatedAt,
  displayName,
  isCurrentContext,
}) {
  if (!churchId || !userId || !commandId || !memberId || !expectedUpdatedAt) {
    return {
      status: 'ABORTED',
      rpcCalled: false,
      message: 'Parâmetros obrigatórios ausentes para restauração de membro.',
    };
  }

  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt.trim()) {
    return {
      status: 'ABORTED',
      rpcCalled: false,
      message: 'Revisão do membro inválida para restauração.',
    };
  }

  const pendingCmd = {
    commandId,
    churchId,
    userId,
    memberId,
    action: 'restore_member',
    expectedUpdatedAt,
    displayName: displayName || null,
    timestamp: Date.now(),
  };

  // 1. Tenta persistir no storage ANTES de qualquer envio de rede
  const isSaved = savePendingLifecycleCommand(storage, pendingCmd);
  if (!isSaved) {
    return {
      status: 'STORAGE_FAILED',
      rpcCalled: false,
      pendingCmd,
      message:
        'Armazenamento local da sessão indisponível. Não foi possível registrar a identidade ' +
        'da operação para garantir sua recuperação. O envio foi cancelado.',
    };
  }

  // 2. Dispara a chamada RPC restore_church_member
  let rpcData = null;
  let rpcError = null;

  try {
    const res = await rpcCaller({
      p_church_id: churchId,
      p_command_id: commandId,
      p_member_id: memberId,
      p_expected_updated_at: expectedUpdatedAt,
    });
    rpcData = res?.data;
    rpcError = res?.error;
  } catch (networkErr) {
    rpcError = networkErr;
  }

  // Proteção de contexto ativo após await: se o contexto mudou na tela, encerra sem efeitos colaterais
  if (typeof isCurrentContext === 'function' && !isCurrentContext()) {
    return {
      status: 'CONTEXT_CHANGED',
      rpcCalled: true,
      pendingCmd,
      message: 'O contexto ativo mudou durante a restauração do membro.',
    };
  }

  // 3. Avalia resposta incerta
  const expectedContext = {
    action: 'restore_member',
    commandId,
    churchId,
    memberId,
  };
  if (isUncertainResponse(rpcError, rpcData, expectedContext)) {
    return {
      status: 'UNCERTAIN',
      rpcCalled: true,
      pendingCmd,
      rpcError,
      message:
        'A confirmação da restauração não chegou devido a uma oscilação na rede ou formato de resposta. ' +
        'O comando foi retido para verificação segura sem gerar duplicidade.',
    };
  }

  // 4. Rejeição definitiva pelo servidor
  if (rpcError) {
    removePendingLifecycleCommand(storage, userId, churchId, memberId, 'restore_member', commandId);
    let message = rpcError.message || 'Falha ao restaurar membro.';
    if (rpcError.code === 'P0018') {
      message = 'Este membro possui um vínculo de acesso ativo legado nesta igreja. A restauração foi bloqueada para proteger a integridade do acesso.';
    } else if (rpcError.code === 'P0019') {
      message = 'O cadastro do membro já se encontra ativo ou foi modificado por outro operador. Atualize a listagem e tente novamente.';
    }
    return {
      status: 'DEFINITIVE_ERROR',
      rpcCalled: true,
      rpcError,
      message,
    };
  }

  // 5. Sucesso confirmado com validação de payload contratado (objeto não array, membro, status active, nova revisão opaca e flag de acesso revogado)
  const restored = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const payload = restored?.result_payload;
  if (
    !restored?.command_id ||
    restored.command_id !== commandId ||
    restored.action !== 'restore_member' ||
    restored.church_id !== churchId ||
    restored.result_member_id !== memberId ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.member_id !== memberId ||
    payload.status !== 'active' ||
    typeof payload.updated_at !== 'string' ||
    !payload.updated_at.trim() ||
    typeof payload.has_revoked_access !== 'boolean'
  ) {
    return {
      status: 'UNCERTAIN',
      rpcCalled: true,
      pendingCmd,
      message:
        'A confirmação retornada pelo servidor possui dados incompletos ou divergentes da restauração. ' +
        'O comando foi retido com segurança.',
    };
  }

  removePendingLifecycleCommand(storage, userId, churchId, memberId, 'restore_member', commandId);
  return {
    status: 'SUCCESS',
    rpcCalled: true,
    restored,
    message: `Membro "${displayName || restored?.result_payload?.display_name || 'selecionado'}" restaurado com sucesso!`,
  };
}

/**
 * Dispara o endpoint de exclusão de membro.
 * O endpoint no servidor valida a autorização e recusa a operação com P0021
 * devido à dependência do módulo de escalas e validação litúrgica.
 *
 * @param {object} params
 * @param {Storage|object|null} params.storage
 * @param {Function} params.rpcCaller
 * @param {string} params.churchId
 * @param {string} params.userId
 * @param {string} params.commandId
 * @param {string} params.memberId
 * @param {string} params.expectedUpdatedAt
 * @param {string} [params.displayName]
 * @param {Function} [params.isCurrentContext]
 * @returns {Promise<{
 *   status: 'STORAGE_FAILED'|'UNCERTAIN'|'DEFINITIVE_ERROR'|'SUCCESS'|'ABORTED'|'CONTEXT_CHANGED',
 *   pendingCmd?: object,
 *   deactivated?: object,
 *   rpcError?: object|Error,
 *   message: string,
 *   rpcCalled: boolean
 * }>}
 */
export async function dispatchMemberDeactivation({
  storage,
  rpcCaller,
  churchId,
  userId,
  commandId,
  memberId,
  expectedUpdatedAt,
  displayName,
  isCurrentContext,
}) {
  if (!churchId || !userId || !commandId || !memberId || !expectedUpdatedAt) {
    return {
      status: 'ABORTED',
      rpcCalled: false,
      message: 'Parâmetros obrigatórios ausentes para exclusão de membro.',
    };
  }

  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt.trim()) {
    return {
      status: 'ABORTED',
      rpcCalled: false,
      message: 'Revisão do membro inválida para exclusão.',
    };
  }

  const pendingCmd = {
    commandId,
    churchId,
    userId,
    memberId,
    action: 'deactivate_member',
    expectedUpdatedAt,
    displayName: displayName || null,
    timestamp: Date.now(),
  };

  // 1. Tenta persistir no storage ANTES de qualquer envio de rede
  const isSaved = savePendingLifecycleCommand(storage, pendingCmd);
  if (!isSaved) {
    return {
      status: 'STORAGE_FAILED',
      rpcCalled: false,
      pendingCmd,
      message:
        'Armazenamento local da sessão indisponível. Não foi possível registrar a identidade ' +
        'da operação. O envio foi cancelado.',
    };
  }

  // 2. Dispara a chamada RPC deactivate_church_member
  let rpcData = null;
  let rpcError = null;

  try {
    const res = await rpcCaller({
      p_church_id: churchId,
      p_command_id: commandId,
      p_member_id: memberId,
      p_expected_updated_at: expectedUpdatedAt,
    });
    rpcData = res?.data;
    rpcError = res?.error;
  } catch (networkErr) {
    rpcError = networkErr;
  }

  // Proteção de contexto ativo após await: se o contexto mudou na tela, encerra sem efeitos colaterais
  if (typeof isCurrentContext === 'function' && !isCurrentContext()) {
    return {
      status: 'CONTEXT_CHANGED',
      rpcCalled: true,
      pendingCmd,
      message: 'O contexto ativo mudou durante a exclusão do membro.',
    };
  }

  // 3. Avalia resposta incerta
  const expectedContext = {
    action: 'deactivate_member',
    commandId,
    churchId,
    memberId,
  };
  if (isUncertainResponse(rpcError, rpcData, expectedContext)) {
    return {
      status: 'UNCERTAIN',
      rpcCalled: true,
      pendingCmd,
      rpcError,
      message:
        'A resposta da operação não chegou devido a uma oscilação na rede. ' +
        'O comando foi retido para verificação segura.',
    };
  }

  // 4. Rejeição definitiva pelo servidor (P0021 ou 42501/22004/P0002)
  if (rpcError) {
    removePendingLifecycleCommand(storage, userId, churchId, memberId, 'deactivate_member', commandId);
    let message = rpcError.message || 'Falha na operação de exclusão.';
    if (rpcError.code === 'P0021' || String(rpcError.message || '').includes('P0021')) {
      message = 'A exclusão de membros está indisponível nesta etapa. Ela depende da verificação de participações e liderança em eventos futuros ou em andamento. O cadastro permanece inalterado.';
    }
    return {
      status: 'DEFINITIVE_ERROR',
      rpcCalled: true,
      rpcError,
      message,
    };
  }

  // 5. Sucesso confirmado (caso de replay histórico autorizado) com validação estrita de objeto não array
  const deactivated = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const payload = deactivated?.result_payload;
  if (
    !deactivated?.command_id ||
    deactivated.command_id !== commandId ||
    deactivated.action !== 'deactivate_member' ||
    deactivated.church_id !== churchId ||
    deactivated.result_member_id !== memberId ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return {
      status: 'UNCERTAIN',
      rpcCalled: true,
      pendingCmd,
      message:
        'A confirmação retornada pelo servidor possui dados incompletos ou divergentes da exclusão. ' +
        'O comando foi retido com segurança.',
    };
  }

  removePendingLifecycleCommand(storage, userId, churchId, memberId, 'deactivate_member', commandId);
  return {
    status: 'SUCCESS',
    rpcCalled: true,
    deactivated,
    message: `Exclusão do membro "${displayName || 'selecionado'}" confirmada.`,
  };
}

/**
 * 6. Gestão de Estado, Resiliência e Prevenção de Concorrência na Listagem de Membros
 */

/**
 * Formata mensagens de erro de consulta de membros para exibição clara e compreensível ao usuário,
 * evitando termos técnicos crus como "TypeError: Failed to fetch" (Requisito 2).
 *
 * @param {object|Error|string|null} error
 * @param {{ isRefresh?: boolean, hasPendingCreationSuccess?: boolean }} options
 * @returns {string}
 */
export function formatListErrorMessage(error, { isRefresh = false, hasPendingCreationSuccess = false } = {}) {
  const rawMsg = typeof error === 'string' ? error : String(error?.message || '');
  const lower = rawMsg.toLowerCase();

  const isNetworkFailure =
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('abort') ||
    lower.includes('conexão') ||
    lower.includes('offline');

  if (hasPendingCreationSuccess) {
    if (isNetworkFailure) {
      return 'O cadastro foi concluído no servidor, mas não foi possível atualizar a lista por falha de conexão. Clique em tentar novamente para atualizar a listagem.';
    }
    return 'O cadastro foi concluído no servidor, mas ocorreu uma falha ao atualizar a lista de membros. Tente atualizar novamente.';
  }

  if (isNetworkFailure) {
    if (isRefresh) {
      return 'Não foi possível atualizar a lista de membros por falha de conexão. Os dados exibidos abaixo podem estar desatualizados.';
    }
    return 'Não foi possível carregar a lista de membros por falha de conexão. Verifique sua rede e tente novamente.';
  }

  if (error?.code === '42501' || lower.includes('privilégio') || lower.includes('não autorizado')) {
    return 'Permissão insuficiente para consultar a lista de membros desta igreja.';
  }

  // Se houver mensagem específica razoável que não seja erro de runtime interno
  if (rawMsg.trim() && !rawMsg.includes('TypeError') && !rawMsg.includes('ReferenceError') && rawMsg.length < 150) {
    return rawMsg;
  }

  if (isRefresh) {
    return 'Não foi possível atualizar a lista de membros. Tente novamente.';
  }
  return 'Não foi possível carregar a lista de membros. Tente novamente.';
}

/**
 * Estado inicial da listagem de membros.
 */
export function createInitialMemberListState() {
  return {
    members: [],
    totalCount: 0,
    hasLoadedSuccessfully: false,
    status: 'idle', // 'idle' | 'loading' | 'success' | 'error'
    errorMessage: null,
    isStale: false,
  };
}

/**
 * Transição pura de estado da listagem de membros.
 *
 * Garante que:
 * 1. O estado vazio só ocorre após consulta bem-sucedida confirmando ausência de membros (Requisito 1).
 * 2. Em falha de carregamento, se houver dados prévios, eles são PRESERVADOS com flag isStale = true (Requisito 3).
 * 3. Totalizador e lista permanecem coerentes (Requisito 3).
 * 4. A mensagem de erro é compreensível e contextualizada (Requisito 2 e 4).
 *
 * @param {object} currentState
 * @param {object} action
 * @returns {object} Novo estado da listagem
 */
export function applyMemberListTransition(currentState, action) {
  if (!currentState) {
    currentState = createInitialMemberListState();
  }

  switch (action.type) {
    case 'FETCH_START':
      return {
        ...currentState,
        status: 'loading',
        errorMessage: null,
      };

    case 'FETCH_SUCCESS': {
      let members = [];
      let total = 0;

      if (action.items !== undefined) {
        members = Array.isArray(action.items) ? action.items : [];
        total = Number(action.totalCount ?? members.length);
      } else if (Array.isArray(action.data) && action.data.length > 0 && action.data[0]?.items !== undefined) {
        // Formato da RPC list_church_members_admin: [{ items: [...], total_count: N }]
        members = Array.isArray(action.data[0]?.items) ? action.data[0].items : [];
        const reported = Number(action.data[0]?.total_count);
        total = isNaN(reported) ? members.length : reported;
      } else if (Array.isArray(action.data)) {
        // Formato legado da RPC list_church_members: [{ member_id, display_name, ..., total_count }]
        members = action.data;
        if (members.length > 0) {
          const reported = Number(members[0]?.total_count);
          total = isNaN(reported) ? members.length : reported;
        }
      }

      return {
        members,
        totalCount: isNaN(total) ? 0 : total,
        hasLoadedSuccessfully: true,
        status: 'success',
        errorMessage: null,
        isStale: false,
      };
    }

    case 'FETCH_ERROR': {
      const hasLoadedBefore = Boolean(currentState.hasLoadedSuccessfully);
      const formattedError = formatListErrorMessage(action.error, {
        isRefresh: hasLoadedBefore,
        hasPendingCreationSuccess: Boolean(action.hasPendingCreationSuccess),
      });

      return {
        // Preserva dados anteriores se já houver carregamento anterior bem-sucedido
        members: hasLoadedBefore ? currentState.members : [],
        totalCount: hasLoadedBefore ? currentState.totalCount : 0,
        hasLoadedSuccessfully: hasLoadedBefore,
        status: 'error',
        errorMessage: formattedError,
        isStale: hasLoadedBefore,
      };
    }

    case 'RESET_ON_AUTH_CHANGE':
      return createInitialMemberListState();

    default:
      return currentState;
  }
}

/**
 * Deriva os estados visuais da listagem para renderização na tela.
 *
 * @param {object} state - Estado atual retornado por applyMemberListTransition
 * @returns {object} Flags e textos para renderização
 */
export function getMemberListViewState(state) {
  const isInitialLoading = state.status === 'loading' && !state.hasLoadedSuccessfully;
  const isRefreshing = state.status === 'loading' && state.hasLoadedSuccessfully;

  // Requisito 1: Exiba o estado vazio somente após uma consulta bem-sucedida que confirme ausência de membros.
  const showEmptyState =
    state.hasLoadedSuccessfully &&
    state.status === 'success' &&
    state.members.length === 0;

  // Requisito 2: Em falha inicial de carregamento, exibir erro e ação de tentar novamente.
  // Nunca oferecer "Cadastrar primeiro membro" em erro.
  const showInitialErrorState =
    state.status === 'error' && !state.hasLoadedSuccessfully;

  // Requisito 3: Preservar dados anteriores durante a falha, mantendo lista e totalizador coerentes
  const showTable = state.members.length > 0;
  const isStale = Boolean(state.isStale);

  // Totalizador coerente
  let totalizerText = '';
  if (!state.hasLoadedSuccessfully && state.status === 'error') {
    totalizerText = 'Consulta indisponível';
  } else if (!state.hasLoadedSuccessfully && state.status === 'loading') {
    totalizerText = 'Carregando membros…';
  } else if (isStale) {
    const count = state.totalCount;
    const itemStr = count === 1 ? 'membro cadastrado' : 'membros cadastrados';
    totalizerText = `${count} ${itemStr} (não foi possível atualizar)`;
  } else {
    const count = state.totalCount;
    totalizerText = count === 1 ? '1 membro cadastrado' : `${count} membros cadastrados`;
  }

  return {
    isInitialLoading,
    isRefreshing,
    showEmptyState,
    showInitialErrorState,
    showTable,
    isStale,
    totalizerText,
  };
}

/**
 * Coordenador de concorrência e descarte de respostas obsoletas para consultas assíncronas.
 * Garante que uma resposta de requisição antiga não sobrescreva uma mais recente (Requisito 5).
 */
export function createListRequestCoordinator() {
  let monotonicCounter = 0;
  let activeRequestId = 0;

  return {
    getNextRequestId() {
      monotonicCounter += 1;
      activeRequestId = monotonicCounter;
      return activeRequestId;
    },
    getCurrentRequestId() {
      return activeRequestId;
    },
    isCurrent(requestId) {
      if (!requestId || !activeRequestId) return false;
      return requestId === activeRequestId;
    },
    reset() {
      activeRequestId = 0;
    },
  };
}


