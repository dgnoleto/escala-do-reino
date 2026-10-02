import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Clock, CheckCircle2, XCircle, ChevronDown, ChevronUp, Music, FileText } from 'lucide-react';

// Ícone de atividade em andamento (pulsating dot) sem depender de imagem
function LivePulse() {
  return (
    <span className="live-pulse-wrapper" aria-hidden="true">
      <span className="live-pulse-ring" />
      <span className="live-pulse-dot" />
    </span>
  );
}

// Ícone de número da etapa
function StepBadge({ index, isDone, isCurrent, isCancelled }) {
  if (isCurrent) return <LivePulse />;
  if (isDone) return <CheckCircle2 size={18} className="step-icon-done" aria-hidden="true" />;
  if (isCancelled) return <XCircle size={18} className="step-icon-cancelled" aria-hidden="true" />;
  return <span className="step-number-label">{index + 1}</span>;
}

// Badge de situação textual
function StatusBadge({ isCurrent, isDone, isCancelled, act }) {
  if (isCurrent) {
    return (
      <span className="status-badge status-live" role="status">
        <span className="live-dot" aria-hidden="true" />
        Em andamento
      </span>
    );
  }
  if (isDone) {
    return (
      <span className="status-badge status-done">
        Concluída{act.realEndTime ? ` · ${act.realEndTime}` : ''}
      </span>
    );
  }
  if (isCancelled) {
    return <span className="status-badge status-cancelled">Cancelada</span>;
  }
  return <span className="status-badge status-pending">Prevista</span>;
}

// Cartão de uma atividade
function ActivityCard({ act, index, isCurrent, totalCount }) {
  const isDone = act.status === 'concluida';
  const isCancelled = act.status === 'cancelada';

  // Há detalhes expandíveis?
  const hasDetails =
    (act.notes && act.notes.trim().length > 0) ||
    (act.musics && act.musics.length > 0) ||
    (isCancelled && act.cancellationReason);

  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    if (hasDetails) setExpanded(prev => !prev);
  };

  const handleKeyDown = (e) => {
    if (hasDetails && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setExpanded(prev => !prev);
    }
  };

  return (
    <div className={`mac-card${isCurrent ? ' mac-card-live' : ''}${isDone ? ' mac-card-done' : ''}${isCancelled ? ' mac-card-cancelled' : ''}`}>
      {/* Coluna esquerda: marcador de etapa + conector */}
      <div className="mac-step-col" aria-hidden="true">
        <div className={`mac-step-circle${isCurrent ? ' mac-step-live' : ''}${isDone ? ' mac-step-done' : ''}${isCancelled ? ' mac-step-cancelled' : ''}`}>
          <StepBadge index={index} isDone={isDone} isCurrent={isCurrent} isCancelled={isCancelled} />
        </div>
        {index < totalCount - 1 && (
          <div className={`mac-connector${isCurrent ? ' mac-connector-live' : ''}`} />
        )}
      </div>

      {/* Coluna direita: conteúdo */}
      <div className="mac-body">
        {/* Linha principal — sempre visível */}
        <div
          className={`mac-summary${hasDetails ? ' mac-summary-expandable' : ''}`}
          onClick={toggle}
          onKeyDown={handleKeyDown}
          role={hasDetails ? 'button' : undefined}
          tabIndex={hasDetails ? 0 : undefined}
          aria-expanded={hasDetails ? expanded : undefined}
          aria-label={hasDetails ? `${act.title} — ${expanded ? 'Recolher detalhes' : 'Ver detalhes'}` : undefined}
        >
          <div className="mac-main-info">
            {/* Categoria + título */}
            <div className="mac-title-row">
              <span className="mac-category">{act.category}</span>
              <h3 className="mac-title">{act.title}</h3>
            </div>

            {/* Duração + status */}
            <div className="mac-meta-row">
              <span className="mac-duration">
                <Clock size={13} aria-hidden="true" />
                {act.plannedDurationMinutes} min
              </span>
              <StatusBadge
                isCurrent={isCurrent}
                isDone={isDone}
                isCancelled={isCancelled}
                act={act}
              />
            </div>
          </div>

          {/* Chevron e "Ver detalhes" apenas quando há conteúdo */}
          {hasDetails && (
            <div className="mac-expand-hint" aria-hidden="true">
              <span className="mac-expand-label">{expanded ? 'Recolher' : 'Ver detalhes'}</span>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          )}
        </div>

        {/* Detalhes expansíveis */}
        {hasDetails && expanded && (
          <div className="mac-details">
            {/* Motivo do cancelamento */}
            {isCancelled && act.cancellationReason && (
              <p className="mac-cancel-reason">
                <XCircle size={13} aria-hidden="true" />
                Motivo: {act.cancellationReason}
              </p>
            )}

            {/* Notas */}
            {act.notes && act.notes.trim().length > 0 && (
              <div className="mac-notes-block">
                <div className="mac-details-label">
                  <FileText size={12} aria-hidden="true" />
                  Observação
                </div>
                <p className="mac-notes-text">"{act.notes}"</p>
              </div>
            )}

            {/* Músicas */}
            {act.musics && act.musics.length > 0 && (
              <div className="mac-music-block">
                <div className="mac-details-label">
                  <Music size={12} aria-hidden="true" />
                  Músicas previstas
                </div>
                <ul className="mac-song-list">
                  {act.musics.map(m => (
                    <li key={m.id} className="mac-song-item">
                      <span className="mac-song-name">{m.name}</span>
                      {m.artist && <span className="mac-song-artist"> — {m.artist}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScheduleView() {
  const { event } = useApp();

  // Totais rápidos para o cabeçalho
  const doneCount = event.activities.filter(a => a.status === 'concluida').length;

  // Total calculado a partir das atividades (fonte de verdade)
  const totalActivityMinutes = event.activities.reduce(
    (sum, a) => sum + (a.plannedDurationMinutes || 0), 0
  );

  // Formata data ISO (YYYY-MM-DD) para dd/mm/aaaa + dia da semana em pt-BR
  const formatDate = (iso, short = false) => {
    if (!iso) return iso;
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (short) {
      return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
    }
    const weekday = dt.toLocaleDateString('pt-BR', { weekday: 'long' });
    return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y} · ${weekday.charAt(0).toUpperCase() + weekday.slice(1)}`;
  };

  return (
    <div className="schedule-view">
      {/* Cabeçalho informativo */}
      <div className="card schedule-header">
        <div className="schedule-header-main">
          <div className="schedule-header-labels">
            <span className="badge badge-primary">Cronograma Macro · Acesso Geral</span>
          </div>
          <h1 className="schedule-event-title">{event.title}</h1>
          <p className="schedule-event-desc">
            Visão geral da ordem do culto, aberta a todos os membros autorizados.
          </p>
        </div>

        <dl className="schedule-stats">
          <div className="stat-item">
            <dt>Data</dt>
            <dd>
              <span className="stat-date-full">{formatDate(event.date)}</span>
              <span className="stat-date-short">{formatDate(event.date, true)}</span>
            </dd>
          </div>
          <div className="stat-item">
            <dt>Início previsto</dt>
            <dd>{event.scheduledStartTime}</dd>
          </div>
          <div className="stat-item">
            <dt>Duração</dt>
            <dd>{totalActivityMinutes} min</dd>
          </div>
          <div className="stat-item">
            <dt>Progresso</dt>
            <dd>{doneCount} / {event.activities.length} etapas</dd>
          </div>
        </dl>
      </div>

      {/* Lista de atividades */}
      <div className="mac-list" role="list" aria-label="Sequência de atividades do culto">
        {event.activities.map((act, index) => {
          const isCurrent =
            event.currentActivityIndex === index &&
            event.currentActivityStatus === 'em_execucao';

          return (
            <div key={act.id} role="listitem">
              <ActivityCard
                act={act}
                index={index}
                isCurrent={isCurrent}
                totalCount={event.activities.length}
              />
            </div>
          );
        })}
      </div>

      <style>{`
        /* ── Wrapper ─────────────────────────────────── */
        .schedule-view {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* ── Cabeçalho ───────────────────────────────── */
        /* Sobrescreve o hover global de .card pois o cabeçalho não é interativo */
        .schedule-header:hover {
          border-color: var(--border-subtle);
        }
        .schedule-header {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          align-items: flex-start;
          justify-content: space-between;
          padding: 24px 28px;
        }

        .schedule-header-main {
          flex: 1 1 auto;
          min-width: 0;
        }

        .schedule-header-labels {
          margin-bottom: 10px;
        }

        .schedule-event-title {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
          color: var(--text-primary);
        }

        .schedule-event-desc {
          font-size: 13px;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .schedule-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: flex-start;
          flex: 0 0 auto;
        }

        .stat-item {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 16px;
          min-width: 100px;
        }

        .stat-item dt {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin-bottom: 3px;
        }

        .stat-item dd {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        /* ── Lista macro ─────────────────────────────── */
        .mac-list {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* ── Cartão de atividade ─────────────────────── */
        .mac-card {
          display: flex;
          gap: 16px;
          padding: 0 0 0 0;
          position: relative;
          background: transparent;
        }

        /* ── Coluna de passos ────────────────────────── */
        .mac-step-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex-shrink: 0;
          width: 36px;
          padding-top: 18px;
        }

        .mac-step-circle {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--bg-card);
          border: 1.5px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          z-index: 1;
        }

        .mac-step-live {
          background: var(--status-live-bg);
          border-color: var(--status-live);
        }

        .mac-step-done {
          background: var(--bg-surface);
          border-color: var(--border-subtle);
        }

        .mac-step-cancelled {
          background: var(--status-cancelled-bg);
          border-color: var(--status-cancelled-border);
          opacity: 0.7;
        }

        .step-number-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
        }

        .step-icon-done {
          color: var(--status-live);
        }

        .step-icon-cancelled {
          color: var(--status-cancelled);
        }

        .mac-connector {
          width: 2px;
          flex: 1;
          min-height: 16px;
          background: var(--border-subtle);
          margin: 4px 0;
        }

        .mac-connector-live {
          background: var(--status-live-border);
        }

        /* ── Corpo do cartão ─────────────────────────── */
        .mac-body {
          flex: 1;
          min-width: 0;
          padding-bottom: 12px;
        }

        /* ── Área de resumo (sempre visível) ─────────── */
        .mac-summary {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          transition: border-color var(--transition-fast), background var(--transition-fast);
        }

        /* Cartão em andamento: destaque especial */
        .mac-card-live .mac-summary {
          background: var(--status-live-bg);
          border-color: var(--status-live-border);
          box-shadow: 0 0 0 1px var(--status-live-border);
        }

        /* Cartão concluído: visual mais apagado */
        .mac-card-done .mac-summary {
          opacity: 0.72;
        }

        /* Cartão cancelado: visual apagado */
        .mac-card-cancelled .mac-summary {
          opacity: 0.55;
          background: var(--status-cancelled-bg);
          border-color: var(--status-cancelled-border);
        }

        /* Expandível: mostrar affordance de interação */
        .mac-summary-expandable {
          cursor: pointer;
        }

        .mac-summary-expandable:hover {
          border-color: var(--border-active);
          background: var(--bg-card-hover);
        }

        .mac-card-live .mac-summary-expandable:hover {
          background: var(--status-live-bg);
          filter: brightness(1.04);
        }

        .mac-summary-expandable:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
          border-color: var(--primary);
        }

        .mac-summary-expandable:active {
          transform: scale(0.995);
        }

        /* ── Informações principais ──────────────────── */
        .mac-main-info {
          flex: 1;
          min-width: 0;
        }

        .mac-title-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 6px;
        }

        .mac-category {
          font-size: 11px;
          font-weight: 700;
          color: var(--primary);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .mac-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1.3;
        }

        .mac-meta-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .mac-duration {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 600;
        }

        /* ── Badges de situação ──────────────────────── */
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 9px;
          border-radius: var(--radius-full);
          white-space: nowrap;
        }

        .status-live {
          background: var(--status-live-bg);
          color: var(--status-live-text);
          border: 1px solid var(--status-live-border);
        }

        .status-done {
          background: var(--bg-surface);
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
        }

        .status-pending {
          background: var(--status-pending-bg);
          color: var(--status-pending-text);
          border: 1px solid var(--status-pending-border);
        }

        .status-cancelled {
          background: var(--status-cancelled-bg);
          color: var(--status-cancelled-text);
          border: 1px solid var(--status-cancelled-border);
        }

        /* ── Hint de expansão ────────────────────────── */
        .mac-expand-hint {
          display: flex;
          align-items: center;
          gap: 4px;
          color: var(--text-muted);
          flex-shrink: 0;
          font-size: 11px;
        }

        .mac-expand-label {
          display: none;
        }

        @media (min-width: 480px) {
          .mac-expand-label {
            display: inline;
          }
        }

        /* ── Seção de detalhes ───────────────────────── */
        .mac-details {
          margin-top: 6px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .mac-details-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          margin-bottom: 5px;
        }

        .mac-notes-text {
          font-size: 13px;
          font-style: italic;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .mac-cancel-reason {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          font-size: 13px;
          color: var(--status-cancelled-text);
          line-height: 1.4;
        }

        /* ── Lista de músicas ────────────────────────── */
        .mac-song-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .mac-song-item {
          font-size: 13px;
          color: var(--text-secondary);
          padding: 4px 0;
          border-bottom: 1px solid var(--border-subtle);
          line-height: 1.4;
        }

        .mac-song-item:last-child {
          border-bottom: none;
        }

        .mac-song-name {
          font-weight: 600;
          color: var(--text-primary);
        }

        .mac-song-artist {
          color: var(--text-muted);
        }

        /* ── Animação do ponto em andamento ──────────── */
        .live-pulse-wrapper {
          position: relative;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .live-pulse-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: var(--status-live);
          opacity: 0.25;
          animation: pulse-ring 1.8s ease-out infinite;
        }

        .live-pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--status-live);
          position: relative;
          z-index: 1;
        }

        @keyframes pulse-ring {
          0%   { transform: scale(0.6); opacity: 0.4; }
          60%  { transform: scale(1.5); opacity: 0; }
          100% { transform: scale(1.5); opacity: 0; }
        }

        /* ── Mobile ajustes ──────────────────────────── */
        /* Data: versão longa (desktop) e curta (mobile) */
        .stat-date-short { display: none; }
        .stat-date-full  { display: inline; }

        @media (max-width: 600px) {
          .schedule-view {
            gap: 12px;
            /* Espaço inferior para o acionador do guia recolhido não cobrir a última atividade */
            padding-bottom: 56px;
          }

          .schedule-header {
            padding: 10px 14px;
            gap: 6px;
            flex-direction: column;
          }

          .schedule-header-main {
            flex: none;
            width: 100%;
          }

          .schedule-event-desc {
            display: none;
          }

          .schedule-event-title {
            font-size: 16px;
            margin-bottom: 4px;
          }

          .schedule-header-labels {
            margin-bottom: 4px;
          }

          .schedule-stats {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
          }

          /* Mostrar data curta no mobile */
          .stat-date-full  { display: none; }
          .stat-date-short { display: inline; }

          .stat-item {
            flex: none;
            min-width: 0;
            padding: 7px 10px;
          }

          .stat-item dt {
            font-size: 9px;
          }

          .stat-item dd {
            font-size: 12px;
          }

          .mac-step-col {
            width: 26px;
          }

          .mac-step-circle {
            width: 26px;
            height: 26px;
          }

          .mac-summary {
            padding: 10px 12px;
          }

          .mac-title {
            font-size: 14px;
          }
        }

        /* ── Preferência de movimento reduzido ───────── */
        @media (prefers-reduced-motion: reduce) {
          .live-pulse-ring {
            animation: none;
            opacity: 0.2;
          }
          .mac-summary-expandable:active {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
