import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Sliders,
  Plus,
  Clock,
  AlertTriangle,
  Music,
  Users,
  Check,
  ExternalLink,
  Trash2,
  Edit,
  Radio,
  Info
} from 'lucide-react';

export default function PlanningView() {
  const {
    event,
    setEvent,
    totalPlannedDurationMinutes,
    durationOverflowMinutes,
    currentUser,
    isLiturgyLeader,
    isAdmin,
    isTeamLeader,
    members,
    teams,
    checkAssignmentConflict,
    addAuditLog,
    isOnline,
    isDataStale
  } = useApp();

  // Modais de Criação / Edição de Atividade
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState('Liturgia');
  const [formDuration, setFormDuration] = useState(10);
  const [formResponsible, setFormResponsible] = useState('carlos');
  const [formNotes, setFormNotes] = useState('');
  const [formRequiresPlayback, setFormRequiresPlayback] = useState(false);

  // Modal de Adicionar Música (PRD 9.1)
  const [musicModalOpen, setMusicModalOpen] = useState(false);
  const [targetActivityForMusic, setTargetActivityForMusic] = useState(null);
  const [songName, setSongName] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [songKey, setSongKey] = useState('G');
  const [songYoutube, setSongYoutube] = useState('');
  const [songNotes, setSongNotes] = useState('');

  // Modal de Conflito de Alocação de Escala (PRD 5.2 / Cenário M22)
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] = useState({ reason: '', candidates: [] });

  // Abertura do Modal de Atividade
  const openNewActivityModal = () => {
    setEditingActivityId(null);
    setFormTitle('');
    setFormCategory('Liturgia');
    setFormDuration(10);
    setFormResponsible('carlos');
    setFormNotes('');
    setFormRequiresPlayback(false);
    setActivityModalOpen(true);
  };

  const openEditActivityModal = (act) => {
    setEditingActivityId(act.id);
    setFormTitle(act.title);
    setFormCategory(act.category);
    setFormDuration(act.plannedDurationMinutes);
    setFormResponsible(act.responsibleMemberId);
    setFormNotes(act.notes || '');
    setFormRequiresPlayback(act.requiresPlayback || false);
    setActivityModalOpen(true);
  };

  const handleSaveActivity = () => {
    if (!formTitle) return;

    if (editingActivityId) {
      // Edição
      setEvent(prev => ({
        ...prev,
        activities: prev.activities.map(a => {
          if (a.id === editingActivityId) {
            return {
              ...a,
              title: formTitle,
              category: formCategory,
              plannedDurationMinutes: parseInt(formDuration) || 5,
              responsibleMemberId: formResponsible,
              notes: formNotes,
              requiresPlayback: formRequiresPlayback
            };
          }
          return a;
        })
      }));
      addAuditLog("Edição de Atividade", `Atividade '${formTitle}' atualizada no planejamento.`);
    } else {
      // Criação de Nova Atividade
      const newAct = {
        id: "act-" + Date.now(),
        title: formTitle,
        category: formCategory,
        plannedDurationMinutes: parseInt(formDuration) || 5,
        responsibleMemberId: formResponsible,
        responsibleTeamId: "liturgia",
        status: "pendente",
        notes: formNotes,
        requiresPlayback: formRequiresPlayback,
        musics: [],
        roster: []
      };

      setEvent(prev => ({
        ...prev,
        activities: [...prev.activities, newAct]
      }));

      addAuditLog("Nova Atividade Planejada", `Atividade '${formTitle}' (${formDuration} min) adicionada à ordem.`);
    }

    setActivityModalOpen(false);
  };

  // Salvar Música na Ficha da Atividade (PRD 9.1)
  const handleSaveMusic = () => {
    if (!songName || !targetActivityForMusic) return;

    const newMusic = {
      id: "m-" + Date.now(),
      name: songName,
      artist: songArtist,
      key: songKey,
      youtubeUrl: songYoutube,
      notes: songNotes
    };

    setEvent(prev => ({
      ...prev,
      activities: prev.activities.map(a => {
        if (a.id === targetActivityForMusic.id) {
          return {
            ...a,
            musics: [...(a.musics || []), newMusic]
          };
        }
        return a;
      })
    }));

    addAuditLog(
      "Música Adicionada",
      `Música '${songName}' (${songArtist}, Tom ${songKey}) vinculada à etapa '${targetActivityForMusic.title}'.`
    );

    setMusicModalOpen(false);
  };

  // Testar Simulação de Alocação de Escala com Conflito (PRD 5.2 & Cenário M22)
  const simulateAssignVolunteer = (activityId, memberId, role) => {
    const conflict = checkAssignmentConflict(memberId, role, activityId);
    if (conflict.hasConflict) {
      setConflictData({
        reason: conflict.reason,
        candidates: conflict.eligibleCandidates || []
      });
      setConflictModalOpen(true);
      return;
    }

    // Se não tiver conflito, insere no roster
    setEvent(prev => ({
      ...prev,
      activities: prev.activities.map(a => {
        if (a.id === activityId) {
          return {
            ...a,
            roster: [...(a.roster || []), { memberId, role }]
          };
        }
        return a;
      })
    }));

    addAuditLog("Voluntário Escalado", `Membro escalado como '${role}' na atividade.`);
  };

  const isControlsDisabled = !isOnline || isDataStale;

  return (
    <div className="planning-view-container">
      {/* Cabeçalho do Planejamento & Medidor de Duração (PRD 6) */}
      <div className="card planning-header-card">
        <div>
          <div className="tag-row">
            <span className="badge badge-primary">Planejamento Litúrgico (Web)</span>
            <span className="badge badge-pending">Sequência Principal</span>
          </div>
          <h1 className="planning-title">Planejamento da Ordem & Duração do Culto</h1>
          <p className="planning-subtitle">
            Estruture a sequência litúrgica, músicas e escalas nominais. Serviços paralelos (transmissão/som)
            e componentes simultâneos do louvor não duplicam a duração (PRD 6 & Cenário M25).
          </p>
        </div>

        {/* ALERTA DE DURAÇÃO EXCEDIDA IGNORÁVEL (PRD 6 & Cenário M26) */}
        <div className="duration-gauge-box">
          <div className="gauge-row">
            <div className="gauge-item">
              <span className="gauge-label">Previsto para o Culto:</span>
              <span className="gauge-val">{event.plannedDurationMinutes} min</span>
            </div>
            <div className="gauge-item">
              <span className="gauge-label">Soma da Sequência:</span>
              <span className={`gauge-val ${durationOverflowMinutes > 0 ? 'text-warning' : 'text-success'}`}>
                {totalPlannedDurationMinutes} min
              </span>
            </div>
            <div className="gauge-item">
              <span className="gauge-label">Saldo de Duração:</span>
              <span className={`gauge-val ${durationOverflowMinutes > 0 ? 'text-danger' : 'text-success'}`}>
                {durationOverflowMinutes > 0 ? `+${durationOverflowMinutes} min (Excesso)` : `${event.plannedDurationMinutes - totalPlannedDurationMinutes} min livres`}
              </span>
            </div>
          </div>

          {durationOverflowMinutes > 0 && (
            <div className="ignorable-overflow-banner">
              <AlertTriangle size={15} color="#fbbf24" />
              <span>
                <strong>Alerta Ignorável (PRD 6 / M26):</strong> A programação excede o culto em {durationOverflowMinutes} min.
                Você pode salvar e publicar normalmente sem exigir aprovação ou justificativa.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Barra de Ações & Lista de Atividades */}
      <div className="planning-actions-bar">
        <div className="actions-left">
          <h2>Etapas Planejadas ({event.activities.length})</h2>
        </div>

        <button
          className="btn btn-primary"
          onClick={openNewActivityModal}
          disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
        >
          <Plus size={16} /> Adicionar Nova Etapa Litúrgica
        </button>
      </div>

      <div className="planning-activities-list">
        {event.activities.map((act, index) => (
          <div key={act.id} className="card planning-activity-card">
            <div className="planning-act-left">
              <span className="act-index-pill">{index + 1}</span>
              <div>
                <div className="act-header-tags">
                  <span className="badge badge-primary">{act.category}</span>
                  <span className="act-duration-tag">
                    <Clock size={13} /> {act.plannedDurationMinutes} minutos
                  </span>
                  {act.requiresPlayback && (
                    <span className="badge badge-pending">
                      <Radio size={12} /> Requer Playback (Avisa Sonoplastia)
                    </span>
                  )}
                </div>
                <h3 className="planning-act-title">{act.title}</h3>
                <div className="planning-act-meta">
                  Direção no altar: <strong>{act.responsibleMemberId}</strong>
                </div>
                {act.notes && <p className="planning-notes-text">"{act.notes}"</p>}
              </div>
            </div>

            {/* Seção de Músicas & Escalas */}
            <div className="planning-act-right">
              {/* Ficha Musical (PRD 9.1) */}
              <div className="musics-planning-box">
                <div className="sec-small-title">
                  <span>Músicas Cadastradas ({act.musics?.length || 0})</span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      setTargetActivityForMusic(act);
                      setSongName('');
                      setSongArtist('');
                      setSongKey('G');
                      setSongYoutube('');
                      setSongNotes('');
                      setMusicModalOpen(true);
                    }}
                    disabled={isControlsDisabled}
                  >
                    <Plus size={12} /> Adicionar Música
                  </button>
                </div>

                {act.musics && act.musics.length > 0 ? (
                  <div className="mini-music-chips">
                    {act.musics.map(m => (
                      <div key={m.id} className="planning-music-chip">
                        <div>
                          <strong>{m.name}</strong> • Tom {m.key} ({m.artist})
                        </div>
                        {m.youtubeUrl && (
                          <a href={m.youtubeUrl} target="_blank" rel="noreferrer" className="chip-link">
                            YouTube ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="no-music-hint">Nenhuma música vinculada.</div>
                )}
              </div>

              {/* Botões de Ação da Etapa */}
              <div className="act-manage-buttons">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => openEditActivityModal(act)}
                  disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
                >
                  <Edit size={13} /> Editar
                </button>

                {/* Botão de Demonstração de Conflito Litúrgico (PRD 5.2 / Cenário M22) */}
                {act.category === "Louvor" && (
                  <button
                    className="btn btn-sm btn-warning"
                    onClick={() => simulateAssignVolunteer(act.id, "beatriz", "Louvor - Canto")}
                    title="Simula tentar escalar Beatriz (já na Dança) para Canto no mesmo louvor (Cenário M22)"
                  >
                    Testar Conflito (M22)
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE ATIVIDADE */}
      {activityModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">
                {editingActivityId ? 'Editar Etapa Litúrgica' : 'Nova Etapa Litúrgica'}
              </h3>
              <button className="close-btn" onClick={() => setActivityModalOpen(false)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Título da Atividade:</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Cânticos Congregacionais"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Categoria / Bloco:</label>
                <select
                  className="form-select"
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                >
                  <option value="Liturgia">Liturgia</option>
                  <option value="Louvor">Louvor & Adoração</option>
                  <option value="Música Especial">Música Especial / Solo</option>
                  <option value="Mensagem">Mensagem da Palavra</option>
                  <option value="Oração">Oração / Apelo</option>
                  <option value="Avisos">Comunicação e Avisos</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Duração Planejada (Minutos):</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max="120"
                  value={formDuration}
                  onChange={e => setFormDuration(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Responsável pela Direção no Altar:</label>
              <select
                className="form-select"
                value={formResponsible}
                onChange={e => setFormResponsible(e.target.value)}
              >
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.teams.join(', ')})</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Observações / Orientações:</label>
              <textarea
                className="form-textarea"
                rows="2"
                placeholder="Orientações aos voluntários..."
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
              ></textarea>
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={formRequiresPlayback}
                  onChange={e => setFormRequiresPlayback(e.target.checked)}
                />
                <span><strong>Requer Playback de Apoio</strong> (Dispara aviso automático para a Sonoplastia, PRD 9.2)</span>
              </label>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActivityModalOpen(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSaveActivity}>
                Salvar Etapa no Planejamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ADICIONAR MÚSICA (PRD 9.1 & Cenário M30) */}
      {musicModalOpen && targetActivityForMusic && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Ficha Simples de Música — {targetActivityForMusic.title}</h3>
              <button className="close-btn" onClick={() => setMusicModalOpen(false)}>✕</button>
            </div>

            <p className="modal-desc">
              Cadastre nome, intérprete de referência, tom de execução e URL do YouTube (PRD 9.1).
              A miniatura é exibida automaticamente se disponível; na indisponibilidade, o link e título continuam funcionais (M30).
            </p>

            <div className="form-group">
              <label className="form-label">Nome da Música:</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Bondade de Deus"
                value={songName}
                onChange={e => setSongName(e.target.value)}
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Cantor / Intérprete de Referência:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: Isaías Saad"
                  value={songArtist}
                  onChange={e => setSongArtist(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tom Escolhido para o Culto:</label>
                <select
                  className="form-select"
                  value={songKey}
                  onChange={e => setSongKey(e.target.value)}
                >
                  {["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B", "Em", "Am", "Dm"].map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">URL do YouTube:</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={songYoutube}
                onChange={e => setSongYoutube(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Observação Curta de Arranjo / Dinâmica:</label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: Entrar suave com teclado e violão..."
                value={songNotes}
                onChange={e => setSongNotes(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setMusicModalOpen(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSaveMusic}>
                Vincular Música ao Bloco
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE INTERCEPTAÇÃO DE CONFLITO LITÚRGICO (PRD 5.2 & Cenário M22) */}
      {conflictModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} /> Bloqueio de Conflito de Escala (PRD 5.2)
              </h3>
              <button className="close-btn" onClick={() => setConflictModalOpen(false)}>✕</button>
            </div>

            <div className="error-banner">
              {conflictData.reason}
            </div>

            <p className="modal-desc">
              Conforme o <strong>PRD 5.2 (Cenário M22)</strong>: Ao tentar escalar alguém para cantar no louvor quando já está
              na dança, o sistema <strong>bloqueia essa alocação</strong>, explica o impedimento e lista os habilitados
              para cantar sem conflito na escala.
            </p>

            <div className="sugg-header">
              <Info size={14} color="#6366f1" />
              <span>Candidatos habilitados sem conflito conhecido na escala:</span>
            </div>

            <div className="eligible-candidates-list">
              {conflictData.candidates.length > 0 ? (
                conflictData.candidates.map(cand => (
                  <div key={cand.id} className="candidate-card-row">
                    <img src={cand.avatar} alt={cand.name} className="cand-avatar" />
                    <div className="cand-info">
                      <div className="cand-name">{cand.name}</div>
                      <div className="cand-skills">Aptidões: {cand.skills.join(', ')}</div>
                    </div>
                    <span className="badge badge-primary">Apto e Livre</span>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Nenhum outro candidato com essa aptidão encontrado no cadastro.
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setConflictModalOpen(false)}>
                Entendido, Manter Regra Litúrgica
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .planning-view-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .planning-header-card {
          padding: 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .planning-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .planning-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 650px;
          line-height: 1.5;
        }

        .duration-gauge-box {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border-subtle);
          padding: 16px 20px;
          border-radius: var(--radius-lg);
          min-width: 320px;
        }

        .gauge-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
        }

        .gauge-item {
          display: flex;
          flex-direction: column;
        }

        .gauge-label {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 600;
        }

        .gauge-val {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .ignorable-overflow-banner {
          margin-top: 10px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: var(--radius-sm);
          font-size: 11px;
          color: #fbbf24;
          line-height: 1.4;
        }

        .planning-actions-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-top: 8px;
        }

        .planning-actions-bar h2 {
          font-size: 20px;
          font-weight: 700;
        }

        .planning-activities-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .planning-activity-card {
          padding: 24px;
          display: flex;
          justify-content: space-between;
          gap: 24px;
          flex-wrap: wrap;
        }

        .planning-act-left {
          display: flex;
          gap: 16px;
          flex: 1;
          min-width: 300px;
        }

        .act-index-pill {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.15);
          color: var(--primary-light);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 14px;
        }

        .act-header-tags {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }

        .act-duration-tag {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 600;
        }

        .planning-act-title {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .planning-act-meta {
          font-size: 13px;
          color: var(--text-muted);
        }

        .planning-notes-text {
          font-size: 12px;
          color: var(--text-secondary);
          font-style: italic;
          margin-top: 8px;
        }

        .planning-act-right {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 320px;
        }

        .musics-planning-box {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px;
        }

        .sec-small-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          margin-bottom: 8px;
        }

        .mini-music-chips {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .planning-music-chip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: var(--radius-sm);
          font-size: 12px;
        }

        .chip-link {
          color: #ef4444;
          text-decoration: none;
          font-weight: 600;
          font-size: 11px;
        }

        .no-music-hint {
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }

        .act-manage-buttons {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }

        .eligible-candidates-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 16px 0;
        }

        .candidate-card-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .cand-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
        }

        .cand-info {
          flex: 1;
        }

        .cand-name {
          font-size: 14px;
          font-weight: 700;
        }

        .cand-skills {
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
