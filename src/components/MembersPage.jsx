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
import {
  isDefinitiveServerError,
  isUncertainResponse,
  validateAndNormalizeMemberName,
  savePendingMemberCommand,
  loadPendingMemberCommand,
  removePendingMemberCommand,
  classifyReceiptCheckResult,
  dispatchMemberCreation,
  createInitialMemberListState,
  applyMemberListTransition,
  getMemberListViewState,
  createListRequestCoordinator,
} from '../utils/memberCommandService';
export { isDefinitiveServerError, isUncertainResponse };


export default function MembersPage({ onBack }) {
  const { session, churchAccess, authState } = useAuth();

  const churchId     = churchAccess?.church_id;
  const churchName   = churchAccess?.church_name || 'Igreja';
  const isAdmin      = churchAccess?.is_admin || false;
  const currentUserId = session?.user?.id;

  // Estado da listagem e coordenação de concorrência
  const [listState, setListState]     = useState(createInitialMemberListState);
  const coordinatorRef                = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createListRequestCoordinator();
  }
  const [page, setPage]               = useState(1);
  const pageSize                      = 10;


  // Estado do formulário de criação
  const [showCreateModal, setShowCreateModal]   = useState(false);
  const [nameInput, setNameInput]               = useState('');
  const [submitting, setSubmitting]             = useState(false);
  const [retrying, setRetrying]                 = useState(false);
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

  // Recupera comando pendente retido no storage de sessão para esta conta e igreja
  useEffect(() => {
    if (!currentUserId || !churchId || typeof window === 'undefined') {
      setUncertainCommand(null);
      return;
    }
    const saved = loadPendingMemberCommand(window.sessionStorage, currentUserId, churchId);
    setUncertainCommand(saved);
  }, [churchId, currentUserId]);

  // Limpar lista se perder autorização ou trocar de conta
  useEffect(() => {
    if (!churchAccess || authState !== 'access_granted') {
      if (coordinatorRef.current) coordinatorRef.current.reset();
      setListState(createInitialMemberListState());
    }
  }, [churchAccess, authState]);

  /**
   * Consulta a lista paginada de membros da igreja autorizada com proteção contra concorrência.
   */
  const loadMembers = useCallback(async (targetPage = page, options = {}) => {
    if (!supabase || !churchId || !isAdmin) return;

    const requestId = coordinatorRef.current.getNextRequestId();
    setListState((prev) => applyMemberListTransition(prev, { type: 'FETCH_START' }));

    try {
      const offset = (targetPage - 1) * pageSize;
      const { data, error } = await supabase.schema('public').rpc('list_church_members', {
        p_church_id: churchId,
        p_limit: pageSize,
        p_offset: offset,
      });

      // Ignora respostas obsoletas se o componente desmontou ou se uma consulta mais recente foi disparada (Requisito 5)
      if (!isMountedRef.current || !coordinatorRef.current.isCurrent(requestId)) {
        return;
      }

      if (error) {
        console.error('[MembersPage] Falha ao consultar membros:', error.message);
        setListState((prev) =>
          applyMemberListTransition(prev, {
            type: 'FETCH_ERROR',
            error,
            hasPendingCreationSuccess: Boolean(options.hasPendingCreationSuccess),
          })
        );
        return;
      }

      setListState((prev) =>
        applyMemberListTransition(prev, {
          type: 'FETCH_SUCCESS',
          data,
        })
      );
    } catch (err) {
      if (!isMountedRef.current || !coordinatorRef.current.isCurrent(requestId)) {
        return;
      }
      console.error('[MembersPage] Erro inesperado ao listar membros:', err);
      setListState((prev) =>
        applyMemberListTransition(prev, {
          type: 'FETCH_ERROR',
          error: err,
          hasPendingCreationSuccess: Boolean(options.hasPendingCreationSuccess),
        })
      );
    }
  }, [churchId, isAdmin, page, pageSize]);

  // Carregar dados na montagem e na troca de página
  useEffect(() => {
    if (churchId && isAdmin) {
      loadMembers(page);
    }
  }, [churchId, isAdmin, page, loadMembers]);

  /**
   * Executa a chamada RPC de criação de membro, retendo a identidade do comando
   * antes do envio e gerenciando respostas incertas versus definitivas.
   */
  async function executeMemberCreation(commandId, normalizedName) {
    if (!supabase || !churchId) return;

    const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
    const rpcCaller = (params) => supabase.schema('public').rpc('create_church_member', params);

    const result = await dispatchMemberCreation({
      storage,
      rpcCaller,
      churchId,
      userId: currentUserId,
      commandId,
      displayName: normalizedName,
    });

    if (!isMountedRef.current) return;

    if (result.status === 'STORAGE_FAILED') {
      // Se o armazenamento estiver indisponível ou a gravação retornar false,
      // interrompe antes da RPC, mantém o nome preenchido e mostra mensagem clara.
      // O modal permanece aberto e nameInput não é alterado.
      setFormError(result.message);
      return;
    }

    if (result.status === 'UNCERTAIN') {
      setUncertainCommand(result.pendingCmd);
      setShowCreateModal(false);
      setFormError(result.message);
      return;
    }

    if (result.status === 'DEFINITIVE_ERROR') {
      console.error('[MembersPage] Erro definitivo retornado ao criar membro:', result.message);
      setUncertainCommand(null);
      setFormError(result.message);
      return;
    }

    if (result.status === 'SUCCESS') {
      setUncertainCommand(null);
      setNameInput('');
      setShowCreateModal(false);
      setSuccessMessage(result.message);
      setPage(1);
      loadMembers(1, { hasPendingCreationSuccess: true });
      return;
    }

    if (result.status === 'ABORTED') {
      setFormError(result.message);
      return;
    }
  }

  /**
   * Submete a criação de um novo membro.
   */
  async function handleCreateMember(e) {
    e.preventDefault();
    if (submitting || retrying) return;

    if (!isOnline) {
      setFormError('Você está sem conexão com a internet. O cadastro não pode ser realizado offline.');
      return;
    }

    const validation = validateAndNormalizeMemberName(nameInput);
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }
    const normalized = validation.normalizedName;

    // Se há um comando incerto pendente, exigir reconciliação ou reexecução prévia
    if (uncertainCommand) {
      setFormError('Existe um comando anterior com resposta incerta. Reconcilie o resultado antes de tentar novamente.');
      return;
    }

    // Cria a identidade do comando antes do envio
    const commandId = crypto.randomUUID();
    setSubmitting(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      await executeMemberCreation(commandId, normalized);
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  /**
   * Reexecuta com segurança o comando retido com o mesmo command_id e os mesmos parâmetros.
   * A função RPC idempotente devolverá o resultado original ou executará uma única criação.
   */
  async function handleRetryCommand() {
    if (!uncertainCommand || retrying || reconciling) return;
    if (!isOnline) {
      setFormError('Sem conexão com a internet. Verifique a rede antes de reexecutar.');
      return;
    }

    setRetrying(true);
    setFormError(null);
    try {
      await executeMemberCreation(uncertainCommand.commandId, uncertainCommand.displayName);
    } finally {
      if (isMountedRef.current) {
        setRetrying(false);
      }
    }
  }

  /**
   * Reconcilia um comando com resposta incerta chamando get_create_member_receipt.
   * Falha na consulta NÃO comprova término sem gravação; o comando não é descartado.
   */
  async function handleReconcileReceipt() {
    if (!uncertainCommand || !supabase || reconciling || retrying) return;

    setReconciling(true);
    setFormError(null);

    try {
      const { data, error } = await supabase.schema('public').rpc('get_create_member_receipt', {
        p_church_id: uncertainCommand.churchId,
        p_command_id: uncertainCommand.commandId,
      });

      if (!isMountedRef.current) return;

      const result = classifyReceiptCheckResult(error, data);

      if (result.status === 'ERROR') {
        // Falha na consulta de recibo: NÃO comprova término sem gravação!
        // O comando NÃO é descartado. Mantém a identidade e o storage.
        setFormError(result.message);
        return;
      }

      if (result.status === 'CONFIRMED') {
        // Confirmado no servidor!
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingMemberCommand(window.sessionStorage, uncertainCommand.userId, uncertainCommand.churchId);
        }
        setUncertainCommand(null);
        setNameInput('');
        setShowCreateModal(false);
        setSuccessMessage(`Cadastro de "${result.member.display_name}" confirmado com sucesso no servidor!`);
        setPage(1);
        loadMembers(1, { hasPendingCreationSuccess: true });
        return;
      }

      if (result.status === 'EMPTY_RECEIPT') {
        // Recibo ainda não localizado: NÃO comprova término sem gravação!
        // NÃO descarta o comando e autoriza reexecução com a mesma chave.
        setFormError(result.message);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      // Exceção de rede: também NÃO descarta o comando!
      setFormError('Erro ao consultar o servidor para reconciliação. A operação pendente foi preservada.');
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

  const viewState = getMemberListViewState(listState);
  const { members, totalCount } = listState;
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
            disabled={!isOnline || !!uncertainCommand}
            aria-label="Cadastrar novo membro"
            title={uncertainCommand ? "Reconcilie ou reexecute o comando pendente antes de cadastrar outro membro" : undefined}
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
                A identidade da operação foi retida para evitar duplicidade.
              </p>
              {formError && (
                <p style={{ marginTop: '4px', fontSize: '0.9rem', color: '#991b1b' }}>
                  {formError}
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                <button
                  type="button"
                  id="btn-reconcile-receipt"
                  className="btn btn-secondary btn-sm"
                  onClick={handleReconcileReceipt}
                  disabled={reconciling || retrying || !isOnline}
                >
                  {reconciling ? (
                    <RefreshCw size={14} className="spin-icon" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  <span>Verificar confirmação</span>
                </button>
                <button
                  type="button"
                  id="btn-retry-command"
                  className="btn btn-primary btn-sm"
                  onClick={handleRetryCommand}
                  disabled={reconciling || retrying || !isOnline}
                >
                  {retrying ? (
                    <RefreshCw size={14} className="spin-icon" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  <span>Reexecutar cadastro</span>
                </button>
              </div>
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

        {listState.errorMessage && viewState.showTable && (
          <div className="alert-banner alert-banner--error" role="alert">
            <AlertCircle size={16} />
            <div className="alert-banner-content" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '12px' }}>
              <span>{listState.errorMessage}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => loadMembers(page)}
                style={{ whiteSpace: 'nowrap' }}
              >
                <RefreshCw size={13} /> Tentar novamente
              </button>
            </div>
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
                {viewState.totalizerText}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-refresh"
              onClick={() => loadMembers(page)}
              disabled={listState.status === 'loading'}
              title="Atualizar lista"
              aria-label="Atualizar lista de membros"
            >
              <RefreshCw size={14} className={listState.status === 'loading' ? 'spin-icon' : ''} />
              <span>Atualizar</span>
            </button>
          </div>

          {viewState.isInitialLoading ? (
            <div className="members-state-box" role="status" aria-live="polite">
              <RefreshCw size={24} className="spin-icon" color="var(--primary)" />
              <p>Carregando membros…</p>
            </div>
          ) : viewState.showInitialErrorState ? (
            <div className="members-state-box members-state-box--error" role="alert">
              <AlertCircle size={36} color="#ef4444" />
              <h3>Não foi possível carregar a lista de membros</h3>
              <p>{listState.errorMessage}</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => loadMembers(page)}
              >
                <RefreshCw size={15} /> Tentar novamente
              </button>
            </div>
          ) : viewState.showEmptyState ? (
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
                disabled={page <= 1 || listState.status === 'loading'}
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
                disabled={page >= totalPages || listState.status === 'loading'}
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

        .members-state-box--empty h3,
        .members-state-box--error h3 {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }

        .members-state-box--empty p,
        .members-state-box--error p {
          font-size: 13px;
          color: var(--text-secondary);
          max-width: 440px;
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
