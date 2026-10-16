import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  Users,
  UserPlus,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Shield,
  Plus,
  Trash2,
  Award,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  fetchChurchTeams,
  fetchChurchTeamRoles,
  fetchTeamMembers,
  createChurchTeam,
  transferTeamLeadership,
  createTeamRole,
  addTeamMember,
  removeTeamMember,
  grantMemberQualification,
  revokeMemberQualification,
  savePendingLiturgicalCommand,
  loadPendingLiturgicalCommand,
  removePendingLiturgicalCommand,
} from '../utils/liturgicalCommandService';

export default function TeamsPage({ onBack }) {
  const { session, churchAccess, authState, getLiveChurchAccess } = useAuth();

  const liveChurchAccess = typeof getLiveChurchAccess === 'function' ? getLiveChurchAccess() : churchAccess;
  const churchId = liveChurchAccess?.church_id ?? churchAccess?.church_id;
  const churchName = liveChurchAccess?.church_name || churchAccess?.church_name || 'Igreja';
  const isAdmin = liveChurchAccess?.is_admin ?? churchAccess?.is_admin ?? false;
  const currentUserId = session?.user?.id;

  // Estados principais da listagem de equipes
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modal de Criação de Equipe
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Equipe Selecionada para Detalhes (Roles e Integrantes)
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [teamRoles, setTeamRoles] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Formulário para Nova Função Técnica
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');

  // Formulário para Adicionar Integrante
  const [availableMembers, setAvailableMembers] = useState([]);
  const [selectedMemberToAdd, setSelectedMemberToAdd] = useState('');

  // Formulário para Transferir Liderança
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [newLeaderId, setNewLeaderId] = useState('');

  // Comando pendente na sessão para recuperação após F5
  const [pendingCmd, setPendingCmd] = useState(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // 1. Carrega comando pendente se houver
  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage && currentUserId && churchId) {
      const saved = loadPendingLiturgicalCommand(window.sessionStorage, currentUserId, churchId);
      setPendingCmd(saved);
    }
  }, [currentUserId, churchId]);

  // 2. Carrega a lista real de equipes do servidor
  const loadTeams = useCallback(async () => {
    if (!supabase || !churchId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await fetchChurchTeams({ supabase, churchId });
      if (isMountedRef.current) {
        setTeams(list);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setErrorMsg(err.message || 'Falha ao carregar ministérios e equipes.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [churchId]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // 3. Carrega detalhes da equipe selecionada (funções e integrantes)
  const loadTeamDetails = useCallback(async (teamId) => {
    if (!supabase || !churchId || !teamId) return;
    setLoadingDetails(true);
    try {
      const [roles, members] = await Promise.all([
        fetchChurchTeamRoles({ supabase, churchId, teamId }),
        fetchTeamMembers({ supabase, churchId, teamId }),
      ]);
      if (isMountedRef.current) {
        setTeamRoles(roles);
        setTeamMembers(members);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setErrorMsg(err.message || 'Falha ao carregar dados da equipe.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingDetails(false);
      }
    }
  }, [churchId]);

  useEffect(() => {
    if (selectedTeamId) {
      loadTeamDetails(selectedTeamId);
    }
  }, [selectedTeamId, loadTeamDetails]);

  // 4. Carrega membros ativos da igreja para seleção em modais
  const loadAvailableMembers = useCallback(async () => {
    if (!supabase || !churchId) return;
    try {
      const { data, error } = await supabase.rpc('list_church_members_admin', {
        p_church_id: churchId,
        p_status_filter: 'active',
        p_limit: 100,
        p_offset: 0,
      });
      if (!error && Array.isArray(data) && data[0]?.items) {
        setAvailableMembers(data[0].items);
      }
    } catch {
      // Falha silenciosa de enriquecimento
    }
  }, [churchId]);

  useEffect(() => {
    if (isCreateModalOpen || isTransferModalOpen || selectedTeamId) {
      loadAvailableMembers();
    }
  }, [isCreateModalOpen, isTransferModalOpen, selectedTeamId, loadAvailableMembers]);

  // 5. Ação: Criar Nova Equipe (Admin)
  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim() || !churchId || isSubmitting) return;

    const commandId = crypto.randomUUID();
    setIsSubmitting(true);
    setErrorMsg(null);

    // Salva comando pendente antes do despacho para tolerância a quedas
    if (typeof window !== 'undefined' && window.sessionStorage) {
      savePendingLiturgicalCommand(window.sessionStorage, currentUserId, {
        commandId,
        churchId,
        action: 'create_church_team',
        name: newTeamName.trim(),
      });
      setPendingCmd({ commandId, churchId, action: 'create_church_team', name: newTeamName.trim() });
    }

    try {
      const res = await createChurchTeam({
        supabase,
        churchId,
        commandId,
        name: newTeamName.trim(),
      });

      if (res.status === 'SUCCESS') {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingLiturgicalCommand(window.sessionStorage, currentUserId, churchId);
          setPendingCmd(null);
        }
        setSuccessMsg(`Equipe "${newTeamName.trim()}" criada com sucesso!`);
        setNewTeamName('');
        setIsCreateModalOpen(false);
        await loadTeams();
      } else if (res.status === 'DEFINITIVE_ERROR') {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingLiturgicalCommand(window.sessionStorage, currentUserId, churchId);
          setPendingCmd(null);
        }
        setErrorMsg(res.message);
      } else {
        // UNCERTAIN: Mantém o comando no storage para recuperação segura
        setErrorMsg('Conexão instável. O comando foi retido e será reconciliado.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Erro inesperado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Ação: Adicionar Integrante na Equipe
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!selectedMemberToAdd || !selectedTeamId || isSubmitting) return;

    const commandId = crypto.randomUUID();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await addTeamMember({
        supabase,
        churchId,
        commandId,
        teamId: selectedTeamId,
        memberId: selectedMemberToAdd,
      });

      if (res.status === 'SUCCESS') {
        setSuccessMsg('Integrante adicionado à equipe com sucesso!');
        setSelectedMemberToAdd('');
        await loadTeamDetails(selectedTeamId);
        await loadTeams();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Falha ao adicionar integrante.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 7. Ação: Remover Integrante da Equipe
  const handleRemoveMember = async (memberId) => {
    if (!confirm('Deseja remover este integrante da equipe?')) return;
    const commandId = crypto.randomUUID();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await removeTeamMember({
        supabase,
        churchId,
        commandId,
        teamId: selectedTeamId,
        memberId,
      });

      if (res.status === 'SUCCESS') {
        setSuccessMsg('Integrante removido da equipe.');
        await loadTeamDetails(selectedTeamId);
        await loadTeams();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Falha ao remover integrante.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 8. Ação: Criar Função Técnica
  const handleCreateRole = async (e) => {
    e.preventDefault();
    if (!newRoleName.trim() || !selectedTeamId || isSubmitting) return;

    const commandId = crypto.randomUUID();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await createTeamRole({
        supabase,
        churchId,
        commandId,
        teamId: selectedTeamId,
        name: newRoleName.trim(),
        description: newRoleDesc.trim() || null,
      });

      if (res.status === 'SUCCESS') {
        setSuccessMsg(`Função técnica "${newRoleName.trim()}" cadastrada!`);
        setNewRoleName('');
        setNewRoleDesc('');
        await loadTeamDetails(selectedTeamId);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Falha ao cadastrar função técnica.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 9. Ação: Transferir Liderança da Equipe (Admin)
  const handleTransferLeadership = async (e) => {
    e.preventDefault();
    if (!newLeaderId || !selectedTeamId || isSubmitting) return;

    const commandId = crypto.randomUUID();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const currentTeam = teams.find((t) => t.team_id === selectedTeamId);
      const res = await transferTeamLeadership({
        supabase,
        churchId,
        commandId,
        teamId: selectedTeamId,
        newLeaderMemberId: newLeaderId,
        expectedVersion: currentTeam?.version ?? null,
      });

      if (res.status === 'SUCCESS') {
        setSuccessMsg('Liderança da equipe transferida com sucesso!');
        setIsTransferModalOpen(false);
        setNewLeaderId('');
        await loadTeams();
        await loadTeamDetails(selectedTeamId);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Falha ao transferir liderança.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedTeam = teams.find((t) => t.team_id === selectedTeamId);

  return (
    <div className="teams-page-container" style={{ padding: '16px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Barra superior de navegação */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
        >
          <ArrowLeft size={16} /> Voltar ao Início
        </button>

        <span className="badge badge-primary" style={{ fontSize: '0.8rem' }}>
          Igreja: {churchName}
        </span>
      </div>

      {/* Cabeçalho */}
      <div className="card" style={{ marginBottom: '16px', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={22} color="var(--primary, #2563eb)" /> Gestão de Ministérios &amp; Equipes
            </h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Fonte real e operacional de equipes, funções técnicas e qualificações homologadas (PRD 3 e 4).
            </p>
          </div>

          {isAdmin && (
            <button
              type="button"
              className="btn btn-primary"
              id="btn-open-create-team-modal"
              onClick={() => setIsCreateModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Nova Equipe
            </button>
          )}
        </div>
      </div>

      {/* Banner de Comando Pendente / Recuperação pós-queda (B2-05) */}
      {pendingCmd && (
        <div
          className="card"
          style={{
            background: 'var(--primary-surface, #eff6ff)',
            border: '1.5px solid var(--primary, #2563eb)',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <RefreshCw size={18} className="spin" color="var(--primary, #2563eb)" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
              Comando pendente de confirmação: <strong>{pendingCmd.name || pendingCmd.action}</strong>
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadTeams}
            style={{ fontSize: '0.78rem', padding: '4px 10px' }}
          >
            Reconciliar
          </button>
        </div>
      )}

      {/* Alertas de Erro e Sucesso */}
      {errorMsg && (
        <div className="card" style={{ background: '#fef2f2', border: '1px solid #f87171', color: '#991b1b', padding: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={18} />
          <span style={{ fontSize: '0.85rem' }}>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="card" style={{ background: '#f0fdf4', border: '1px solid #4ade80', color: '#166534', padding: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={18} />
          <span style={{ fontSize: '0.85rem' }}>{successMsg}</span>
        </div>
      )}

      {/* Conteúdo Principal: Grade de Equipes */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px' }}>
          <RefreshCw size={24} className="spin" color="var(--primary)" />
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '8px' }}>Carregando equipes...</p>
        </div>
      ) : teams.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
          <Layers size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ fontSize: '1.1rem', margin: '0 0 6px' }}>Nenhuma equipe cadastrada</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
            {isAdmin ? 'Crie o primeiro ministério ou equipe para iniciar as escalas.' : 'Nenhuma equipe disponível no momento.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedTeamId ? '1fr 1fr' : '1fr', gap: '16px' }}>
          {/* Coluna 1: Lista de Equipes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {teams.map((t) => {
              const isSelected = t.team_id === selectedTeamId;
              return (
                <div
                  key={t.team_id}
                  className="card"
                  onClick={() => setSelectedTeamId(isSelected ? null : t.team_id)}
                  style={{
                    cursor: 'pointer',
                    border: isSelected ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border-subtle)',
                    padding: '14px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{t.name}</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Líder: <strong>{t.leader_name || 'Não designado'}</strong>
                      </p>
                      <span className="badge badge-pending" style={{ fontSize: '0.72rem', marginTop: '6px', display: 'inline-block' }}>
                        {t.member_count} {Number(t.member_count) === 1 ? 'integrante' : 'integrantes'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isSelected ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Coluna 2: Detalhes da Equipe Selecionada */}
          {selectedTeamId && selectedTeam && (
            <div className="card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{selectedTeam.name}</h2>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setIsTransferModalOpen(true)}
                    style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                  >
                    Transferir Liderança
                  </button>
                )}
              </div>

              {loadingDetails ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Carregando detalhes...</p>
              ) : (
                <>
                  {/* Seção: Funções Técnicas */}
                  <div style={{ marginBottom: '18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '0.9rem' }}>Funções Técnicas ({teamRoles.length})</strong>
                    </div>

                    {teamRoles.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nenhuma função cadastrada.</p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                        {teamRoles.map((r) => (
                          <span key={r.team_role_id} className="badge badge-primary" style={{ fontSize: '0.78rem' }}>
                            {r.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Form simples para adicionar função */}
                    <form onSubmit={handleCreateRole} style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <input
                        type="text"
                        placeholder="Nome da função (ex: Vocal Solo)"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        style={{ flex: 1, fontSize: '0.8rem', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}
                      />
                      <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
                        Adicionar Função
                      </button>
                    </form>
                  </div>

                  {/* Seção: Integrantes da Equipe */}
                  <div>
                    <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '8px' }}>
                      Integrantes ({teamMembers.length})
                    </strong>

                    {teamMembers.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nenhum integrante vinculado.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                        {teamMembers.map((m) => (
                          <div
                            key={m.membership_id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              background: 'var(--bg-surface)',
                              borderRadius: '6px',
                              border: '1px solid var(--border-subtle)',
                              fontSize: '0.82rem',
                            }}
                          >
                            <span>
                              {m.display_name} {m.is_team_leader && <strong style={{ color: 'var(--primary)' }}>(Líder)</strong>}
                            </span>
                            {!m.is_team_leader && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m.member_id)}
                                style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                                title="Remover da equipe"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Form para vincular integrante */}
                    <form onSubmit={handleAddMember} style={{ display: 'flex', gap: '6px' }}>
                      <select
                        value={selectedMemberToAdd}
                        onChange={(e) => setSelectedMemberToAdd(e.target.value)}
                        style={{ flex: 1, fontSize: '0.8rem', padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}
                      >
                        <option value="">Selecione um membro...</option>
                        {availableMembers
                          .filter((am) => !teamMembers.some((tm) => tm.member_id === am.id))
                          .map((am) => (
                            <option key={am.id} value={am.id}>
                              {am.display_name}
                            </option>
                          ))}
                      </select>
                      <button type="submit" className="btn btn-primary" disabled={!selectedMemberToAdd || isSubmitting} style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
                        Vincular
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Nova Equipe */}
      {isCreateModalOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '90%', maxWidth: '450px', padding: '20px' }}>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 12px' }}>Criar Nova Equipe / Ministério</h2>
            <form onSubmit={handleCreateTeam}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px', fontWeight: 600 }}>Nome da Equipe</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Louvor &amp; Adoração"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsCreateModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={!newTeamName.trim() || isSubmitting}>
                  {isSubmitting ? 'Salvando...' : 'Criar Equipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Transferir Liderança */}
      {isTransferModalOpen && selectedTeam && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: '90%', maxWidth: '450px', padding: '20px' }}>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 12px' }}>Transferir Liderança: {selectedTeam.name}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Selecione o novo membro ativo que assumirá a liderança desta equipe.
            </p>
            <form onSubmit={handleTransferLeadership}>
              <div style={{ marginBottom: '14px' }}>
                <select
                  required
                  value={newLeaderId}
                  onChange={(e) => setNewLeaderId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}
                >
                  <option value="">Selecione o novo líder...</option>
                  {availableMembers
                    .filter((am) => am.id !== selectedTeam.leader_member_id)
                    .map((am) => (
                      <option key={am.id} value={am.id}>
                        {am.display_name}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsTransferModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={!newLeaderId || isSubmitting}>
                  {isSubmitting ? 'Transferindo...' : 'Confirmar Transferência'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
