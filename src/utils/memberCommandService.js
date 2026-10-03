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

  // 3. Avalia resposta incerta (queda de conexão, timeout, 5xx ou payload malformado)
  if (isUncertainResponse(rpcError, rpcData)) {
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
    removePendingMemberCommand(storage, userId, churchId);
    return {
      status: 'DEFINITIVE_ERROR',
      rpcCalled: true,
      rpcError,
      message: rpcError.message || 'Falha ao cadastrar membro.',
    };
  }

  // 5. Sucesso confirmado
  removePendingMemberCommand(storage, userId, churchId);
  const created = rpcData[0];
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
      const data = Array.isArray(action.data) ? action.data : [];
      let total = 0;
      if (data.length > 0) {
        const reported = Number(data[0]?.total_count);
        total = isNaN(reported) ? data.length : reported;
      }
      return {
        members: data,
        totalCount: total,
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


