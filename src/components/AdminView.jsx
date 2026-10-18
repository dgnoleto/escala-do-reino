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
  Power,
  Calendar,
  Clock,
  Layers
} from 'lucide-react';
import { isReasonUsedInActivities } from '../utils/cancellationReasonService';
import {
  isEventTypeUsed,
  isStandardActivityUsed,
  canDeleteEventType,
  canDeleteStandardActivity
} from '../utils/eventTypeActivityService';

export default function AdminView() {
  const {
    church,
    members,
    teams,
    cancelReasons,
    eventTypes,
    standardActivities,
    accessInvites,
    currentUser,
    isAdmin,
    addCancelReason,
    updateCancelReason,
    toggleCancelReasonStatus,
    deleteCancelReason,
    addEventType,
    updateEventType,
    toggleEventTypeStatus,
    deleteEventType,
    addStandardActivity,
    updateStandardActivity,
    toggleStandardActivityStatus,
    deleteStandardActivity,
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

  // Formulário de Tipos de Evento (PRD §5 - Issue #25)
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeDesc, setNewTypeDesc] = useState('');
  const [typeError, setTypeError] = useState('');
  const [typeSuccess, setTypeSuccess] = useState('');
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [editingTypeName, setEditingTypeName] = useState('');
  const [editingTypeDesc, setEditingTypeDesc] = useState('');
  const [editingTypeError, setEditingTypeError] = useState('');

  // Formulário de Atividades Padrão com Duração (PRD §5 - Issue #25)
  const [newActName, setNewActName] = useState('');
  const [newActDuration, setNewActDuration] = useState(10);
  const [newActCategory, setNewActCategory] = useState('Liturgia');
  const [newActDesc, setNewActDesc] = useState('');
  const [actError, setActError] = useState('');
  const [actSuccess, setActSuccess] = useState('');
  const [editingActId, setEditingActId] = useState(null);
  const [editingActName, setEditingActName] = useState('');
  const [editingActDuration, setEditingActDuration] = useState(10);
  const [editingActCategory, setEditingActCategory] = useState('Liturgia');
  const [editingActDesc, setEditingActDesc] = useState('');
  const [editingActError, setEditingActError] = useState('');

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

  // Handlers para Tipos de Evento (Issue #25)
  const handleAddType = (e) => {
    e.preventDefault();
    setTypeError('');
    setTypeSuccess('');
    const res = addEventType(newTypeName, newTypeDesc);
    if (!res.success) {
      setTypeError(res.error);
    } else {
      setNewTypeName('');
      setNewTypeDesc('');
      setTypeSuccess('Tipo de evento cadastrado com sucesso!');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  const handleStartEditType = (type) => {
    setEditingTypeId(type.id);
    setEditingTypeName(type.name);
    setEditingTypeDesc(type.description || '');
    setEditingTypeError('');
    setTypeError('');
  };

  const handleSaveEditType = (id) => {
    setEditingTypeError('');
    const res = updateEventType(id, editingTypeName, editingTypeDesc);
    if (!res.success) {
      setEditingTypeError(res.error);
    } else {
      setEditingTypeId(null);
      setEditingTypeName('');
      setEditingTypeDesc('');
      setTypeSuccess('Tipo de evento atualizado com sucesso!');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  const handleCancelEditType = () => {
    setEditingTypeId(null);
    setEditingTypeName('');
    setEditingTypeDesc('');
    setEditingTypeError('');
  };

  const handleToggleTypeStatus = (id) => {
    setTypeError('');
    setTypeSuccess('');
    const res = toggleEventTypeStatus(id);
    if (!res.success) {
      setTypeError(res.error);
    } else {
      setTypeSuccess(res.active ? 'Tipo de evento reativado com sucesso!' : 'Tipo de evento desativado.');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  const handleDeleteType = (id) => {
    setTypeError('');
    setTypeSuccess('');
    const res = deleteEventType(id);
    if (!res.success) {
      setTypeError(res.error);
    } else {
      setTypeSuccess('Tipo de evento excluído com sucesso.');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  // Handlers para Atividades Padrão (Issue #25)
  const handleAddActivity = (e) => {
    e.preventDefault();
    setActError('');
    setActSuccess('');
    const res = addStandardActivity(newActName, newActDuration, newActCategory, newActDesc);
    if (!res.success) {
      setActError(res.error);
    } else {
      setNewActName('');
      setNewActDuration(10);
      setNewActCategory('Liturgia');
      setNewActDesc('');
      setActSuccess('Atividade padrão cadastrada com sucesso!');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const handleStartEditActivity = (act) => {
    setEditingActId(act.id);
    setEditingActName(act.name);
    setEditingActDuration(act.defaultDurationMinutes);
    setEditingActCategory(act.category || 'Liturgia');
    setEditingActDesc(act.description || '');
    setEditingActError('');
    setActError('');
  };

  const handleSaveEditActivity = (id) => {
    setEditingActError('');
    const res = updateStandardActivity(id, editingActName, editingActDuration, editingActCategory, editingActDesc);
    if (!res.success) {
      setEditingActError(res.error);
    } else {
      setEditingActId(null);
      setEditingActName('');
      setEditingActDuration(10);
      setEditingActDesc('');
      setActSuccess('Atividade padrão atualizada com sucesso!');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const handleCancelEditActivity = () => {
    setEditingActId(null);
    setEditingActName('');
    setEditingActDuration(10);
    setEditingActCategory('Liturgia');
    setEditingActDesc('');
    setEditingActError('');
  };

  const handleToggleActivityStatus = (id) => {
    setActError('');
    setActSuccess('');
    const res = toggleStandardActivityStatus(id);
    if (!res.success) {
      setActError(res.error);
    } else {
      setActSuccess(res.active ? 'Atividade reativada com sucesso!' : 'Atividade desativada.');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const handleDeleteActivity = (id) => {
    setActError('');
    setActSuccess('');
    const res = deleteStandardActivity(id);
    if (!res.success) {
      setActError(res.error);
    } else {
      setActSuccess('Atividade padrão excluída com sucesso.');
      setTimeout(() => setActSuccess(''), 3000);
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
            Gerenciamento global restrito a administradores (PRD 3.2, 4 e 5). Cadastre tipos de evento, atividades com
            durações padrão, motivos de cancelamento, convites de acesso e designe a liderança da liturgia por evento.
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
          className={`admin-tab-btn ${activeAdminTab === 'event_types' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('event_types')}
          id="tab-admin-event-types"
        >
          <Calendar size={16} /> Tipos de Evento (PRD §5)
        </button>

        <button
          className={`admin-tab-btn ${activeAdminTab === 'activities' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('activities')}
          id="tab-admin-activities"
        >
          <Clock size={16} /> Atividades & Durações (PRD §5)
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

      {/* ABA: TIPOS DE EVENTO (PRD §5 - Issue #25) */}
      {activeAdminTab === 'event_types' && (
        <div className="grid-2">
          <div className="card">
            <h2 className="tab-sec-title">
              <Calendar size={18} color="var(--primary)" /> Cadastrar Tipo de Evento
            </h2>
            <p className="tab-sec-desc">
              Tipos definem as categorias de culto e reuniões da igreja (ex: Celebração Geral, Culto de Oração, Ensaio).
              Conforme o <strong>PRD §4 e §5</strong>, o cadastro é exclusivo na Web por administradores.
            </p>

            {typeError && (
              <div className="error-banner" style={{ marginBottom: '16px' }}>
                <AlertCircle size={16} />
                <span>{typeError}</span>
              </div>
            )}

            {typeSuccess && (
              <div className="success-banner" style={{ marginBottom: '16px' }}>
                <CheckCircle2 size={16} />
                <span>{typeSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddType}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Nome do Tipo de Evento:</label>
                  <span style={{ fontSize: '11px', color: newTypeName.length > 100 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newTypeName.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  id="new-event-type-name-input"
                  className="form-input"
                  placeholder="Ex: Culto de Celebração de Domingo"
                  value={newTypeName}
                  maxLength={100}
                  onChange={e => {
                    setNewTypeName(e.target.value);
                    if (typeError) setTypeError('');
                  }}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Descrição ou Objetivo (opcional):</label>
                  <span style={{ fontSize: '11px', color: newTypeDesc.length > 255 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newTypeDesc.length}/255
                  </span>
                </div>
                <input
                  type="text"
                  id="new-event-type-desc-input"
                  className="form-input"
                  placeholder="Ex: Culto principal congregacional com louvor e palavra"
                  value={newTypeDesc}
                  maxLength={255}
                  onChange={e => {
                    setNewTypeDesc(e.target.value);
                    if (typeError) setTypeError('');
                  }}
                  disabled={isControlsDisabled}
                />
              </div>

              <button
                type="submit"
                id="btn-add-event-type"
                className="btn btn-primary"
                disabled={isControlsDisabled || !newTypeName.trim()}
              >
                <Plus size={15} /> Cadastrar Tipo de Evento
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 className="tab-sec-title" style={{ margin: 0 }}>
                Tipos de Evento ({eventTypes.length})
              </h2>
              <span className="badge badge-primary">
                {eventTypes.filter(t => t.active !== false).length} Ativos
              </span>
            </div>

            {eventTypes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                <Calendar size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                <p>Nenhum tipo de evento cadastrado nesta igreja.</p>
              </div>
            ) : (
              <div className="reasons-list">
                {eventTypes.map((type, idx) => {
                  const isEditing = editingTypeId === type.id;
                  const isUsed = isEventTypeUsed(type, [event]);
                  const isActive = type.active !== false;

                  return (
                    <div
                      key={type.id || idx}
                      id={`event-type-item-${idx}`}
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
                          <input
                            type="text"
                            id={`edit-event-type-name-${idx}`}
                            className="form-input"
                            value={editingTypeName}
                            maxLength={100}
                            onChange={e => setEditingTypeName(e.target.value)}
                            style={{ fontSize: '13px', padding: '6px 10px' }}
                            placeholder="Nome do tipo"
                            autoFocus
                          />
                          <input
                            type="text"
                            id={`edit-event-type-desc-${idx}`}
                            className="form-input"
                            value={editingTypeDesc}
                            maxLength={255}
                            onChange={e => setEditingTypeDesc(e.target.value)}
                            style={{ fontSize: '12px', padding: '6px 10px' }}
                            placeholder="Descrição opcional"
                          />
                          {editingTypeError && (
                            <span style={{ fontSize: '11px', color: '#ef4444' }}>{editingTypeError}</span>
                          )}
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              id={`btn-save-event-type-${idx}`}
                              className="btn btn-primary"
                              onClick={() => handleSaveEditType(type.id)}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <Check size={14} /> Salvar
                            </button>
                            <button
                              type="button"
                              id={`btn-cancel-edit-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={handleCancelEditType}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <X size={14} /> Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: '14px', textDecoration: isActive ? 'none' : 'line-through' }}>
                                {type.name}
                              </strong>
                              {!isActive && (
                                <span className="badge badge-pending" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                  Inativo
                                </span>
                              )}
                              {isUsed && (
                                <span className="badge" style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                                  Em uso
                                </span>
                              )}
                            </div>
                            {type.description && (
                              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {type.description}
                              </p>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              id={`btn-edit-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleStartEditType(type)}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              title="Editar tipo"
                              disabled={isControlsDisabled}
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              type="button"
                              id={`btn-toggle-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleToggleTypeStatus(type.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isActive ? '#f59e0b' : '#10b981'
                              }}
                              title={isActive ? 'Desativar tipo de evento' : 'Reativar tipo de evento'}
                              disabled={isControlsDisabled}
                            >
                              <Power size={12} style={{ marginRight: '4px' }} />
                              {isActive ? 'Desativar' : 'Ativar'}
                            </button>

                            <button
                              type="button"
                              id={`btn-delete-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleDeleteType(type.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isUsed ? 'var(--text-muted)' : '#ef4444',
                                opacity: isUsed ? 0.5 : 1
                              }}
                              title={
                                isUsed
                                  ? 'Tipo de evento utilizado em histórico não pode ser excluído; desative-o em vez de excluir'
                                  : 'Excluir tipo de evento'
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

      {/* ABA: ATIVIDADES PADRÃO & DURAÇÕES (PRD §5 & CA02 - Issue #25) */}
      {activeAdminTab === 'activities' && (
        <div className="grid-2">
          <div className="card">
            <h2 className="tab-sec-title">
              <Clock size={18} color="var(--primary)" /> Cadastrar Atividade Padrão
            </h2>
            <p className="tab-sec-desc">
              Atividades reutilizáveis para a ordem do culto. Conforme o <strong>PRD §5 (CA02)</strong>,
              as durações padrão são livremente configuráveis (exemplos de 5, 15 ou 20 min não são universais).
            </p>

            {actError && (
              <div className="error-banner" style={{ marginBottom: '16px' }}>
                <AlertCircle size={16} />
                <span>{actError}</span>
              </div>
            )}

            {actSuccess && (
              <div className="success-banner" style={{ marginBottom: '16px' }}>
                <CheckCircle2 size={16} />
                <span>{actSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddActivity}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Nome da Atividade:</label>
                  <span style={{ fontSize: '11px', color: newActName.length > 100 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newActName.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  id="new-activity-name-input"
                  className="form-input"
                  placeholder="Ex: Louvor e Adoração Congregacional"
                  value={newActName}
                  maxLength={100}
                  onChange={e => {
                    setNewActName(e.target.value);
                    if (actError) setActError('');
                  }}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <div className="grid-2" style={{ gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Duração Padrão (minutos):</label>
                  <input
                    type="number"
                    id="new-activity-duration-input"
                    className="form-input"
                    min={1}
                    max={720}
                    value={newActDuration}
                    onChange={e => {
                      setNewActDuration(parseInt(e.target.value) || '');
                      if (actError) setActError('');
                    }}
                    disabled={isControlsDisabled}
                    required
                  />
                  <small style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                    CA02: Configurável livremente (1 a 720 min)
                  </small>
                </div>

                <div className="form-group">
                  <label className="form-label">Categoria Litúrgica:</label>
                  <select
                    id="new-activity-category-select"
                    className="form-input"
                    value={newActCategory}
                    onChange={e => setNewActCategory(e.target.value)}
                    disabled={isControlsDisabled}
                  >
                    <option value="Liturgia">Liturgia & Direção</option>
                    <option value="Louvor">Louvor & Adoração</option>
                    <option value="Palavra">Ministração da Palavra</option>
                    <option value="Pastoral">Momento Pastoral & Avisos</option>
                    <option value="Apoio">Serviço de Apoio Técnico</option>
                    <option value="Comunhão">Comunhão & Encerramento</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Descrição ou Observação Padrão (opcional):</label>
                  <span style={{ fontSize: '11px', color: newActDesc.length > 255 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newActDesc.length}/255
                  </span>
                </div>
                <input
                  type="text"
                  id="new-activity-desc-input"
                  className="form-input"
                  placeholder="Ex: Bloco de músicas com participação da equipe"
                  value={newActDesc}
                  maxLength={255}
                  onChange={e => {
                    setNewActDesc(e.target.value);
                    if (actError) setActError('');
                  }}
                  disabled={isControlsDisabled}
                />
              </div>

              <button
                type="submit"
                id="btn-add-activity"
                className="btn btn-primary"
                disabled={isControlsDisabled || !newActName.trim() || !newActDuration}
              >
                <Plus size={15} /> Cadastrar Atividade Padrão
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 className="tab-sec-title" style={{ margin: 0 }}>
                Atividades Cadastradas ({standardActivities.length})
              </h2>
              <span className="badge badge-primary">
                {standardActivities.filter(a => a.active !== false).length} Ativas
              </span>
            </div>

            {standardActivities.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                <Clock size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                <p>Nenhuma atividade padrão cadastrada nesta igreja.</p>
              </div>
            ) : (
              <div className="reasons-list">
                {standardActivities.map((act, idx) => {
                  const isEditing = editingActId === act.id;
                  const isUsed = isStandardActivityUsed(act, event.activities);
                  const isActive = act.active !== false;

                  return (
                    <div
                      key={act.id || idx}
                      id={`activity-item-${idx}`}
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
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                              type="text"
                              id={`edit-activity-name-${idx}`}
                              className="form-input"
                              value={editingActName}
                              maxLength={100}
                              onChange={e => setEditingActName(e.target.value)}
                              style={{ flex: 2, fontSize: '13px', padding: '6px 10px' }}
                              placeholder="Nome da atividade"
                              autoFocus
                            />
                            <input
                              type="number"
                              id={`edit-activity-duration-${idx}`}
                              className="form-input"
                              min={1}
                              max={720}
                              value={editingActDuration}
                              onChange={e => setEditingActDuration(parseInt(e.target.value) || '')}
                              style={{ flex: 1, fontSize: '13px', padding: '6px 10px' }}
                              placeholder="Duração (min)"
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select
                              id={`edit-activity-category-${idx}`}
                              className="form-input"
                              value={editingActCategory}
                              onChange={e => setEditingActCategory(e.target.value)}
                              style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }}
                            >
                              <option value="Liturgia">Liturgia</option>
                              <option value="Louvor">Louvor</option>
                              <option value="Palavra">Palavra</option>
                              <option value="Pastoral">Pastoral</option>
                              <option value="Apoio">Apoio</option>
                              <option value="Comunhão">Comunhão</option>
                            </select>
                            <input
                              type="text"
                              id={`edit-activity-desc-${idx}`}
                              className="form-input"
                              value={editingActDesc}
                              maxLength={255}
                              onChange={e => setEditingActDesc(e.target.value)}
                              style={{ flex: 2, fontSize: '12px', padding: '6px 10px' }}
                              placeholder="Observação padrão"
                            />
                          </div>

                          {editingActError && (
                            <span style={{ fontSize: '11px', color: '#ef4444' }}>{editingActError}</span>
                          )}

                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              id={`btn-save-activity-${idx}`}
                              className="btn btn-primary"
                              onClick={() => handleSaveEditActivity(act.id)}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <Check size={14} /> Salvar
                            </button>
                            <button
                              type="button"
                              id={`btn-cancel-edit-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={handleCancelEditActivity}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <X size={14} /> Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: '14px', textDecoration: isActive ? 'none' : 'line-through' }}>
                                {act.name}
                              </strong>
                              <span className="badge" style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
                                <Clock size={10} style={{ marginRight: '3px' }} />
                                {act.defaultDurationMinutes} min
                              </span>
                              <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                {act.category || 'Liturgia'}
                              </span>
                              {!isActive && (
                                <span className="badge badge-pending" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                  Inativa
                                </span>
                              )}
                              {isUsed && (
                                <span className="badge" style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                                  No Culto
                                </span>
                              )}
                            </div>
                            {act.description && (
                              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {act.description}
                              </p>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              id={`btn-edit-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleStartEditActivity(act)}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              title="Editar atividade"
                              disabled={isControlsDisabled}
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              type="button"
                              id={`btn-toggle-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleToggleActivityStatus(act.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isActive ? '#f59e0b' : '#10b981'
                              }}
                              title={isActive ? 'Desativar atividade padrão' : 'Reativar atividade padrão'}
                              disabled={isControlsDisabled}
                            >
                              <Power size={12} style={{ marginRight: '4px' }} />
                              {isActive ? 'Desativar' : 'Ativar'}
                            </button>

                            <button
                              type="button"
                              id={`btn-delete-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleDeleteActivity(act.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isUsed ? 'var(--text-muted)' : '#ef4444',
                                opacity: isUsed ? 0.5 : 1
                              }}
                              title={
                                isUsed
                                  ? 'Atividade utilizada no culto não pode ser excluída fisicamente; desative-a em vez de excluir'
                                  : 'Excluir atividade'
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
