import React from 'react';
import { useApp } from '../context/AppContext';
import { UserCheck, Clock, Music, AlertCircle, ExternalLink, Calendar, MapPin } from 'lucide-react';

export default function MyScheduleView() {
  const { event, currentUser } = useApp();

  // Encontrar todas as participações do usuário logado
  const scheduledAssignments = [];

  // 1. Verificar atividades onde o usuário está no Roster nominal
  event.activities.forEach((act, actIdx) => {
    if (act.roster) {
      act.roster.forEach(r => {
        if (r.memberId === currentUser.id) {
          scheduledAssignments.push({
            type: "roster",
            activity: act,
            actIndex: actIdx,
            role: r.role,
            isResponsible: act.responsibleMemberId === currentUser.id
          });
        }
      });
    } else if (act.responsibleMemberId === currentUser.id) {
      scheduledAssignments.push({
        type: "responsible",
        activity: act,
        actIndex: actIdx,
        role: "Responsável Litúrgico / Direção",
        isResponsible: true
      });
    }
  });

  // 2. Verificar se está em Serviços Paralelos (Sonoplastia ou Transmissão)
  event.parallelServices.forEach(serv => {
    if (serv.volunteers.includes(currentUser.id)) {
      scheduledAssignments.push({
        type: "parallel",
        service: serv,
        role: serv.name,
        prepMinutes: serv.prepRequiredMinutes
      });
    }
  });

  return (
    <div className="my-schedule-container">
      {/* Cabeçalho Personalizado */}
      <div className="card my-schedule-header">
        <div className="user-profile-badge">
          <img src={currentUser.avatar} alt={currentUser.name} className="header-avatar" />
          <div>
            <div className="tag-row">
              <span className="badge badge-primary">Minha Escala Nominal (PRD 10.1)</span>
              <span className="badge badge-pending">Consulta Individual</span>
            </div>
            <h1 className="header-user-title">{currentUser.name}</h1>
            <p className="header-user-desc">
              Esta é a sua ficha de participação nominal para o <strong>{event.title}</strong>.
              Consulte suas funções, horários, músicas com tom e notas de ensaio.
            </p>
          </div>
        </div>

        <div className="church-time-card">
          <div className="time-line">
            <Calendar size={15} /> <strong>{event.date}</strong> às <strong>{event.scheduledStartTime}</strong>
          </div>
          <div className="time-line">
            <MapPin size={15} /> Santuário Principal — Ministério Shalom
          </div>
          <div className="time-notice">
            Chegada recomendada: 30 a 45 min antes do início para comunhão e oração.
          </div>
        </div>
      </div>

      {/* Lista de Atribuições */}
      {scheduledAssignments.length > 0 ? (
        <div className="assignments-grid">
          {scheduledAssignments.map((assign, idx) => {
            if (assign.type === "parallel") {
              return (
                <div key={`par-${idx}`} className="card assignment-card parallel-assignment">
                  <div className="card-top-bar">
                    <span className="badge badge-primary">Serviço Paralelo Contínuo</span>
                    <span className="badge badge-pending">Ocupa todo o culto</span>
                  </div>

                  <h2 className="assignment-role-title">{assign.service.name}</h2>
                  <p className="assignment-meta-text">
                    Equipe de Apoio: <strong>{assign.service.volunteers.join(', ')}</strong>
                  </p>

                  <div className="service-prep-notice">
                    <Clock size={16} color="#6366f1" />
                    <div>
                      <strong>Preparação Técnica:</strong> Estar a postos {assign.prepMinutes} minutos antes do início do culto
                      para checagem de cabos, mesa de som e link de streaming.
                    </div>
                  </div>
                </div>
              );
            }

            const act = assign.activity;
            return (
              <div key={`act-${idx}`} className="card assignment-card">
                <div className="card-top-bar">
                  <span className="badge badge-primary">{act.category}</span>
                  <span className="badge badge-live">Etapa {assign.actIndex + 1} da Ordem</span>
                </div>

                <div className="assignment-header-details">
                  <div className="role-chip">Sua Função: <strong>{assign.role}</strong></div>
                  <h2 className="assignment-role-title">{act.title}</h2>
                  <div className="assignment-meta-text">
                    Duração prevista da etapa: <strong>{act.plannedDurationMinutes} min</strong> • Direção da etapa: {act.responsibleMemberId}
                  </div>
                </div>

                {act.notes && (
                  <div className="assignment-notes-box">
                    <strong>Orientação da Liderança:</strong> "{act.notes}"
                  </div>
                )}

                {/* Músicas detalhadas se houver (PRD 9.1) */}
                {act.musics && act.musics.length > 0 && (
                  <div className="assignment-musics-section">
                    <h3 className="musics-sec-title">
                      <Music size={16} /> Músicas do seu repertório nesta etapa:
                    </h3>
                    <div className="musics-detailed-list">
                      {act.musics.map(m => (
                        <div key={m.id} className="detailed-music-card">
                          <div className="music-main-info">
                            <span className="music-name-text">{m.name}</span>
                            <span className="music-key-pill">Tom de Execução: <strong>{m.key}</strong></span>
                          </div>

                          <div className="music-artist-text">Intérprete de Referência: {m.artist}</div>

                          {m.notes && (
                            <div className="music-arrangement-note">
                              <strong>Arranjo / Dinâmica:</strong> {m.notes}
                            </div>
                          )}

                          {m.youtubeUrl && (
                            <a
                              href={m.youtubeUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-sm btn-secondary youtube-link-btn"
                            >
                              <ExternalLink size={13} /> Abrir Referência do YouTube
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="readonly-consultation-footer">
                  <AlertCircle size={14} color="var(--text-muted)" />
                  <span>
                    Conforme o PRD 3.2, esta tela é estritamente para consulta. Qualquer ajuste de tom ou escala deve ser
                    alinhado diretamente com sua liderança de equipe fora do sistema.
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card not-scheduled-card">
          <UserCheck size={48} color="var(--text-muted)" />
          <h3>Você não está escalado neste culto</h3>
          <p>
            Olá, <strong>{currentUser.name}</strong>! Você possui acesso autorizado à igreja, mas não foi escalado
            para nenhuma função nominal no culto de {event.date}.
          </p>
          <p className="not-sched-sub">
            Você pode acompanhar toda a liturgia e programação geral através da aba <strong>Cronograma Macro</strong>.
          </p>
        </div>
      )}

      <style>{`
        .my-schedule-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .my-schedule-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 28px;
          gap: 24px;
          flex-wrap: wrap;
        }

        .user-profile-badge {
          display: flex;
          align-items: center;
          gap: 20px;
          max-width: 650px;
        }

        .header-avatar {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid var(--border-active);
        }

        .header-user-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .header-user-desc {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .church-time-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-subtle);
          padding: 16px 20px;
          border-radius: var(--radius-md);
        }

        .time-line {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .time-notice {
          font-size: 11px;
          color: var(--primary-light);
          margin-top: 8px;
          font-weight: 600;
        }

        .assignments-grid {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .assignment-card {
          padding: 28px;
        }

        .parallel-assignment {
          border-left: 4px solid var(--primary);
        }

        .card-top-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .role-chip {
          display: inline-block;
          font-size: 13px;
          color: var(--primary-light);
          margin-bottom: 6px;
        }

        .assignment-role-title {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .assignment-meta-text {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .assignment-notes-box {
          margin: 16px 0;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          font-size: 13px;
          color: var(--text-secondary);
        }

        .service-prep-notice {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid var(--border-active);
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .assignment-musics-section {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid var(--border-subtle);
        }

        .musics-sec-title {
          font-size: 14px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
          color: var(--text-primary);
        }

        .musics-detailed-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px;
        }

        .detailed-music-card {
          padding: 16px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .music-main-info {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 4px;
        }

        .music-name-text {
          font-size: 15px;
          font-weight: 700;
        }

        .music-key-pill {
          font-size: 12px;
          background: rgba(99, 102, 241, 0.2);
          color: var(--primary-light);
          padding: 3px 8px;
          border-radius: var(--radius-sm);
        }

        .music-artist-text {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .music-arrangement-note {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 8px;
          line-height: 1.4;
        }

        .youtube-link-btn {
          margin-top: 12px;
          display: inline-flex;
        }

        .readonly-consultation-footer {
          margin-top: 24px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted);
          padding-top: 14px;
          border-top: 1px solid var(--border-subtle);
        }

        .not-scheduled-card {
          padding: 60px 24px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .not-scheduled-card h3 {
          font-size: 20px;
          font-weight: 700;
        }

        .not-scheduled-card p {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 500px;
        }

        .not-sched-sub {
          font-size: 13px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
