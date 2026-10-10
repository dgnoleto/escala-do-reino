import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { createListRequestCoordinator } from '../utils/memberCommandService';
import {
  Mail,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter
} from 'lucide-react';
import IssueInvitationModal from './IssueInvitationModal';

/**
 * AdminInvitationsTab — gestão paginada de convites da igreja para administradores.
 *
 * Filtros suportados pelo backend:
 *   - 'all'      → todos os convites
 *   - 'open'     → abertos e dentro do prazo
 *   - 'redeemed' → já consumidos
 *   - 'revoked'  → cancelados por reemissão
 *   - 'expired'  → prazo de 72h transcorrido sem consumo
 */
export default function AdminInvitationsTab({ churchId, churchName, onInvitationIssued }) {
  const { session, getAuthSnapshot } = useAuth ? useAuth() : {};
  const [invitations, setInvitations] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // Modal para reemissão direta
  const [reissueMember, setReissueMember] = useState(null);

  const pageSize = 10;
  const isMountedRef = useRef(true);
  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createListRequestCoordinator();
  }
  const currentChurchIdRef = useRef(churchId);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Limpa imediatamente dados e modal ao trocar de comunidade
  useEffect(() => {
    if (currentChurchIdRef.current !== churchId) {
      currentChurchIdRef.current = churchId;
      coordinatorRef.current.reset();
      setInvitations([]);
      setTotalCount(0);
      setReissueMember(null);
      setErrorMessage(null);
    }
  }, [churchId]);

  const loadInvitations = useCallback(async (targetPage = page, targetFilter = statusFilter) => {
    if (!supabase || !churchId) return;

    const requestId = coordinatorRef.current.getNextRequestId();
    const expectedChurchId = churchId;
    const snapshot = getAuthSnapshot ? getAuthSnapshot() : null;

    setLoading(true);
    setErrorMessage(null);

    const offset = (targetPage - 1) * pageSize;
    const filterParam = targetFilter === 'all' ? null : targetFilter;

    try {
      const { data, error } = await supabase.schema('public').rpc('list_church_invitations', {
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
        setErrorMessage(error.message || 'Falha ao carregar lista de convites.');
        setInvitations([]);
        setTotalCount(0);
        return;
      }

      const rows = Array.isArray(data) ? data : [];
      setInvitations(rows);
      const total = rows.length > 0 ? Number(rows[0].total_count || 0) : 0;
      setTotalCount(total);

    } catch (err) {
      if (!isMountedRef.current || !coordinatorRef.current.isCurrent(requestId) || currentChurchIdRef.current !== expectedChurchId) {
        return;
      }
      setErrorMessage(err.message || 'Erro ao consultar convites.');
      setInvitations([]);
      setTotalCount(0);
    } finally {
      if (isMountedRef.current && coordinatorRef.current.isCurrent(requestId) && currentChurchIdRef.current === expectedChurchId) {
        setLoading(false);
      }
    }
  }, [churchId, page, statusFilter, pageSize, getAuthSnapshot]);

  useEffect(() => {
    loadInvitations(page, statusFilter);
  }, [loadInvitations, page, statusFilter]);

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

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function getStatusBadge(status) {
    switch (status) {
      case 'open':
        return <span className="badge badge-primary" role="status">Aberto</span>;
      case 'redeemed':
        return <span className="badge badge-success" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }} role="status">Consumido</span>;
      case 'revoked':
        return <span className="badge badge-pending" role="status">Cancelado</span>;
      case 'expired':
        return <span className="badge" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }} role="status">Expirado</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  }

  return (
    <div className="admin-tab-container" role="region" aria-label="Gestão de convites da igreja">
      {/* Barra de Filtros e Ações */}
      <div className="admin-tab-header">
        <div className="filter-group">
          <Filter size={15} color="var(--text-muted)" />
          <label htmlFor="filter-invitations-status" className="visually-hidden">Filtrar por situação</label>
          <select
            id="filter-invitations-status"
            className="form-select"
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            disabled={loading}
          >
            <option value="all">Todos os convites</option>
            <option value="open">Abertos</option>
            <option value="redeemed">Consumidos</option>
            <option value="revoked">Cancelados</option>
            <option value="expired">Expirados</option>
          </select>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => loadInvitations(page, statusFilter)}
          disabled={loading}
          title="Atualizar lista"
          aria-label="Atualizar convites"
        >
          <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
          <span>Atualizar</span>
        </button>
      </div>

      {errorMessage && (
        <div className="alert-banner alert-banner--error" role="alert" style={{ marginBottom: '14px' }}>
          <AlertCircle size={15} />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="members-state-box" role="status" aria-live="polite">
          <RefreshCw size={24} className="spin-icon" color="var(--primary)" />
          <p>Carregando convites…</p>
        </div>
      ) : invitations.length === 0 ? (
        <div className="members-state-box members-state-box--empty">
          <Mail size={36} color="var(--text-muted)" />
          <h3>Nenhum convite encontrado</h3>
          <p>Não há convites correspondentes ao filtro selecionado nesta igreja.</p>
        </div>
      ) : (
        <div className="members-table-wrapper">
          <table className="members-table" aria-label="Tabela de convites emitidos">
            <thead>
              <tr>
                <th scope="col">Membro</th>
                <th scope="col">E-mail Destinatário</th>
                <th scope="col">Emitido em</th>
                <th scope="col">Vencimento</th>
                <th scope="col" style={{ width: '110px' }}>Situação</th>
                <th scope="col" style={{ width: '100px' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.invitation_id}>
                  <td>
                    <strong>{inv.member_display_name}</strong>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {inv.recipient_email}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {formatDateTime(inv.issued_at)}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {formatDateTime(inv.expires_at)}
                    </span>
                  </td>
                  <td>
                    {getStatusBadge(inv.status)}
                  </td>
                  <td>
                    {(inv.status === 'open' || inv.status === 'expired') && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setReissueMember({
                          member_id: inv.member_id,
                          display_name: inv.member_display_name,
                          isReissue: true,
                          status: inv.status,
                        })}
                        title="Reemitir convite"
                        style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                      >
                        Reemitir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginação */}
      {totalPages > 1 && (
        <nav className="pagination-bar" aria-label="Navegação da paginação de convites" style={{ marginTop: '16px' }}>
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
            Página {page} de {totalPages} ({totalCount} convites)
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

      {/* Modal de Reemissão */}
      {reissueMember && (
        <IssueInvitationModal
          member={reissueMember}
          churchId={churchId}
          churchName={churchName}
          isOpen={true}
          isReissue={true}
          onClose={() => setReissueMember(null)}
          onSuccess={() => {
            loadInvitations(page, statusFilter);
            if (onInvitationIssued) onInvitationIssued();
          }}
        />
      )}

      <style>{`
        .admin-tab-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .admin-tab-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }

        .filter-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .form-select {
          padding: 6px 10px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-card);
          color: var(--text-primary);
          font-size: 13px;
        }

        .visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
      `}</style>
    </div>
  );
}
