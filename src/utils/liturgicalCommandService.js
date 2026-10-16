/**
 * liturgicalCommandService.js — Serviços e utilitários para o ciclo de equipes, cultos e escalas.
 *
 * Mapeia os endpoints RPC do incremento 015 no servidor:
 * 1. create_church_team, assign_team_leader;
 * 2. create_church_event, assign_event_liturgy_leader, finish_event_service;
 * 3. assign_event_participant, replace_event_participant;
 * 4. list_church_teams, list_church_events.
 */

import { isDefinitiveServerError as isDefinitiveMemberServerError } from './memberCommandService.js';

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
  // P0002 = Entidade não encontrada ou inativa
  // P0019 = Conflito de versão ou estado
  // P0020 = Membro não possui aptidão homologada para a função
  // P0022 = Membro lidera ministério ativo
  // P0023 = Membro lidera liturgia em evento ativo
  // P0024 = Membro escalado ou nominalmente responsável em evento ativo
  // P0025 = Evento com horário expirado sem encerramento formal
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
 * Cria uma nova equipe na igreja via RPC.
 */
export async function createChurchTeam({ supabase, churchId, commandId, name, leaderMemberId = null }) {
  if (!supabase || !churchId || !commandId || !name) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para criação de equipe.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('create_church_team', {
      p_church_id: churchId,
      p_command_id: commandId,
      p_name: name,
      p_leader_member_id: leaderMemberId || null,
    });

    if (error) {
      return {
        status: isDefinitiveLiturgicalError(error) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
        error,
        message: error.message || 'Erro ao criar equipe.',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: 'SUCCESS',
      data: row,
    };
  } catch (err) {
    return {
      status: isDefinitiveLiturgicalError(err) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
      error: err,
      message: err.message || 'Falha de comunicação ao criar equipe.',
    };
  }
}

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

  try {
    const { data, error } = await supabase.rpc('create_church_event', {
      p_church_id: churchId,
      p_command_id: commandId,
      p_title: title,
      p_event_type: eventType,
      p_planned_start_at: plannedStartAt,
      p_planned_end_at: plannedEndAt,
      p_liturgy_leader_member_id: liturgyLeaderMemberId || null,
    });

    if (error) {
      return {
        status: isDefinitiveLiturgicalError(error) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
        error,
        message: error.message || 'Erro ao criar evento.',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: 'SUCCESS',
      data: row,
    };
  } catch (err) {
    return {
      status: isDefinitiveLiturgicalError(err) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
      error: err,
      message: err.message || 'Falha de comunicação ao criar evento.',
    };
  }
}

/**
 * Aloca participante em evento via RPC (exclusivo Líder da Equipe).
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

  try {
    const { data, error } = await supabase.rpc('assign_event_participant', {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
      p_team_id: teamId,
      p_member_id: memberId,
      p_item_id: itemId || null,
      p_team_role_id: teamRoleId || null,
      p_notes: notes || null,
    });

    if (error) {
      return {
        status: isDefinitiveLiturgicalError(error) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
        error,
        message: error.message || 'Erro ao alocar voluntário.',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: 'SUCCESS',
      data: row,
    };
  } catch (err) {
    return {
      status: isDefinitiveLiturgicalError(err) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
      error: err,
      message: err.message || 'Falha de comunicação ao alocar voluntário.',
    };
  }
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
  reason,
}) {
  if (!supabase || !churchId || !commandId || !assignmentId || !replacementMemberId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para substituição de voluntário.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('replace_event_participant', {
      p_church_id: churchId,
      p_command_id: commandId,
      p_assignment_id: assignmentId,
      p_replacement_member_id: replacementMemberId,
      p_reason: reason || null,
    });

    if (error) {
      return {
        status: isDefinitiveLiturgicalError(error) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
        error,
        message: error.message || 'Erro ao substituir voluntário.',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: 'SUCCESS',
      data: row,
    };
  } catch (err) {
    return {
      status: isDefinitiveLiturgicalError(err) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
      error: err,
      message: err.message || 'Falha de comunicação ao substituir voluntário.',
    };
  }
}

/**
 * Encerra o culto/evento via RPC (exclusivo Líder da Liturgia).
 */
export async function finishEventService({ supabase, churchId, commandId, eventId }) {
  if (!supabase || !churchId || !commandId || !eventId) {
    return {
      status: 'DEFINITIVE_ERROR',
      message: 'Parâmetros obrigatórios ausentes para encerramento de evento.',
    };
  }

  try {
    const { data, error } = await supabase.rpc('finish_event_service', {
      p_church_id: churchId,
      p_command_id: commandId,
      p_event_id: eventId,
    });

    if (error) {
      return {
        status: isDefinitiveLiturgicalError(error) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
        error,
        message: error.message || 'Erro ao encerrar culto.',
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: 'SUCCESS',
      data: row,
    };
  } catch (err) {
    return {
      status: isDefinitiveLiturgicalError(err) ? 'DEFINITIVE_ERROR' : 'UNCERTAIN',
      error: err,
      message: err.message || 'Falha de comunicação ao encerrar culto.',
    };
  }
}

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
