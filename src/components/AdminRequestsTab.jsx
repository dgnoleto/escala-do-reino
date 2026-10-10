import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { createListRequestCoordinator } from '../utils/memberCommandService';
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  User,
  X
} from 'lucide-react';
import {
  isUncertainInvitationResponse,
  validateReceiptPayload,
  formatInvitationErrorMessage,
  savePendingInvitationCommand,
  loadPendingInvitationCommand,
  removePendingInvitationCommand,
  checkPendingOperationConflict,
} from '../utils/invitationCommandService';

/**
 * AdminRequestsTab — gestão paginada e análise administrativa de solicitações de alteração de nome.
 *
 * Requisitos:
 * - Exibe comparação explícita: Nome original, Nome atual e Nome proposto.
 * - Apresenta o prazo restante de 72h derivado do convite original.
 * - Confirmação do alvo e da ação antes de aprovar ou rejeitar.
 * - Trata concorrência: se outro admin já tiver decidido, exibe diagnóstico sem anunciar concessão.
 * - Trata expiração do servidor: 'REQUEST_EXPIRED' encerra sem concessão de acesso.
 */
export default function AdminRequestsTab({ churchId, onDecisionCompleted }) {
  const { session, getAuthSnapshot } = useAuth();
  const userId = session?.user?.id;

  const [requests, setRequests] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState(null);

  // Modal de decisão para confirmação segura
  const [decisionModal, setDecisionModal] = useState(null); // { request, decision: 'approve' | 'reject' }
  const [isDeciding, setIsDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState(null);

  const activeCommandRef = useRef(null);
  const isDecidingSyncRef = useRef(false);
  const pageSize = 10;
  const isMountedRef = useRef(true);

  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createListRequestCoordinator();
  }
  const currentChurchIdRef = useRef(churchId);

  useEffect(() => {
    isMountedRef.current = true;

    // Restaura e reconcilia decisão pendente em caso de recarga ou remontagem da aba (C3)
    if (typeof window !== 'undefined' && window.sessionStorage && userId && churchId) {
      const saved = loadPendingInvitationCommand(window.sessionStorage, userId, 'decide_access_request');
      if (saved && saved.churchId === churchId && saved.commandId) {
        activeCommandRef.current = saved;

        (async () => {
          if (!supabase) return;
          try {
            const { data: recData, error: recErr } = await supabase.schema('public').rpc('get_invitation_command_receipt', {
              p_command_id: saved.commandId,
            });

            if (!isMountedRef.current || currentChurchIdRef.current !== churchId) return;

            if (!recErr && Array.isArray(recData) && recData.length > 0) {
              const validation = validateReceiptPayload('decide_access_request', recData[0], {
                commandId: saved.commandId,
                churchId,
                requestId: saved.requestId,
                memberId: saved.memberId,
                decision: saved.decision,
              });

              if (validation.valid) {
                const payload = validation.payload;
                activeCommandRef.current = null;
                if (typeof window !== 'undefined' && window.sessionStorage) {
                  removePendingInvitationCommand(window.sessionStorage, userId, 'decide_access_request');
                }
                handleDecisionResult(payload);
              }
            }
          } catch {}
        })();
      }
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [userId, churchId]);

  // Limpa imediatamente dados e modal ao trocar de comunidade
  useEffect(() => {
    if (currentChurchIdRef.current !== churchId) {
      currentChurchIdRef.current = churchId;
      coordinatorRef.current.reset();
      setRequests([]);
      setTotalCount(0);
      setDecisionModal(null);
      setErrorMessage(null);
      setFeedbackMessage(null);
    }
  }, [churchId]);

  const loadRequests = useCallback(async (targetPage = page, targetFilter = statusFilter) => {
    if (!supabase || !churchId) return;

    const requestId = coordinatorRef.current.getNextRequestId();
    const expectedChurchId = churchId;
    const snapshot = getAuthSnapshot ? getAuthSnapshot() : null;

    setLoading(true);
    setErrorMessage(null);

    const offset = (targetPage - 1) * pageSize;
    const filterParam = targetFilter === 'all' ? null : targetFilter;

    try {
      const { data, error } = await supabase.schema('public').rpc('list_church_access_requests', {
        p_church_id: churchId,
        p_status_filter: filterParam,
        p_limit: pageSize,
        p_offset: offset,
      });

      if (!isMountedRef.current || !coordinatorRef.current.isCurrent(requestId) || currentChurchIdRef.current !== expectedChurchId) {
        return;
      }
      if (snapshot && getAuthSnapshot && (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId)) {
        return;
      }

      if (error) {
        setErrorMessage(formatInvitationErrorMessage(error, 'admin_requests_list'));
        setRequests([]);
        setTotalCount(0);
        return;
      }

      const rows = Array.isArray(data) ? data : [];
      setRequests(rows);
      const total = rows.length > 0 ? Number(rows[0].total_count || 0) : 0;
      setTotalCount(total);

    } catch (err) {
      if (!isMountedRef.current || !coordinatorRef.current.isCurrent(requestId) || currentChurchIdRef.current !== expectedChurchId) {
        return;
      }
      setErrorMessage(formatInvitationErrorMessage(err, 'admin_requests_list'));
      setRequests([]);
      setTotalCount(0);
    } finally {
      if (isMountedRef.current && coordinatorRef.current.isCurrent(requestId) && currentChurchIdRef.current === expectedChurchId) {
        setLoading(false);
      }
    }
  }, [churchId, page, statusFilter, pageSize, getAuthSnapshot]);

  useEffect(() => {
    loadRequests(page, statusFilter);
  }, [loadRequests, page, statusFilter]);

  function handleFilterChange(newFilter) {
    setStatusFilter(newFilter);
    setPage(1);
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  /**
   * Executa a decisão administrativa (approve ou reject).
   */
  async function handleExecuteDecision() {
    if (!decisionModal || isDeciding || isDecidingSyncRef.current) return;

    const { request, decision } = decisionModal;

    // Avalia conflito de operação pendente existente (D2)
    const conflict = typeof window !== 'undefined' && window.sessionStorage && userId
      ? checkPendingOperationConflict(window.sessionStorage, userId, {
          action: 'decide_access_request',
          churchId,
          targetId: request.request_id,
          decision,
        })
      : { allowed: true, isRetry: false };

    if (!conflict.allowed) {
      if (conflict.reason === 'incompatible_decision') {
        const pendingDecText = conflict.existingCommand?.decision === 'approve' ? 'aprovação' : 'rejeição';
        const intendedText = decision === 'approve' ? 'aprovar' : 'rejeitar';
        setDecisionError(`Existe uma operação de ${pendingDecText} pendente para esta solicitação cujo resultado é desconhecido. Não é permitido alternar para ${intendedText} enquanto o resultado for desconhecido.`);
        return;
      }
      if (conflict.reason === 'other_target_pending') {
        setDecisionError('Existe uma decisão pendente para outra solicitação aguardando reconciliação com o servidor.');
        return;
      }
      setDecisionError('Existe uma operação pendente com resultado desconhecido.');
      return;
    }

    let command = activeCommandRef.current;
    if (conflict.isRetry && conflict.existingCommand) {
      command = conflict.existingCommand;
      activeCommandRef.current = command;
    } else if (!command || command.requestId !== request.request_id || command.decision !== decision) {
      command = {
        commandId: crypto.randomUUID(),
        action: 'decide_access_request',
        churchId,
        requestId: request.request_id,
        decision,
        userId,
      };
      activeCommandRef.current = command;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        savePendingInvitationCommand(window.sessionStorage, userId, command);
      }
    }

    isDecidingSyncRef.current = true;
    setIsDeciding(true);
    setDecisionError(null);
    const snapshot = getAuthSnapshot();

    try {
      const { data, error } = await supabase.schema('public').rpc('decide_access_request', {
        p_command_id: command.commandId,
        p_church_id: churchId,
        p_request_id: request.request_id,
        p_decision: decision,
      });

      if (!isMountedRef.current) return;
      if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

      const isUncertain = isUncertainInvitationResponse(error, data, 'decide_access_request');

      if (isUncertain) {
        // Consulta recibo
        try {
          const { data: recData, error: recErr } = await supabase.schema('public').rpc('get_invitation_command_receipt', {
            p_command_id: command.commandId,
          });

          if (!isMountedRef.current) return;
          if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

          if (!recErr && Array.isArray(recData) && recData.length > 0) {
            const validation = validateReceiptPayload('decide_access_request', recData[0], {
              commandId: command.commandId,
              churchId,
              requestId: request.request_id,
              memberId: request.member_id,
              decision,
            });
            if (validation.valid) {
              const payload = validation.payload;
              activeCommandRef.current = null;
              if (typeof window !== 'undefined' && window.sessionStorage) {
                removePendingInvitationCommand(window.sessionStorage, userId, 'decide_access_request', request.request_id);
              }
              handleDecisionResult(payload);
              return;
            }
          }
        } catch {}

        setDecisionError('A resposta do servidor demorou mais que o esperado. Não repita com nova intenção; tente novamente mantendo o mesmo comando.');
        return;
      }

      if (error) {
        activeCommandRef.current = null;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingInvitationCommand(window.sessionStorage, userId, 'decide_access_request', request.request_id);
        }
        setDecisionError(formatInvitationErrorMessage(error));
        return;
      }

      const result = data[0];
      activeCommandRef.current = null;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        removePendingInvitationCommand(window.sessionStorage, userId, 'decide_access_request', request.request_id);
      }
      handleDecisionResult(result);

    } catch (err) {
      if (!isMountedRef.current) return;
      setDecisionError(formatInvitationErrorMessage(err));
    } finally {
      isDecidingSyncRef.current = false;
      if (isMountedRef.current) {
        setIsDeciding(false);
      }
    }
  }

  function handleDecisionResult(result) {
    setDecisionModal(null);

    if ((result.decision === 'approved' || result.decision === 'approve') && result.access_granted) {
      setFeedbackMessage({
        type: 'success',
        text: `Nome "${result.final_display_name}" aprovado com sucesso! Acesso concedido à comunidade.`,
      });
    } else if (result.decision === 'rejected' || result.decision === 'reject') {
      setFeedbackMessage({
        type: 'info',
        text: 'A solicitação foi rejeitada. A tentativa de acesso foi encerrada sem alteração no membro e sem conceder vínculo.',
      });
    } else if (result.decision === 'expired' || result.error_code === 'REQUEST_EXPIRED') {
      setFeedbackMessage({
        type: 'warning',
        text: 'A solicitação expirou antes da decisão. O encerramento foi persistido e nenhum acesso foi concedido.',
      });
    }

    loadRequests(page, statusFilter);
    if (onDecisionCompleted) onDecisionCompleted();
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function getStatusBadge(status) {
    switch (status) {
      case 'pending':
        return <span className="badge badge-pending" role="status">Pendente</span>;
      case 'approved':
        return <span className="badge badge-success" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }} role="status">Aprovada</span>;
      case 'rejected':
        return <span className="badge" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }} role="status">Rejeitada</span>;
      case 'cancelled':
        return <span className="badge" style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' }} role="status">Cancelada</span>;
      case 'expired':
        return <span className="badge" style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }} role="status">Expirada</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  }

  return (
    <div className="admin-tab-container" role="region" aria-label="Gestão de solicitações de alteração de nome">
      {/* Cabeçalho da aba */}
      <div className="admin-tab-header">
        <div className="filter-group">
          <Filter size={15} color="var(--text-muted)" />
          <label htmlFor="filter-requests-status" className="visually-hidden">Filtrar por situação</label>
          <select
            id="filter-requests-status"
            className="form-select"
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            disabled={loading}
          >
            <option value="pending">Pendentes de análise</option>
            <option value="all">Todas as solicitações</option>
            <option value="approved">Aprovadas</option>
            <option value="rejected">Rejeitadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="expired">Expiradas</option>
          </select>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => loadRequests(page, statusFilter)}
          disabled={loading}
          title="Atualizar lista"
          aria-label="Atualizar solicitações"
        >
          <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
          <span>Atualizar</span>
        </button>
      </div>

      {feedbackMessage && (
        <div className={`alert-banner alert-banner--${feedbackMessage.type === 'success' ? 'success' : feedbackMessage.type === 'warning' ? 'warning' : 'info'}`} role="status" style={{ marginBottom: '14px' }}>
          {feedbackMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{feedbackMessage.text}</span>
          <button
            type="button"
            className="alert-close-btn"
            onClick={() => setFeedbackMessage(null)}
            aria-label="Fechar mensagem"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="members-state-box" role="status" aria-live="polite">
          <RefreshCw size={24} className="spin-icon" color="var(--primary)" />
          <p>Carregando solicitações…</p>
        </div>
      ) : errorMessage ? (
        <div className="members-state-box members-state-box--error" role="alert">
          <AlertCircle size={36} color="var(--error, #e53e3e)" />
          <h3>Não foi possível carregar as solicitações</h3>
          <p>{errorMessage}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadRequests(page, statusFilter)}
            style={{ marginTop: '12px' }}
          >
            <RefreshCw size={13} />
            <span>Atualizar lista</span>
          </button>
        </div>
      ) : requests.length === 0 ? (
        <div className="members-state-box members-state-box--empty">
          <FileText size={36} color="var(--text-muted)" />
          <h3>Nenhuma solicitação encontrada</h3>
          <p>Não há solicitações correspondentes ao filtro atual nesta igreja.</p>
        </div>
      ) : (
        <div className="members-table-wrapper">
          <table className="members-table" aria-label="Tabela de solicitações de alteração de nome">
            <thead>
              <tr>
                <th scope="col">Nome Cadastrado</th>
                <th scope="col">Nome Proposto</th>
                <th scope="col">Solicitante</th>
                <th scope="col">Vencimento</th>
                <th scope="col" style={{ width: '100px' }}>Situação</th>
                <th scope="col" style={{ width: '140px' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => {
                const isPending = req.status === 'pending';
                const isApproveConflict = typeof window !== 'undefined' && window.sessionStorage && userId
                  ? !checkPendingOperationConflict(window.sessionStorage, userId, {
                      action: 'decide_access_request',
                      churchId,
                      targetId: req.request_id,
                      decision: 'approve',
                    }).allowed
                  : false;

                const isRejectConflict = typeof window !== 'undefined' && window.sessionStorage && userId
                  ? !checkPendingOperationConflict(window.sessionStorage, userId, {
                      action: 'decide_access_request',
                      churchId,
                      targetId: req.request_id,
                      decision: 'reject',
                    }).allowed
                  : false;

                return (
                  <tr key={req.request_id}>
                    <td>
                      <div>
                        <strong>{req.current_display_name}</strong>
                        {req.original_display_name && req.original_display_name !== req.current_display_name && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Original: {req.original_display_name}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <strong style={{ color: 'var(--primary)', fontSize: '0.92rem' }}>
                        {req.proposed_display_name}
                      </strong>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {req.requester_email || '—'}
                      </span>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Enviado em {formatDateTime(req.submitted_at)}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem' }}>
                        <Clock size={12} color="var(--text-muted)" />
                        <span>{formatDateTime(req.expires_at)}</span>
                      </div>
                    </td>
                    <td>
                      {getStatusBadge(req.status)}
                    </td>
                    <td>
                      {isPending ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              if (isApproveConflict) return;
                              setDecisionModal({ request: req, decision: 'approve' });
                              setDecisionError(null);
                            }}
                            disabled={isDeciding || isApproveConflict}
                            id={`btn-approve-${req.request_id}`}
                            title={isApproveConflict ? "Operação de rejeição pendente para esta solicitação" : "Aprovar nome proposto"}
                            style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                          >
                            Aprovar
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              if (isRejectConflict) return;
                              setDecisionModal({ request: req, decision: 'reject' });
                              setDecisionError(null);
                            }}
                            disabled={isDeciding || isRejectConflict}
                            id={`btn-reject-${req.request_id}`}
                            title={isRejectConflict ? "Operação de aprovação pendente para esta solicitação" : "Rejeitar solicitação"}
                            style={{ fontSize: '0.75rem', padding: '3px 8px', color: '#dc2626' }}
                          >
                            Rejeitar
                          </button>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {req.decided_by_name ? `Por: ${req.decided_by_name}` : 'Finalizada'}
                        </div>
                      )}
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
        <nav className="pagination-bar" aria-label="Navegação da paginação de solicitações" style={{ marginTop: '16px' }}>
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
            Página {page} de {totalPages} ({totalCount} solicitações)
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

      {/* Modal de Confirmação de Decisão */}
      {decisionModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-decision-title">
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title-row">
                {decisionModal.decision === 'approve' ? (
                  <CheckCircle2 size={18} color="#10b981" />
                ) : (
                  <XCircle size={18} color="#ef4444" />
                )}
                <h2 id="modal-decision-title">
                  {decisionModal.decision === 'approve' ? 'Aprovar Nome Proposto' : 'Rejeitar Solicitação de Nome'}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDecisionModal(null)}
                disabled={isDeciding}
                aria-label="Fechar confirmação"
              >
                <X size={18} />
              </button>
            </div>

            <div className="invite-context-card" style={{ marginTop: '8px' }}>
              <div className="invite-context-row">
                <span className="invite-context-label">Membro alvo:</span>
                <strong>{decisionModal.request.current_display_name}</strong>
              </div>
              <div className="invite-context-row">
                <span className="invite-context-label">Nome proposto:</span>
                <strong style={{ color: 'var(--primary)' }}>{decisionModal.request.proposed_display_name}</strong>
              </div>
              <div className="invite-context-row">
                <span className="invite-context-label">Solicitante:</span>
                <span>{decisionModal.request.requester_email}</span>
              </div>
            </div>

            {decisionModal.decision === 'approve' ? (
              <p className="modal-desc" style={{ marginTop: '12px' }}>
                Ao aprovar, o cadastro do membro será <strong>atualizado com o nome proposto</strong> e um vínculo de acesso básico será concedido imediatamente a esta conta.
              </p>
            ) : (
              <p className="modal-desc" style={{ marginTop: '12px', color: '#b91c1c' }}>
                Ao rejeitar, a solicitação será <strong>encerrada definitivamente</strong>. O cadastro do membro permanecerá inalterado e nenhum acesso será liberado. Uma nova tentativa exigirá a emissão de um novo convite.
              </p>
            )}

            {decisionError && (
              <div className="alert-banner alert-banner--error" role="alert" style={{ marginBottom: '14px' }}>
                <AlertCircle size={15} />
                <span>{decisionError}</span>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '18px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDecisionModal(null)}
                disabled={isDeciding}
              >
                Cancelar
              </button>

              <button
                type="button"
                className={`btn ${decisionModal.decision === 'approve' ? 'btn-primary' : 'btn-danger'}`}
                onClick={handleExecuteDecision}
                disabled={isDeciding || Boolean(typeof window !== 'undefined' && window.sessionStorage && userId && !checkPendingOperationConflict(window.sessionStorage, userId, {
                  action: 'decide_access_request',
                  churchId,
                  targetId: decisionModal.request.request_id,
                  decision: decisionModal.decision,
                }).allowed)}
                id="btn-confirm-decision-execute"
                style={decisionModal.decision === 'reject' ? { background: '#dc2626', borderColor: '#b91c1c', color: '#fff' } : {}}
              >
                {isDeciding ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" /> Processando…
                  </>
                ) : decisionModal.decision === 'approve' ? (
                  'Confirmar Aprovação'
                ) : (
                  'Confirmar Rejeição'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
