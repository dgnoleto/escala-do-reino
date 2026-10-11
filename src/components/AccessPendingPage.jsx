import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  Church,
  PlusCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
  ShieldAlert,
  Mail,
  WifiOff,
  LogOut,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight
} from 'lucide-react';
import { checkChurchCreationEligibility, loadPendingChurchCommand } from '../utils/churchCommandService';
import {
  loadAccessRequestMarker,
  removeAccessRequestMarker,
  formatInvitationErrorMessage,
} from '../utils/invitationCommandService';
import CreateChurchModal from './CreateChurchModal';

/**
 * AccessPendingPage — exibida para contas autenticadas sem vínculo elegível.
 *
 * Funcionalidades do incremento "Criar minha igreja":
 * - Consulta a elegibilidade da conta para criar uma nova igreja no servidor.
 * - Falha ao consultar elegibilidade não concede permissão de criação (estados carregando, erro e retry).
 * - Se elegível: oferece ação destacada "Criar minha igreja", abrindo o formulário controlado.
 * - Se já administra outra igreja: explica com clareza o impedimento e a regra de administração única.
 * - Se e-mail não confirmado ou bloqueio: apresenta a explicação correspondente.
 * - Suporta reconciliação de comando pendente mesmo quando o servidor retornar already_admin.
 * - Preserva estados de carregamento, erro, tentativa novamente e falta de conexão.
 * - Conclusão com sucesso redireciona com segurança para a igreja criada via refreshAccess.
 */
export default function AccessPendingPage() {
  const {
    session,
    signOut,
    refreshAccess,
    reloadChurchAccess,
    recordCreationConfirmation,
  } = useAuth();

  const user = session?.user;
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || null;
  const displayEmail = user?.email || null;
  const avatarUrl = user?.user_metadata?.avatar_url || null;

  // Estado de solicitação de acesso / proposta de nome vinculada à aba
  const [requestMarker, setRequestMarker] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestData, setRequestData] = useState(null);
  const [requestError, setRequestError] = useState(null);

  // Estado de elegibilidade para criação de igreja
  const [eligibilityState, setEligibilityState] = useState('checking'); // 'checking' | 'ready' | 'error'
  const [eligibilityData, setEligibilityData] = useState(null);
  const [eligibilityError, setEligibilityError] = useState(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Comando pendente na sessão
  const [pendingCommand, setPendingCommand] = useState(null);

  // Destino confirmado após criação e erro de recarga
  const [confirmedChurch, setConfirmedChurch] = useState(null);
  const [accessReloadError, setAccessReloadError] = useState(null);

  // Controle do modal de criação
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Monitora conectividade
  useEffect(() => {
    function handleOnline() { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Monitora comando pendente no storage
  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage && user?.id) {
      const cmd = loadPendingChurchCommand(window.sessionStorage, user.id);
      setPendingCommand(cmd);
    }
  }, [user?.id, eligibilityState, isCreateModalOpen]);

  // Consulta elegibilidade no servidor
  const loadEligibility = useCallback(async () => {
    if (!supabase || !user) return;
    setEligibilityState('checking');
    setEligibilityError(null);

    const res = await checkChurchCreationEligibility(supabase);

    if (res.success) {
      setEligibilityData(res);
      setEligibilityState('ready');
    } else {
      setEligibilityError(res.error || 'Falha ao verificar elegibilidade no servidor.');
      setEligibilityState('error');
    }
  }, [user]);

  useEffect(() => {
    loadEligibility();
  }, [loadEligibility]);

  // Monitora marcador de solicitação de acesso da aba
  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage && user?.id) {
      const marker = loadAccessRequestMarker(window.sessionStorage, user.id);
      setRequestMarker(marker);
    }
  }, [user?.id]);

  // Consulta a própria solicitação de acesso via get_my_access_request
  const loadMyAccessRequest = useCallback(async (marker) => {
    if (!supabase || !user || !marker?.churchId) return;
    setRequestLoading(true);
    setRequestError(null);

    try {
      const { data, error } = await supabase.schema('public').rpc('get_my_access_request', {
        p_church_id: marker.churchId,
      });

      if (error) {
        setRequestError(formatInvitationErrorMessage(error, 'invitee'));
        setRequestLoading(false);
        return;
      }

      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
      if (!row) {
        setRequestData(null);
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removeAccessRequestMarker(window.sessionStorage, user?.id);
        }
        setRequestMarker(null);
      } else {
        // Reconciliação estrita com o marcador
        if (row.church_id === marker.churchId && (!marker.requestId || row.request_id === marker.requestId)) {
          setRequestData(row);
        } else {
          setRequestData(null);
        }
      }
    } catch (err) {
      setRequestError(formatInvitationErrorMessage(err, 'invitee'));
    } finally {
      setRequestLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (requestMarker) {
      loadMyAccessRequest(requestMarker);
    }
  }, [requestMarker, loadMyAccessRequest]);

  // Acessa a comunidade após aprovação confirmada pelo servidor
  async function handleAccessApprovedChurch() {
    const targetChurchId = requestData?.church_id || requestMarker?.churchId;
    if (reloadChurchAccess && targetChurchId) {
      const res = await reloadChurchAccess(targetChurchId);
      // Remove o marcador apenas após revalidação concluída com sucesso
      if (res && res.success !== false) {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removeAccessRequestMarker(window.sessionStorage, user?.id);
        }
        setRequestMarker(null);
        setRequestData(null);
      }
    }
  }

  // Descarta o aviso terminal (rejeitada, cancelada ou expirada)
  function handleDismissRequestNotice() {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      removeAccessRequestMarker(window.sessionStorage, user?.id);
    }
    setRequestMarker(null);
    setRequestData(null);
    setRequestError(null);
  }

  function formatExpiresAt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', {
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

  // Transição segura para a igreja criada
  async function handleChurchCreated(createdChurch) {
    setIsCreateModalOpen(false);
    setConfirmedChurch(createdChurch);
    setAccessReloadError(null);
    if (createdChurch?.church_id && recordCreationConfirmation) {
      recordCreationConfirmation(createdChurch);
    }
    if (createdChurch?.church_id && refreshAccess) {
      try {
        const res = await refreshAccess(createdChurch.church_id);
        if (res && res.success === false && res.error) {
          setAccessReloadError(res.error);
        }
      } catch (err) {
        setAccessReloadError('A igreja foi criada, mas ocorreu uma falha ao atualizar o acesso.');
      }
    }
  }

  async function handleRetryAccessReload() {
    if (confirmedChurch?.church_id && refreshAccess) {
      setAccessReloadError(null);
      if (recordCreationConfirmation) {
        recordCreationConfirmation(confirmedChurch);
      }
      try {
        const res = await refreshAccess(confirmedChurch.church_id);
        if (res && res.success === false && res.error) {
          setAccessReloadError(res.error);
        }
      } catch (err) {
        setAccessReloadError('Falha ao recarregar acesso. Tente novamente.');
      }
    }
  }

  return (
    <div className="pending-page" role="main">
      <div className="pending-card" aria-label="Acesso à igreja ainda não liberado">

        {/* Ícone de espera */}
        <div className="pending-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <h1 className="pending-title">Você entrou na sua conta.</h1>
        <p className="pending-subtitle">Acesso à igreja ainda não liberado.</p>

        <p className="pending-description">
          Para usar o Escala do Reino com uma comunidade existente, você precisa ser
          convidado por um administrador e ter sua conta vinculada a um membro cadastrado.
        </p>

        {/* Orientação para continuidade a partir de convite recebido */}
        <div className="pending-invite-guidance" role="note">
          <div className="pending-invite-guidance-header">
            <Mail size={16} />
            <strong>Recebeu um convite para participar de uma igreja?</strong>
          </div>
          <p>
            Se você acabou de confirmar sua conta a partir de um convite de acesso:
          </p>
          <ul>
            <li>
              <strong>Retorne à aba original</strong> onde você abriu o convite; OU
            </li>
            <li>
              <strong>Reabra o link original do convite</strong> neste navegador para continuar a validação e confirmar seu nome.
            </li>
          </ul>
        </div>

        {/* Identificação da conta autenticada */}
        <div className="pending-account" aria-label="Conta autenticada">
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              className="pending-avatar"
              aria-hidden="true"
              referrerPolicy="no-referrer"
            />
          )}
          <div className="pending-account-info">
            {displayName && (
              <span className="pending-account-name">{displayName}</span>
            )}
            {displayEmail && (
              <span className="pending-account-email">{displayEmail}</span>
            )}
          </div>
        </div>

        {/* Bloco de Acompanhamento de Solicitação de Acesso / Proposta de Nome */}
        {requestMarker && (
          <div className="pending-request-section" style={{ width: '100%', marginBottom: '20px' }}>
            {requestLoading ? (
              <div className="status-notice status-notice--loading" role="status">
                <Loader2 size={16} className="status-notice-icon spin" />
                <span>Verificando situação da sua solicitação de acesso...</span>
              </div>
            ) : requestError ? (
              <div className="status-notice status-notice--error" role="alert">
                <AlertCircle size={16} className="status-notice-icon" />
                <div className="status-notice-text">
                  <span>{requestError}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm retry-btn"
                    onClick={() => loadMyAccessRequest(requestMarker)}
                    id="btn-retry-my-request"
                  >
                    <RefreshCw size={12} />
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : requestData?.status === 'approved' ? (
              <div className="create-church-card" style={{ borderColor: 'var(--primary)', background: 'var(--primary-surface)' }}>
                <div className="create-church-header">
                  <div className="create-church-icon" style={{ background: '#ecfdf5', borderColor: '#a7f3d0', color: '#059669' }}>
                    <CheckCircle2 size={20} />
                  </div>
                  <div className="create-church-info">
                    <span className="create-church-title">Solicitação Aprovada!</span>
                    <span className="create-church-desc">
                      Sua proposta para o nome <strong>"{requestData.proposed_display_name}"</strong> foi aprovada na comunidade <strong>{requestData.church_name}</strong>.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary create-church-btn"
                  onClick={handleAccessApprovedChurch}
                  id="btn-access-approved-church"
                >
                  <ArrowRight size={16} />
                  Acessar a Comunidade
                </button>
              </div>
            ) : requestData && (requestData.status === 'expired' || requestData.is_expired) ? (
              <div className="status-notice status-notice--warning" role="note">
                <Clock size={18} className="status-notice-icon" />
                <div className="status-notice-text">
                  <strong>Solicitação Expirada</strong>
                  <p>
                    O prazo para análise da proposta de nome na comunidade <strong>{requestData.church_name}</strong> expirou.
                    Para ingressar na comunidade, solicite um novo convite aos administradores.
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleDismissRequestNotice}
                    id="btn-dismiss-request-expired"
                    style={{ marginTop: '6px', alignSelf: 'flex-start' }}
                  >
                    Entendido
                  </button>
                </div>
              </div>
            ) : requestData?.status === 'rejected' ? (
              <div className="status-notice status-notice--error" role="note">
                <XCircle size={18} className="status-notice-icon" />
                <div className="status-notice-text">
                  <strong>Solicitação Rejeitada</strong>
                  <p>
                    Sua proposta de nome para a comunidade <strong>{requestData.church_name}</strong> não foi aceita pelos administradores.
                    Para obter acesso, será necessário solicitar um novo convite.
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleDismissRequestNotice}
                    id="btn-dismiss-request-rejected"
                    style={{ marginTop: '6px', alignSelf: 'flex-start' }}
                  >
                    Entendido
                  </button>
                </div>
              </div>
            ) : requestData?.status === 'cancelled' ? (
              <div className="status-notice status-notice--warning" role="note">
                <AlertCircle size={18} className="status-notice-icon" />
                <div className="status-notice-text">
                  <strong>Solicitação Cancelada</strong>
                  <p>
                    A solicitação na comunidade <strong>{requestData.church_name}</strong> foi cancelada, possivelmente devido à reemissão de um novo convite.
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleDismissRequestNotice}
                    id="btn-dismiss-request-cancelled"
                    style={{ marginTop: '6px', alignSelf: 'flex-start' }}
                  >
                    Entendido
                  </button>
                </div>
              </div>
            ) : requestData?.status === 'pending' ? (
              <div className="create-church-card">
                <div className="create-church-header">
                  <div className="create-church-icon" style={{ color: 'var(--primary)' }}>
                    <Clock size={20} />
                  </div>
                  <div className="create-church-info">
                    <span className="create-church-title">Solicitação de Nome em Análise</span>
                    <span className="create-church-desc">
                      Proposta de <strong>"{requestData.proposed_display_name}"</strong> (original: "{requestData.original_display_name}") na comunidade <strong>{requestData.church_name}</strong>.
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Prazo de análise: {formatExpiresAt(requestData.expires_at)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary create-church-btn"
                  onClick={() => loadMyAccessRequest(requestMarker)}
                  id="btn-refresh-my-request"
                >
                  <RefreshCw size={14} />
                  Atualizar situação
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Seção Criar Minha Igreja / Elegibilidade */}
        <div className="pending-create-section">
          {!isOnline ? (
            <div className="status-notice status-notice--offline" role="note">
              <WifiOff size={16} className="status-notice-icon" />
              <div className="status-notice-text">
                <strong>Sem conexão à internet</strong>
                <p>Conecte-se para verificar a elegibilidade e criar uma nova igreja.</p>
              </div>
            </div>
          ) : eligibilityState === 'checking' ? (
            <div className="status-notice status-notice--loading" role="status">
              <Loader2 size={16} className="status-notice-icon spin" />
              <span>Verificando elegibilidade para criar igreja...</span>
            </div>
          ) : eligibilityState === 'error' ? (
            <div className="status-notice status-notice--error" role="alert">
              <AlertCircle size={16} className="status-notice-icon" />
              <div className="status-notice-text">
                <span>Não foi possível verificar a elegibilidade para criar igreja.</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm retry-btn"
                  onClick={loadEligibility}
                  id="btn-retry-eligibility"
                >
                  <RefreshCw size={12} />
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : accessReloadError ? (
            <div className="status-notice status-notice--error" role="alert">
              <AlertCircle size={18} className="status-notice-icon" />
              <div className="status-notice-text">
                <span>{accessReloadError}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm retry-btn"
                  onClick={handleRetryAccessReload}
                  id="btn-retry-access-reload"
                >
                  <RefreshCw size={12} />
                  Tentar carregar acesso novamente
                </button>
              </div>
            </div>
          ) : pendingCommand ? (
            <div className="create-church-card" style={{ borderColor: 'var(--primary)' }}>
              <div className="create-church-header">
                <div className="create-church-icon" aria-hidden="true">
                  <RefreshCw size={20} className="spin" />
                </div>
                <div className="create-church-info">
                  <span className="create-church-title">Envio de igreja pendente de confirmação</span>
                  <span className="create-church-desc">
                    Existe um comando de criação não confirmado para a igreja{' '}
                    <strong>{pendingCommand.churchData?.name || 'solicitada'}</strong>.
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary create-church-btn"
                onClick={() => setIsCreateModalOpen(true)}
                id="btn-recover-pending-church"
              >
                <RefreshCw size={16} />
                Verificar resultado / Recuperar
              </button>
            </div>
          ) : eligibilityData?.eligible ? (
            <div className="create-church-card">
              <div className="create-church-header">
                <div className="create-church-icon" aria-hidden="true">
                  <Church size={20} />
                </div>
                <div className="create-church-info">
                  <span className="create-church-title">Quer iniciar sua comunidade?</span>
                  <span className="create-church-desc">
                    Cadastre sua igreja e torne-se o primeiro administrador das equipes e cultos.
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary create-church-btn"
                onClick={() => setIsCreateModalOpen(true)}
                id="btn-open-create-church-pending"
              >
                <PlusCircle size={16} />
                Criar minha igreja
              </button>
            </div>
          ) : eligibilityData?.reason === 'already_admin' ? (
            <div className="status-notice status-notice--warning" role="note">
              <ShieldAlert size={18} className="status-notice-icon" />
              <div className="status-notice-text">
                <strong>Limite de administração ativo</strong>
                <p>
                  Sua conta já possui administração ativa na igreja{' '}
                  <strong>{eligibilityData.activeAdminChurchName || 'existente'}</strong>.
                  Pelas regras do sistema, cada conta pode administrar no máximo uma igreja por vez.
                </p>
              </div>
            </div>
          ) : eligibilityData?.reason === 'email_not_confirmed' ? (
            <div className="status-notice status-notice--warning" role="note">
              <Mail size={18} className="status-notice-icon" />
              <div className="status-notice-text">
                <strong>Confirmação de e-mail necessária</strong>
                <p>Confirme o e-mail da sua conta para poder criar uma nova igreja.</p>
              </div>
            </div>
          ) : (
            <div className="status-notice status-notice--warning" role="note">
              <AlertCircle size={18} className="status-notice-icon" />
              <div className="status-notice-text">
                <strong>Criação não disponível</strong>
                <p>Sua conta não atende aos critérios para criar uma nova igreja no momento.</p>
              </div>
            </div>
          )}
        </div>

        {/* Botão de saída */}
        <button
          id="btn-signout"
          className="btn btn-secondary pending-signout-btn"
          onClick={signOut}
          type="button"
          aria-label="Sair da conta"
        >
          <LogOut size={16} />
          Sair
        </button>
      </div>

      {/* Modal de criação de igreja */}
      <CreateChurchModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleChurchCreated}
      />

      <style>{`
        .pending-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          background: var(--bg-secondary);
          background-image: radial-gradient(
            ellipse at 40% 80%,
            var(--primary-surface) 0%,
            transparent 60%
          );
        }

        .pending-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          padding: 40px 36px;
          width: 100%;
          max-width: 460px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (max-width: 480px) {
          .pending-card {
            padding: 30px 20px;
          }
        }

        .pending-icon {
          width: 56px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--status-pending-bg);
          border: 2px solid var(--status-pending-border);
          border-radius: var(--radius-lg);
          margin-bottom: 20px;
          color: var(--status-pending-text);
        }

        .pending-icon svg {
          width: 28px;
          height: 28px;
        }

        .pending-title {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
          text-align: center;
          margin: 0 0 6px;
        }

        .pending-subtitle {
          font-size: 14px;
          font-weight: 600;
          color: var(--status-pending-text);
          text-align: center;
          margin: 0 0 16px;
        }

        .pending-description {
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
          line-height: 1.5;
          margin: 0 0 20px;
        }

        /* Bloco de identificação da conta */
        .pending-account {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          width: 100%;
          margin-bottom: 20px;
        }

        .pending-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          border: 1.5px solid var(--border-subtle);
        }

        .pending-account-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .pending-account-name {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .pending-account-email {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Seção Criar Igreja */
        .pending-create-section {
          width: 100%;
          margin-bottom: 20px;
        }

        .create-church-card {
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          border-radius: var(--radius-lg);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .create-church-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .create-church-icon {
          width: 38px;
          height: 38px;
          border-radius: var(--radius-md);
          background: var(--bg-card);
          border: 1px solid var(--primary-border);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .create-church-info {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .create-church-title {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .create-church-desc {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .create-church-btn {
          width: 100%;
          justify-content: center;
          gap: 8px;
          font-weight: 700;
        }

        /* Avisos de estado */
        .status-notice {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: var(--radius-md);
          font-size: 12px;
          line-height: 1.45;
        }

        .status-notice-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .status-notice-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .status-notice-text p {
          margin: 0;
        }

        .status-notice--loading {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-muted);
          align-items: center;
        }

        .status-notice--offline {
          background: rgba(148, 163, 184, 0.1);
          border: 1px solid rgba(148, 163, 184, 0.25);
          color: var(--text-secondary);
        }

        .status-notice--error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: var(--danger, #ef4444);
        }

        .status-notice--warning {
          background: var(--status-pending-bg);
          border: 1px solid var(--status-pending-border);
          color: var(--status-pending-text);
        }

        .retry-btn {
          align-self: flex-start;
          margin-top: 4px;
          gap: 5px;
        }

        .pending-invite-guidance {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-left: 3px solid var(--primary);
          border-radius: var(--radius-md);
          padding: 12px 14px;
          margin-bottom: 20px;
          width: 100%;
          text-align: left;
          font-size: 13px;
          line-height: 1.45;
        }

        .pending-invite-guidance-header {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--primary);
          font-weight: 700;
          margin-bottom: 6px;
        }

        .pending-invite-guidance p {
          color: var(--text-secondary);
          margin: 0 0 6px;
        }

        .pending-invite-guidance ul {
          margin: 0;
          padding-left: 18px;
          color: var(--text-secondary);
        }

        .pending-invite-guidance li {
          margin-bottom: 4px;
        }

        .pending-signout-btn {
          width: 100%;
          justify-content: center;
          gap: 8px;
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
