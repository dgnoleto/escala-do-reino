import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  UserPlus,
  Shield,
  Tag,
  Users,
  AlertCircle,
  CheckCircle2,
  Send,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Power
} from 'lucide-react';
import { isReasonUsedInActivities } from '../utils/cancellationReasonService';

export default function AdminView() {
  const {
    church,
    members,
    teams,
    cancelReasons,
    accessInvites,
    currentUser,
    isAdmin,
    addCancelReason,
    updateCancelReason,
    toggleCancelReasonStatus,
    deleteCancelReason,
    sendAccessInvite,
    designateLiturgyLeader,
    event,
    addAuditLog,
    isOnline,
    isDataStale
  } = useApp();

  const [activeAdminTab, setActiveAdminTab] = useState('invites');

  // Formulário de Convite de Acesso (PRD 3.1 & Cenário M40)
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMemberName, setInviteMemberName] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Formulário de Motivo de Cancelamento (PRD 7.3 & Cenário M12)
  const [newReasonText, setNewReasonText] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [reasonSuccess, setReasonSuccess] = useState('');
  const [editingReasonId, setEditingReasonId] = useState(null);
  const [editingReasonText, setEditingReasonText] = useState('');
  const [editingError, setEditingError] = useState('');

  // Designação da Liderança da Liturgia (PRD 3.2 & Cenário M05)
  const [selectedLiturgyLeader, setSelectedLiturgyLeader] = useState(event.liturgyLeaderId);

  // Proteção de Acesso (PRD 3.2 & Cenário M40)
  if (!isAdmin) {
    return (
      <div className="card admin-denied-card">
        <Shield size={48} color="#ef4444" />
        <h2>Acesso Administrativo Restrito</h2>
        <p>
          Conforme o <strong>PRD 3.2 e Cenário M40</strong>, apenas administradores com permissão concedida podem
          gerenciar cadastros, emitir convites de acesso ou designar lideranças.
        </p>
        <p className="denied-hint">
          Você está conectado como <strong>{currentUser.name}</strong>. Para testar o painel administrativo,
          mude seu perfil para <strong>Pastor Marcos Ribeiro (Administrador)</strong> no topo da página.
        </p>
      </div>
    );
  }

  const handleSendInvite = (e) => {
    e.preventDefault();
    if (!inviteEmail || !inviteMemberName) return;

    sendAccessInvite(inviteEmail, inviteMemberName);
    setInviteEmail('');
    setInviteMemberName('');
    setInviteSuccess(true);
    setTimeout(() => setInviteSuccess(false), 3000);
  };

  const handleAddReason = (e) => {
    e.preventDefault();
    setReasonError('');
    setReasonSuccess('');
    const res = addCancelReason(newReasonText);
    if (!res.success) {
      setReasonError(res.error);
    } else {
      setNewReasonText('');
      setReasonSuccess('Motivo cadastrado com sucesso!');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleStartEditReason = (reason) => {
    setEditingReasonId(reason.id);
    setEditingReasonText(reason.name);
    setEditingError('');
    setReasonError('');
  };

  const handleSaveEditReason = (id) => {
    setEditingError('');
    const res = updateCancelReason(id, editingReasonText);
    if (!res.success) {
      setEditingError(res.error);
    } else {
      setEditingReasonId(null);
      setEditingReasonText('');
      setReasonSuccess('Motivo alterado com sucesso!');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleCancelEditReason = () => {
    setEditingReasonId(null);
    setEditingReasonText('');
    setEditingError('');
  };

  const handleToggleReasonStatus = (id) => {
    setReasonError('');
    setReasonSuccess('');
    const res = toggleCancelReasonStatus(id);
    if (!res.success) {
      setReasonError(res.error);
    } else {
      setReasonSuccess(res.active ? 'Motivo reativado com sucesso!' : 'Motivo desativado.');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleDeleteReason = (id) => {
    setReasonError('');
    setReasonSuccess('');
    const res = deleteCancelReason(id);
    if (!res.success) {
      setReasonError(res.error);
    } else {
      setReasonSuccess('Motivo excluído com sucesso.');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleDesignateLeader = () => {
    designateLiturgyLeader(selectedLiturgyLeader);
    alert(`Liderança da Liturgia deste evento atualizada com sucesso para ${members.find(m => m.id === selectedLiturgyLeader)?.name}!`);
  };

  const isControlsDisabled = !isOnline || isDataStale;

  return (
    <div className="admin-container">
      {/* Cabeçalho de Administração */}
      <div className="card admin-header-card">
        <div>
          <div className="tag-row">
            <span className="badge badge-primary">Painel de Administração Web (Exclusivo Admin)</span>
            <span className="badge badge-pending">Igreja: {church.name}</span>
          </div>
          <h1 className="admin-title">Governança, Cadastros & Designações</h1>
          <p className="admin-subtitle">
            Gerenciamento global restrito a administradores (PRD 3.2 e 4). Cadastre motivos de cancelamento,
            envie convites de acesso à igreja vinculados a membros e designe a liderança da liturgia por evento.
          </p>
        </div>
      </div>

      {/* Sub-Navegação Administrativa */}
      <div className="admin-nav-tabs">
        <button
          className={`admin-tab-btn ${activeAdminTab === 'invites' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('invites')}
        >
          <UserPlus size={16} /> Convites de Acesso à Igreja (PRD 3.1)
        </button>

        <button
          className={`admin-tab-btn ${activeAdminTab === 'liturgy' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('liturgy')}
        >
          <Shield size={16} /> Designação da Liturgia por Evento (PRD 3.2)
        </button>

        <button
          className={`admin-tab-btn ${activeAdminTab === 'reasons' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('reasons')}
        >
          <Tag size={16} /> Motivos de Cancelamento Web (PRD 7.3)
        </button>

        <button
          className={`admin-tab-btn ${activeAdminTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('members')}
        >
          <Users size={16} /> Membros e Aptidões (PRD 3)
        </button>
      </div>

      {/* ABA 1: CONVITES DE ACESSO À IGREJA (PRD 3.1 & Cenário M01, M40) */}
      {activeAdminTab === 'invites' && (
        <div className="grid-2">
          <div className="card">
            <h2 className="tab-sec-title">
              <UserPlus size={18} color="var(--primary)" /> Enviar Convite de Acesso
            </h2>
            <p className="tab-sec-desc">
              O convite permite à pessoa entrar na igreja pelo login Google/Apple. Conforme o PRD 3.1:
              <strong> fazer login sem convite não libera dados da igreja</strong> e somente admin pode emitir convites.
            </p>

            {inviteSuccess && (
              <div className="success-banner">
                <CheckCircle2 size={16} /> Convite enviado com sucesso!
              </div>
            )}

            <form onSubmit={handleSendInvite}>
              <div className="form-group">
                <label className="form-label">Nome Completo do Membro:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: João da Silva"
                  value={inviteMemberName}
                  onChange={e => setInviteMemberName(e.target.value)}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">E-mail do Membro (Conta Google / Apple):</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="membro@gmail.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={isControlsDisabled}
              >
                <Send size={15} /> Emitir Convite Oficial de Acesso
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="tab-sec-title">Convites Emitidos Recentemente</h2>
            <div className="invites-list">
              {accessInvites.map(inv => (
                <div key={inv.id} className="invite-row-item">
                  <div className="inv-info">
                    <div className="inv-name">{inv.memberName}</div>
                    <div className="inv-email">{inv.email}</div>
                    <div className="inv-date">Enviado em: {inv.sentAt}</div>
                  </div>
                  <span className={`badge ${inv.status === 'Aceito' ? 'badge-primary' : 'badge-pending'}`}>
                    {inv.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: DESIGNAÇÃO DA LIDERANÇA DA LITURGIA (PRD 3.2 & Cenário M05) */}
      {activeAdminTab === 'liturgy' && (
        <div className="card">
          <h2 className="tab-sec-title">
            <Shield size={18} color="var(--primary)" /> Designação da Liderança da Liturgia por Evento
          </h2>
          <p className="tab-sec-desc">
            A liderança da liturgia é designada por edição do evento (o culto de domingo pode ter uma pessoa, o de quarta outra).
            <strong> Somente o Administrador pode designar e trocar essa liderança</strong> (PRD 3.2 & Cenário M05).
          </p>

          <div className="current-event-leader-box">
            <div className="current-lead-header">
              Evento Selecionado: <strong>{event.title}</strong> ({event.date})
            </div>

            <div className="designation-form-row">
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Selecione o Líder da Liturgia Designado:</label>
                <select
                  className="form-select"
                  value={selectedLiturgyLeader}
                  onChange={e => setSelectedLiturgyLeader(e.target.value)}
                  disabled={isControlsDisabled}
                >
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} — Papéis: {m.roles.join(', ')} ({m.teams.join(', ')})
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleDesignateLeader}
                disabled={isControlsDisabled}
                style={{ marginTop: '22px' }}
              >
                Salvar Designação do Culto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: MOTIVOS DE CANCELAMENTO PRÉ-CADASTRADOS (PRD 7.3 & Cenário M12) */}
      {activeAdminTab === 'reasons' && (
        <div className="grid-2">
          <div className="card">
            <h2 className="tab-sec-title">
              <Tag size={18} color="var(--primary)" /> Cadastrar Motivo de Cancelamento
            </h2>
            <p className="tab-sec-desc">
              Conforme o <strong>PRD 7.3 e Cenário M12</strong>, durante a execução do culto o cancelamento de uma
              atividade exige motivo pré-cadastrado na Web pelo administrador. O mobile ou tela operacional não permite cadastrar motivos na hora da emergência.
            </p>

            {reasonError && (
              <div className="alert alert-danger" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px' }}>
                <AlertCircle size={16} />
                <span>{reasonError}</span>
              </div>
            )}

            {reasonSuccess && (
              <div className="alert alert-success" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '6px' }}>
                <CheckCircle2 size={16} />
                <span>{reasonSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddReason}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Descrição do Motivo Pré-Aprovado:</label>
                  <span style={{ fontSize: '11px', color: newReasonText.length > 120 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newReasonText.length}/120
                  </span>
                </div>
                <input
                  type="text"
                  id="new-cancel-reason-input"
                  className="form-input"
                  placeholder="Ex: Falha no gerador de energia..."
                  value={newReasonText}
                  maxLength={120}
                  onChange={e => {
                    setNewReasonText(e.target.value);
                    if (reasonError) setReasonError('');
                  }}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <button
                type="submit"
                id="btn-add-cancel-reason"
                className="btn btn-primary"
                disabled={isControlsDisabled || !newReasonText.trim()}
              >
                <Plus size={15} /> Cadastrar Novo Motivo
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 className="tab-sec-title" style={{ margin: 0 }}>
                Motivos de Cancelamento ({cancelReasons.length})
              </h2>
              <span className="badge badge-primary">
                {cancelReasons.filter(r => r.active !== false).length} Ativos
              </span>
            </div>

            {cancelReasons.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                <Tag size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                <p>Nenhum motivo cadastrado para esta igreja.</p>
              </div>
            ) : (
              <div className="reasons-list">
                {cancelReasons.map((reason, idx) => {
                  const isEditing = editingReasonId === reason.id;
                  const isUsed = isReasonUsedInActivities(reason, event.activities);
                  const isActive = reason.active !== false;

                  return (
                    <div
                      key={reason.id || idx}
                      id={`reason-item-${idx}`}
                      className="reason-item-row"
                      style={{
                        opacity: isActive ? 1 : 0.65,
                        borderColor: isEditing ? 'var(--primary)' : undefined,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: '8px'
                      }}
                    >
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="text"
                              id={`edit-reason-input-${idx}`}
                              className="form-input"
                              value={editingReasonText}
                              maxLength={120}
                              onChange={e => setEditingReasonText(e.target.value)}
                              style={{ flex: 1, fontSize: '13px', padding: '6px 10px' }}
                              autoFocus
                            />
                            <button
                              type="button"
                              id={`btn-save-reason-${idx}`}
                              className="btn btn-primary"
                              onClick={() => handleSaveEditReason(reason.id)}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                              title="Salvar alteração"
                            >
                              <Check size={14} /> Salvar
                            </button>
                            <button
                              type="button"
                              id={`btn-cancel-edit-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={handleCancelEditReason}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                              title="Cancelar edição"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          {editingError && (
                            <span style={{ fontSize: '12px', color: '#ef4444' }}>{editingError}</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                fontWeight: 500,
                                textDecoration: isActive ? 'none' : 'line-through',
                                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)'
                              }}
                            >
                              {reason.name}
                            </span>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              <span className={`badge ${isActive ? 'badge-primary' : 'badge-pending'}`}>
                                {isActive ? 'Ativo' : 'Inativo'}
                              </span>
                              {isUsed && (
                                <span className="badge badge-live" title="Utilizado em registros de atividades do histórico">
                                  Em Histórico
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              id={`btn-edit-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleStartEditReason(reason)}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              title="Alterar descrição do motivo"
                              disabled={isControlsDisabled}
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              type="button"
                              id={`btn-toggle-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleToggleReasonStatus(reason.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isActive ? '#f59e0b' : '#10b981'
                              }}
                              title={isActive ? 'Desativar motivo (preserva histórico)' : 'Reativar motivo para seleção'}
                              disabled={isControlsDisabled}
                            >
                              <Power size={12} style={{ marginRight: '4px' }} />
                              {isActive ? 'Desativar' : 'Ativar'}
                            </button>

                            <button
                              type="button"
                              id={`btn-delete-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleDeleteReason(reason.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isUsed ? 'var(--text-muted)' : '#ef4444',
                                opacity: isUsed ? 0.5 : 1
                              }}
                              title={
                                isUsed
                                  ? 'Motivo utilizado em histórico não pode ser excluído; desative-o em vez de excluir'
                                  : 'Excluir motivo não utilizado'
                              }
                              disabled={isControlsDisabled}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 4: MEMBROS E APTIDÕES (PRD 3 & Cenário M35) */}
      {activeAdminTab === 'members' && (
        <div className="card">
          <h2 className="tab-sec-title">
            <Users size={18} color="var(--primary)" /> Membros Cadastrados & Habilitação de Aptidões
          </h2>
          <p className="tab-sec-desc">
            Cada membro possui cadastro único na igreja. A liderança habilita aptidões (ex: Canto, Dança, Bateria);
            <strong> o membro não se habilita sozinho</strong> (PRD 3 & Cenário M35).
          </p>

          <div className="members-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Membro</th>
                  <th>E-mail</th>
                  <th>Papéis</th>
                  <th>Equipes</th>
                  <th>Aptidões Habilitadas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div className="table-member-cell">
                        <img src={m.avatar} alt={m.name} className="table-avatar" />
                        <span className="table-member-name">{m.name}</span>
                      </div>
                    </td>
                    <td>{m.email}</td>
                    <td>
                      {m.roles.map(r => (
                        <span key={r} className="badge badge-primary" style={{ marginRight: '4px' }}>
                          {r}
                        </span>
                      ))}
                    </td>
                    <td>{m.teams.join(', ')}</td>
                    <td>
                      <div className="skills-chips">
                        {m.skills.map(s => (
                          <span key={s} className="skill-pill">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-primary">Ativo</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .admin-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .admin-header-card {
          padding: 28px;
        }

        .admin-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .admin-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 750px;
          line-height: 1.5;
        }

        .admin-nav-tabs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .admin-tab-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
        }

        .admin-tab-btn:hover {
          color: var(--text-primary);
          background: var(--bg-card-hover);
        }

        .admin-tab-btn.active {
          color: white;
          background: var(--primary);
          border-color: var(--primary);
        }

        .tab-sec-title {
          font-size: 18px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .tab-sec-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 20px;
          line-height: 1.5;
        }

        .invites-list, .reasons-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .invite-row-item, .reason-item-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .inv-name {
          font-weight: 700;
          color: var(--text-primary);
        }

        .inv-email {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .inv-date {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .current-event-leader-box {
          background: var(--bg-inset);
          border: 1px solid var(--border-subtle);
          padding: 20px;
          border-radius: var(--radius-lg);
        }

        .current-lead-header {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }

        .designation-form-row {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .members-table-wrapper {
          overflow-x: auto;
          margin-top: 12px;
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }

        .admin-table th {
          padding: 12px 14px;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-subtle);
        }

        .admin-table td {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .table-member-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .table-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
        }

        .table-member-name {
          font-weight: 700;
          color: var(--text-primary);
        }

        .skills-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .skill-pill {
          font-size: 11px;
          background: var(--bg-surface);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .admin-denied-card {
          padding: 60px 24px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .admin-denied-card h2 {
          font-size: 22px;
          font-weight: 800;
        }

        .admin-denied-card p {
          max-width: 550px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .denied-hint {
          color: #fbbf24 !important;
          font-size: 13px !important;
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
