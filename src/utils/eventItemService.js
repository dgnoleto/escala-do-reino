/**
 * eventItemService.js — Gravação das etapas litúrgicas de um evento no servidor (Issue #29).
 *
 * Usa a RPC public.create_event_item (via createEventItem de liturgicalCommandService), uma chamada
 * por etapa, cada uma com seu próprio command_id.
 *
 * Limites conhecidos desta entrega (dependem do pacote B2), que este módulo não contorna:
 * - A RPC grava somente título, natureza, ordem, duração, equipe designada e responsável nominal.
 *   Categoria, observações, playback, músicas e atividade padrão não são gravados.
 * - Não existe RPC para ler etapas de volta, editar ou remover etapa.
 * - Serviços paralelos NÃO são gravados: a RPC exige duração maior que zero e não tem campo para o
 *   tempo de preparação, e não se inventa duração. Eles permanecem apenas na memória da sessão.
 */

import { createEventItem } from './liturgicalCommandService.js';
import { generateCommandUuid, normalizeNfcText } from './eventPlanningService.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aviso permanente da tela sobre o que é e o que não é gravado no servidor. */
export const EVENT_ITEMS_PERSISTENCE_NOTICE =
  'Cada etapa litúrgica adicionada é gravada no servidor (título, ordem, duração e responsável). ' +
  'Categoria, observações, playback e músicas ficam apenas nesta sessão. ' +
  'Ainda não é possível ler, editar ou remover etapas no servidor: as etapas gravadas não reaparecem ' +
  'nesta tela depois de recarregar a página, e alterações feitas em etapas já gravadas valem só nesta sessão.';

/** Aviso permanente da tela sobre serviços paralelos. */
export const PARALLEL_SERVICES_NOT_PERSISTED_NOTICE =
  'Serviços paralelos e apoios técnicos não são gravados no servidor nesta versão: ' +
  'ficam apenas nesta sessão e somem ao recarregar a página.';

/** Aviso exibido ao aplicar modelo a um evento que já tem etapas. */
export const TEMPLATE_APPEND_NOTICE =
  'Este culto já tinha etapas: as etapas do modelo foram acrescentadas ao final, sem substituir as existentes, ' +
  'porque ainda não é possível remover etapas no servidor.';

/** Motivo de bloqueio ao tentar acrescentar etapas em evento carregado do servidor sem leitura de etapas (B2). */
export const UNKNOWN_SERVER_ITEMS_BLOCK_REASON =
  'Não é possível acrescentar novas etapas a um evento carregado do servidor após recarregar a página: ' +
  'este evento pode já ter etapas gravadas que ainda não são lidas nesta versão (depende do pacote B2), ' +
  'o que poderia gerar conflito na ordem das etapas no servidor.';

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
    draft.designatedTeamId,
    draft.nominalLeaderMemberId,
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
    const minutes = Number(act?.plannedDurationMinutes);
    return {
      localId: act?.id ?? null,
      title: normalizeNfcText(act?.title || ''),
      itemNature: 'liturgical',
      sequenceOrder: orderOffset + idx + 1,
      plannedDurationSeconds: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : null,
      designatedTeamId: isUuid(act?.responsibleTeamId) ? act.responsibleTeamId : null,
      nominalLeaderMemberId: isUuid(act?.responsibleMemberId) ? act.responsibleMemberId : null,
      source: act,
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
    if (!draft.plannedDurationSeconds || draft.plannedDurationSeconds <= 0) {
      failed = { draft, message: 'Duração planejada da etapa inválida (deve ser maior que zero).', uncertain: false };
      continue;
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
  return saved.map(({ draft, itemId }) => ({
    ...(draft.source || {}),
    id: itemId,
    title: draft.title,
    persisted: true,
    sequenceOrder: draft.sequenceOrder,
  }));
}
