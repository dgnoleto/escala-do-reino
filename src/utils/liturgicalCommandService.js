/**
 * liturgicalCommandService.js — Serviços e utilitários para o ciclo de equipes, cultos e escalas.
 *
 * Mapeia os endpoints RPC do incremento 015 no servidor:
 * 1. create_church_team, assign_team_leader (transfer_team_leadership);
 * 2. create_team_role, add_team_member, remove_team_member;
 * 3. grant_member_qualification, revoke_member_qualification;
 * 4. create_church_event, assign_event_liturgy_leader, start_event_service, finish_event_service, cancel_church_event;
 * 5. assign_event_participant, replace_event_participant;
 * 6. list_church_teams, list_church_team_roles, list_team_members, list_member_qualifications, list_church_events, list_event_assignments.
 *
 * Implementa validação estrita de recibos (B2-05), proteção contra respostas falsamente
 * positivas (null, [], ou recibo divergente) e retenção/reconciliação de comandos pendentes.
 */

import { isDefinitiveServerError as isDefinitiveMemberServerError } from './memberCommandService.js';

// Chave canônica para retenção de comandos litúrgicos pendentes na sessão
export const PENDING_LITURGICAL_COMMAND_KEY = 'escala_pending_liturgical_command_v1';

/**
 * Valida estritamente se o retorno da RPC contém recibo canônico compatível.
 * Rejeita null, array vazio, objetos sem identificadores e recibos de outro comando/igreja/ação.
 *
 * @param {any} data Retorno bruto da RPC Supabase
 * @param {string} commandId UUID do comando enviado
 * @param {string} churchId UUID da igreja ativa
 * @param {string} [action] Ação esperada da RPC
 * @returns {object|null} Recibo validado ou null se inválido/divergente
 */
export function validateLiturgicalReceipt(data, commandId, churchId, action) {
  if (!data) return null;
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return null;
  const receipt = rows[0];
  if (!receipt || typeof receipt !== 'object') return null;

  if (receipt.command_id !== commandId) return null;
  if (receipt.church_id !== churchId) return null;
  // Ação é obrigatória e deve coincidir estritamente com a esperada
  if (!receipt.action || (action && receipt.action !== action)) return null;

  // Entidade e payload são obrigatórios para comprovação de efeito (B2-05)
  if (!receipt.result_entity_id) return null;
  if (!receipt.result_payload || typeof receipt.result_payload !== 'object' || Array.isArray(receipt.result_payload)) return null;

  // Coerência estrita entre entidade principal e identificador no payload (B2-05)
  const payload = receipt.result_payload;
  let payloadEntityId = null;

  switch (action || receipt.action) {
    case 'create_church_team':
    case 'assign_team_leader':
      payloadEntityId = payload.team_id ?? payload.id;
      break;
    case 'create_team_role':
      payloadEntityId = payload.role_id ?? payload.team_role_id ?? payload.id;
      break;
    case 'add_team_member':
    case 'remove_team_member':
      payloadEntityId = payload.membership_id ?? payload.id;
      break;
    case 'grant_member_qualification':
    case 'revoke_member_qualification':
      payloadEntityId = payload.qualification_id ?? payload.id;
      break;
    case 'create_church_event':
    case 'assign_event_liturgy_leader':
    case 'start_event_service':
    case 'finish_event_service':
    case 'cancel_church_event':
      payloadEntityId = payload.event_id ?? payload.id;
      break;
    case 'create_event_item':
      payloadEntityId = payload.item_id ?? payload.event_item_id ?? payload.id;
      break;
    case 'assign_event_participant':
      payloadEntityId = payload.assignment_id ?? payload.id;
      break;
    case 'replace_event_participant':
      payloadEntityId = payload.replacement_assignment_id ?? payload.assignment_id ?? payload.id;
      break;
    default:
      payloadEntityId = payload.id;
      break;
  }

  // Identificador principal é obrigatório no payload e deve coincidir estritamente com result_entity_id
  if (!payloadEntityId || String(payloadEntityId) !== String(receipt.result_entity_id)) {
    return null;
  }

  return receipt;
}

/**
 * Classifica se um erro retornado pelo servidor em operações litúrgicas é definitivo.
 * @param {object|Error|null} error
 * @returns {boolean}
 */
export function isDefinitiveLiturgicalError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const status = Number(error.status || 0);

  // Códigos Postgres canônicos do sistema:
  // 42501 = Privilégio insuficiente / não autorizado
  // 22000 = Validação de regra de dados (ex: término antes de início, comprimento)
  // 22004 = Parâmetro obrigatório ausente
  // 23505 = Unicidade violada ou parâmetros divergentes para mesmo command_id
  // 23514 = Check constraint violada
  // P0002 = Entidade não encontrada ou inativa
  // P0019 = Conflito de versão ou estado
  // P0020 = Membro não possui aptidão homologada para a função / Alocação já substituída
  // P0022 = Membro lidera ministério ativo
  // P0023 = Membro lidera liturgia em evento ativo
  // P0024 = Membro escalado ou nominalmente responsável em evento ativo
  // P0025 = Evento com horário expirado sem encerramento formal ou conflito de agenda
  if ([
    '42501', '22000', '22004', '23505', '23514',
    'P0002', 'P0004', 'P0015', 'P0016', 'P0018',
    'P0019', 'P0020', 'P0021', 'P0022', 'P0023', 'P0024', 'P0025'
  ].includes(code)) {
    return true;
  }

  if (status >= 400 && status < 500 && status !== 408) {
    return true;
  }

  const msg = String(error.message || '').toLowerCase();
  if (
    msg.includes('não autenticado') ||
    msg.includes('não autorizado') ||
    msg.includes('apenas administradores') ||
    msg.includes('apenas o líder') ||
    msg.includes('apenas o líder da liturgia') ||
    msg.includes('membro inativo') ||
    msg.includes('aptidão ativa homologada') ||
    msg.includes('já se encontra encerrado') ||
    msg.includes('não é permitido') ||
    msg.includes('obrigatório') ||
    msg.includes('conflito') ||
    msg.includes('p0020') ||
    msg.includes('p0022') ||
    msg.includes('p0023') ||
    msg.includes('p0024') ||
    msg.includes('p0025')
  ) {
    return true;
  }

  return isDefinitiveMemberServerError(error);
}

/**
 * Salva comando litúrgico pendente de confirmação na sessão.
 */
export function savePendingLiturgicalCommand(storage, userId, command) {
  if (!storage || !userId || !command || !command.commandId || !command.churchId) return false;
  try {
    const raw = storage.getItem(PENDING_LITURGICAL_COMMAND_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const userStore = store[userId] || {};

    userStore[command.churchId] = {
      ...command,
      savedAt: new Date().toISOString(),
    };
    store[userId] = userStore;
    storage.setItem(PENDING_LITURGICAL_COMMAND_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recupera comando litúrgico pendente para um usuário e igreja específicos.
 */
export function loadPendingLiturgicalCommand(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return null;
  try {
    const raw = storage.getItem(PENDING_LITURGICAL_COMMAND_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw);
    return store[userId]?.[churchId] || null;
  } catch {
    return null;
  }
}

/**
 * Remove comando litúrgico pendente após confirmação definitiva.
 */
export function removePendingLiturgicalCommand(storage, userId, churchId) {
  if (!storage || !userId || !churchId) return false;
  try {
    const raw = storage.getItem(PENDING_LITURGICAL_COMMAND_KEY);
    if (!raw) return false;
    const store = JSON.parse(raw);
    if (store[userId] && store[userId][churchId]) {
      delete store[userId][churchId];
      storage.setItem(PENDING_LITURGICAL_COMMAND_KEY, JSON.stringify(store));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Função utilitária unificada de despacho RPC litúrgico com conferência estrita de recibo.
 */
async function dispatchLiturgicalRpc({ supabase, rpcName, action, churchId, commandId, params }) {
  try {
    const { data, error } = await supabase.rpc(rpcName, params);

    if (error) {
      return {
        status: isDefinitiveLiturgicalError(error) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
        error,
        message: error.message || `Erro ao executar ${action}.`,
      };
    }

    const receipt = validateLiturgicalReceipt(data, commandId, churchId, action);
    if (!receipt) {
      return {
        status: 'UNCERTAIN',
        message: 'Resposta recebida sem recibo canônico compatível para confirmação.',
      };
    }

    return {
      status: 'SUCCESS',
      receipt,
      data: receipt.result_payload || receipt,
    };
  } catch (err) {
    return {
      status: isDefinitiveLiturgicalError(err) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
      error: err,
      message: err.message || `Falha de comunicação ao executar ${action}.`,
    };
  }
}

// -----------------------------------------------------------------------------
// MUTAÇÕES: EQUIPES / MINISTÉRIOS
// -----------------------------------------------------------------------------

/**
 * Cria uma nova equipe na igreja via RPC (Exclusivo Administrador).
 */
export async function createChurchTeam({ supabase, churchId, commandId, name, leaderMemberId = null }) {
  if (!supabase || !churchId || !commandId || !name) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para criação de equipe.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'create_church_team',
    action: 'create_church_team',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_name: name,
      p_leader_member_id: leaderMemberId || null,
    },
  });
}

/**
 * Transfere ou designa liderança de equipe via RPC (Exclusivo Administrador).
 */
export async function assignTeamLeader({
  supabase,
  churchId,
  commandId,
  teamId,
  newLeaderMemberId,
  expectedVersion = null,
}) {
  if (!supabase || !churchId || !commandId || !teamId || !newLeaderMemberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para transferência de liderança.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'assign_team_leader',
    action: 'assign_team_leader',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_team_id: teamId,
      p_new_leader_member_id: newLeaderMemberId,
      p_expected_version: expectedVersion !== null ? Number(expectedVersion) : null,
    },
  });
}

// Alias contratual
export const transferTeamLeadership = assignTeamLeader;

/**
 * Cria uma função técnica na equipe via RPC (Admin ou Líder da Equipe).
 */
export async function createTeamRole({ supabase, churchId, commandId, teamId, name, description = null }) {
  if (!supabase || !churchId || !commandId || !teamId || !name) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para criação de função técnica.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'create_team_role',
    action: 'create_team_role',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_team_id: teamId,
      p_name: name,
      p_description: description || null,
    },
  });
}

/**
 * Adiciona integrante à equipe via RPC (Admin ou Líder da Equipe).
 */
export async function addTeamMember({ supabase, churchId, commandId, teamId, memberId }) {
  if (!supabase || !churchId || !commandId || !teamId || !memberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para inclusão de integrante na equipe.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'add_team_member',
    action: 'add_team_member',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_team_id: teamId,
      p_member_id: memberId,
    },
  });
}

/**
 * Remove integrante da equipe via RPC (Admin ou Líder da Equipe).
 */
export async function removeTeamMember({ supabase, churchId, commandId, teamId, memberId }) {
  if (!supabase || !churchId || !commandId || !teamId || !memberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para remoção de integrante da equipe.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'remove_team_member',
    action: 'remove_team_member',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_team_id: teamId,
      p_member_id: memberId,
    },
  });
}

/**
 * Homologa aptidão/qualificação de membro para função técnica via RPC (Admin ou Líder da Equipe).
 */
export async function grantMemberQualification({ supabase, churchId, commandId, memberId, teamId, teamRoleId }) {
  if (!supabase || !churchId || !commandId || !memberId || !teamId || !teamRoleId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para homologação de aptidão.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'grant_member_qualification',
    action: 'grant_member_qualification',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_member_id: memberId,
      p_team_id: teamId,
      p_team_role_id: teamRoleId,
    },
  });
}

/**
 * Revoga aptidão/qualificação de membro via RPC (Admin ou Líder da Equipe).
 */
export async function revokeMemberQualification({ supabase, churchId, commandId, memberId, teamId, teamRoleId }) {
  if (!supabase || !churchId || !commandId || !memberId || !teamId || !teamRoleId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para revogação de aptidão.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'revoke_member_qualification',
    action: 'revoke_member_qualification',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_member_id: memberId,
      p_team_id: teamId,
      p_team_role_id: teamRoleId,
    },
  });
}

// -----------------------------------------------------------------------------
// MUTAÇÕES: CULTOS / EVENTOS / LITURGIA
// -----------------------------------------------------------------------------

/**
 * Cria um novo culto/evento na igreja via RPC.
 * Autorizado para Admin OU Líder de Ministério Ativo (se líder de ministério, liturgyLeaderMemberId deve ser null).
 */
export async function createChurchEvent({
  supabase,
  churchId,
  commandId,
  title,
  eventType = 'culto',
  plannedStartAt,
  plannedEndAt,
  liturgyLeaderMemberId = null,
}) {
  if (!supabase || !churchId || !commandId || !title || !plannedStartAt || !plannedEndAt) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para criação de evento.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'create_church_event',
    action: 'create_church_event',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_title: title,
      p_event_type: eventType,
      p_planned_start_at: plannedStartAt,
      p_planned_end_at: plannedEndAt,
      p_liturgy_leader_member_id: liturgyLeaderMemberId || null,
    },
  });
}

/**
 * Designa ou altera o Líder da Liturgia de um evento (Exclusivo Administrador).
 */
export async function assignEventLiturgyLeader({
  supabase,
  churchId,
  commandId,
  eventId,
  newLiturgyLeaderMemberId,
  expectedVersion = null,
}) {
  if (!supabase || !churchId || !commandId || !eventId || !newLiturgyLeaderMemberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para designação de liturgia.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'assign_event_liturgy_leader',
    action: 'assign_event_liturgy_leader',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_new_liturgy_leader_member_id: newLiturgyLeaderMemberId,
      p_expected_version: expectedVersion !== null ? Number(expectedVersion) : null,
    },
  });
}

/**
 * Inicia execução do culto/evento via RPC (Exclusivo Líder da Liturgia).
 */
export async function startEventService({
  supabase,
  churchId,
  commandId,
  eventId,
  expectedVersion = null,
}) {
  if (!supabase || !churchId || !commandId || !eventId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para início do culto.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'start_event_service',
    action: 'start_event_service',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_expected_version: expectedVersion !== null ? Number(expectedVersion) : null,
    },
  });
}

/**
 * Encerra o culto/evento via RPC (Exclusivo Líder da Liturgia).
 */
export async function finishEventService({
  supabase,
  churchId,
  commandId,
  eventId,
  expectedVersion = null,
}) {
  if (!supabase || !churchId || !commandId || !eventId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para encerramento de evento.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'finish_event_service',
    action: 'finish_event_service',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_expected_version: expectedVersion !== null ? Number(expectedVersion) : null,
    },
  });
}

/**
 * Cancela culto/evento via RPC com motivo obrigatório (Admin ou Líder da Liturgia).
 */
export async function cancelChurchEvent({
  supabase,
  churchId,
  commandId,
  eventId,
  cancelReason,
  expectedVersion = null,
}) {
  if (!supabase || !churchId || !commandId || !eventId || !cancelReason) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para cancelamento de evento.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'cancel_church_event',
    action: 'cancel_church_event',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_cancel_reason: cancelReason,
      p_expected_version: expectedVersion !== null ? Number(expectedVersion) : null,
    },
  });
}

/**
 * Cria item de cronograma de culto ou apoio paralelo (Líder da Liturgia, Equipe designada ou Admin).
 */
export async function createEventItem({
  supabase,
  churchId,
  commandId,
  eventId,
  title,
  itemNature = 'liturgical',
  sequenceOrder = 1,
  plannedDurationSeconds = 300,
  designatedTeamId = null,
  nominalLeaderMemberId = null,
}) {
  if (!supabase || !churchId || !commandId || !eventId || !title) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para criação de item do evento.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'create_event_item',
    action: 'create_event_item',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_title: title,
      p_item_nature: itemNature,
      p_sequence_order: Number(sequenceOrder) || 1,
      p_planned_duration_seconds: Number(plannedDurationSeconds) || 300,
      p_designated_team_id: designatedTeamId || null,
      p_nominal_leader_member_id: nominalLeaderMemberId || null,
    },
  });
}

// -----------------------------------------------------------------------------
// MUTAÇÕES: ESCALA (ALOCAÇÃO E SUBSTITUIÇÃO)
// -----------------------------------------------------------------------------

/**
 * Aloca participante em evento via RPC (Líder da Equipe ou Liturgia/Admin).
 */
export async function assignEventParticipant({
  supabase,
  churchId,
  commandId,
  eventId,
  teamId,
  memberId,
  itemId = null,
  teamRoleId = null,
  notes = null,
}) {
  if (!supabase || !churchId || !commandId || !eventId || !teamId || !memberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para alocação de voluntário.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'assign_event_participant',
    action: 'assign_event_participant',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_team_id: teamId,
      p_member_id: memberId,
      p_item_id: itemId || null,
      p_team_role_id: teamRoleId || null,
      p_notes: notes || null,
    },
  });
}

/**
 * Substitui voluntário escalado via RPC (Líder da equipe antes do início / Liturgia em execução).
 */
export async function replaceEventParticipant({
  supabase,
  churchId,
  commandId,
  assignmentId,
  replacementMemberId,
  reason = null,
  notes = null,
}) {
  if (!supabase || !churchId || !commandId || !assignmentId || !replacementMemberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para substituição de voluntário.',
    };
  }

  return dispatchLiturgicalRpc({
    supabase,
    rpcName: 'replace_event_participant',
    action: 'replace_event_participant',
    churchId,
    commandId,
    params: {
      p_church_id: churchId,
      p_command_id: commandId,
      p_assignment_id: assignmentId,
      p_replacement_member_id: replacementMemberId,
      p_reason: reason || null,
      p_notes: notes || null,
    },
  });
}

// -----------------------------------------------------------------------------
// CONSULTAS: LISTAGENS REAIS
// -----------------------------------------------------------------------------

/**
 * Consulta a lista real de equipes cadastradas no servidor para o tenant ativo.
 */
export async function fetchChurchTeams({ supabase, churchId }) {
  if (!supabase || !churchId) return [];
  const { data, error } = await supabase.rpc('list_church_teams', {
    p_church_id: churchId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.teams || [];
}

/**
 * Consulta funções técnicas cadastradas para uma equipe.
 */
export async function fetchChurchTeamRoles({ supabase, churchId, teamId }) {
  if (!supabase || !churchId || !teamId) return [];
  const { data, error } = await supabase.rpc('list_church_team_roles', {
    p_church_id: churchId,
    p_team_id: teamId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.roles || [];
}

/**
 * Consulta integrantes vinculados a uma equipe.
 */
export async function fetchTeamMembers({ supabase, churchId, teamId }) {
  if (!supabase || !churchId || !teamId) return [];
  const { data, error } = await supabase.rpc('list_team_members', {
    p_church_id: churchId,
    p_team_id: teamId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.members || [];
}

/**
 * Consulta aptidões homologadas para um membro.
 */
export async function fetchMemberQualifications({ supabase, churchId, memberId }) {
  if (!supabase || !churchId || !memberId) return [];
  const { data, error } = await supabase.rpc('list_member_qualifications', {
    p_church_id: churchId,
    p_member_id: memberId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.qualifications || [];
}

/**
 * Consulta a lista real de eventos cadastrados no servidor para o tenant ativo.
 */
export async function fetchChurchEvents({ supabase, churchId, statusFilter = 'all', limit = 20, offset = 0 }) {
  if (!supabase || !churchId) return { events: [], totalCount: 0 };
  const { data, error } = await supabase.rpc('list_church_events', {
    p_church_id: churchId,
    p_status_filter: statusFilter,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    events: row?.events || [],
    totalCount: Number(row?.total_count || 0),
  };
}

/**
 * Consulta as alocações/escalas de um evento.
 */
export async function fetchEventAssignments({ supabase, churchId, eventId }) {
  if (!supabase || !churchId || !eventId) return [];
  const { data, error } = await supabase.rpc('list_event_assignments', {
    p_church_id: churchId,
    p_event_id: eventId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.assignments || [];
}

/**
 * Formata mensagens de erro na consulta de equipes de forma contextualizada.
 * Distingue:
 * - Indisponibilidade de backend / contrato ausente (PGRST202 / Could not find function)
 * - Permissão recusada (42501 / permission denied)
 * - Falha de conexão / transporte (network / failed to fetch)
 * - Erro genérico
 *
 * @param {object|string} error
 * @param {object} [options]
 * @returns {string}
 */
export function formatTeamsListErrorMessage(error, { isRefresh = false } = {}) {
  const rawMsg = typeof error === 'string' ? error : String(error?.message || '');
  const lower = rawMsg.toLowerCase();
  const code = String(error?.code || '');

  const isNetworkFailure =
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('abort') ||
    lower.includes('conexão') ||
    lower.includes('offline');

  if (isNetworkFailure) {
    if (isRefresh) {
      return 'Não foi possível atualizar os ministérios e equipes por falha de conexão. Os dados exibidos podem estar desatualizados.';
    }
    return 'Não foi possível carregar os ministérios e equipes por falha de conexão. Verifique sua rede e tente novamente.';
  }

  if (
    code === 'PGRST202' ||
    lower.includes('could not find the function') ||
    lower.includes('schema cache') ||
    lower.includes('does not exist')
  ) {
    return 'Serviço de equipes indisponível no servidor. O contrato necessário ainda não está disponível no backend conectado.';
  }

  if (
    code === '42501' ||
    lower.includes('privilégio') ||
    lower.includes('não autorizado') ||
    lower.includes('permission denied')
  ) {
    return 'Permissão insuficiente para consultar os ministérios e equipes desta igreja.';
  }

  if (rawMsg.trim() && !rawMsg.includes('TypeError') && !rawMsg.includes('ReferenceError') && rawMsg.length < 150) {
    return rawMsg;
  }

  if (isRefresh) {
    return 'Não foi possível atualizar os ministérios e equipes. Tente novamente.';
  }
  return 'Não foi possível carregar os ministérios e equipes. Tente novamente.';
}
