/**
 * eventPlanningService.js
 * Regras de validação, integridade, cálculo de duração e publicação da programação litúrgica.
 * Atende às Issues #28, #29 e #30 e aos critérios do PRD §3.2, §5, §6 e §7.7 (Cenários M05, M06, M24-M26, M28, M47-M50).
 */

import {
  isDefinitiveLiturgicalError,
  updateEventItem,
  removeEventItem,
  reorderEventItems,
  validateLiturgicalReceipt,
  fetchEventAssignments,
} from './liturgicalCommandService.js';

export const MAX_TITLE_LENGTH = 200;
export const MIN_TITLE_LENGTH = 1;
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const DURATION_POLICIES = ['warn', 'block'];
export const PROGRAM_STATUSES = ['draft', 'published'];
export const MIN_EVENT_DURATION_MINUTES = 1;
export const MAX_EVENT_DURATION_MINUTES = 1440; // 24 horas

/**
 * Normaliza o texto com Unicode NFC e remove espaços nas extremidades (trim).
 */
export function normalizeNfcText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

const NAIVE_LOCAL_DATETIME_REGEX = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const zonedFormatterCache = new Map();

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Devolve o formatador Intl do fuso informado. Lança RangeError se o fuso não for reconhecido.
 */
function getZonedFormatter(timeZone) {
  if (!zonedFormatterCache.has(timeZone)) {
    zonedFormatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }));
  }
  return zonedFormatterCache.get(timeZone);
}

/**
 * Indica se o identificador de fuso é reconhecido pelo ambiente (Intl).
 */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    getZonedFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decompõe um instante em data e hora de parede no fuso informado.
 */
function getZonedParts(instantMs, timeZone) {
  const parts = {};
  for (const part of getZonedFormatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = parseInt(part.value, 10);
  }
  return parts;
}

/**
 * Deslocamento do fuso em relação ao UTC, em minutos, no instante informado.
 */
function getTimeZoneOffsetMinutes(instantMs, timeZone) {
  const p = getZonedParts(instantMs, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wallAsUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

/**
 * Converte data e hora de parede no fuso informado para o instante correspondente (ms).
 * Não usa o fuso do navegador (Issue #28 / PRD §3.3 / M47).
 * Limite conhecido: em hora repetida de fim de horário de verão, escolhe a primeira ocorrência.
 */
function zonedWallTimeToInstantMs(year, month, day, hour, minute, second, timeZone) {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = wallAsUtc - getTimeZoneOffsetMinutes(wallAsUtc, timeZone) * 60000;
  instant = wallAsUtc - getTimeZoneOffsetMinutes(instant, timeZone) * 60000;
  return instant;
}

/**
 * Interpreta data/hora como instante (ms).
 * - Texto sem fuso ("2026-11-01T19:00" ou "2026-11-01T19:00:00") é lido como hora local NO FUSO INFORMADO.
 * - Texto com fuso explícito (Z ou ±hh:mm) e objetos Date mantêm o instante que já representam.
 * Retorna null se o valor for inválido. Lança RangeError se o fuso não for reconhecido.
 */
export function parseInstantInTimeZone(value, timeZone = DEFAULT_TIMEZONE) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const match = NAIVE_LOCAL_DATETIME_REGEX.exec(value.trim());
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);
      const second = match[6] ? parseInt(match[6], 10) : 0;
      // Rejeita datas/horas inexistentes (ex.: 31/02 ou 25:00) em vez de normalizá-las em silêncio
      const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      if (
        check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
        check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second
      ) {
        return null;
      }
      const instant = zonedWallTimeToInstantMs(year, month, day, hour, minute, second, timeZone);
      // Conferência de ida e volta no fuso: rejeita hora local inexistente em transição de horário de verão
      const roundTrip = getZonedParts(instant, timeZone);
      if (
        roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day ||
        roundTrip.hour !== hour || roundTrip.minute !== minute || roundTrip.second !== second
      ) {
        return null;
      }
      return instant;
    }
  }
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Formata um instante como texto ISO com deslocamento explícito do fuso informado
 * (ex.: "2026-11-01T19:00:00-03:00"), próprio para parâmetros timestamptz.
 */
export function formatInstantWithOffset(instantMs, timeZone = DEFAULT_TIMEZONE) {
  const p = getZonedParts(instantMs, timeZone);
  const offset = getTimeZoneOffsetMinutes(instantMs, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const datePart = `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
  const timePart = `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  return `${datePart}T${timePart}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/**
 * Converte data/hora (com ou sem fuso) em texto ISO com deslocamento explícito no fuso informado.
 * Retorna null se o valor for inválido.
 */
export function toZonedInstantString(value, timeZone = DEFAULT_TIMEZONE) {
  const ms = parseInstantInTimeZone(value, timeZone);
  return ms === null ? null : formatInstantWithOffset(ms, timeZone);
}

/**
 * Data (AAAA-MM-DD) e hora (HH:mm) de um instante para exibição no fuso informado.
 * Retorna null se o valor for inválido.
 */
export function formatInstantInTimeZone(value, timeZone = DEFAULT_TIMEZONE) {
  const ms = parseInstantInTimeZone(value, timeZone);
  if (ms === null) return null;
  const p = getZonedParts(ms, timeZone);
  return {
    date: `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`,
    time: `${pad2(p.hour)}:${pad2(p.minute)}`,
  };
}

/**
 * Calcula a duração disponível em minutos a partir de duas datas completas (data + hora).
 * Suporta travessia de meia-noite (CA01 de #28 e PRD §6 / M48).
 * Rejeita fim anterior ou igual ao início.
 */
export function calculateAvailableDurationMinutes(plannedStartAt, plannedEndAt) {
  if (!plannedStartAt || !plannedEndAt) {
    return {
      valid: false,
      minutes: 0,
      error: 'Data/hora de início e término são obrigatórias.'
    };
  }

  const start = new Date(plannedStartAt);
  const end = new Date(plannedEndAt);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {
      valid: false,
      minutes: 0,
      error: 'Formato de data/hora inválido.'
    };
  }

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    return {
      valid: false,
      minutes: 0,
      error: 'Data/hora de término planejada deve ser posterior ao início.'
    };
  }

  const minutes = Math.round(diffMs / (1000 * 60));
  if (minutes < MIN_EVENT_DURATION_MINUTES) {
    return {
      valid: false,
      minutes: 0,
      error: 'A duração mínima do evento deve ser de pelo menos 1 minuto.'
    };
  }

  return {
    valid: true,
    minutes,
    error: null
  };
}

/**
 * Valida os dados de cadastro de uma edição de culto (Issue #28, CA01 a CA04).
 */
export function validateEventEdition(eventData, church = {}, caller = {}) {
  const title = normalizeNfcText(eventData?.title);
  if (!title) {
    return { valid: false, error: 'Título do evento é obrigatório.' };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `Título do evento deve ter no máximo ${MAX_TITLE_LENGTH} caracteres.` };
  }

  // Fuso da igreja (CA02 de #28 e PRD §3.3 / M47)
  const timezone = church?.timezone || DEFAULT_TIMEZONE;
  if (!isValidTimeZone(timezone)) {
    return { valid: false, error: `Fuso horário da igreja não reconhecido: '${timezone}'.` };
  }

  // Data/hora sem fuso explícito é hora local no fuso da igreja, nunca no fuso do navegador (#28)
  const startMs = parseInstantInTimeZone(eventData?.plannedStartAt, timezone);
  if (startMs === null) {
    return { valid: false, error: 'Data/hora de início inválida para o fuso da igreja.' };
  }
  const endMs = parseInstantInTimeZone(eventData?.plannedEndAt, timezone);
  if (endMs === null) {
    return { valid: false, error: 'Data/hora de término inválida para o fuso da igreja.' };
  }
  const durationCheck = calculateAvailableDurationMinutes(
    new Date(startMs).toISOString(),
    new Date(endMs).toISOString()
  );
  if (!durationCheck.valid) {
    return { valid: false, error: durationCheck.error };
  }

  // Política de duração (Issue #30)
  const durationPolicy = eventData?.durationPolicy || 'warn';
  if (!DURATION_POLICIES.includes(durationPolicy)) {
    return { valid: false, error: "Política de duração inválida. Opções: 'warn' ou 'block'." };
  }

  // Designação da liderança da liturgia (CA03 de #28 e PRD §3.2 / M05, M40)
  // Somente administrador da igreja pode designar/trocar
  const isCallerAdmin = Boolean(
    caller?.roles?.includes('admin') ||
    caller?.isAdmin === true
  );

  if (eventData?.liturgyLeaderId && !isCallerAdmin && caller?.id) {
    return {
      valid: false,
      error: 'Somente o administrador pode designar ou alterar a liderança da liturgia para este evento.'
    };
  }

  return {
    valid: true,
    error: null,
    title,
    timezone,
    plannedStartAt: new Date(startMs).toISOString(),
    plannedEndAt: new Date(endMs).toISOString(),
    plannedDurationMinutes: durationCheck.minutes,
    durationPolicy
  };
}

/**
 * Cria um objeto padronizado de nova edição de culto (Issue #28).
 * Garante que criar o evento não inicia execução nem escala integrantes automaticamente (CA04).
 */
export function createEventEditionObject(eventData, church = {}, caller = {}, initialActivities = [], initialParallelServices = []) {
  const validation = validateEventEdition(eventData, church, caller);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const now = new Date().toISOString();
  const id = eventData?.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // Data e hora de exibição no fuso da igreja, não no fuso do navegador (#28)
  const startDisplay = formatInstantInTimeZone(validation.plannedStartAt, validation.timezone);
  const startDateStr = startDisplay.date;
  const startTimeStr = startDisplay.time;

  // Assegura que atividades não possuem escalas nominais de voluntários (CA04 de #28 e CA03 de #27)
  const cleanActivities = initialActivities.map((act, idx) => ({
    id: act.id || `act-${Date.now()}-${idx}`,
    title: normalizeNfcText(act.title || act.name || 'Nova Etapa'),
    category: normalizeNfcText(act.category || 'Liturgia'),
    plannedDurationMinutes: parseInt(act.plannedDurationMinutes || act.defaultDurationMinutes, 10) || 10,
    responsibleMemberId: null, // Sem alocação automática (CA04)
    responsibleTeamId: act.responsibleTeamId || act.targetTeamId || null,
    status: 'pendente',
    realStartTime: null,
    realEndTime: null,
    cancellationReason: null,
    notes: normalizeNfcText(act.notes || ''),
    requiresPlayback: Boolean(act.requiresPlayback),
    musics: Array.isArray(act.musics) ? [...act.musics] : [],
    roster: [] // Sem voluntários escalados automaticamente (CA04)
  }));

  // Assegura que apoios paralelos não possuem escalas nominais de voluntários
  const cleanParallelServices = initialParallelServices.map((serv, idx) => ({
    id: serv.id || `serv-${Date.now()}-${idx}`,
    name: normalizeNfcText(serv.name || serv.serviceName || 'Serviço de Apoio'),
    teamId: normalizeNfcText(serv.teamId || 'apoio'),
    leaderId: null, // Sem liderança automática
    volunteers: [], // Sem voluntários escalados automaticamente (CA04)
    status: 'Aguardando culto',
    prepRequiredMinutes: parseInt(serv.prepRequiredMinutes, 10) || 0
  }));

  return {
    id,
    churchId: church?.id || eventData?.churchId || 'church-piloto-01',
    title: validation.title,
    type: normalizeNfcText(eventData?.type || 'Culto'),
    date: startDateStr,
    scheduledStartTime: startTimeStr,
    plannedStartAt: validation.plannedStartAt,
    plannedEndAt: validation.plannedEndAt,
    timezone: validation.timezone,
    plannedDurationMinutes: validation.plannedDurationMinutes,
    liturgyLeaderId: eventData?.liturgyLeaderId || null,
    durationPolicy: validation.durationPolicy, // 'warn' ou 'block'
    programStatus: 'draft', // 'draft' ou 'published' (CA03 de #30)
    programVersion: 1,
    publishedAt: null,
    publishedByMemberId: null,
    status: 'pronto', // 'pronto', 'em_andamento', 'encerrado' (CA04: não inicia execução)
    realStartTime: null,
    realEndTime: null,
    currentActivityIndex: 0,
    currentActivityStatus: 'pendente',
    activityStartTime: null,
    activityElapsedSeconds: 0,
    inBreak: false,
    breakStartTime: null,
    lastSyncTimestamp: now,
    activities: cleanActivities,
    parallelServices: cleanParallelServices,
    checklist: [],
    internalAlerts: []
  };
}

/**
 * Reordena uma atividade na programação litúrgica (Issue #29, CA01).
 * Permite mover para cima ou para baixo sem alterar outras edições ou o modelo original.
 */
export function reorderEventActivities(activities = [], fromIndex, toIndex) {
  if (!Array.isArray(activities) || activities.length === 0) return [];
  if (fromIndex < 0 || fromIndex >= activities.length) return [...activities];
  if (toIndex < 0 || toIndex >= activities.length) return [...activities];
  if (fromIndex === toIndex) return [...activities];

  const cloned = [...activities];
  const [moved] = cloned.splice(fromIndex, 1);
  cloned.splice(toIndex, 0, moved);
  return cloned;
}

/**
 * Move uma atividade para cima na ordem litúrgica (Issue #29, CA01).
 */
export function moveActivityUp(activities = [], activityId) {
  const index = activities.findIndex(a => a.id === activityId);
  if (index <= 0) return activities;
  return reorderEventActivities(activities, index, index - 1);
}

/**
 * Move uma atividade para baixo na ordem litúrgica (Issue #29, CA01).
 */
export function moveActivityDown(activities = [], activityId) {
  const index = activities.findIndex(a => a.id === activityId);
  if (index === -1 || index >= activities.length - 1) return activities;
  return reorderEventActivities(activities, index, index + 1);
}

/**
 * Calcula os tempos de duração da programação litúrgica (Issue #29 CA02 e Issue #30 CA01).
 * Regras:
 * - Duração disponível deriva da janela prevista (plannedDurationMinutes).
 * - Componentes simultâneos do louvor (canto, instrumentos, dança) compartilham a duração do bloco
 *   e somam apenas uma vez na sequência principal (CA02 de #29 e PRD §6 / M25).
 * - Apoios paralelos (sonoplastia, transmissão, etc.) NÃO somam na sequência principal (CA02 de #29 e PRD §6 / M28).
 * - Retorna disponível, ocupado e excedente.
 */
export function calculateProgramDurations(event) {
  if (!event) {
    return {
      availableMinutes: 0,
      occupiedMinutes: 0,
      overflowMinutes: 0,
      remainingMinutes: 0
    };
  }

  // Duração disponível derivada da janela prevista
  let availableMinutes = event.plannedDurationMinutes;
  if (!availableMinutes && event.plannedStartAt && event.plannedEndAt) {
    const calc = calculateAvailableDurationMinutes(event.plannedStartAt, event.plannedEndAt);
    if (calc.valid) availableMinutes = calc.minutes;
  }
  availableMinutes = availableMinutes || 0;

  // Soma da sequência principal de atividades (ignora apoios paralelos)
  const activities = Array.isArray(event.activities) ? event.activities : [];
  const occupiedMinutes = activities.reduce((sum, act) => {
    // Se a atividade for classificada como apoio paralelo na lista, não soma na sequência principal
    if (act.itemNature === 'parallel_support' || act.isParallelSupport === true) {
      return sum;
    }
    const duration = parseInt(act.plannedDurationMinutes, 10);
    return sum + (!isNaN(duration) && duration > 0 ? duration : 0);
  }, 0);

  const overflowMinutes = Math.max(0, occupiedMinutes - availableMinutes);
  const remainingMinutes = Math.max(0, availableMinutes - occupiedMinutes);

  return {
    availableMinutes,
    occupiedMinutes,
    overflowMinutes,
    remainingMinutes
  };
}

/**
 * Calcula a janela de ocupação de um serviço paralelo com tempo de preparação antecedente (Issue #29, CA03).
 * A preparação pode começar antes do horário previsto de início do culto (PRD §6 e §7.7 / M50).
 * Regras:
 * - A preparação é só prep_required_minutes (0–180) do apoio. Sem início/fim próprio, turno, cronômetro ou controle individual.
 * - O intervalo de ocupação é derivado e NÃO gravado: de planned_start_at menos a preparação até planned_end_at do culto.
 * - Retorna null se não houver horário de início ou fim previsto válido (end > start).
 */
export function calculateParallelServiceWindow(eventPlannedStartAt, eventPlannedEndAt, prepRequiredMinutes = 0) {
  if (!eventPlannedStartAt || !eventPlannedEndAt) return null;
  const start = new Date(eventPlannedStartAt);
  const end = new Date(eventPlannedEndAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return null;
  }
  const prep = Math.min(180, Math.max(0, parseInt(prepRequiredMinutes, 10) || 0));

  const prepStart = new Date(start.getTime() - (prep * 60 * 1000));

  return {
    prepStartAt: prepStart.toISOString(),
    eventStartAt: start.toISOString(),
    eventEndAt: end.toISOString(),
    prepRequiredMinutes: prep,
    totalOccupiedMinutes: Math.round((end.getTime() - prepStart.getTime()) / (1000 * 60))
  };
}

/**
 * Verifica se uma alocação em serviço paralelo ou atividade gera conflito de escala (Issue #29, CA03 e CA04).
 * Sinaliza compromissos e lideranças envolvidas sem substituir pessoas silenciosamente.
 * Conflito é SINAL: não bloqueia e não substitui pessoa.
 * Sem início ou sem fim definido, NÃO se calcula conflito (retorna calculable: false, sem padrão fixo de 21:00).
 */
export function checkScaleConflictWithParallelPrep(memberId, candidateWindow, event, targetRole = '') {
  if (!memberId || !event) {
    return { hasConflict: false, calculable: false, reason: 'Sem conflito calculável: voluntário ou evento não informado.' };
  }

  const plannedStart = event.plannedStartAt || event.planned_start_at;
  const plannedEnd = event.plannedEndAt || event.planned_end_at;

  // Sem início ou sem fim definido, NÃO se calcula conflito. Remover o padrão fixo de 21:00.
  if (!plannedStart || !plannedEnd) {
    return {
      hasConflict: false,
      calculable: false,
      reason: 'Sem conflito calculável: início ou término previsto do evento não definido.'
    };
  }

  if (!candidateWindow) {
    return {
      hasConflict: false,
      calculable: false,
      reason: 'Sem conflito calculável: janela da atividade ou serviço não definida.'
    };
  }

  const candStartRaw = candidateWindow.prepStartAt || candidateWindow.startAt || candidateWindow.planned_start_at || candidateWindow.eventStartAt;
  const candEndRaw = candidateWindow.eventEndAt || candidateWindow.endAt || candidateWindow.planned_end_at;

  if (!candStartRaw || !candEndRaw) {
    return {
      hasConflict: false,
      calculable: false,
      reason: 'Sem conflito calculável: horário de início ou término da janela candidata não definido.'
    };
  }

  const candStart = new Date(candStartRaw).getTime();
  const candEnd = new Date(candEndRaw).getTime();
  if (isNaN(candStart) || isNaN(candEnd) || candEnd <= candStart) {
    return {
      hasConflict: false,
      calculable: false,
      reason: 'Sem conflito calculável: horários da janela candidata são inválidos.'
    };
  }

  // Verifica se o membro já está alocado em algum serviço paralelo da edição
  const parallelServices = Array.isArray(event.parallelServices) ? event.parallelServices : [];
  for (const serv of parallelServices) {
    if (candidateWindow.serviceId && (candidateWindow.serviceId === serv.id || candidateWindow.serviceId === serv.teamId)) {
      continue;
    }

    const isVol = Array.isArray(serv.volunteers) && serv.volunteers.includes(memberId);
    const isLead = serv.leaderId === memberId;
    const isAssigned = Array.isArray(event.assignments) && event.assignments.some(
      a => (a.member_id === memberId || a.memberId === memberId) &&
           (a.item_id === serv.id || a.itemId === serv.id || a.team_id === serv.teamId || a.teamId === serv.teamId)
    );

    if (isVol || isLead || isAssigned) {
      const servWindow = calculateParallelServiceWindow(
        plannedStart,
        plannedEnd,
        serv.prepRequiredMinutes
      );

      if (!servWindow) {
        return {
          hasConflict: false,
          calculable: false,
          reason: 'Sem conflito calculável: intervalo do serviço paralelo não pôde ser calculado.'
        };
      }

      const servStart = new Date(servWindow.prepStartAt).getTime();
      const servEnd = new Date(servWindow.eventEndAt).getTime();

      // Sobreposição estrita de horários: max(candStart, servStart) < min(candEnd, servEnd)
      // Janelas adjacentes (candEnd === servStart ou servEnd === candStart) NÃO sobrepõem.
      if (Math.max(candStart, servStart) < Math.min(candEnd, servEnd)) {
        const servStartFormatted = new Date(servStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const servEndFormatted = new Date(servEnd).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return {
          hasConflict: true,
          calculable: true,
          conflictingService: serv.name || serv.title,
          conflictingWindow: servWindow,
          reason: `Membro já está escalado no apoio '${serv.name || serv.title}' (ocupação com preparação antecedente das ${servStartFormatted} até ${servEndFormatted}).`
        };
      }
    }
  }

  return { hasConflict: false, calculable: true };
}

/**
 * Consulta as alocações da edição via RPC list_event_assignments (SQL 015).
 * Serviço de cliente para leitura das escalas existentes.
 */
export async function getEventAssignmentsRemote(supabase, churchId, eventId) {
  return fetchEventAssignments({ supabase, churchId, eventId });
}

/**
 * Calcula as sobreposições e sinais de conflito de escala dentro da mesma edição (Issue #29, CA03 e CA04).
 * Inclui tempo de preparação antecedente (prep_required_minutes) derivado exclusivamente
 * por calculateParallelServiceWindow.
 * 
 * Regras:
 * - O intervalo de ocupação é derivado e NÃO gravado: de planned_start_at menos a preparação até planned_end_at.
 * - Sem planned_end_at definido, NÃO calcula conflito (retorna calculable: false).
 * - Conflito é SINAL: não bloqueia e não substitui pessoa.
 * - Compara apenas dentro da mesma edição.
 */
export function calculateEditionScaleConflicts(event, assignments = [], members = []) {
  if (!event) return { calculable: false, reason: 'Evento não informado.', conflicts: [] };

  const plannedStart = event.plannedStartAt || event.planned_start_at;
  const plannedEnd = event.plannedEndAt || event.planned_end_at;

  if (!plannedStart || !plannedEnd) {
    return {
      calculable: false,
      reason: 'Sem conflito calculável: início ou término previsto do evento não definido.',
      conflicts: []
    };
  }

  const conflicts = [];
  const parallelServices = Array.isArray(event.parallelServices) ? event.parallelServices : [];
  const activities = Array.isArray(event.activities) ? event.activities : [];

  // Mapear janelas de cada serviço paralelo usando calculateParallelServiceWindow
  const serviceWindows = new Map();
  for (const serv of parallelServices) {
    const window = calculateParallelServiceWindow(plannedStart, plannedEnd, serv.prepRequiredMinutes);
    if (window) {
      serviceWindows.set(serv.id || serv.teamId || serv.name, {
        service: serv,
        window,
        startMs: new Date(window.prepStartAt).getTime(),
        endMs: new Date(window.eventEndAt).getTime(),
      });
    }
  }

  // Mapear janelas sequenciais das atividades litúrgicas da edição
  const activityWindows = new Map();
  let currentCursorMs = new Date(plannedStart).getTime();
  for (const act of activities) {
    if (act.itemNature === 'parallel_support' || act.isParallelSupport === true) {
      continue;
    }
    const durationMin = parseInt(act.plannedDurationMinutes, 10) || 0;
    const actStartMs = currentCursorMs;
    const actEndMs = actStartMs + (durationMin * 60 * 1000);
    activityWindows.set(act.id, {
      activity: act,
      startMs: actStartMs,
      endMs: actEndMs,
      startIso: new Date(actStartMs).toISOString(),
      endIso: new Date(actEndMs).toISOString(),
    });
    currentCursorMs = actEndMs;
  }

  const memberCommitments = new Map();

  function addCommitment(memberId, commitment) {
    if (!memberId) return;
    if (!memberCommitments.has(memberId)) {
      memberCommitments.set(memberId, []);
    }
    memberCommitments.get(memberId).push(commitment);
  }

  // Do estado do evento:
  for (const serv of parallelServices) {
    const sw = serviceWindows.get(serv.id || serv.teamId || serv.name);
    if (!sw) continue;
    const vols = Array.isArray(serv.volunteers) ? serv.volunteers : [];
    for (const vId of vols) {
      addCommitment(vId, {
        type: 'parallel_service',
        sourceId: serv.id,
        name: serv.name || 'Serviço Paralelo',
        startMs: sw.startMs,
        endMs: sw.endMs,
        window: sw.window,
        prepRequiredMinutes: serv.prepRequiredMinutes || 0,
      });
    }
    if (serv.leaderId) {
      addCommitment(serv.leaderId, {
        type: 'parallel_service',
        sourceId: serv.id,
        name: `${serv.name || 'Serviço Paralelo'} (Líder)`,
        startMs: sw.startMs,
        endMs: sw.endMs,
        window: sw.window,
        prepRequiredMinutes: serv.prepRequiredMinutes || 0,
      });
    }
  }

  for (const act of activities) {
    const aw = activityWindows.get(act.id);
    if (!aw) continue;
    const roster = Array.isArray(act.roster) ? act.roster : [];
    for (const r of roster) {
      if (r.memberId) {
        addCommitment(r.memberId, {
          type: 'activity',
          sourceId: act.id,
          name: `${act.title || 'Atividade'} (${r.role || 'Participante'})`,
          startMs: aw.startMs,
          endMs: aw.endMs,
          window: { prepStartAt: aw.startIso, eventEndAt: aw.endIso },
          prepRequiredMinutes: 0,
        });
      }
    }
    if (act.responsibleMemberId) {
      addCommitment(act.responsibleMemberId, {
        type: 'activity',
        sourceId: act.id,
        name: `${act.title || 'Atividade'} (Responsável)`,
        startMs: aw.startMs,
        endMs: aw.endMs,
        window: { prepStartAt: aw.startIso, eventEndAt: aw.endIso },
        prepRequiredMinutes: 0,
      });
    }
  }

  // Das alocações de list_event_assignments:
  for (const asg of assignments) {
    const mId = asg.member_id || asg.memberId;
    if (!mId) continue;
    const itemId = asg.item_id || asg.itemId;
    const teamId = asg.team_id || asg.teamId;

    const servEntry = Array.from(serviceWindows.values()).find(
      sw => (itemId && sw.service.id === itemId) || (teamId && sw.service.teamId === teamId)
    );
    if (servEntry) {
      addCommitment(mId, {
        type: 'parallel_service',
        sourceId: servEntry.service.id,
        name: servEntry.service.name || asg.team_name || 'Serviço Paralelo',
        startMs: servEntry.startMs,
        endMs: servEntry.endMs,
        window: servEntry.window,
        prepRequiredMinutes: servEntry.service.prepRequiredMinutes || 0,
        assignmentId: asg.id,
      });
      continue;
    }

    const actEntry = activityWindows.get(itemId);
    if (actEntry) {
      addCommitment(mId, {
        type: 'activity',
        sourceId: actEntry.activity.id,
        name: `${actEntry.activity.title || asg.item_title || 'Atividade'} (${asg.role_name || 'Função'})`,
        startMs: actEntry.startMs,
        endMs: actEntry.endMs,
        window: { prepStartAt: actEntry.startIso, eventEndAt: actEntry.endIso },
        prepRequiredMinutes: 0,
        assignmentId: asg.id,
      });
    }
  }

  // Compara os compromissos de cada membro na edição
  for (const [mId, commitments] of memberCommitments.entries()) {
    if (commitments.length < 2) continue;

    const memberObj = members.find(m => m.id === mId) || { id: mId, name: commitments[0]?.memberName || mId };
    const memberName = memberObj.name || memberObj.displayName || mId;

    for (let i = 0; i < commitments.length; i++) {
      for (let j = i + 1; j < commitments.length; j++) {
        const c1 = commitments[i];
        const c2 = commitments[j];

        if (c1.sourceId && c2.sourceId && c1.sourceId === c2.sourceId) continue;

        // Sobreposição estrita de horários: max(start1, start2) < min(end1, end2)
        if (Math.max(c1.startMs, c2.startMs) < Math.min(c1.endMs, c2.endMs)) {
          const overlapStart = Math.max(c1.startMs, c2.startMs);
          const overlapEnd = Math.min(c1.endMs, c2.endMs);
          const servCommitment = c1.type === 'parallel_service' ? c1 : (c2.type === 'parallel_service' ? c2 : null);
          const otherCommitment = servCommitment === c1 ? c2 : c1;

          const startFmt = new Date(overlapStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const endFmt = new Date(overlapEnd).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          const c1StartFmt = new Date(c1.startMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const c1EndFmt = new Date(c1.endMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const c2StartFmt = new Date(c2.startMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const c2EndFmt = new Date(c2.endMs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          conflicts.push({
            memberId: mId,
            memberName,
            sourceId: servCommitment ? servCommitment.sourceId : c1.sourceId,
            serviceId: servCommitment ? servCommitment.sourceId : c1.sourceId,
            c1SourceId: c1.sourceId,
            c2SourceId: c2.sourceId,
            serviceName: servCommitment ? servCommitment.name : c1.name,
            otherName: otherCommitment.name,
            prepRequiredMinutes: servCommitment?.prepRequiredMinutes || 0,
            interval: `${startFmt} às ${endFmt}`,
            overlapWindow: {
              startAt: new Date(overlapStart).toISOString(),
              endAt: new Date(overlapEnd).toISOString(),
            },
            c1Window: { name: c1.name, interval: `${c1StartFmt} às ${c1EndFmt}`, window: c1.window },
            c2Window: { name: c2.name, interval: `${c2StartFmt} às ${c2EndFmt}`, window: c2.window },
            reason: `Sinal de Conflito de Escala (CA03/CA04): ${memberName} está alocado(a) simultaneamente em '${c1.name}' (${c1StartFmt}–${c1EndFmt}) e '${c2.name}' (${c2StartFmt}–${c2EndFmt}), com sobreposição no intervalo ${startFmt} às ${endFmt}.`
          });
        }
      }
    }
  }

  return {
    calculable: true,
    conflicts
  };
}

/**
 * Validação de publicação da programação conforme a política de duração do evento (Issue #30, CA01 a CA04).
 * - Em 'warn': alerta ignorável se exceder, publicação permitida sem justificativa (CA02).
 * - Em 'block': bloqueia terminantemente publicar se exceder (CA03). Salvar rascunho é sempre permitido.
 */
export function validateProgramPublication(event) {
  const durations = calculateProgramDurations(event);
  const policy = event?.durationPolicy || 'warn';

  if (policy === 'block' && durations.overflowMinutes > 0) {
    return {
      canPublish: false,
      policy: 'block',
      overflowMinutes: durations.overflowMinutes,
      error: `A programação excede a janela do culto em ${durations.overflowMinutes} min. No modo de bloqueio (block), a programação não pode ser publicada até que a duração seja ajustada à janela prevista.`
    };
  }

  if (policy === 'warn' && durations.overflowMinutes > 0) {
    return {
      canPublish: true,
      policy: 'warn',
      overflowMinutes: durations.overflowMinutes,
      warning: `A programação excede o culto em ${durations.overflowMinutes} min. Publicação permitida conforme a política de alerta (warn) do evento.`
    };
  }

  return {
    canPublish: true,
    policy,
    overflowMinutes: 0,
    warning: null,
    error: null
  };
}

/**
 * Publica a programação da edição do evento (Issue #30).
 * Rejeita se estiver em modo 'block' e com duração excedida (CA03).
 */
export function publishEventProgram(event, publishedByMemberId = null) {
  const check = validateProgramPublication(event);
  if (!check.canPublish) {
    throw new Error(check.error);
  }

  const now = new Date().toISOString();
  return {
    ...event,
    programStatus: 'published',
    publishedAt: now,
    publishedByMemberId,
    programVersion: (event.programVersion || 1) + 1,
    lastSyncTimestamp: now
  };
}

/**
 * Salva a programação da edição do evento como rascunho (Issue #30).
 * Sempre permitido em 'warn' e 'block', mesmo com duração excedida (CA02 e CA03).
 */
export function saveEventProgramDraft(event) {
  const now = new Date().toISOString();
  return {
    ...event,
    programStatus: 'draft',
    lastSyncTimestamp: now
  };
}

/**
 * Atualiza a política de duração de um evento existente (Issue #30, CA04).
 * Somente administradores (ou líder da liturgia designado) podem alterar.
 */
export function updateEventDurationPolicy(event, newPolicy, isCallerAuthorized = false) {
  if (!isCallerAuthorized) {
    throw new Error('Somente liderança autorizada (administrador ou líder da liturgia) pode alterar a política de duração do evento.');
  }
  if (!DURATION_POLICIES.includes(newPolicy)) {
    throw new Error("Política de duração inválida. Opções aceitas: 'warn' ou 'block'.");
  }

  return {
    ...event,
    durationPolicy: newPolicy,
    lastSyncTimestamp: new Date().toISOString()
  };
}

/**
 * Mensagem padronizada de erro para planejamento de eventos.
 */
export function eventPlanningErrorMessage(error) {
  if (!error) return 'Ocorreu um erro ao processar o planejamento do evento.';
  const rawMsg = typeof error === 'string' ? error : String(error?.message || '');
  const lower = rawMsg.toLowerCase();
  const code = String(error?.code || '');

  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('abort') ||
    lower.includes('conexão') ||
    lower.includes('offline')
  ) {
    return 'Falha de conexão com o servidor. Verifique sua rede e tente novamente.';
  }

  if (code === 'PGRST202' || lower.includes('could not find the function') || lower.includes('schema cache')) {
    return 'Serviço de planejamento temporariamente indisponível no servidor. Verifique se as migrações foram aplicadas.';
  }

  if (code === '42501' || code === '28000') {
    return 'Permissão insuficiente. Apenas administradores ou líderes da liturgia autorizados podem executar esta ação.';
  }
  if (code === '22000') {
    return error.message || 'Dados inválidos. Verifique as datas, horários e a política de duração do evento.';
  }
  if (code === '22004') {
    return 'Parâmetros obrigatórios ausentes para a operação de evento.';
  }
  if (code === '23503') {
    return 'Referência a membro ou igreja inexistente ou inativa.';
  }
  if (code === 'P0002') {
    return 'Evento litúrgico não encontrado.';
  }
  return error.message || 'Falha na operação de planejamento litúrgico.';
}

/**
 * Utilitário para executar RPCs compatível com versões recentes do cliente Supabase.
 */
async function invokeSupabaseRpc(supabaseClient, rpcName, params = {}) {
  if (!supabaseClient) {
    throw new Error('Cliente Supabase não fornecido.');
  }
  const builder = typeof supabaseClient.schema === 'function'
    ? supabaseClient.schema('public').rpc(rpcName, params)
    : supabaseClient.rpc(rpcName, params);
  return await builder;
}

/**
 * Gera identificador UUIDv4 para idempotência de comandos.
 */
export function generateCommandUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Extrai a lista de eventos do retorno de public.list_church_events (Issue #28).
 * A RPC devolve TABLE(events jsonb, total_count bigint): uma linha { events: [...], total_count }.
 * Retorna null quando o formato não é reconhecido (nada deve ser alterado no estado) e
 * lista vazia quando o servidor informa que não há eventos — nunca cria evento-fantasma.
 */
export function extractChurchEventsFromRpc(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object' || !Array.isArray(row.events)) return null;
  return row.events.filter(ev => ev && typeof ev === 'object' && ev.id);
}

const SERVER_EVENT_STATUS_TO_LOCAL = {
  scheduled: 'pronto',
  in_progress: 'em_andamento',
  completed: 'encerrado',
  cancelled: 'cancelado',
};

/**
 * Converte um evento devolvido por list_church_events para o formato usado na tela (Issue #28).
 * - Data e hora de exibição usam o fuso do próprio evento, não o do navegador.
 * - A duração planejada é derivada de planned_start_at/planned_end_at.
 * - A RPC não devolve política de duração, situação/versão da programação nem etapas:
 *   esses campos ficam null ("não informado pelo servidor") em vez de valores inventados.
 */
export function toPlanningEventFromServer(ev, fallbackTimezone = DEFAULT_TIMEZONE) {
  if (!ev || !ev.id) return null;
  const timezone = isValidTimeZone(ev.timezone)
    ? ev.timezone
    : (isValidTimeZone(fallbackTimezone) ? fallbackTimezone : DEFAULT_TIMEZONE);
  const startDisplay = ev.planned_start_at ? formatInstantInTimeZone(ev.planned_start_at, timezone) : null;
  const durationCheck = calculateAvailableDurationMinutes(ev.planned_start_at, ev.planned_end_at);

  return {
    id: ev.id,
    churchId: ev.church_id || null,
    title: ev.title,
    type: ev.event_type || null,
    timezone,
    date: startDisplay ? startDisplay.date : null,
    scheduledStartTime: startDisplay ? startDisplay.time : null,
    plannedStartAt: ev.planned_start_at || null,
    plannedEndAt: ev.planned_end_at || null,
    plannedDurationMinutes: durationCheck.valid ? durationCheck.minutes : null,
    liturgyLeaderId: ev.liturgy_leader_member_id || null,
    liturgyLeaderName: ev.liturgy_leader_name || null,
    serverStatus: ev.status || null,
    status: SERVER_EVENT_STATUS_TO_LOCAL[ev.status] || null,
    actualStartAt: ev.actual_start_at || null,
    actualEndAt: ev.actual_end_at || null,
    cancelReason: ev.cancel_reason || null,
    version: ev.version ?? null,
    // Não informados por list_church_events (dependem do pacote B2):
    durationPolicy: null,
    programStatus: null,
    programVersion: null,
    activities: [],
    parallelServices: [],
    checklist: [],
    internalAlerts: [],
    loadedFromServer: true,
    activitiesKnownInSession: false,
  };
}

/**
 * Combina os eventos lidos do servidor com o que a sessão atual já conhece (Issue #28).
 * O servidor é a fonte de identidade, título, tipo, fuso, datas e liderança. Como a RPC de listagem
 * não devolve etapas, apoios, política de duração nem situação da programação, o que a sessão já
 * conhece desses campos para o mesmo evento é mantido; o que ela não conhece permanece null.
 */
export function mergeServerEventsWithSession(serverEvents = [], sessionEvents = []) {
  const known = new Map((Array.isArray(sessionEvents) ? sessionEvents : []).map(ev => [ev?.id, ev]));
  return serverEvents.map(serverEv => {
    const prev = known.get(serverEv.id);
    if (!prev) return serverEv;
    return {
      ...prev,
      ...serverEv,
      durationPolicy: prev.durationPolicy ?? null,
      programStatus: prev.programStatus ?? null,
      programVersion: prev.programVersion ?? null,
      activities: Array.isArray(prev.activities) ? prev.activities : [],
      parallelServices: Array.isArray(prev.parallelServices) ? prev.parallelServices : [],
      checklist: Array.isArray(prev.checklist) ? prev.checklist : [],
      internalAlerts: Array.isArray(prev.internalAlerts) ? prev.internalAlerts : [],
      loadedFromServer: prev.loadedFromServer ?? true,
      activitiesKnownInSession: prev.activitiesKnownInSession ?? !prev.loadedFromServer,
    };
  });
}

/**
 * Valida estritamente o recibo canônico devolvido por public.create_church_event_edition (#28).
 * Rejeita resposta vazia, com mais de uma linha, comando/ação/igreja divergentes,
 * created_at ausente/inválido ou payload sem event_id coerente.
 */
export function validateCreateEventEditionReceipt(data, commandId, churchId) {
  if (!data) return null;
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length !== 1) return null;
  const receipt = rows[0];
  if (!receipt || typeof receipt !== 'object') return null;
  if (receipt.command_id !== commandId) return null;
  if (receipt.church_id !== churchId) return null;
  if (receipt.action !== 'create_church_event_edition') return null;
  if (!receipt.result_entity_id) return null;
  if (typeof receipt.created_at !== 'string' || !receipt.created_at.trim() || Number.isNaN(Date.parse(receipt.created_at))) {
    return null;
  }
  if (!receipt.result_payload || typeof receipt.result_payload !== 'object' || Array.isArray(receipt.result_payload)) {
    return null;
  }
  const payloadEntityId = receipt.result_payload.event_id;
  if (!payloadEntityId || String(payloadEntityId) !== String(receipt.result_entity_id)) {
    return null;
  }
  return receipt;
}

/**
 * Cria edição concreta de culto no Supabase.
 * Início e fim são enviados como instantes com deslocamento explícito, calculados no fuso da igreja
 * (campo timezone; se ausente, America/Sao_Paulo, padrão do servidor) — nunca no fuso do navegador.
 * O tipo de evento é obrigatório: não há padrão silencioso (Issue #28).
 */
export async function createChurchEventEditionRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventData = {}
) {
  let churchId, commandId, title, eventType, plannedStartAt, plannedEndAt, liturgyLeaderMemberId, durationPolicy, timezone;
  let fallbackDurationMinutes = null;
  let endGivenAsTimeOnly = false;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      title,
      eventType,
      plannedStartAt,
      plannedEndAt,
      liturgyLeaderMemberId = null,
      durationPolicy = 'warn',
      timezone,
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    const d = maybeEventData || {};
    title = d.title;
    eventType = d.eventType || d.event_type;
    timezone = d.timezone || d.timeZone;
    plannedStartAt = d.plannedStartAt || d.planned_start_at || (d.event_date && d.start_time ? `${d.event_date}T${d.start_time}` : null);
    plannedEndAt = d.plannedEndAt || d.planned_end_at || null;
    if (!plannedEndAt && d.event_date && d.target_end_time) {
      plannedEndAt = `${d.event_date}T${d.target_end_time}`;
      endGivenAsTimeOnly = true;
    }
    if (!plannedEndAt) {
      fallbackDurationMinutes = d.planned_duration_minutes || 105;
    }
    liturgyLeaderMemberId = d.liturgyLeaderMemberId || d.liturgy_leader_id || d.liturgyLeaderId || null;
    durationPolicy = d.durationPolicy || d.duration_policy || 'warn';
    commandId = d.commandId;
  }

  if (!churchId) {
    return { success: false, error: 'Identificador da igreja não informado.' };
  }

  // Instantes com deslocamento explícito, calculados no fuso da igreja e não no do navegador (Issue #28)
  const effectiveTimezone = timezone || DEFAULT_TIMEZONE;
  if (!isValidTimeZone(effectiveTimezone)) {
    return { success: false, error: `Fuso horário da igreja não reconhecido: '${effectiveTimezone}'.` };
  }
  const startMs = parseInstantInTimeZone(plannedStartAt, effectiveTimezone);
  if (startMs === null) {
    return { success: false, uncertain: false, error: 'Data/hora de início inválida ou inexistente no fuso horário da igreja.' };
  }
  let endMs = parseInstantInTimeZone(plannedEndAt, effectiveTimezone);
  if (!plannedEndAt && fallbackDurationMinutes) {
    endMs = startMs + fallbackDurationMinutes * 60000;
  }
  if (endMs !== null && endGivenAsTimeOnly && endMs <= startMs) {
    // Término informado só como hora e não posterior ao início: virada de meia-noite (dia seguinte no fuso da igreja)
    const startDay = formatInstantInTimeZone(startMs, effectiveTimezone).date;
    const nextDay = new Date(Date.UTC(
      parseInt(startDay.slice(0, 4), 10),
      parseInt(startDay.slice(5, 7), 10) - 1,
      parseInt(startDay.slice(8, 10), 10) + 1
    )).toISOString().slice(0, 10);
    endMs = parseInstantInTimeZone(`${nextDay}T${String(plannedEndAt).split('T')[1]}`, effectiveTimezone);
  }
  if (endMs === null) {
    return { success: false, uncertain: false, error: 'Data/hora de término inválida ou inexistente no fuso horário da igreja.' };
  }
  plannedStartAt = formatInstantWithOffset(startMs, effectiveTimezone);
  plannedEndAt = formatInstantWithOffset(endMs, effectiveTimezone);

  const durationCheck = calculateAvailableDurationMinutes(plannedStartAt, plannedEndAt);
  if (!durationCheck.valid) {
    return { success: false, error: durationCheck.error };
  }
  const cleanTitle = normalizeNfcText(title);
  if (!cleanTitle || cleanTitle.length < MIN_TITLE_LENGTH || cleanTitle.length > MAX_TITLE_LENGTH) {
    return { success: false, error: `Título deve ter entre ${MIN_TITLE_LENGTH} e ${MAX_TITLE_LENGTH} caracteres.` };
  }
  const cleanPolicy = durationPolicy ? String(durationPolicy).toLowerCase().trim() : 'warn';
  if (!DURATION_POLICIES.includes(cleanPolicy)) {
    return { success: false, error: "Política de duração inválida. Opções aceitas: 'warn' ou 'block'." };
  }
  // Tipo de evento obrigatório: sem padrão silencioso (Issue #28)
  const cleanEventType = normalizeNfcText(eventType);
  if (!cleanEventType) {
    return { success: false, error: 'Tipo de evento não informado. Selecione o tipo de evento antes de criar a edição.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'create_church_event_edition', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_title: cleanTitle,
      p_event_type: cleanEventType,
      p_planned_start_at: plannedStartAt,
      p_planned_end_at: plannedEndAt,
      p_liturgy_leader_member_id: liturgyLeaderMemberId || null,
      p_duration_policy: cleanPolicy,
    });
    if (error) {
      return {
        success: false,
        uncertain: !isDefinitiveLiturgicalError(error),
        error: eventPlanningErrorMessage(error),
        rawError: error,
      };
    }
    const receipt = validateCreateEventEditionReceipt(data, cmdId, churchId);
    if (!receipt) {
      return {
        success: false,
        uncertain: true,
        commandId: cmdId,
        error: 'O servidor não retornou um recibo canônico válido para a criação da edição.',
      };
    }
    const eventId = receipt.result_entity_id;
    const rawPayload = receipt.result_payload && typeof receipt.result_payload === 'object'
      ? { ...receipt.result_payload }
      : {};
    delete rawPayload.id;
    const sanitizedPayload = { ...rawPayload, event_id: eventId };
    return {
      success: true,
      uncertain: false,
      commandId: cmdId,
      eventId,
      data: { ...sanitizedPayload, id: eventId },
      payload: sanitizedPayload,
      receipt,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      uncertain: !isDefinitiveLiturgicalError(err),
      commandId: cmdId,
      error: eventPlanningErrorMessage(err),
      rawError: err,
    };
  }
}

/**
 * Reordena atividades litúrgicas no Supabase.
 * Delega para a implementação canônica com validação de recibo em liturgicalCommandService.
 */
export async function reorderEventItemsRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybeItemOrders = []
) {
  let churchId, commandId, eventId, itemIds, itemNature;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({
      churchId,
      commandId,
      eventId,
      itemIds = churchIdOrOpts.orderedItemIds || churchIdOrOpts.itemIds || [],
      itemNature = 'liturgical',
    } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
    itemIds = Array.isArray(maybeItemOrders)
      ? maybeItemOrders.map(item => (typeof item === 'object' ? item.item_id || item.id : item)).filter(Boolean)
      : [];
    itemNature = 'liturgical';
  }

  const cmdId = commandId || generateCommandUuid();
  const res = await reorderEventItems({
    supabase: supabaseClient,
    churchId,
    commandId: cmdId,
    eventId,
    itemIds,
    itemNature,
  });

  if (res.status === 'SUCCESS') {
    return {
      success: true,
      commandId: cmdId,
      receipt: res.receipt,
      error: null,
    };
  }

  return {
    success: false,
    commandId: cmdId,
    uncertain: res.status === 'UNCERTAIN' || res.status === 'UNCERTAIN_ERROR',
    error: res.message || eventPlanningErrorMessage(res.rawError),
    rawError: res.rawError,
  };
}

/**
 * Configura política de duração do evento no Supabase.
 */
export async function setEventDurationPolicyRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybePolicy = null,
  maybeTargetEndTime = null
) {
  let churchId, commandId, eventId, durationPolicy;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId, durationPolicy } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
    durationPolicy = maybePolicy;
  }

  if (!churchId || !eventId || !durationPolicy) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  if (!DURATION_POLICIES.includes(durationPolicy)) {
    return { success: false, error: "Política inválida. Opções aceitas: 'warn' ou 'block'." };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'set_event_duration_policy', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
      p_duration_policy: durationPolicy,
    });
    if (error) {
      const definitive = isDefinitiveLiturgicalError(error);
      return {
        success: false,
        uncertain: !definitive,
        error: eventPlanningErrorMessage(error),
        rawError: error,
      };
    }
    const receipt = validateLiturgicalReceipt(data, cmdId, churchId, 'set_event_duration_policy');
    if (!receipt) {
      return {
        success: false,
        uncertain: true,
        error: 'Resposta recebida sem recibo canônico compatível para confirmação da política de duração.',
      };
    }
    return { success: true, durationPolicy, receipt, error: null };
  } catch (err) {
    const definitive = isDefinitiveLiturgicalError(err);
    return {
      success: false,
      uncertain: !definitive,
      error: eventPlanningErrorMessage(err),
      rawError: err,
    };
  }
}

/**
 * Publica a programação litúrgica no Supabase.
 */
export async function publishEventProgramRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybeVersion = null,
  maybeItems = []
) {
  let churchId, commandId, eventId, expectedVersion;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId, expectedVersion } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
    expectedVersion = maybeVersion;
  }

  if (!churchId || !eventId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'publish_event_program', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
    });
    if (error) {
      const definitive = isDefinitiveLiturgicalError(error);
      return {
        success: false,
        uncertain: !definitive,
        error: eventPlanningErrorMessage(error),
        rawError: error,
      };
    }
    const receipt = validateLiturgicalReceipt(data, cmdId, churchId, 'publish_event_program');
    if (!receipt) {
      return {
        success: false,
        uncertain: true,
        error: 'Resposta recebida sem recibo canônico compatível para confirmação da publicação da programação.',
      };
    }
    return { success: true, payload: receipt?.result_payload, receipt, error: null };
  } catch (err) {
    const definitive = isDefinitiveLiturgicalError(err);
    return {
      success: false,
      uncertain: !definitive,
      error: eventPlanningErrorMessage(err),
      rawError: err,
    };
  }
}

/**
 * Salva rascunho da programação no Supabase.
 */
export async function saveEventProgramDraftRemote(
  supabaseClient,
  churchIdOrOpts,
  maybeEventId = null,
  maybeItems = []
) {
  let churchId, commandId, eventId;
  if (typeof churchIdOrOpts === 'object' && churchIdOrOpts !== null) {
    ({ churchId, commandId, eventId } = churchIdOrOpts);
  } else {
    churchId = churchIdOrOpts;
    eventId = maybeEventId;
  }

  if (!churchId || !eventId) {
    return { success: false, error: 'Parâmetros obrigatórios ausentes.' };
  }
  const cmdId = commandId || generateCommandUuid();
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'save_event_program_draft', {
      p_church_id: churchId,
      p_command_id: cmdId,
      p_event_id: eventId,
    });
    if (error) {
      const definitive = isDefinitiveLiturgicalError(error);
      return {
        success: false,
        uncertain: !definitive,
        error: eventPlanningErrorMessage(error),
        rawError: error,
      };
    }
    const receipt = validateLiturgicalReceipt(data, cmdId, churchId, 'save_event_program_draft');
    if (!receipt) {
      return {
        success: false,
        uncertain: true,
        error: 'Resposta recebida sem recibo canônico compatível para confirmação do salvamento de rascunho.',
      };
    }
    return { success: true, payload: receipt?.result_payload, receipt, error: null };
  } catch (err) {
    const definitive = isDefinitiveLiturgicalError(err);
    return {
      success: false,
      uncertain: !definitive,
      error: eventPlanningErrorMessage(err),
      rawError: err,
    };
  }
}

/**
 * Obtém a programação completa do evento no Supabase (pós-026 / B2).
 * Retorna { event, items }.
 */
export async function getEventProgramRemote(supabaseClient, churchId, eventId) {
  if (!churchId || !eventId) {
    return { success: false, error: 'Identificadores da igreja e do evento são obrigatórios.' };
  }
  try {
    const { data, error } = await invokeSupabaseRpc(supabaseClient, 'get_event_program', {
      p_church_id: churchId,
      p_event_id: eventId,
    });
    if (error) {
      return { success: false, error: eventPlanningErrorMessage(error), rawError: error };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.event || !Array.isArray(row.items)) {
      return { success: false, error: 'Retorno inválido ao carregar a programação do evento: estrutura incompleta.' };
    }
    return {
      success: true,
      event: row.event,
      items: row.items,
      error: null,
    };
  } catch (err) {
    return { success: false, error: eventPlanningErrorMessage(err), rawError: err };
  }
}

/**
 * Atualiza etapa litúrgica ou apoio no Supabase com token de concorrência otimista (pós-026 / B2).
 * Delega para a implementação canônica com validação de recibo em liturgicalCommandService.
 */
export async function updateEventItemRemote(supabaseClient, params) {
  const {
    churchId,
    commandId,
    eventId,
    itemId,
    title,
    itemNature = 'liturgical',
    plannedDurationSeconds,
    prepRequiredMinutes = 0,
    designatedTeamId = null,
    nominalLeaderMemberId = null,
    expectedUpdatedAt,
  } = params || {};

  const cmdId = commandId || generateCommandUuid();
  const res = await updateEventItem({
    supabase: supabaseClient,
    churchId,
    commandId: cmdId,
    eventId,
    itemId,
    title,
    itemNature,
    plannedDurationSeconds,
    prepRequiredMinutes,
    designatedTeamId,
    nominalLeaderMemberId,
    expectedUpdatedAt,
  });

  if (res.status === 'SUCCESS') {
    return {
      success: true,
      commandId: cmdId,
      receipt: res.receipt,
      updatedAt: res.receipt?.result_payload?.updated_at,
      error: null,
    };
  }

  const rawError = res.rawError || res.error || null;
  const isConcurrency = (res.code || rawError?.code) === '40001' || String(res.message || rawError?.message || '').includes('40001');
  return {
    success: false,
    commandId: cmdId,
    uncertain: res.status === 'UNCERTAIN' || res.status === 'UNCERTAIN_ERROR',
    concurrencyConflict: isConcurrency,
    error: isConcurrency
      ? 'Conflito de concorrência: a etapa foi modificada por outro usuário. Recarregue a página antes de editar.'
      : (res.message || eventPlanningErrorMessage(rawError)),
    rawError,
  };
}

/**
 * Remove fisicamente etapa litúrgica ou apoio no Supabase no status de planejamento (pós-026 / B2).
 * Delega para a implementação canônica com validação de recibo em liturgicalCommandService.
 */
export async function removeEventItemRemote(supabaseClient, params) {
  const {
    churchId,
    commandId,
    eventId,
    itemId,
    expectedUpdatedAt,
  } = params || {};

  const cmdId = commandId || generateCommandUuid();
  const res = await removeEventItem({
    supabase: supabaseClient,
    churchId,
    commandId: cmdId,
    eventId,
    itemId,
    expectedUpdatedAt,
  });

  if (res.status === 'SUCCESS') {
    return {
      success: true,
      commandId: cmdId,
      receipt: res.receipt,
      error: null,
    };
  }

  const rawError = res.rawError || res.error || null;
  const isConflict = (res.code || rawError?.code) === '40001' || String(res.message || rawError?.message || '').includes('40001');
  const isBlocked = (res.code || rawError?.code) === 'P0020' || String(res.message || rawError?.message || '').includes('P0020');
  let msg = res.message || eventPlanningErrorMessage(rawError);
  if (isConflict) {
    msg = 'Conflito de concorrência: a etapa foi modificada. Recarregue a página.';
  } else if (isBlocked) {
    msg = 'Não é possível remover a etapa: existem voluntários ou equipes alocadas a ela.';
  }

  return {
    success: false,
    commandId: cmdId,
    uncertain: res.status === 'UNCERTAIN' || res.status === 'UNCERTAIN_ERROR',
    concurrencyConflict: isConflict,
    blockedByAssignment: isBlocked,
    error: msg,
    rawError,
  };
}
