import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  Users,
  UserPlus,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  WifiOff,
  Shield,
  X
} from 'lucide-react';

/**
 * MembersPage — tela de gestão de membros para administrador autorizado.
 *
 * Requisitos atendidos:
 * - Apenas administradores autorizados têm acesso à tela.
 * - Listagem paginada com apenas Nome e Situação (sem CPF, telefone, e-mail ou endereço).
 * - Criação de membro com apenas o Nome (1 a 120 caracteres, normalizado em NFC).
 * - Identidade, autorização e autoria estritamente derivadas da sessão no servidor.
 * - Suporte a homônimos (nomes iguais não são bloqueados).
 * - Tratamento explícito de resposta incerta (queda de conexão) com reconciliação antes de reenvio.
 * - Bloqueio de cadastro offline com aviso explícito.
 * - Estados de carregamento, lista vazia, erro e processamento.
 * - Uso legível no navegador do celular.
 */
export default function MembersPage({ onBack }) {
  const { churchAccess, authState } = useAuth();

  const churchId   = churchAccess?.church_id;
  const churchName = churchAccess?.church_name || 'Igreja';
  const isAdmin    = churchAccess?.is_admin || false;

  // Estado da listagem
  const [members, setMembers]         = useState([]);
  const [totalCount, setTotalCount]   = useState(0);
  const [page, setPage]               = useState(1);
  const pageSize                      = 10;
  const [loading, setLoading]         = useState(true);
  const [listError, setListError]     = useState(null);

  // Estado do formulário de criação
  const [showCreateModal, setShowCreateModal]   = useState(false);
  const [nameInput, setNameInput]               = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [formError, setFormError]               = useState(null);
  const [successMessage, setSuccessMessage]     = useState(null);

  // Estado para comando com resposta incerta
  const [uncertainCommand, setUncertainCommand] = useState(null);
  const [reconciling, setReconciling]           = useState(false);

  // Detecção de status de rede
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Referência para descarte de respostas em voo se a página mudar
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Monitorar conectividade
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Limpar lista se perder autorização ou trocar de conta
  useEffect(() => {
    if (!churchAccess || authState !== 'access_granted') {
      setMembers([]);
      setTotalCount(0);
    }
  }, [churchAccess, authState]);

  /**
   * Consulta a lista paginada de membros da igreja autorizada.
   */
  const loadMembers = useCallback(async (targetPage = page) => {
    if (!supabase || !churchId || !isAdmin) return;

    setLoading(true);
    setListError(null);

    try {
      const offset = (targetPage - 1) * pageSize;
      const { data, error } = await supabase.schema('public').rpc('list_church_members', {
        p_church_id: churchId,
        p_limit: pageSize,
        p_offset: offset,
      });

      if (!isMountedRef.current) return;

      if (error) {
        console.error('[MembersPage] Falha ao consultar membros:', error.message);
        setListError(error.message || 'Falha ao carregar a lista de membros.');
        setMembers([]);
        return;
      }

      if (!data || data.length === 0) {
        setMembers([]);
        setTotalCount(0);
      } else {
        setMembers(data);
        const reportedTotal = Number(data[0].total_count);
        setTotalCount(isNaN(reportedTotal) ? data.length : reportedTotal);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('[MembersPage] Erro inesperado ao listar membros:', err);
      setListError('Erro de conexão ao carregar a lista de membros.');
      setMembers([]);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [churchId, isAdmin, page, pageSize]);

  // Carregar dados na montagem e na troca de página
  useEffect(() => {
    if (churchId && isAdmin) {
      loadMembers(page);
    }
  }, [churchId, isAdmin, page, loadMembers]);

  /**
   * Submete a criação de um novo membro.
   */
  async function handleCreateMember(e) {
    e.preventDefault();
    if (submitting) return;

    if (!isOnline) {
      setFormError('Você está sem conexão com a internet. O cadastro não pode ser realizado offline.');
      return;
    }

    const trimmed = nameInput.trim();
    if (!trimmed) {
      setFormError('Informe o nome do membro.');
      return;
    }

    if (trimmed.length > 120) {
      setFormError('O nome deve ter no máximo 120 caracteres.');
      return;
    }

    // Se há um comando incerto pendente, exigir reconciliação prévia
    if (uncertainCommand) {
      setFormError('Existe um comando anterior com resposta incerta. Reconcilie o resultado antes de tentar novamente.');
      return;
    }

    const commandId = crypto.randomUUID();
    setSubmitting(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const { data, error } = await supabase.schema('public').rpc('create_church_member', {
        p_church_id: churchId,
        p_command_id: commandId,
        p_display_name: trimmed,
      });

      if (!isMountedRef.current) return;

      if (error) {
        console.error('[MembersPage] Erro retornado ao criar membro:', error.message);
        setFormError(error.message || 'Falha ao cadastrar membro.');
        setSubmitting(false);
        return;
      }

      // Sucesso confirmado pelo servidor
      const created = data?.[0];
      const existed = created?.already_existed;
      setSuccessMessage(
        existed
          ? `Membro "${created?.display_name || trimmed}" já constava como cadastrado.`
          : `Membro "${created?.display_name || trimmed}" cadastrado com sucesso!`
      );
      setNameInput('');
      setShowCreateModal(false);
      setUncertainCommand(null);

      // Recarrega na primeira página para exibir o cadastro
      setPage(1);
      loadMembers(1);
    } catch (networkErr) {
      if (!isMountedRef.current) return;
      console.warn('[MembersPage] Resposta incerta após envio do comando:', networkErr);
      // Registra comando incerto para reconciliação
      setUncertainCommand({
        commandId,
        churchId,
        displayName: trimmed,
      });
      setFormError(
        'A confirmação do cadastro não chegou devido a uma oscilação na rede. ' +
        'O comando foi retido para verificação segura. Não reenvie sem verificar.'
      );
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  /**
   * Reconcilia um comando com resposta incerta chamando get_create_member_receipt.
   */
  async function handleReconcileReceipt() {
    if (!uncertainCommand || !supabase || reconciling) return;

    setReconciling(true);
    setFormError(null);

    try {
      const { data, error } = await supabase.schema('public').rpc('get_create_member_receipt', {
        p_church_id: uncertainCommand.churchId,
        p_command_id: uncertainCommand.commandId,
      });

      if (!isMountedRef.current) return;

      if (error) {
        setFormError('Falha ao verificar confirmação: ' + error.message);
        setReconciling(false);
        return;
      }

      if (data && data.length > 0) {
        // Confirmado no servidor!
        const member = data[0];
        setSuccessMessage(`Cadastro de "${member.display_name}" confirmado com sucesso no servidor!`);
        setUncertainCommand(null);
        setNameInput('');
        setShowCreateModal(false);
        setPage(1);
        loadMembers(1);
      } else {
        // Não foi processado no servidor; o usuário pode reenviar com segurança
        setFormError(
          'O servidor confirmou que o comando não foi gravado. ' +
          'Você pode tentar salvar o membro novamente.'
        );
        setUncertainCommand(null);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setFormError('Erro ao consultar o servidor para reconciliação. Verifique a conexão.');
    } finally {
      if (isMountedRef.current) {
        setReconciling(false);
      }
    }
  }

  // Se não for admin, apresentar bloqueio claro de perfil
  if (!isAdmin) {
    return (
      <div className="members-page" role="main">
        <div className="members-card members-card--denied">
          <div className="members-denied-icon" aria-hidden="true">
            <Shield size={44} color="#ef4444" />
          </div>
          <h1>Acesso Restrito</h1>
          <p>
            O gerenciamento e cadastro de membros é restrito a administradores autorizados da igreja.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onBack}
            aria-label="Voltar para a página inicial"
          >
            <ArrowLeft size={16} /> Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="members-page" role="main">
      <div className="members-container">

        {/* Barra superior de navegação */}
        <header className="members-header">
          <button
            id="btn-back-home"
            type="button"
            className="btn-back"
            onClick={onBack}
            aria-label="Voltar para a página inicial"
          >
            <ArrowLeft size={18} />
            <span>Início</span>
          </button>

          <div className="members-header-title-box">
            <div className="members-church-badge" title={`Igreja: ${churchName}`}>
              <Users size={14} />
              <span>{churchName}</span>
            </div>
            <h1 className="members-title">Gestão de Membros</h1>
          </div>

          <button
            id="btn-open-create-member"
            type="button"
            className="btn btn-primary btn-add-member"
            onClick={() => {
              setShowCreateModal(true);
              setFormError(null);
            }}
            disabled={!isOnline}
            aria-label="Cadastrar novo membro"
          >
            <UserPlus size={16} />
            <span>Cadastrar membro</span>
          </button>
        </header>

        {/* Alertas de contexto (offline, sucesso, incerto) */}
        {!isOnline && (
          <div className="alert-banner alert-banner--warning" role="alert">
            <WifiOff size={16} />
            <span>
              Você está sem conexão com a internet. O cadastro de membros está temporariamente bloqueado.
            </span>
          </div>
        )}

        {uncertainCommand && (
          <div className="alert-banner alert-banner--uncertain" role="alert">
            <AlertCircle size={18} />
            <div className="alert-banner-content">
              <strong>Resposta incerta do servidor:</strong>
              <p>
                O envio de "{uncertainCommand.displayName}" foi interrompido antes da confirmação.
                Verifique antes de tentar novo cadastro.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleReconcileReceipt}
                disabled={reconciling || !isOnline}
              >
                {reconciling ? (
                  <RefreshCw size={14} className="spin-icon" />
                ) : (
                  <RefreshCw size={14} />
                )}
                <span>Verificar confirmação</span>
              </button>
            </div>
          </div>
        )}

        {successMessage && (
          <div className="alert-banner alert-banner--success" role="status">
            <CheckCircle2 size={16} />
            <span>{successMessage}</span>
            <button
              type="button"
              className="alert-close-btn"
              onClick={() => setSuccessMessage(null)}
              aria-label="Fechar mensagem de sucesso"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {listError && (
          <div className="alert-banner alert-banner--error" role="alert">
            <AlertCircle size={16} />
            <span>{listError}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => loadMembers(page)}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Modal / Formulário de Cadastro */}
        {showCreateModal && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-create-title">
            <div className="modal-card">
              <div className="modal-header">
                <div className="modal-title-row">
                  <UserPlus size={18} color="var(--primary)" />
                  <h2 id="modal-create-title">Cadastrar Novo Membro</h2>
                </div>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => {
                    if (!submitting) setShowCreateModal(false);
                  }}
                  disabled={submitting}
                  aria-label="Fechar formulário"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="modal-desc">
                Cadastre o nome do membro para utilizá-lo nas escalas da igreja.
                O cadastro não concede login, acesso ou liderança. Nomes homônimos são permitidos.
              </p>

              {formError && (
                <div className="form-error-banner" role="alert">
                  <AlertCircle size={15} />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleCreateMember}>
                <div className="form-group">
                  <label htmlFor="member-display-name" className="form-label">
                    Nome completo do membro:
                  </label>
                  <input
                    id="member-display-name"
                    type="text"
                    className="form-input"
                    placeholder="Ex: Maria de Souza"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={120}
                    disabled={submitting || !isOnline}
                    autoFocus
                    required
                  />
                  <div className="input-hint">
                    <span>{nameInput.trim().length}/120 caracteres</span>
                    <span>Acentos, cedilhas e apóstrofos são preservados</span>
                  </div>
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowCreateModal(false)}
                    disabled={submitting}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting || !isOnline || !nameInput.trim()}
                  >
                    {submitting ? 'Salvando membro…' : 'Salvar membro'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Tabela de Membros */}
        <section className="members-content-card" aria-label="Lista de membros cadastrados">
          <div className="members-content-header">
            <div>
              <h2 className="members-section-title">Membros Cadastrados</h2>
              <p className="members-section-subtitle">
                {totalCount === 1
                  ? '1 membro cadastrado'
                  : `${totalCount} membros cadastrados`}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-refresh"
              onClick={() => loadMembers(page)}
              disabled={loading}
              title="Atualizar lista"
              aria-label="Atualizar lista de membros"
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>Atualizar</span>
            </button>
          </div>

          {loading ? (
            <div className="members-state-box" role="status" aria-live="polite">
              <RefreshCw size={24} className="spin-icon" color="var(--primary)" />
              <p>Carregando membros…</p>
            </div>
          ) : members.length === 0 ? (
            <div className="members-state-box members-state-box--empty">
              <Users size={36} color="var(--text-muted)" />
              <h3>Nenhum membro cadastrado</h3>
              <p>
                Esta igreja ainda não possui membros adicionais cadastrados.
                Cadastre o primeiro membro para iniciar a organização.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setShowCreateModal(true);
                  setFormError(null);
                }}
                disabled={!isOnline}
              >
                <UserPlus size={15} /> Cadastrar primeiro membro
              </button>
            </div>
          ) : (
            <div className="members-table-wrapper">
              <table className="members-table">
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col" style={{ width: '130px' }}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const isActive = m.status === 'active';
                    return (
                      <tr key={m.member_id}>
                        <td>
                          <div className="member-name-cell">
                            <div className="member-avatar-initial" aria-hidden="true">
                              {m.display_name.charAt(0).toUpperCase()}
                            </div>
                            <span className="member-name-text">{m.display_name}</span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${isActive ? 'badge-primary' : 'badge-pending'}`}
                            role="status"
                          >
                            {isActive ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação */}
          {totalPages > 1 && (
            <nav className="pagination-bar" aria-label="Navegação da paginação de membros">
              <button
                type="button"
                className="btn-pagination"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                aria-label="Página anterior"
              >
                <ChevronLeft size={16} />
                <span>Anterior</span>
              </button>

              <span className="pagination-status" aria-current="page">
                Página {page} de {totalPages}
              </span>

              <button
                type="button"
                className="btn-pagination"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                aria-label="Próxima página"
              >
                <span>Próxima</span>
                <ChevronRight size={16} />
              </button>
            </nav>
          )}
        </section>

      </div>

      <style>{`
        .members-page {
          min-height: 100vh;
          background: var(--bg-secondary);
          padding: 24px 20px 48px;
          display: flex;
          justify-content: center;
        }

        .members-container {
          width: 100%;
          max-width: 800px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Cabeçalho */
        .members-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          padding: 8px 0;
        }

        .btn-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          padding: 8px 14px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-back:hover {
          color: var(--text-primary);
          background: var(--bg-surface);
          border-color: var(--border-focus);
        }

        .members-header-title-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          flex: 1;
          text-align: center;
        }

        .members-church-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: var(--primary);
          background: var(--primary-surface);
          padding: 3px 10px;
          border-radius: var(--radius-full);
          border: 1px solid var(--primary-border);
        }

        .members-title {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0;
          color: var(--text-primary);
        }

        .btn-add-member {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 700;
        }

        @media (max-width: 600px) {
          .members-header {
            flex-direction: column;
            align-items: stretch;
          }
          .members-header-title-box {
            text-align: left;
            align-items: flex-start;
          }
          .btn-add-member {
            width: 100%;
            justify-content: center;
          }
        }

        /* Banners de Alerta */
        .alert-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          font-size: 13px;
          line-height: 1.45;
        }

        .alert-banner--warning {
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.35);
          color: #f59e0b;
        }

        .alert-banner--uncertain {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.35);
          color: #f87171;
        }

        .alert-banner-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }

        .alert-banner-content p {
          margin: 0;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .alert-banner--success {
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.35);
          color: #10b981;
          align-items: center;
        }

        .alert-banner--error {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.35);
          color: #f87171;
          align-items: center;
          justify-content: space-between;
        }

        .alert-close-btn {
          background: transparent;
          border: none;
          color: currentColor;
          cursor: pointer;
          margin-left: auto;
          display: flex;
          align-items: center;
        }

        /* Card de Conteúdo Principal */
        .members-content-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-md);
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .members-content-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .members-section-title {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
          color: var(--text-primary);
        }

        .members-section-subtitle {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .btn-refresh {
          padding: 6px 12px;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        /* Tabela */
        .members-table-wrapper {
          overflow-x: auto;
        }

        .members-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          text-align: left;
        }

        .members-table th {
          padding: 10px 12px;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-subtle);
        }

        .members-table td {
          padding: 12px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .member-name-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .member-avatar-initial {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 13px;
          flex-shrink: 0;
        }

        .member-name-text {
          font-weight: 600;
          color: var(--text-primary);
          word-break: break-word;
        }

        /* Estados Vazios e Carregando */
        .members-state-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          text-align: center;
          gap: 12px;
          color: var(--text-muted);
        }

        .members-state-box--empty h3 {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .members-state-box--empty p {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 400px;
          margin: 0 0 8px;
        }

        /* Paginação */
        .pagination-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }

        .btn-pagination {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          padding: 6px 12px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-pagination:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btn-pagination:not(:disabled):hover {
          color: var(--text-primary);
          background: var(--bg-card-hover);
        }

        .pagination-status {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
        }

        /* Modal */
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 500;
          backdrop-filter: blur(2px);
          animation: fadeIn 0.15s ease-out;
        }

        .modal-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          padding: 28px;
          width: 100%;
          max-width: 460px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          animation: scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .modal-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .modal-title-row h2 {
          font-size: 17px;
          font-weight: 700;
          margin: 0;
          color: var(--text-primary);
        }

        .modal-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 4px;
          border-radius: var(--radius-sm);
        }

        .modal-close-btn:hover {
          color: var(--text-primary);
        }

        .modal-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.45;
        }

        .form-error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.35);
          color: #f87171;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          font-size: 12px;
        }

        .input-hint {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .modal-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 8px;
        }

        /* Estado Negado */
        .members-card--denied {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          padding: 48px 32px;
          max-width: 440px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .spin-icon {
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
