/**
 * Escala do Reino — invitationCommandService.js
 *
 * Módulo de cliente para o ciclo de comandos de convites de acesso, aprovação de nome,
 * consulta de solicitações e reconciliação de recibos idempotente (Incremento 011).
 *
 * Regras estritas:
 * 1. O token bruto nunca é normalizado (sem trim, sem lowercase, sem NFC). Formato Base64URL de exatamente 43 caracteres.
 * 2. Tokens brutos novos residem exclusivamente na memória do componente e nunca em localStorage, logs ou telemetria.
 * 3. Chave contratada para sobrevivência entre abas/login: sessionStorage['escala_invite_token_pending'].
 * 4. Ações de recibo: 'issue_invitation', 'redeem_confirm_name', 'redeem_propose_name', 'decide_access_request'.
 * 5. Replay de issue_church_invitation retorna raw_token nulo; link_unrecoverable provém exclusivamente do recibo.
 * 6. Decisão de solicitação aceita 'approve' ou 'reject'; retorno 'expired' é persistido no servidor.
 * 7. Isolamento de comandos por userId e geração de sessão; respostas de sessões antigas são descartadas.
 */

export const INVITATION_PENDING_TOKEN_KEY = 'escala_invite_token_pending';
export const INVITATION_CMD_STORAGE_PREFIX = 'escala_invitation_cmd_';
export const ACCESS_REQUEST_MARKER_PREFIX = 'escala_access_request_marker_';

const BASE64URL_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Valida o formato estrito do token sem efetuar nenhuma alteração nos caracteres.
 * Preserva maiúsculas/minúsculas e não aplica trim ou NFC.
 *
 * @param {any} token
 * @returns {boolean}
 */
export function isValidInviteTokenFormat(token) {
  if (typeof token !== 'string') return false;
  return BASE64URL_TOKEN_REGEX.test(token);
}

/**
 * Extrai o token de convite da rota /#/invite?token=... ou /invite?token=...
 * Preserva os parâmetros OAuth e códigos de autenticação sem apagá-los.
 *
 * @param {string|Location} [locationObj] - Objeto window.location ou string de URL
 * @returns {string|null} Token extraído ou null se não for rota de convite
 */
export function extractInviteTokenFromUrl(locationObj) {
  const loc = locationObj || (typeof window !== 'undefined' ? window.location : null);
  if (!loc) return null;

  const hash = typeof loc === 'string' ? loc : loc.hash || '';
  const search = typeof loc === 'string' ? '' : loc.search || '';

  // Verifica se o hash contém a rota de convite: ex. #/invite?token=... ou #invite?token=...
  if (hash.includes('/invite') || hash.includes('invite?')) {
    const queryIndex = hash.indexOf('?');
    if (queryIndex !== -1) {
      const queryStr = hash.slice(queryIndex + 1);
      const params = new URLSearchParams(queryStr);
      const token = params.get('token');
      if (token && isValidInviteTokenFormat(token)) {
        return token;
      }
    }
  }

  // Fallback para caso venha via search puro: ex. ?token=... em /invite
  if (search) {
    const params = new URLSearchParams(search);
    const token = params.get('token');
    const pathname = typeof loc === 'string' ? '' : loc.pathname || '';
    if (pathname.includes('/invite') && token && isValidInviteTokenFormat(token)) {
      return token;
    }
  }

  return null;
}

/**
 * Remove a rota do convite da URL usando history.replaceState, preservando outros parâmetros
 * (como retornos de OAuth ou callbacks do Supabase).
 */
export function clearInviteTokenFromUrl() {
  if (typeof window === 'undefined' || !window.history || !window.location) return;

  const loc = window.location;
  const hash = loc.hash || '';
  const search = loc.search || '';
  const pathname = loc.pathname || '/';

  let newHash = hash;
  let newSearch = search;

  if (hash.includes('/invite') || hash.includes('invite?')) {
    newHash = '';
  }

  if (search.includes('token=')) {
    const params = new URLSearchParams(search);
    if (params.has('token')) {
      params.delete('token');
      const qs = params.toString();
      newSearch = qs ? `?${qs}` : '';
    }
  }

  const cleanUrl = `${pathname}${newSearch}${newHash}`;
  if (cleanUrl !== `${pathname}${search}${hash}`) {
    window.history.replaceState(null, '', cleanUrl);
  }
}

/**
 * Extrai e interpreta erros de redirecionamento do Supabase Auth presentes no hash ou search
 * (ex.: link de confirmação ou recuperação expirado ou inválido).
 *
 * @param {string|Location} [locationObj] - Objeto window.location ou string de URL
 * @returns {{ error: string, errorCode: string, errorDescription: string, message: string }|null}
 */
export function extractAuthRedirectError(locationObj) {
  const loc = locationObj || (typeof window !== 'undefined' ? window.location : null);
  if (!loc) return null;

  const hash = typeof loc === 'string' ? (loc.includes('#') ? loc.slice(loc.indexOf('#')) : '') : loc.hash || '';
  const search = typeof loc === 'string' ? (loc.includes('?') ? loc.slice(loc.indexOf('?'), loc.includes('#') ? loc.indexOf('#') : undefined) : '') : loc.search || '';

  let params = null;

  // 1. Procura no hash (formato padrão do Supabase Auth: #error=...&error_code=...&error_description=...)
  if (hash && hash.includes('error=')) {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const queryIdx = raw.indexOf('?');
    const paramStr = queryIdx !== -1 ? raw.slice(queryIdx + 1) : raw;
    params = new URLSearchParams(paramStr);
  }

  // 2. Se não encontrou no hash, procura no search (?error=...)
  if ((!params || !params.get('error')) && search && search.includes('error=')) {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  }

  if (!params || !params.get('error')) {
    return null;
  }

  const error = params.get('error') || '';
  const errorCode = params.get('error_code') || '';
  const errorDescription = params.get('error_description') || '';

  const lowerDesc = errorDescription.toLowerCase();
  const lowerCode = errorCode.toLowerCase();

  let message = 'Não foi possível validar o link de acesso. Por favor, solicite um novo envio.';

  if (
    lowerCode === 'otp_expired' ||
    lowerDesc.includes('expired') ||
    lowerDesc.includes('has expired') ||
    lowerDesc.includes('invalid or has expired')
  ) {
    message = 'O link de confirmação ou recuperação expirou ou já foi utilizado. Por favor, solicite um novo envio para continuar.';
  } else if (lowerCode === 'access_denied' || error === 'access_denied') {
    message = 'Acesso não autorizado pelo serviço de autenticação. Por favor, tente novamente ou solicite um novo link.';
  }

  return {
    error,
    errorCode,
    errorDescription,
    message,
  };
}

/**
 * Remove parâmetros de erro de autenticação da URL via history.replaceState,
 * preservando a rota, fragmentos legítimos e tokens de convite caso existam.
 */
export function clearAuthRedirectErrorFromUrl() {
  if (typeof window === 'undefined' || !window.history || !window.location) return;

  const loc = window.location;
  const hash = loc.hash || '';
  const search = loc.search || '';
  const pathname = loc.pathname || '/';

  let newHash = hash;
  let newSearch = search;

  if (hash.includes('error=')) {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const queryIdx = raw.indexOf('?');
    if (queryIdx === -1 && !raw.includes('/')) {
      newHash = '';
    } else {
      const parts = raw.split('?');
      const routePart = parts[0];
      const queryPart = parts[1] || '';
      const params = new URLSearchParams(queryPart || routePart);
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      const remaining = params.toString();
      if (queryPart) {
        newHash = remaining ? `#${routePart}?${remaining}` : (routePart ? `#${routePart}` : '');
      } else {
        newHash = remaining ? `#${remaining}` : '';
      }
    }
  }

  if (search.includes('error=')) {
    const params = new URLSearchParams(search);
    params.delete('error');
    params.delete('error_code');
    params.delete('error_description');
    const remaining = params.toString();
    newSearch = remaining ? `?${remaining}` : '';
  }

  const cleanUrl = `${pathname}${newSearch}${newHash}`;
  if (cleanUrl !== `${pathname}${search}${hash}`) {
    window.history.replaceState(null, '', cleanUrl);
  }
}

/**
 * Valida e normaliza o e-mail do destinatário do convite.
 *
 * @param {string} email
 * @returns {{ valid: boolean, email: string, error?: string }}
 */
export function validateRecipientEmail(email) {
  if (typeof email !== 'string') {
    return { valid: false, email: '', error: 'Informe o endereço de e-mail do destinatário.' };
  }
  const clean = email.trim().toLowerCase();
  if (clean.length < 3 || clean.length > 254 || !EMAIL_REGEX.test(clean)) {
    return { valid: false, email: clean, error: 'Endereço de e-mail inválido.' };
  }
  return { valid: true, email: clean };
}

/**
 * Normaliza e valida o nome proposto em uma solicitação de alteração.
 * Aplica trim, forma canônica NFC, e verifica o limite de 1 a 120 caracteres.
 * Deve ser diferente do nome cadastrado original.
 *
 * @param {string} proposedName
 * @param {string} [currentName]
 * @returns {{ valid: boolean, name: string, error?: string }}
 */
export function validateProposedName(proposedName, currentName) {
  if (typeof proposedName !== 'string') {
    return { valid: false, name: '', error: 'Informe o nome proposto.' };
  }
  const clean = proposedName.trim().normalize('NFC');
  if (clean.length < 1 || clean.length > 120) {
    return { valid: false, name: clean, error: 'O nome proposto deve ter entre 1 e 120 caracteres.' };
  }
  if (currentName) {
    const cleanCurrent = currentName.trim().normalize('NFC');
    if (clean === cleanCurrent) {
      return { valid: false, name: clean, error: 'O nome proposto deve ser diferente do nome atualmente cadastrado.' };
    }
  }
  return { valid: true, name: clean };
}

/**
 * Classifica se um erro retornado pelo servidor é definitivo ou de transporte/incerto.
 *
 * @param {object|Error|null} error
 * @returns {boolean}
 */
export function isDefinitiveInvitationError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const status = Number(error.status || 0);

  // Códigos Postgres:
  // 42501 = não autorizado / privilégio insuficiente
  // 23514 = violação de restrição (e-mail, nome, formato)
  // 22004 = parâmetro obrigatório nulo
  // 23505 = duplicidade / já executado com parâmetros diferentes / já decidido
  // P0002 = registro não encontrado / convite não está mais aberto
  // P0004 = convite expirado
  // P0005 = nome alterado concorrentemente
  // 28000 = não autenticado
  if (['42501', '23514', '22004', '23505', 'P0002', 'P0004', 'P0005', '28000'].includes(code)) {
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
    msg.includes('parâmetros diferentes') ||
    msg.includes('inválido') ||
    msg.includes('já foi decidida') ||
    msg.includes('não está mais aberto') ||
    msg.includes('expirado') ||
    msg.includes('modificado concorrentemente') ||
    msg.includes('já possui acesso')
  ) {
    return true;
  }

  return false;
}

/**
 * Avalia se o resultado representa uma resposta incerta.
 *
 * @param {object|Error|null} error
 * @param {Array|null} data
 * @param {string} action
 * @returns {boolean}
 */
export function isUncertainInvitationResponse(error, data, action) {
  if (error) {
    return !isDefinitiveInvitationError(error);
  }
  if (!Array.isArray(data) || data.length === 0) {
    return true;
  }
  const row = data[0];
  if (!row) return true;

  switch (action) {
    case 'issue_invitation':
      return !row.invitation_id || !row.church_id || !row.member_id;
    case 'redeem_confirm_name':
      return !row.church_id || !row.member_id || row.access_granted === undefined;
    case 'redeem_propose_name':
      return !row.request_id || !row.church_id || !row.member_id;
    case 'decide_access_request':
      return !row.request_id || !row.member_id || !row.decision;
    default:
      return false;
  }
}

/**
 * Traduz erros do backend para mensagens amigáveis ao usuário sem expor detalhes internos.
 *
 * @param {object|Error|string} error
 * @param {string} [context]
 * @returns {string}
 */
export function formatInvitationErrorMessage(error, context = 'default') {
  if (!error) return 'Ocorreu um erro inesperado.';
  const msg = typeof error === 'string' ? error : String(error.message || '');
  const code = error?.code || '';

  if (context === 'admin_requests_list') {
    if (code === '42501' || msg.includes('não autorizado')) {
      return 'Você não possui permissão administrativa para visualizar as solicitações desta igreja.';
    }
    if (code === '28000' || msg.includes('não autenticado')) {
      return 'Sessão não autenticada. Faça login novamente.';
    }
    return 'Não foi possível carregar as solicitações de alteração de nome no momento. Tente novamente.';
  }

  if (code === '42501' || msg.includes('não autorizado')) {
    if (context === 'invitee') {
      return 'Convite inválido, expirado ou não associado a esta conta.';
    }
    return 'Você não possui permissão administrativa para realizar esta ação nesta igreja.';
  }

  if (code === 'P0004' || msg.includes('expirado') || msg.includes('REQUEST_EXPIRED')) {
    return 'O prazo deste convite ou solicitação expirou.';
  }

  if (code === 'P0005' || msg.includes('modificado concorrentemente')) {
    return 'O cadastro do membro foi alterado por outro usuário durante esta operação.';
  }

  if (msg.includes('já foi decidida') || (code === '23505' && msg.includes('decidida'))) {
    return 'Esta solicitação já foi decidida anteriormente por outro administrador.';
  }

  if (msg.includes('não está mais aberto') || (code === 'P0002' && msg.includes('não está mais aberto'))) {
    return 'O convite não está mais aberto ou foi reemitido.';
  }

  if (code === '23514') {
    if (msg.includes('e-mail')) return 'O endereço de e-mail informado é inválido.';
    if (msg.includes('proposto deve ser diferente')) return 'O nome proposto deve ser diferente do nome cadastrado.';
    if (msg.includes('1 e 120')) return 'O nome deve ter entre 1 e 120 caracteres.';
    return 'Os dados informados não atendem aos critérios de validação.';
  }

  if (code === '23505') {
    if (msg.includes('já possui acesso')) return 'Este membro já possui acesso ativo nesta igreja.';
    if (msg.includes('parâmetros diferentes')) return 'Comando já executado anteriormente com parâmetros diferentes.';
    return 'Conflito de registro ou comando concorrente detectado.';
  }

  if (code === 'P0002') {
    if (context === 'invitee') {
      return 'Convite inválido, expirado ou não associado a esta conta.';
    }
    return 'Registro não encontrado ou inativo nesta igreja.';
  }

  if (code === '28000' || msg.includes('não autenticado')) {
    return 'Sessão não autenticada. Faça login novamente.';
  }

  if (msg.includes('indisponível') || code === '42883' || msg.includes('function') && msg.includes('does not exist')) {
    return 'Serviço de convites temporariamente indisponível no servidor.';
  }

  if (context === 'invitee') {
    return 'Convite inválido, expirado ou não associado a esta conta.';
  }

  return 'Não foi possível concluir a operação. Verifique sua conexão e tente novamente.';
}

/**
 * Valida a estrutura e consistência do payload de um recibo retornado por get_invitation_command_receipt.
 *
 * @param {string} action
 * @param {object} receiptRow
 * @param {object} [expectedParams]
 * @returns {{ valid: boolean, payload: object|null, reason?: string }}
 */
export function validateReceiptPayload(action, receiptRow, expectedParams = {}) {
  if (!receiptRow || typeof receiptRow !== 'object') {
    return { valid: false, payload: null, reason: 'Recibo ausente.' };
  }

  if (receiptRow.action !== action) {
    return { valid: false, payload: null, reason: `Ação do recibo divergente (esperado: ${action}, recebido: ${receiptRow.action}).` };
  }

  const payload = receiptRow.result_payload;
  if (!payload || typeof payload !== 'object') {
    return { valid: false, payload: null, reason: 'Payload de resultado ausente no recibo.' };
  }

  // Validação estrita de UUIDs do envelope
  if (!UUID_REGEX.test(receiptRow.command_id)) {
    return { valid: false, payload: null, reason: 'command_id com formato inválido no recibo.' };
  }
  if (expectedParams.commandId && receiptRow.command_id !== expectedParams.commandId) {
    return { valid: false, payload: null, reason: 'command_id divergente do comando esperado.' };
  }

  if (!UUID_REGEX.test(receiptRow.church_id)) {
    return { valid: false, payload: null, reason: 'church_id com formato inválido no recibo.' };
  }
  if (expectedParams.churchId && receiptRow.church_id !== expectedParams.churchId) {
    return { valid: false, payload: null, reason: 'ID da igreja divergente no recibo.' };
  }

  if (receiptRow.result_member_id && !UUID_REGEX.test(receiptRow.result_member_id)) {
    return { valid: false, payload: null, reason: 'result_member_id com formato inválido no recibo.' };
  }
  if (expectedParams.memberId && receiptRow.result_member_id !== expectedParams.memberId) {
    return { valid: false, payload: null, reason: 'result_member_id divergente do membro esperado.' };
  }

  if (receiptRow.result_entity_id && !UUID_REGEX.test(receiptRow.result_entity_id)) {
    return { valid: false, payload: null, reason: 'result_entity_id com formato inválido no recibo.' };
  }

  switch (action) {
    case 'issue_invitation': {
      if (!UUID_REGEX.test(receiptRow.result_entity_id) || !UUID_REGEX.test(receiptRow.result_member_id)) {
        return { valid: false, payload: null, reason: 'IDs de entidade/membro inválidos na emissão.' };
      }
      if (payload.invitation_id !== receiptRow.result_entity_id) {
        return { valid: false, payload: null, reason: 'invitation_id do payload diverge do recibo.' };
      }
      if (payload.church_id !== receiptRow.church_id) {
        return { valid: false, payload: null, reason: 'church_id do payload diverge do recibo.' };
      }
      if (payload.member_id !== receiptRow.result_member_id) {
        return { valid: false, payload: null, reason: 'member_id do payload diverge do recibo.' };
      }
      if (payload.raw_token !== null && payload.raw_token !== undefined) {
        return { valid: false, payload: null, reason: 'raw_token não pode ser retornado em recibo de emissão.' };
      }
      if (typeof receiptRow.link_unrecoverable !== 'boolean') {
        return { valid: false, payload: null, reason: 'link_unrecoverable deve ser booleano no recibo de emissão.' };
      }
      if (typeof payload.recipient_email !== 'string' || !payload.recipient_email.trim()) {
        return { valid: false, payload: null, reason: 'recipient_email ausente no payload de emissão.' };
      }
      if (!payload.expires_at) {
        return { valid: false, payload: null, reason: 'expires_at ausente no payload de emissão.' };
      }
      return { valid: true, payload };
    }
    case 'redeem_confirm_name': {
      // No resgate com confirmação, result_entity_id é o vínculo criado (church_access), e result_member_id é o membro
      if (!UUID_REGEX.test(receiptRow.result_entity_id) || !UUID_REGEX.test(receiptRow.result_member_id)) {
        return { valid: false, payload: null, reason: 'IDs de vínculo/membro inválidos na confirmação de nome.' };
      }
      if (payload.church_id !== receiptRow.church_id) {
        return { valid: false, payload: null, reason: 'church_id do payload diverge do recibo.' };
      }
      if (payload.member_id !== receiptRow.result_member_id) {
        return { valid: false, payload: null, reason: 'member_id do payload diverge do recibo.' };
      }
      if (typeof payload.display_name !== 'string' || !payload.display_name.trim()) {
        return { valid: false, payload: null, reason: 'display_name ausente ou inválido no payload de confirmação.' };
      }
      if (payload.access_granted !== true) {
        return { valid: false, payload: null, reason: 'access_granted deve ser estritamente true no recibo de confirmação.' };
      }
      return { valid: true, payload };
    }
    case 'redeem_propose_name': {
      if (!UUID_REGEX.test(receiptRow.result_entity_id) || !UUID_REGEX.test(receiptRow.result_member_id)) {
        return { valid: false, payload: null, reason: 'IDs de solicitação/membro inválidos na proposta de nome.' };
      }
      if (payload.request_id !== receiptRow.result_entity_id) {
        return { valid: false, payload: null, reason: 'request_id do payload diverge do recibo.' };
      }
      if (payload.church_id !== receiptRow.church_id) {
        return { valid: false, payload: null, reason: 'church_id do payload diverge do recibo.' };
      }
      if (payload.member_id !== receiptRow.result_member_id) {
        return { valid: false, payload: null, reason: 'member_id do payload diverge do recibo.' };
      }
      if (typeof payload.proposed_display_name !== 'string' || !payload.proposed_display_name.trim()) {
        return { valid: false, payload: null, reason: 'proposed_display_name ausente no payload de proposta.' };
      }
      if (payload.status !== 'pending') {
        return { valid: false, payload: null, reason: 'status deve ser pending no payload de proposta.' };
      }
      return { valid: true, payload };
    }
    case 'decide_access_request': {
      if (!UUID_REGEX.test(receiptRow.result_entity_id) || !UUID_REGEX.test(receiptRow.result_member_id)) {
        return { valid: false, payload: null, reason: 'IDs de solicitação/membro inválidos na decisão.' };
      }
      if (expectedParams.requestId && receiptRow.result_entity_id !== expectedParams.requestId) {
        return { valid: false, payload: null, reason: 'request_id diverge da solicitação esperada.' };
      }
      if (payload.request_id !== receiptRow.result_entity_id) {
        return { valid: false, payload: null, reason: 'request_id do payload diverge do recibo.' };
      }
      if (payload.member_id !== receiptRow.result_member_id) {
        return { valid: false, payload: null, reason: 'member_id do payload diverge do recibo.' };
      }
      if (!['approved', 'rejected', 'expired'].includes(payload.decision)) {
        return { valid: false, payload: null, reason: 'decision inválida no payload de decisão.' };
      }

      // Mapeamento coerente entre intenção do cliente ('approve' | 'reject') e resultado do SQL ('approved' | 'rejected' | 'expired')
      const expectedDecision = expectedParams.decision === 'approve'
        ? 'approved'
        : expectedParams.decision === 'reject'
          ? 'rejected'
          : expectedParams.decision;

      if (expectedDecision) {
        if (payload.decision !== expectedDecision && payload.decision !== 'expired') {
          return { valid: false, payload: null, reason: 'decision diverge da intenção esperada.' };
        }
        if (payload.decision === 'expired') {
          if (payload.access_granted !== false || payload.error_code !== 'REQUEST_EXPIRED') {
            return { valid: false, payload: null, reason: 'resultado expired deve possuir access_granted=false e REQUEST_EXPIRED.' };
          }
        }
      }
      return { valid: true, payload };
    }
    default:
      return { valid: false, payload: null, reason: 'Ação de recibo desconhecida.' };
  }
}

/**
 * Retorna o identificador de alvo canônico de um comando conforme a ação do domínio.
 *
 * @param {object} command
 * @returns {string|null}
 */
export function getCommandTargetId(command) {
  if (!command) return null;
  if (command.targetId) return command.targetId;
  if (command.action === 'issue_invitation') return command.memberId || null;
  if (command.action === 'decide_access_request') return command.requestId || null;
  if (command.action === 'redeem_confirm_name' || command.action === 'redeem_propose_name') {
    return command.token || command.memberId || null;
  }
  return command.token || command.requestId || command.memberId || null;
}

/**
 * Salva um comando com resposta incerta no sessionStorage.
 * Persiste apenas campos mínimos e seguros por ação sem incluir tokens brutos.
 * Garante que comandos de alvos distintos não sejam perdidos (D3).
 */
export function savePendingInvitationCommand(storage, userId, command) {
  if (!storage || !userId || !command?.commandId || !command?.action) return;
  const targetId = getCommandTargetId(command);
  const primaryKey = `${INVITATION_CMD_STORAGE_PREFIX}${userId}_${command.action}`;
  try {
    const safeCommand = {
      commandId: command.commandId,
      action: command.action,
      churchId: command.churchId,
      targetId: targetId || null,
      memberId: command.memberId || null,
      token: command.token || null,
      recipientEmail: command.recipientEmail || null,
      expectedDisplayName: command.expectedDisplayName || null,
      proposedDisplayName: command.proposedDisplayName || null,
      requestId: command.requestId || null,
      decision: command.decision || null,
      userId,
      status: command.status || 'unknown',
      createdAt: command.createdAt || Date.now(),
    };
    const payload = JSON.stringify(safeCommand);

    const existingRaw = storage.getItem(primaryKey);
    let shouldOverwritePrimary = true;
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        const existingTarget = getCommandTargetId(existing);
        if (existingTarget && targetId && existingTarget !== targetId && (existing.status === 'unknown' || !existing.status)) {
          // Já existe um comando pendente desconhecido para outro alvo na chave primária!
          // Preserva o comando do alvo existente em sua própria chave de alvo
          storage.setItem(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${command.action}_${existingTarget}`, existingRaw);
          // E salva o novo comando na chave de alvo do novo alvo
          storage.setItem(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${command.action}_${targetId}`, payload);
          shouldOverwritePrimary = false;
        }
      } catch {}
    }

    if (shouldOverwritePrimary) {
      storage.setItem(primaryKey, payload);
      if (targetId) {
        const hasOtherTargetKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
          .some((k) => k && k.startsWith(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${command.action}_`));
        if (hasOtherTargetKeys) {
          storage.setItem(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${command.action}_${targetId}`, payload);
        }
      }
    }
  } catch (err) {
    console.warn('[invitationCommandService] Falha ao persistir comando no storage:', err);
  }
}

/**
 * Carrega um comando retido para a ação especificada, opcionalmente filtrando por alvo.
 */
export function loadPendingInvitationCommand(storage, userId, action, targetId = null) {
  if (!storage || !userId || !action) return null;
  try {
    if (targetId) {
      const targetRaw = storage.getItem(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${action}_${targetId}`);
      if (targetRaw) return JSON.parse(targetRaw);
    }
    const primaryRaw = storage.getItem(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${action}`);
    if (!primaryRaw) return null;
    const parsed = JSON.parse(primaryRaw);
    if (targetId) {
      const parsedTarget = getCommandTargetId(parsed);
      if (parsedTarget && parsedTarget !== targetId) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remove um comando retido para a ação especificada e opcionalmente para um alvo.
 */
export function removePendingInvitationCommand(storage, userId, action, targetId = null) {
  if (!storage || !userId || !action) return;
  try {
    if (targetId) {
      storage.removeItem(`${INVITATION_CMD_STORAGE_PREFIX}${userId}_${action}_${targetId}`);
    }
    const primaryKey = `${INVITATION_CMD_STORAGE_PREFIX}${userId}_${action}`;
    const primaryRaw = storage.getItem(primaryKey);
    if (primaryRaw) {
      const primary = JSON.parse(primaryRaw);
      const primaryTarget = getCommandTargetId(primary);
      if (!targetId || !primaryTarget || primaryTarget === targetId) {
        storage.removeItem(primaryKey);
      }
    }
  } catch {}
}

/**
 * Busca todos os comandos retidos para um usuário, opcionalmente filtrando por ação ou igreja.
 */
export function findPendingInvitationCommands(storage, userId, filter = {}) {
  if (!storage || !userId) return [];
  const results = [];
  const prefix = `${INVITATION_CMD_STORAGE_PREFIX}${userId}_`;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(prefix)) {
      try {
        const item = JSON.parse(storage.getItem(key));
        if (item && item.commandId) {
          if (filter.action && item.action !== filter.action) continue;
          if (filter.churchId && item.churchId !== filter.churchId) continue;
          if (filter.targetId) {
            const itemTarget = getCommandTargetId(item);
            if (itemTarget !== filter.targetId) continue;
          }
          if (!results.some((r) => r.commandId === item.commandId)) {
            results.push(item);
          }
        }
      } catch {}
    }
  }
  return results;
}

/**
 * Avalia se é permitido iniciar uma nova intenção diante de operações pendentes existentes (D2/D3).
 *
 * @param {Storage} storage
 * @param {string} userId
 * @param {Object} options
 * @param {string} options.action - 'issue_invitation' | 'decide_access_request' | 'redeem_confirm_name' | 'redeem_propose_name'
 * @param {string} [options.churchId]
 * @param {string} [options.targetId] - memberId / requestId / token
 * @param {string} [options.decision] - 'approve' | 'reject'
 * @returns {{ allowed: boolean, isRetry: boolean, reason?: string, existingCommand?: Object }}
 */
export function checkPendingOperationConflict(storage, userId, {
  action,
  churchId,
  targetId,
  decision,
}) {
  if (!storage || !userId || !action) {
    return { allowed: true, isRetry: false };
  }

  // 1. Resgate: exclusão mútua entre confirmação e proposta de nome para o mesmo token
  if (action === 'redeem_confirm_name' || action === 'redeem_propose_name') {
    const oppositeAction = action === 'redeem_confirm_name' ? 'redeem_propose_name' : 'redeem_confirm_name';
    const pendingOpposite = loadPendingInvitationCommand(storage, userId, oppositeAction);
    if (pendingOpposite) {
      const oppTarget = getCommandTargetId(pendingOpposite);
      if (!targetId || !oppTarget || oppTarget === targetId) {
        return {
          allowed: false,
          isRetry: false,
          reason: 'incompatible_redeem_action',
          existingCommand: pendingOpposite,
        };
      }
    }
  }

  // 2. Busca qualquer comando desconhecido da mesma ação
  const pendingCommands = findPendingInvitationCommands(storage, userId, { action, churchId });
  if (pendingCommands.length === 0) {
    return { allowed: true, isRetry: false };
  }

  for (const cmd of pendingCommands) {
    const cmdTarget = getCommandTargetId(cmd);

    // Se o alvo for o mesmo
    if (cmdTarget && targetId && cmdTarget === targetId) {
      if (action === 'decide_access_request' && decision && cmd.decision && cmd.decision !== decision) {
        return {
          allowed: false,
          isRetry: false,
          reason: 'incompatible_decision',
          existingCommand: cmd,
        };
      }
      return {
        allowed: true,
        isRetry: true,
        existingCommand: cmd,
      };
    }

    // Se o alvo for DIFERENTE
    if (cmdTarget && targetId && cmdTarget !== targetId) {
      return {
        allowed: false,
        isRetry: false,
        reason: 'other_target_pending',
        existingCommand: cmd,
      };
    }
  }
  return { allowed: true, isRetry: false };
}

/**
 * Salva o marcador de solicitação de acesso para continuidade por aba (M52 / PRD).
 * Contém apenas identificadores mínimos e não constitui permissão.
 */
export function saveAccessRequestMarker(storage, userId, marker) {
  const reqId = marker?.requestId || marker?.request_id;
  const chId = marker?.churchId || marker?.church_id;
  if (!storage || !userId || !reqId) return;
  const key = `${ACCESS_REQUEST_MARKER_PREFIX}${userId}`;
  try {
    storage.setItem(key, JSON.stringify({
      userId,
      churchId: chId,
      requestId: reqId,
      churchName: marker.churchName || marker.church_name || null,
      proposedDisplayName: marker.proposedDisplayName || marker.proposed_display_name || null,
      status: marker.status || 'pending',
      expiresAt: marker.expiresAt || marker.expires_at || null,
      submittedAt: marker.submittedAt || marker.submitted_at || null,
    }));
  } catch (err) {
    console.warn('[invitationCommandService] Falha ao salvar marcador de solicitação:', err);
  }
}

/**
 * Carrega o marcador de solicitação de acesso e reconcilia o UID.
 */
export function loadAccessRequestMarker(storage, userId) {
  if (!storage || !userId) return null;
  const key = `${ACCESS_REQUEST_MARKER_PREFIX}${userId}`;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const marker = JSON.parse(raw);
    if (marker.userId !== userId) return null;
    return marker;
  } catch {
    return null;
  }
}

/**
 * Remove o marcador de solicitação de acesso.
 */
export function removeAccessRequestMarker(storage, userId) {
  if (!storage || !userId) return;
  const key = `${ACCESS_REQUEST_MARKER_PREFIX}${userId}`;
  try {
    storage.removeItem(key);
  } catch {}
}

/**
 * Limpa todos os marcadores e comandos de convite associados a um usuário.
 */
export function clearAllInvitationStorageForUser(storage, userId) {
  if (!storage || !userId) return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && (k.startsWith(`${INVITATION_CMD_STORAGE_PREFIX}${userId}`) || k === `${ACCESS_REQUEST_MARKER_PREFIX}${userId}`)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => storage.removeItem(k));
  } catch {}
}
