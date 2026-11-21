/**
 * eventItemService.js — Gerenciamento e persistência de itens do programa do evento (Issue #29, #30, #51).
 *
 * Usa as RPCs do pacote SQL 026 pós-B2:
 * - public.create_event_item (via createEventItem) para criar etapas litúrgicas e apoios paralelos.
 * - public.update_event_item (via updateEventItem) para edição concorrente com expected_updated_at.
 * - public.remove_event_item (via removeEventItem) para remoção protegida contra concorrência e dependências.
 * - public.reorder_event_items (via reorderEventItems) para reordenação com lista completa de IDs da natureza litúrgica.
 * - public.get_event_program para hidratação durável e leitura de etapas e apoios.
 *
 * Contrato vigente:
 * - Etapas litúrgicas e apoios paralelos são gravados no backend com suas naturezas específicas ('liturgical' e 'parallel_support').
 * - Todos os itens exigem planned_duration_seconds > 0 no banco.
 * - Cada item possui sequência independente iniciada em 1 por natureza.
 */

import { createEventItem } from './liturgicalCommandService.js';
import { generateCommandUuid, normalizeNfcText } from './eventPlanningService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aviso permanente da tela sobre o que é e o que não é gravado no servidor. */
export const EVENT_ITEMS_PERSISTENCE_NOTICE =
  'Cada etapa litúrgica e apoio adicionado é gravado e lido diretamente do servidor (título, ordem, duração, preparação e responsável). ' +
  'Campos como categoria, observações, playback e músicas são mantidos no cliente nesta sessão.';

/** Aviso permanente da tela sobre serviços paralelos. */
export const PARALLEL_SERVICES_PERSISTENCE_NOTICE =
  'Apoios técnicos e serviços paralelos desta edição são gravados com natureza própria no servidor, incluindo o tempo de preparação antecedente.';

/** Aviso exibido ao aplicar modelo a um evento que já tem etapas. */
export const TEMPLATE_APPEND_NOTICE =
  'Este culto já tinha etapas: as etapas do modelo foram acrescentadas ao final, mantendo as existentes.';

/** Motivo de bloqueio ao tentar acrescentar etapas em evento carregado do servidor sem leitura bem-sucedida de etapas. */
export const UNKNOWN_SERVER_ITEMS_BLOCK_REASON =
  'Não é possível acrescentar novas etapas antes de carregar com sucesso o programa existente do servidor (B2) para preservar a ordem das etapas. ' +
  'Recarregue a página para sincronizar o programa antes de novas adições.';

/** Motivo de bloqueio ao tentar acrescentar etapas em evento com resposta incerta pendente (#29). */
export const UNCERTAIN_EVENT_ITEMS_BLOCK_REASON =
  'Uma etapa anterior deste evento ficou sem confirmação do servidor e pode ou não ter sido gravada. ' +
  'Para evitar duplicidade ou conflito na ordem das etapas, o evento fica bloqueado nesta sessão para novas etapas ' +
  'ou aplicação de modelo (a leitura das etapas existentes depende do pacote B2). ' +
  'Apenas a repetição idêntica da etapa pendente é permitida.';

export function buildEventItemDraftKey(eventId, draft) {
  return JSON.stringify([
    eventId,
    draft.itemNature,
    draft.sequenceOrder,
    draft.title,
    draft.plannedDurationSeconds,
    draft.prepRequiredMinutes ?? 0,
    draft.designatedTeamId,
    draft.nominalLeaderMemberId,
  ]);
}

export function buildEventItemUpdateKey(eventId, itemId, payload, expectedUpdatedAt) {
  return JSON.stringify([
    'update_event_item',
    eventId,
    itemId,
    payload?.title,
    payload?.plannedDurationSeconds,
    payload?.prepRequiredMinutes,
    payload?.designatedTeamId,
    payload?.nominalLeaderMemberId,
    expectedUpdatedAt,
  ]);
}

export function buildEventItemRemoveKey(eventId, itemId, expectedUpdatedAt) {
  return JSON.stringify([
    'remove_event_item',
    eventId,
    itemId,
    expectedUpdatedAt,
  ]);
}

function getPendingKeysForEvent(pendingCommandIds, eventId) {
  if (!pendingCommandIds || !eventId) return [];
  const prefix = `[${JSON.stringify(eventId)},`;
  const keys = [];
  for (const key of pendingCommandIds.keys()) {
    if (typeof key === 'string' && key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Verifica se é seguro calcular sequence_order e gravar novas etapas no evento.
 * - Eventos carregados do servidor sem leitura prévia de etapas na sessão ficam bloqueados (#29).
 * - Eventos com comando incerto pendente bloqueiam aplicação de modelo ou qualquer etapa diferente da pendente (#29).
 */
export function canAppendEventItemsToEvent(event, pendingCommandIds = null, nextDraftKey = null) {
  if (!event) return false;
  if (event.loadedFromServer && event.activitiesKnownInSession !== true) {
    return false;
  }
  const pendingKeys = getPendingKeysForEvent(pendingCommandIds, event.id);
  if (pendingKeys.length > 0) {
    if (!nextDraftKey) return false;
    return pendingKeys.length === 1 && pendingKeys[0] === nextDraftKey;
  }
  return true;
}

export function getAppendEventItemsBlockReason(event, pendingCommandIds = null, nextDraftKey = null) {
  if (!event) return UNKNOWN_SERVER_ITEMS_BLOCK_REASON;
  if (event.loadedFromServer && event.activitiesKnownInSession !== true) {
    return UNKNOWN_SERVER_ITEMS_BLOCK_REASON;
  }
  const pendingKeys = getPendingKeysForEvent(pendingCommandIds, event.id);
  if (pendingKeys.length > 0 && (!nextDraftKey || pendingKeys.length !== 1 || pendingKeys[0] !== nextDraftKey)) {
    return UNCERTAIN_EVENT_ITEMS_BLOCK_REASON;
  }
  return null;
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Monta os rascunhos de gravação das etapas litúrgicas, na ordem recebida.
 * orderOffset é a quantidade de etapas que o evento já possui (a ordem continua a partir dela).
 * Equipe e responsável só são enviados quando são identificadores reais (UUID) do servidor.
 */
export function buildLiturgicalItemDrafts(activities = [], orderOffset = 0) {
  return (Array.isArray(activities) ? activities : []).map((act, idx) => {
    const rawMinutes = act?.plannedDurationMinutes;
    const minutes = Number.isFinite(Number(rawMinutes)) ? Number(rawMinutes) : NaN;
    const durationSeconds = Number.isFinite(minutes) && minutes > 0
      ? Math.round(minutes * 60)
      : (Number.isFinite(Number(act?.plannedDurationSeconds)) && Number(act.plannedDurationSeconds) > 0
        ? Math.round(Number(act.plannedDurationSeconds))
        : 0);

    return {
      localId: act?.id ?? null,
      title: normalizeNfcText(act?.title || act?.name || ''),
      itemNature: 'liturgical',
      sequenceOrder: orderOffset + idx + 1,
      plannedDurationSeconds: durationSeconds,
      prepRequiredMinutes: 0,
      designatedTeamId: isUuid(act?.responsibleTeamId || act?.teamId) ? (act.responsibleTeamId || act.teamId) : null,
      nominalLeaderMemberId: isUuid(act?.responsibleMemberId || act?.leaderId) ? (act.responsibleMemberId || act.leaderId) : null,
      source: act,
    };
  });
}

/**
 * Monta os rascunhos de gravação de serviços paralelos e apoios, na ordem recebida.
 * orderOffset é a quantidade de apoios que o evento já possui (a ordem continua a partir dela).
 * options.fallbackDurationSeconds: duração derivada da janela do evento quando o modelo não possui duração própria.
 */
export function buildParallelServiceDrafts(services = [], orderOffset = 0, options = {}) {
  const fallbackDurationSeconds = Number(options?.fallbackDurationSeconds);
  return (Array.isArray(services) ? services : []).map((serv, idx) => {
    const rawMinutes = serv?.durationMinutes ?? serv?.plannedDurationMinutes;
    let durationSeconds = 0;
    if (Number.isFinite(Number(serv?.plannedDurationSeconds)) && Number(serv.plannedDurationSeconds) > 0) {
      durationSeconds = Math.round(Number(serv.plannedDurationSeconds));
    } else if (Number.isFinite(Number(rawMinutes)) && Number(rawMinutes) > 0) {
      durationSeconds = Math.round(Number(rawMinutes) * 60);
    } else if (Number.isFinite(fallbackDurationSeconds) && fallbackDurationSeconds > 0) {
      durationSeconds = Math.round(fallbackDurationSeconds);
    } else {
      durationSeconds = 0;
    }

    let prepMinutes = 0;
    const rawPrep = serv?.prepRequiredMinutes ?? serv?.prepLeadMinutes;
    if (rawPrep !== undefined && rawPrep !== null && rawPrep !== '') {
      const parsed = Number(rawPrep);
      prepMinutes = Number.isInteger(parsed) ? parsed : NaN;
    }

    const teamId = isUuid(serv?.responsibleTeamId || serv?.teamId || serv?.designatedTeamId)
      ? (serv.responsibleTeamId || serv.teamId || serv.designatedTeamId)
      : null;
    const leaderId = isUuid(serv?.responsibleMemberId || serv?.leaderId || serv?.nominalLeaderMemberId)
      ? (serv.responsibleMemberId || serv.leaderId || serv.nominalLeaderMemberId)
      : null;

    return {
      localId: serv?.id ?? null,
      title: normalizeNfcText(serv?.name || serv?.title || ''),
      itemNature: 'parallel_support',
      sequenceOrder: orderOffset + idx + 1,
      plannedDurationSeconds: durationSeconds,
      prepRequiredMinutes: prepMinutes,
      designatedTeamId: teamId,
      nominalLeaderMemberId: leaderId,
      source: serv,
    };
  });
}

function draftKey(eventId, draft) {
  return buildEventItemDraftKey(eventId, draft);
}

/**
 * Grava as etapas uma a uma, na ordem, com um command_id novo por etapa.
 *
 * Falha parcial: ao primeiro erro a sequência para; as etapas já gravadas não são reenviadas e as
 * seguintes não são tentadas. Nada é dado como gravado sem recibo canônico do servidor.
 *
 * Resposta incerta (sem confirmação): o command_id daquela etapa fica guardado em pendingCommandIds
 * para que uma nova tentativa com os mesmos dados reutilize o mesmo comando (idempotência no servidor),
 * em vez de arriscar gravar a etapa em duplicidade.
 *
 * @returns {Promise<{saved: Array, failed: object|null, notAttempted: Array}>}
 */
export async function saveEventItemsSequentially({
  supabase,
  churchId,
  eventId,
  drafts = [],
  pendingCommandIds = null,
  createItem = createEventItem,
  generateId = generateCommandUuid,
}) {
  const saved = [];
  let failed = null;
  const notAttempted = [];

  for (let i = 0; i < drafts.length; i += 1) {
    const draft = drafts[i];
    if (failed) {
      notAttempted.push(draft);
      continue;
    }

    if (!draft.title) {
      failed = { draft, message: 'Título da etapa não informado.', uncertain: false };
      continue;
    }

    if (!Number.isFinite(draft.plannedDurationSeconds) || draft.plannedDurationSeconds <= 0 || !Number.isInteger(draft.plannedDurationSeconds)) {
      const msg = draft.itemNature === 'parallel_support'
        ? 'Duração planejada de apoio paralelo deve ser um número inteiro e estritamente maior que zero.'
        : 'Duração planejada da etapa litúrgica é obrigatória e deve ser maior que zero.';
      failed = { draft, message: msg, uncertain: false };
      continue;
    }

    if (draft.itemNature === 'parallel_support') {
      const prep = draft.prepRequiredMinutes;
      if (!Number.isInteger(prep) || prep < 0 || prep > 180) {
        failed = {
          draft,
          message: 'Tempo de preparação antecedente deve ser um número inteiro entre 0 e 180 minutos.',
          uncertain: false,
        };
        continue;
      }
    }

    const key = draftKey(eventId, draft);
    const commandId = (pendingCommandIds && pendingCommandIds.get(key)) || generateId();

    let result;
    try {
      result = await createItem({
        supabase,
        churchId,
        commandId,
        eventId,
        title: draft.title,
        itemNature: draft.itemNature,
        sequenceOrder: draft.sequenceOrder,
        plannedDurationSeconds: draft.plannedDurationSeconds,
        designatedTeamId: draft.designatedTeamId,
        nominalLeaderMemberId: draft.nominalLeaderMemberId,
        prepRequiredMinutes: draft.prepRequiredMinutes,
      });
    } catch (err) {
      result = { status: 'UNCERTAIN', message: err?.message || 'Falha de comunicação ao gravar a etapa.' };
    }

    if (result?.status === 'SUCCESS' && result.receipt?.result_entity_id) {
      if (pendingCommandIds) pendingCommandIds.delete(key);
      saved.push({ draft, itemId: result.receipt.result_entity_id, commandId, receipt: result.receipt });
      continue;
    }

    const uncertain = result?.status !== 'DEFINITIVE_ERROR';
    if (pendingCommandIds) {
      if (uncertain) pendingCommandIds.set(key, commandId);
      else pendingCommandIds.delete(key);
    }
    failed = {
      draft,
      commandId,
      uncertain,
      message: result?.message || 'O servidor não confirmou a gravação da etapa.',
    };
  }

  return { saved, failed, notAttempted };
}

function quoteTitles(drafts) {
  return drafts.map(d => `'${d.title || 'sem título'}'`).join(', ');
}

/**
 * Descreve ao usuário o resultado da gravação: quais etapas foram gravadas, qual falhou e quais não foram enviadas.
 */
export function describeEventItemsOutcome(outcome) {
  if (!outcome) return '';
  const { saved = [], failed = null, notAttempted = [] } = outcome;
  const parts = [];

  if (saved.length > 0) {
    parts.push(`Etapas gravadas no servidor (${saved.length}): ${quoteTitles(saved.map(s => s.draft))}.`);
  } else if (failed) {
    parts.push('Nenhuma etapa foi gravada no servidor.');
  }

  if (failed) {
    parts.push(
      failed.uncertain
        ? `Sem confirmação do servidor para a etapa '${failed.draft.title || 'sem título'}': ${failed.message} Ela pode ou não ter sido gravada e não é exibida como gravada.`
        : `Falha ao gravar a etapa '${failed.draft.title || 'sem título'}': ${failed.message}`
    );
  }

  if (notAttempted.length > 0) {
    parts.push(`Etapas não enviadas (${notAttempted.length}): ${quoteTitles(notAttempted)}.`);
  }

  return parts.join(' ');
}

/**
 * Converte as etapas confirmadas pelo servidor em atividades do estado da tela,
 * substituindo o identificador local (act-…) pelo result_entity_id devolvido.
 */
export function toPersistedActivities(saved = []) {
  return saved.map(({ draft, itemId, receipt }) => ({
    ...(draft.source || {}),
    id: itemId,
    title: draft.title,
    persisted: true,
    sequenceOrder: draft.sequenceOrder,
    plannedDurationMinutes: Math.round((draft.plannedDurationSeconds || 0) / 60),
    plannedDurationSeconds: draft.plannedDurationSeconds,
    prepRequiredMinutes: draft.prepRequiredMinutes || 0,
    itemNature: draft.itemNature,
    updatedAt: receipt?.result_payload?.updated_at || receipt?.created_at || new Date().toISOString(),
  }));
}

/**
 * Converte os apoios paralelos confirmados pelo servidor em objetos do estado local do evento.
 */
export function toPersistedParallelServices(saved = []) {
  return (Array.isArray(saved) ? saved : []).map(({ draft, itemId, receipt }) => {
    const source = draft.source || {};
    const payload = receipt?.result_payload || {};
    const duration = Number.isFinite(Number(draft.plannedDurationSeconds))
      ? draft.plannedDurationSeconds
      : (Number.isFinite(Number(payload.planned_duration_seconds)) ? payload.planned_duration_seconds : 0);
    return {
      ...source,
      id: itemId,
      name: draft.title || source.name || '',
      title: draft.title || source.title || '',
      teamId: draft.designatedTeamId,
      leaderId: draft.nominalLeaderMemberId,
      designatedTeamId: draft.designatedTeamId,
      nominalLeaderMemberId: draft.nominalLeaderMemberId,
      prepLeadMinutes: draft.prepRequiredMinutes,
      prepRequiredMinutes: draft.prepRequiredMinutes,
      durationMinutes: Math.round(duration / 60),
      plannedDurationSeconds: duration,
      sequenceOrder: draft.sequenceOrder,
      itemNature: 'parallel_support',
      persisted: true,
      updatedAt: payload.updated_at || receipt?.created_at || new Date().toISOString(),
      status: source.status || 'Aguardando culto',
      volunteers: source.volunteers || [],
    };
  });
}
