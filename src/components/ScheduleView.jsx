import React from 'react';
import { useApp } from '../context/AppContext';
import { Calendar, Clock, CheckCircle2, Play, AlertCircle, Music, User } from 'lucide-react';

export default function ScheduleView() {
  const { event } = useApp();

  return (
    <div className="schedule-view-container">
      {/* Cabeçalho do Cronograma Macro */}
      <div className="card schedule-header-card">
        <div className="schedule-title-block">
          <div className="tag-row">
            <span className="badge badge-primary">Cronograma Macro (Acesso Geral)</span>
            <span className="badge badge-pending">Piloto Ministério Shalom</span>
          </div>
          <h1 className="schedule-main-title">{event.title}</h1>
          <p className="schedule-description">
            Visão geral da ordem do culto aberta a todos os membros autorizados da congregação. Acompanhe a sequência,
            durações e a etapa em execução no púlpito em tempo real.
          </p>
        </div>

        <div className="schedule-summary-stats">
          <div className="stat-box">
            <span className="stat-label">Data</span>
            <span className="stat-value">{event.date}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Início Previsto</span>
            <span className="stat-value">{event.scheduledStartTime}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Duração Prevista</span>
            <span className="stat-value">{event.plannedDurationMinutes} min</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Total de Etapas</span>
            <span className="stat-value">{event.activities.length} etapas</span>
          </div>
        </div>
      </div>

      {/* Linha do Tempo Macro das Atividades */}
      <div className="timeline-container">
        {event.activities.map((act, index) => {
          const isCurrent = event.currentActivityIndex === index && event.currentActivityStatus === "em_execucao";
          const isDone = act.status === "concluida";
          const isCancelled = act.status === "cancelada";

          return (
            <div
              key={act.id}
              className={`timeline-card card ${isCurrent ? 'timeline-card-current' : ''}`}
            >
              <div className="timeline-left-column">
                <div className="step-circle-badge">
                  {isDone ? (
                    <CheckCircle2 size={20} color="var(--status-live)" />
                  ) : isCurrent ? (
                    <span className="live-dot-pulse"></span>
                  ) : (
                    <span className="step-number">{index + 1}</span>
                  )}
                </div>
                {index < event.activities.length - 1 && <div className="timeline-connector-line"></div>}
              </div>

              <div className="timeline-content">
                <div className="timeline-header-row">
                  <div className="timeline-title-area">
                    <span className="badge badge-primary">{act.category}</span>
                    <h3 className="act-timeline-title">{act.title}</h3>
                  </div>

                  <div className="timeline-status-badge">
                    {isCurrent ? (
                      <span className="badge badge-live">
                        <span className="live-dot"></span> Em Andamento no Altar
                      </span>
                    ) : isDone ? (
                      <span className="badge badge-primary">
                        Concluído ({act.realEndTime ? `Fim: ${act.realEndTime}` : 'Realizado'})
                      </span>
                    ) : isCancelled ? (
                      <span className="badge badge-cancelled">Cancelado ({act.cancellationReason || "Motivo informado"})</span>
                    ) : (
                      <span className="badge badge-pending">Previsto</span>
                    )}
                  </div>
                </div>

                <div className="timeline-meta-row">
                  <div className="meta-badge-item">
                    <Clock size={14} />
                    <span>Duração Prevista: <strong>{act.plannedDurationMinutes} minutos</strong></span>
                  </div>

                  <div className="meta-badge-item">
                    <User size={14} />
                    <span>Direção / Púlpito: <strong>{act.responsibleMemberId}</strong></span>
                  </div>
                </div>

                {act.notes && (
                  <p className="timeline-notes">
                    "{act.notes}"
                  </p>
                )}

                {/* Bloco Musical Macro (se houver) */}
                {act.musics && act.musics.length > 0 && (
                  <div className="timeline-music-list">
                    <div className="music-list-header">
                      <Music size={14} /> Músicas previstas para esta etapa:
                    </div>
                    <div className="songs-chips">
                      {act.musics.map(m => (
                        <span key={m.id} className="song-pill">
                          {m.name} — <small>{m.artist}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .schedule-view-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .schedule-header-card {
          padding: 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .schedule-title-block {
          max-width: 700px;
        }

        .tag-row {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .schedule-main-title {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 8px;
        }

        .schedule-description {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .schedule-summary-stats {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .stat-box {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          padding: 12px 18px;
          border-radius: var(--radius-md);
          min-width: 120px;
        }

        .stat-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .stat-value {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .timeline-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .timeline-card {
          display: flex;
          gap: 20px;
          padding: 24px;
          position: relative;
        }

        .timeline-card-current {
          border-color: var(--status-live-border);
          background: var(--status-live-bg);
          box-shadow: var(--shadow-sm);
        }

        .timeline-left-column {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 36px;
        }

        .step-circle-badge {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .timeline-card-current .step-circle-badge {
          background: var(--status-live-bg);
          border-color: var(--status-live);
        }

        .live-dot-pulse {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--status-live-dot);
          display: inline-block;
        }

        .timeline-connector-line {
          width: 2px;
          flex: 1;
          background: var(--border-subtle);
          margin-top: 8px;
        }

        .timeline-content {
          flex: 1;
        }

        .timeline-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }

        .timeline-title-area {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .act-timeline-title {
          font-size: 18px;
          font-weight: 700;
        }

        .timeline-meta-row {
          display: flex;
          align-items: center;
          gap: 18px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }

        .meta-badge-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .timeline-notes {
          font-size: 13px;
          color: var(--text-muted);
          font-style: italic;
          margin-bottom: 12px;
        }

        .timeline-music-list {
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          border: 1px solid var(--border-subtle);
        }

        .music-list-header {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          margin-bottom: 6px;
          text-transform: uppercase;
        }

        .songs-chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .song-pill {
          font-size: 12px;
          background: var(--primary-surface);
          color: var(--primary);
          padding: 3px 10px;
          border-radius: var(--radius-full);
          border: 1px solid var(--primary-border);
        }
      `}</style>
    </div>
  );
}
