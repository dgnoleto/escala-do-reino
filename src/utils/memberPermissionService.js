/**
 * Escala do Reino — memberPermissionService.js
 *
 * Módulo de cliente para gestão de permissões administrativas da igreja (Issue #23).
 * Garante idempotência, proteção contra comandos concorrentes e mapeamento amigável
 * de erros de negócio (CA01 a CA04).
 *
 * ==============================================================================
 * VALIDAÇÃO DE NEGÓCIO (BDD / GHERKIN)
 * ==============================================================================
 * Funcionalidade: Gestão de Permissões Administrativas da Igreja
 *
 *   Cenário: Concessão de administração para membro elegível (CA01)
 *     Dado que o usuário autenticado é administrador ativo da igreja selecionada
 *     E o membro alvo possui acesso ativo com e-mail confirmado e não administra outra igreja
 *     Quando o administrador solicita conceder administração ao membro
 *     Então o servidor executa a RPC manage_church_admin com ação 'grant'
 *     E o membro passa a ter is_admin = true com recibo e auditoria registrados
 *
 *   Cenário: Bloqueio de concessão para quem já administra outra igreja (CA01)
 *     Dado que o membro alvo já é administrador ativo em outra igreja
 *     Quando o administrador tenta conceder administração
 *     Então o servidor recusa com código 23514
 *     E a interface informa que o membro já possui administração ativa em outra igreja
 *
 *   Cenário: Bloqueio de retirada ou renúncia do último administrador (CA02)
 *     Dado que a igreja possui apenas um único administrador ativo
 *     Quando o administrador tenta revogar seu próprio acesso ou de outrem
 *     Então o servidor recusa a operação com código 23514
 *     E a interface informa que a igreja não pode ficar sem administrador ativo
 *
 *   Cenário: Saída voluntária ou revogação com sucessor elegível (CA02)
 *     Dado que a igreja possui dois ou mais administradores ativos
 *     Quando um administrador renuncia à administração ou é revogado
 *     Então a permissão de administração é removida (is_admin = false)
 *     E seu cadastro de membro ativo é mantido inalterado
 *
 *   Cenário: Desacoplamento e preservação de histórico e ministérios (CA03)
 *     Dado que o membro é líder litúrgico, líder de equipe ou escalado em cultos
 *     Quando a permissão administrativa é alterada (concedida ou retirada)
 *     Então suas aptidões, escalas e lideranças são integralmente preservadas
 *
 *   Cenário: Explicação prévia na interface e idempotência de comandos (CA04)
 *     Dado que o administrador aciona a ação de alteração de permissão
 *     Quando o diálogo de confirmação é exibido
 *     Então o efeito é detalhado antes da confirmação
 *     E o botão entra em estado ocupado para evitar duplicidade de comandos
 * ==============================================================================
 */

export function permissionStorageKey(userId, churchId) {
  return `member_perm_cmd_${userId}_${churchId}`;
}

export function readPendingPermission(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return null;
  const raw = storage.getItem(permissionStorageKey(userId, churchId));
  if (!raw) return null;
  try {
    const cmd = JSON.parse(raw);
    if (cmd.userId !== userId || cmd.churchId !== churchId || !cmd.commandId) {
      return null;
    }
    return cmd;
  } catch {
    return null;
  }
}

export function savePendingPermission(storage, userId, churchId, command) {
  if (!storage || !userId || !churchId || !command) return;
  storage.setItem(permissionStorageKey(userId, churchId), JSON.stringify({
    ...command,
    userId,
    churchId,
    timestamp: Date.now(),
  }));
}

export function clearPendingPermission(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return;
  storage.removeItem(permissionStorageKey(userId, churchId));
}

export function formatPermissionErrorMessage(error) {
  if (!error) return 'Não foi possível completar a operação de permissão.';

  const code = error.code || '';
  const message = error.message || '';

  if (code === '42501' || code === '28000') {
    return 'Você não possui permissão de administrador ativo para alterar permissões nesta igreja.';
  }

  if (code === '23514') {
    if (/outra igreja/i.test(message)) {
      return 'Este membro já possui administração ativa em outra igreja e não pode administrar duas igrejas.';
    }
    if (/último administrador|sem administrador/i.test(message)) {
      return 'Operação não permitida: a igreja não pode ficar sem pelo menos um administrador ativo elegível.';
    }
    return 'A alteração de permissão não atende às regras de continuidade ou limites do sistema.';
  }

  if (code === '23505') {
    return 'Este comando já foi enviado anteriormente. Recarregue a página para conferir o resultado.';
  }

  if (code === '22023' || code === '22004') {
    if (/não possui vínculo/i.test(message) || /não está ativa/i.test(message)) {
      return 'O membro selecionado ainda não concluiu a entrada com conta confirmada na igreja.';
    }
    return 'Dados inválidos fornecidos para a alteração de permissão.';
  }

  if (code === '40001') {
    return 'Houve uma alteração concorrente nas permissões. Por favor, tente novamente.';
  }

  if (code === 'PGRST202' || code === '42883') {
    return 'A gestão de permissões administrativas ainda não está habilitada neste ambiente.';
  }

  if (/network|fetch|timeout/i.test(message)) {
    return 'Falha de conexão com o servidor. Verifique sua rede e tente novamente.';
  }

  return message || 'Ocorreu um erro ao processar a alteração de permissão.';
}

/**
 * Executa o comando transacional de alteração de permissão administrativa.
 *
 * @param {object} supabase - Cliente Supabase configurado
 * @param {object} options
 * @param {string} options.churchId - ID da igreja
 * @param {string} options.targetMemberId - ID do membro alvo
 * @param {'grant'|'revoke'} options.action - Ação a executar
 * @param {string} [options.commandId] - ID idempotente do comando
 * @returns {Promise<{ success: boolean, data?: object, error?: object }>}
 */
export async function manageChurchAdmin(supabase, { churchId, targetMemberId, action, commandId }) {
  if (!supabase) throw new Error('Cliente Supabase não fornecido.');
  if (!churchId || !targetMemberId || !action) {
    throw new Error('Parâmetros obrigatórios ausentes.');
  }

  const effectiveCommandId = commandId || crypto.randomUUID();

  const { data, error } = await supabase.rpc('manage_church_admin', {
    p_church_id: churchId,
    p_target_member_id: targetMemberId,
    p_action: action,
    p_command_id: effectiveCommandId,
  });

  if (error) {
    return {
      success: false,
      error,
      errorMessage: formatPermissionErrorMessage(error),
      commandId: effectiveCommandId,
    };
  }

  const result = Array.isArray(data) ? data[0] : data;
  return {
    success: true,
    data: result,
    commandId: effectiveCommandId,
  };
}
