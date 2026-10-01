import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldAlert,
  CheckSquare,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserX,
  RefreshCw,
  Info,
  Check
} from 'lucide-react';

export default function BackstageView() {
  const {
    event,
    currentUser,
    isLiturgyLeader,
    isAdmin,
    isTeamLeader,
    members,
    teams,
    toggleChecklistItem,
    replaceVolunteerInRoster,
    checkAssignmentConflict,
    isOnline,
    isDataStale
  } = useApp();

  // Filtro de Equipe no Checklist
  const [teamFilter, setTeamFilter] = useState('all');

  // Estado do Modal de Substituição / Ausência (PRD 8)
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [subActivityId, setSubActivityId] = useState(event.activities[1]?.id || '');
  const [subOldMemberId, setSubOldMemberId] = useState('');
  const [subRole, setSubRole] = useState('');
  const [subNewMemberId, setSubNewMemberId] = useState('');
  const [subError, setSubError] = useState('');
  const [subSuccess, setSubSuccess] = useState('');
  const [eligibleCandidates, setEligibleCandidates] = useState([]);

  // Filtragem dos itens de Checklist conforme visibilidade do papel
  const filteredChecklist = event.checklist.filter(item => {
    if (teamFilter !== 'all' && item.targetTeamId !== teamFilter) return false;
    // Se for líder de equipe mas não liturgia/admin, filtra preferencialmente por responsabilidade ou mostra tudo se liturgia
    return true;
  });

  // Preparar abertura do modal de substituição para uma atividade
  const handleOpenSubstitution = (act, rosterItem) => {
    setSubActivityId(act.id);
    setSubOldMemberId(rosterItem.memberId);
    setSubRole(rosterItem.role);
    setSubNewMemberId('');
    setSubError('');
    setSubSuccess('');
    setEligibleCandidates([]);
    setSubModalOpen(true);
  };

  const handleExecuteSubstitution = () => {
    if (!subNewMemberId) {
      setSubError("Por favor, selecione o substituto apto.");
      return;
    }

    const res = replaceVolunteerInRoster(subActivityId, subOldMemberId, subNewMemberId, subRole);
    if (!res.success) {
      setSubError(res.error);
      // Se houver conflito, verificar candidatos sugeridos
      const conflictCheck = checkAssignmentConflict(subNewMemberId, subRole, subActivityId);
      if (conflictCheck.eligibleCandidates) {
        setEligibleCandidates(conflictCheck.eligibleCandidates);
      }
    } else {
      setSubSuccess("Substituição registrada com sucesso no histórico. Não requer aceite eletrônico (PRD 8).");
      setTimeout(() => {
        setSubModalOpen(false);
      }, 1800);
    }
  };

  const isControlsDisabled = !isOnline || isDataStale;

  return (
    <div className="backstage-container">
      {/* Cabeçalho dos Bastidores */}
      <div className="card backstage-header">
        <div>
          <div className="tag-row">
            <span className="badge badge-primary">Bastidores & Gestão (PRD 10.1)</span>
            {isLiturgyLeader ? (
              <span className="badge badge-live">Visão Completa do Evento (Líder da Liturgia)</span>
            ) : isTeamLeader ? (
              <span className="badge badge-pending">Visão Setorial da Liderança</span>
            ) : (
              <span className="badge badge-cancelled">Visualização Restrita</span>
            )}
          </div>
          <h1 className="backstage-title">Bastidores do Culto & Checklist de Preparação</h1>
          <p className="backstage-subtitle">
            Acompanhamento das pendências operacionais, validações conjuntas (ex: Louvor + Sonoplastia) e
            registro de ausências e substituições combinadas externamente.
          </p>
        </div>

        <div className="backstage-summary-chip">
          <ShieldAlert size={28} color="var(--primary)" />
          <div>
            <div className="chip-val">
              {event.checklist.filter(c => !c.completed).length} Pendências
            </div>
            <div className="chip-sub">no checklist técnico</div>
          </div>
        </div>
      </div>

      <div className="backstage-grid">
        {/* COLUNA ESQUERDA: CHECKLIST SIMPLES E CONJUNTO (PRD 9.3) */}
        <div className="checklist-column">
          <div className="card">
            <div className="section-header-row">
              <div className="section-title-box">
                <CheckSquare size={18} color="var(--primary)" />
                <h2>Checklist de Preparação (PRD 9.3)</h2>
              </div>

              {/* Filtro por Equipe */}
              <div className="filter-pill-group">
                <button
                  className={`pill-btn ${teamFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTeamFilter('all')}
                >
                  Todos
                </button>
                <button
                  className={`pill-btn ${teamFilter === 'som' ? 'active' : ''}`}
                  onClick={() => setTeamFilter('som')}
                >
                  Sonoplastia
                </button>
                <button
                  className={`pill-btn ${teamFilter === 'midia' ? 'active' : ''}`}
                  onClick={() => setTeamFilter('midia')}
                >
                  Mídia
                </button>
                <button
                  className={`pill-btn ${teamFilter === 'liturgia' ? 'active' : ''}`}
                  onClick={() => setTeamFilter('liturgia')}
                >
                  Liturgia
                </button>
              </div>
            </div>

            <p className="section-desc">
              Itens simples exigem uma marcação. Itens conjuntos exigem validação de duas lideranças envolvidas
              (ex: entrega e verificação da música de louvor/playback pela sonoplastia, PRD 9.3).
            </p>

            <div className="checklist-items-list">
              {filteredChecklist.map(item => {
                const act = event.activities.find(a => a.id === item.activityId);

                return (
                  <div
                    key={item.id}
                    className={`checklist-card-item ${item.completed ? 'completed' : 'pending'}`}
                  >
                    <div className="check-main-row">
                      <div className="check-title-col">
                        <div className="check-item-title">{item.title}</div>
                        <div className="check-item-meta">
                          Vinculado à etapa: <strong>{act?.title || "Geral"}</strong> • Equipe: <strong>{item.targetTeamId}</strong>
                        </div>
                      </div>

                      <div className="check-status-badge">
                        {item.completed ? (
                          <span className="badge badge-primary">
                            <CheckCircle2 size={13} /> Preparação Pronta
                          </span>
                        ) : (
                          <span className="badge badge-pending">
                            <Clock size={13} /> Pendente
                          </span>
                        )}
                      </div>
                    </div>

                    {/* SE FOR ITEM CONJUNTO (Validação Dupla - PRD 9.3 & M46) */}
                    {item.isJoint ? (
                      <div className="joint-validation-box">
                        <div className="joint-label">
                          <AlertTriangle size={14} color="#f59e0b" />
                          <span>Validação Conjunta Exigida (2 Lideranças):</span>
                        </div>

                        <div className="validators-grid">
                          <div className={`validator-badge ${item.validation1 ? 'valid' : 'pending'}`}>
                            <span className="val-circle">{item.validation1 ? '✓' : '1'}</span>
                            <div className="val-text">
                              <span className="val-title">Líder de Louvor ({item.secondLeaderId})</span>
                              <span className="val-state">
                                {item.validation1 ? `Confirmou entrega às ${item.validation1At || '18:40'}` : 'Aguardando validação'}
                              </span>
                            </div>
                          </div>

                          <div className={`validator-badge ${item.validation2 ? 'valid' : 'pending'}`}>
                            <span className="val-circle">{item.validation2 ? '✓' : '2'}</span>
                            <div className="val-text">
                              <span className="val-title">Líder Sonoplastia ({item.assignedLeaderId})</span>
                              <span className="val-state">
                                {item.validation2 ? `Confirmou recebimento às ${item.validation2At || '18:50'}` : 'Aguardando teste na mesa'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          className="btn btn-sm btn-secondary toggle-check-btn"
                          onClick={() => toggleChecklistItem(item.id)}
                          disabled={isControlsDisabled}
                        >
                          Confirmar Minha Validação / Alternar
                        </button>
                      </div>
                    ) : (
                      /* ITEM SIMPLES */
                      <div className="simple-check-actions">
                        <button
                          className={`btn btn-sm ${item.completed ? 'btn-secondary' : 'btn-success'}`}
                          onClick={() => toggleChecklistItem(item.id)}
                          disabled={isControlsDisabled}
                        >
                          {item.completed ? 'Marcar como Pendente' : 'Marcar como Pronto'}
                        </button>
                        {item.confirmedBy && (
                          <span className="confirmed-by-text">
                            Confirmado por {item.confirmedBy} às {item.confirmedAt}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* COLUNA DIREITA: GESTÃO DE ESCALAS, AUSÊNCIAS E SUBSTITUIÇÕES (PRD 8) */}
        <div className="roster-management-column">
          <div className="card">
            <div className="section-title-box">
              <Users size={18} color="var(--primary)" />
              <h2>Escala Nominal & Substituições (PRD 8)</h2>
            </div>

            <p className="section-desc">
              Antes do início da atividade, o líder de equipe pode realocar pessoas. Durante a execução, apenas o Líder da Liturgia pode registrar substituições (M20/M21).
            </p>

            <div className="activities-roster-list">
              {event.activities.map(act => {
                if (!act.roster || act.roster.length === 0) return null;
                const isRunning = act.status === 'em_execucao';

                return (
                  <div key={act.id} className="act-roster-block">
                    <div className="roster-block-header">
                      <div>
                        <div className="block-title">{act.title}</div>
                        <div className="block-meta">
                          {act.category} • Estado: <strong>{act.status}</strong>
                        </div>
                      </div>
                      {isRunning && (
                        <span className="badge badge-live">Em Execução (Apenas Liturgia Substitui)</span>
                      )}
                    </div>

                    <div className="volunteers-sub-list">
                      {act.roster.map((r, rIdx) => {
                        const memberObj = members.find(m => m.id === r.memberId);

                        return (
                          <div key={rIdx} className="volunteer-sub-row">
                            <div className="vol-info">
                              <img src={memberObj?.avatar} alt={memberObj?.name} className="vol-mini-avatar" />
                              <div>
                                <div className="vol-name">{memberObj?.name || r.memberId}</div>
                                <div className="vol-role">{r.role}</div>
                              </div>
                            </div>

                            <button
                              className="btn btn-sm btn-secondary sub-btn"
                              onClick={() => handleOpenSubstitution(act, r)}
                              disabled={isControlsDisabled}
                              title="Registrar substituição combinada externamente"
                            >
                              <RefreshCw size={13} /> Substituir
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DE SUBSTITUIÇÃO COM VALIDAÇÃO RÍGIDA DE CONFLITO (PRD 5.2 & 8) */}
      {subModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Registrar Ausência / Substituição</h3>
              <button className="close-btn" onClick={() => setSubModalOpen(false)}>✕</button>
            </div>

            <p className="modal-desc">
              O líder combina a substituição fora do aplicativo e registra a pessoa apta. <strong>Não há exigência de aceite eletrônico</strong> (PRD 8).
              O sistema verifica e bloqueia conflitos de escala automaticamente.
            </p>

            {subError && (
              <div className="error-banner">
                <AlertTriangle size={16} />
                <div>
                  <strong>Impedimento:</strong>
                  <div style={{ marginTop: '4px' }}>{subError}</div>
                </div>
              </div>
            )}

            {subSuccess && (
              <div className="success-banner">
                <CheckCircle2 size={16} />
                <span>{subSuccess}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Função / Responsabilidade:</label>
              <input type="text" className="form-input" value={subRole} disabled />
            </div>

            <div className="form-group">
              <label className="form-label">Membro Ausente / A Substituir:</label>
              <input
                type="text"
                className="form-input"
                value={members.find(m => m.id === subOldMemberId)?.name || subOldMemberId}
                disabled
              />
            </div>

            <div className="form-group">
              <label className="form-label">Selecione o Substituto Habilitado:</label>
              <select
                className="form-select"
                value={subNewMemberId}
                onChange={e => {
                  setSubNewMemberId(e.target.value);
                  setSubError('');
                }}
              >
                <option value="">-- Selecione uma pessoa cadastrada --</option>
                {members
                  .filter(m => m.id !== subOldMemberId && m.active)
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} — Aptidões: {m.skills.join(', ')}
                    </option>
                  ))}
              </select>
            </div>

            {/* SE HOUVER CANDIDATOS SUGERIDOS SEM CONFLITO (PRD 5.2 & Cenário M22) */}
            {eligibleCandidates.length > 0 && (
              <div className="suggested-candidates-box">
                <div className="sugg-header">
                  <Info size={14} color="var(--primary)" />
                  <span>Candidatos habilitados sem conflito conhecido na escala:</span>
                </div>
                <div className="sugg-list">
                  {eligibleCandidates.map(cand => (
                    <button
                      key={cand.id}
                      className="candidate-quick-pick"
                      onClick={() => {
                        setSubNewMemberId(cand.id);
                        setSubError('');
                      }}
                    >
                      <span>{cand.name}</span>
                      <small>Selecionar</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSubModalOpen(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleExecuteSubstitution}>
                Confirmar Substituição no Histórico
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .backstage-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .backstage-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 28px;
          gap: 24px;
          flex-wrap: wrap;
        }

        .backstage-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .backstage-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 700px;
          line-height: 1.5;
        }

        .backstage-summary-chip {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          background: var(--primary-surface);
          border: 1px solid var(--border-active);
          border-radius: var(--radius-lg);
        }

        .chip-val {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .chip-sub {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .backstage-grid {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 24px;
        }

        @media (max-width: 1024px) {
          .backstage-grid {
            grid-template-columns: 1fr;
          }
        }

        .section-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }

        .section-title-box {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .section-title-box h2 {
          font-size: 18px;
          font-weight: 700;
        }

        .section-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 20px;
          line-height: 1.4;
        }

        .filter-pill-group {
          display: flex;
          gap: 6px;
        }

        .pill-btn {
          padding: 4px 10px;
          border-radius: var(--radius-full);
          font-size: 12px;
          font-weight: 600;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          cursor: pointer;
        }

        .pill-btn.active {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }

        .checklist-items-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .checklist-card-item {
          padding: 16px;
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          transition: all var(--transition-fast);
        }

        .checklist-card-item.completed {
          border-color: rgba(16, 185, 129, 0.3);
        }

        .check-main-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .check-item-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .check-item-meta {
          font-size: 12px;
          color: var(--text-muted);
        }

        .joint-validation-box {
          margin-top: 12px;
          padding: 12px;
          background: rgba(245, 158, 11, 0.06);
          border: 1px solid rgba(245, 158, 11, 0.2);
          border-radius: var(--radius-sm);
        }

        .joint-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #fbbf24;
          margin-bottom: 8px;
        }

        .validators-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 10px;
        }

        @media (max-width: 600px) {
          .validators-grid {
            grid-template-columns: 1fr;
          }
        }

        .validator-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          background: var(--bg-inset);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-subtle);
        }

        .validator-badge.valid {
          border-color: rgba(16, 185, 129, 0.4);
          background: rgba(16, 185, 129, 0.08);
        }

        .val-circle {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--bg-surface);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
        }

        .validator-badge.valid .val-circle {
          background: #10b981;
          color: white;
        }

        .val-title {
          font-size: 12px;
          font-weight: 700;
          display: block;
        }

        .val-state {
          font-size: 11px;
          color: var(--text-muted);
        }

        .simple-check-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
        }

        .confirmed-by-text {
          font-size: 11px;
          color: var(--text-muted);
        }

        .activities-roster-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .act-roster-block {
          padding: 14px;
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }

        .roster-block-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .block-title {
          font-size: 14px;
          font-weight: 700;
        }

        .block-meta {
          font-size: 11px;
          color: var(--text-muted);
        }

        .volunteers-sub-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .volunteer-sub-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: var(--bg-inset);
          border-radius: var(--radius-sm);
        }

        .vol-info {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .vol-mini-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
        }

        .vol-name {
          font-size: 13px;
          font-weight: 600;
        }

        .vol-role {
          font-size: 11px;
          color: var(--text-muted);
        }

        .sub-btn {
          font-size: 11px;
          padding: 4px 8px;
        }

        .suggested-candidates-box {
          margin-top: 14px;
          padding: 12px;
          background: var(--primary-surface);
          border: 1px solid var(--border-active);
          border-radius: var(--radius-md);
        }

        .sugg-header {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: var(--primary-light);
          margin-bottom: 8px;
        }

        .sugg-list {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .candidate-quick-pick {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: var(--radius-full);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 12px;
          cursor: pointer;
        }

        .candidate-quick-pick:hover {
          background: var(--primary);
          color: white;
        }

        .candidate-quick-pick small {
          opacity: 0.7;
          font-size: 10px;
        }

        .success-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.4);
          border-radius: var(--radius-md);
          color: #34d399;
          font-size: 13px;
          margin-bottom: 16px;
        }
      `}</style>
    </div>
  );
}
