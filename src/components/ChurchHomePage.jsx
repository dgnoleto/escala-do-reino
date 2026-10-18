import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import MembersPage from './MembersPage';
import TeamsPage from './TeamsPage';
import ChurchSettingsPage from './ChurchSettingsPage';
import ChurchLogo from './ChurchLogo';
import CreateChurchModal from './CreateChurchModal';
import { Church, PlusCircle, ShieldAlert, Loader2, AlertCircle, Mail, RefreshCw, Clock, Users } from 'lucide-react';
import { checkChurchCreationEligibility, loadPendingChurchCommand } from '../utils/churchCommandService';
import { loadAccessRequestMarker, removeAccessRequestMarker } from '../utils/invitationCommandService';

/**
 * ChurchHomePage — tela inicial para contas com vínculo confirmado.
 *
 * Exibe exclusivamente dados retornados pelo banco via `get_my_church_access()`:
 *   - Nome cadastrado do membro (display_name)
 *   - Nome da igreja (church_name)
 *   - Perfil: Administrador ou Membro (is_admin)
 *
 * Se for Administrador:
 *   - Oferece acesso à tela de Gestão de Membros (cadastro e listagem paginada).
 *   - Explica o impedimento do limite de administração ativa única por conta.
 *
 * Se for Membro (acesso básico):
 *   - Oferece a opção "Criar minha igreja" para iniciar sua própria comunidade.
 *
 * Não exibe UUIDs, tokens, e-mails ou qualquer identificador técnico.
 * Não monta AppProvider nem acessa dados fictícios do protótipo.
 *
 * Acessibilidade: foco inicial no título, regiões semânticas, rótulos descritivos.
 */
export default function ChurchHomePage() {
  const { session, sessionId, churchAccess, availableAccesses, selectChurch, signOut, refreshAccess, recordCreationConfirmation, reloadChurchAccess } = useAuth();
  const [currentView, setCurrentView] = useState('home');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Consulta de elegibilidade global para membros básicos
  const [eligibilityData, setEligibilityData] = useState(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);

  // Comando pendente de criação retido na sessão
  const [pendingCommand, setPendingCommand] = useState(null);

  // Marcador de solicitação / proposta de nome para outra igreja (R5 / PRD)
  const [accessRequestMarker, setAccessRequestMarker] = useState(null);
  const [pendingRequestData, setPendingRequestData] = useState(null);
  const [pendingRequestLoading, setPendingRequestLoading] = useState(false);

  // Campos provêm exclusivamente do retorno da função RPC autenticada.
  const displayName = churchAccess?.display_name ?? '';
  const churchName  = churchAccess?.church_name  ?? '';
  const isAdmin     = churchAccess?.is_admin     ?? false;
  const userId      = session?.user?.id;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage && userId) {
      const cmd = loadPendingChurchCommand(window.sessionStorage, userId);
      setPendingCommand(cmd);
    }
  }, [userId, isCreateModalOpen]);

  useEffect(() => {
    let isMounted = true;
    if (typeof window !== 'undefined' && window.sessionStorage && userId) {
      const marker = loadAccessRequestMarker(window.sessionStorage, userId);
      setAccessRequestMarker(marker);

      if (marker && marker.churchId && supabase) {
        setPendingRequestLoading(true);
        supabase.schema('public').rpc('get_my_access_request', {
          p_church_id: marker.churchId,
        }).then(({ data, error }) => {
          if (!isMounted) return;
          setPendingRequestLoading(false);
          if (!error && Array.isArray(data) && data.length > 0) {
            const row = data[0];
            if (row && row.church_id === marker.churchId) {
              setPendingRequestData(row);
            }
          }
        }).catch(() => {
          if (isMounted) setPendingRequestLoading(false);
        });
      }
    }
    return () => { isMounted = false; };
  }, [userId]);

  useEffect(() => {
    let isMounted = true;
    if (!isAdmin && supabase) {
      setEligibilityLoading(true);
      checkChurchCreationEligibility(supabase)
        .then((res) => {
          if (isMounted) {
            setEligibilityData(res);
            setEligibilityLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) setEligibilityLoading(false);
        });
    }
    return () => { isMounted = false; };
  }, [isAdmin]);

  const profileLabel = isAdmin ? 'Administrador' : 'Membro';

  if (currentView === 'church-settings' && isAdmin) {
    return <ChurchSettingsPage key={`${userId}:${sessionId}:${churchAccess.church_id}`} onBack={() => setCurrentView('home')} />;
  }

  // Navegação para a tela de membros do administrador
  if (currentView === 'members' && isAdmin) {
    return <MembersPage onBack={() => setCurrentView('home')} />;
  }

  // Navegação para a tela de ministérios e equipes (Admin ou Membro)
  if (currentView === 'teams') {
    return <TeamsPage onBack={() => setCurrentView('home')} />;
  }

  return (
    <div className="church-home-page" role="main">
      <div className="church-home-card" aria-label={`Início — ${churchName}`}>

        {/* Cabeçalho da igreja */}
        <div className="church-home-header">
          <div className="church-home-logo" aria-hidden="true">
            <ChurchLogo churchId={churchAccess?.church_id} userId={userId} sessionId={sessionId} />
          </div>

          <div className="church-home-header-text">
            <h1 className="church-home-church-name">{churchName}</h1>
            <p className="church-home-app-label">Escala do Reino</p>
          </div>
        </div>

        {availableAccesses && availableAccesses.length > 1 && (
          <div className="church-home-switch-bar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => selectChurch(null)}
              type="button"
              aria-label="Alternar igreja consultada"
              style={{ fontSize: '0.78rem', padding: '4px 10px', height: 'auto', borderRadius: '8px' }}
            >
              Trocar de comunidade ({availableAccesses.length})
            </button>
          </div>
        )}

        {/* Saudação do membro */}
        <section className="church-home-welcome" aria-label="Bem-vindo">
          <p className="church-home-greeting-label">Bem-vindo,</p>
          <p className="church-home-member-name" aria-label={`Nome: ${displayName}`}>
            {displayName}
          </p>
        </section>

        {/* Badge de perfil */}
        <div
          className={`church-home-profile-badge ${isAdmin ? 'church-home-profile-badge--admin' : ''}`}
          role="status"
          aria-label={`Perfil: ${profileLabel}`}
        >
          {isAdmin ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
          <span>{profileLabel}</span>
        </div>

        {/* Card de Recuperação Acessível: existe comando de criação pendente nesta conta */}
        {pendingCommand && (
          <div
            className="church-home-recovery-card"
            style={{
              background: 'var(--primary-surface, #eff6ff)',
              border: '1.5px solid var(--primary, #2563eb)',
              borderRadius: '12px',
              padding: '16px',
              margin: '12px 0 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
            role="region"
            aria-label="Comando de criação de igreja pendente de confirmação"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <RefreshCw size={20} className="spin" color="var(--primary, #2563eb)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Envio de igreja pendente de confirmação
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Existe um comando de criação não confirmado para a igreja{' '}
                  <strong>{pendingCommand.churchData?.name || 'solicitada'}</strong>.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsCreateModalOpen(true)}
              id="btn-recover-pending-church-home"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} />
              Verificar resultado / Recuperar
            </button>
          </div>
        )}

        {/* Card de Acompanhamento de Proposta/Solicitação de Nome em outra comunidade (R5 / PRD) */}
        {(accessRequestMarker || pendingRequestData) && (
          <div
            className="church-home-request-card"
            style={{
              background: 'var(--bg-primary, #ffffff)',
              border: '1.5px solid var(--primary, #2563eb)',
              borderRadius: '12px',
              padding: '16px',
              margin: '12px 0 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
            role="region"
            aria-label="Acompanhamento de solicitação de acesso e proposta de nome"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <Clock size={20} color="var(--primary, #2563eb)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Solicitação de Acesso / Proposta de Nome
                </strong>
                {(() => {
                  const reqStatus = pendingRequestData?.status || accessRequestMarker?.status || 'pending';
                  const isExp = reqStatus === 'expired' || pendingRequestData?.is_expired;
                  const targetName = pendingRequestData?.church_name || accessRequestMarker?.churchName || 'outra igreja';

                  if (reqStatus === 'approved') {
                    return (
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        Sua proposta de nome foi aprovada pelos administradores para a comunidade <strong>{targetName}</strong>! Seu acesso foi liberado.
                      </p>
                    );
                  }
                  if (reqStatus === 'cancelled') {
                    return (
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        A solicitação de acesso para a comunidade <strong>{targetName}</strong> foi cancelada, possivelmente devido à reemissão de um novo convite pelos administradores. Para ingressar, solicite um novo convite.
                      </p>
                    );
                  }
                  if (reqStatus === 'rejected') {
                    return (
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        Sua proposta de alteração de nome para a comunidade <strong>{targetName}</strong> não foi aceita pelos administradores. O cadastro do membro permaneceu inalterado e nenhum acesso foi liberado. Para ingressar, solicite um novo convite.
                      </p>
                    );
                  }
                  if (isExp) {
                    return (
                      <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        O prazo para análise da solicitação de acesso na comunidade <strong>{targetName}</strong> expirou. Para ingressar, solicite um novo convite aos administradores.
                      </p>
                    );
                  }
                  return (
                    <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      Você possui uma solicitação com proposta de alteração de nome pendente para a comunidade <strong>{targetName}</strong>.
                    </p>
                  );
                })()}

                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <span>Nome proposto: <strong>{pendingRequestData?.proposed_display_name || accessRequestMarker?.proposedDisplayName}</strong></span>
                  <span style={{ marginLeft: '12px' }}>
                    {(() => {
                      const reqStatus = pendingRequestData?.status || accessRequestMarker?.status || 'pending';
                      const isExp = reqStatus === 'expired' || pendingRequestData?.is_expired;
                      const statusLabel = reqStatus === 'approved' ? 'Aprovada' : reqStatus === 'rejected' ? 'Rejeitada' : reqStatus === 'cancelled' ? 'Cancelada' : isExp ? 'Expirada' : 'Pendente de aprovação';
                      const statusColor = reqStatus === 'approved' ? '#059669' : (reqStatus === 'rejected' || reqStatus === 'cancelled' || isExp) ? '#dc2626' : '#d97706';
                      return (
                        <>
                          Situação: <strong style={{ color: statusColor }}>{statusLabel}</strong>
                        </>
                      );
                    })()}
                  </span>
                </div>
              </div>
            </div>

            {(() => {
              const reqStatus = pendingRequestData?.status || accessRequestMarker?.status || 'pending';
              const isExp = reqStatus === 'expired' || pendingRequestData?.is_expired;

              if (reqStatus === 'approved') {
                return (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        const targetChurchId = pendingRequestData?.church_id || accessRequestMarker?.churchId;
                        if (reloadChurchAccess && targetChurchId) {
                          const res = await reloadChurchAccess(targetChurchId);
                          if (res && res.success !== false) {
                            if (typeof window !== 'undefined' && window.sessionStorage) {
                              removeAccessRequestMarker(window.sessionStorage, userId);
                            }
                            setAccessRequestMarker(null);
                            setPendingRequestData(null);
                          }
                        }
                      }}
                      id="btn-access-approved-church"
                      style={{ fontSize: '0.82rem', padding: '6px 12px' }}
                    >
                      Acessar comunidade aprovada
                    </button>
                  </div>
                );
              }

              if (reqStatus === 'rejected' || reqStatus === 'cancelled' || isExp) {
                return (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        if (typeof window !== 'undefined' && window.sessionStorage) {
                          removeAccessRequestMarker(window.sessionStorage, userId);
                        }
                        setAccessRequestMarker(null);
                        setPendingRequestData(null);
                      }}
                      id="btn-dismiss-request-marker"
                      style={{ fontSize: '0.82rem', padding: '6px 12px' }}
                    >
                      Dispensar aviso
                    </button>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pendingRequestLoading}
                    onClick={async () => {
                      if (!supabase || !accessRequestMarker?.churchId) return;
                      setPendingRequestLoading(true);
                      try {
                        const { data, error } = await supabase.schema('public').rpc('get_my_access_request', {
                          p_church_id: accessRequestMarker.churchId,
                        });
                        if (!error && Array.isArray(data) && data.length > 0) {
                          const row = data[0];
                          if (row && row.church_id === accessRequestMarker.churchId) {
                            setPendingRequestData(row);
                          }
                        }
                      } finally {
                        setPendingRequestLoading(false);
                      }
                    }}
                    id="btn-refresh-request-status"
                    style={{ fontSize: '0.82rem', padding: '6px 12px' }}
                  >
                    {pendingRequestLoading ? 'Verificando…' : 'Verificar situação da proposta'}
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {isAdmin && (
          <div className="church-home-admin-section">
            <div className="church-home-admin-box">
              <div className="church-home-admin-icon" aria-hidden="true"><Church size={20} /></div>
              <div className="church-home-admin-info">
                <span className="church-home-admin-title">Dados da Igreja</span>
                <span className="church-home-admin-desc">Atualize o endereço, a localização no Google Maps e a logo.</span>
              </div>
            </div>
            <button id="btn-goto-church-settings" className="btn btn-primary church-home-admin-btn" type="button" onClick={() => setCurrentView('church-settings')}>
              Acessar Dados da Igreja
            </button>
          </div>
        )}

        {/* Bloco de Gestão de Membros exclusivo para Administrador */}
        {isAdmin && (
          <div className="church-home-admin-section">
            <div className="church-home-admin-box">
              <div className="church-home-admin-icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              </div>
              <div className="church-home-admin-info">
                <span className="church-home-admin-title">Gestão de Membros</span>
                <span className="church-home-admin-desc">
                  Cadastre novos membros e consulte a listagem da igreja.
                </span>
              </div>
            </div>
            <button
              id="btn-goto-members"
              className="btn btn-primary church-home-admin-btn"
              onClick={() => setCurrentView('members')}
              type="button"
              aria-label="Acessar Gestão de Membros"
            >
              Acessar Membros
            </button>
          </div>
        )}

        {/* Bloco de Gestão de Ministérios e Equipes */}
        <div className="church-home-admin-section" style={{ marginTop: '12px' }}>
          <div className="church-home-admin-box">
            <div className="church-home-admin-icon" aria-hidden="true">
              <Users size={20} />
            </div>
            <div className="church-home-admin-info">
              <span className="church-home-admin-title">Ministérios &amp; Equipes</span>
              <span className="church-home-admin-desc">
                {isAdmin
                  ? 'Gerencie equipes, líderes, funções técnicas e qualificações para escalas.'
                  : 'Consulte os ministérios, funções e integrantes da igreja.'}
              </span>
            </div>
          </div>
          <button
            id="btn-goto-teams"
            className="btn btn-secondary church-home-admin-btn"
            onClick={() => setCurrentView('teams')}
            type="button"
            aria-label="Acessar Ministérios e Equipes"
          >
            Acessar Equipes
          </button>
        </div>

        {/* Aviso de limite de administração para Administrador */}
        {isAdmin && !pendingCommand && (
          <div className="church-home-admin-limit-notice" role="note">
            <ShieldAlert size={16} className="church-home-admin-limit-icon" aria-hidden="true" />
            <span>
              Sua conta já administra ativamente esta igreja. Pelas regras de governança, uma conta pode administrar no máximo uma igreja por vez.
            </span>
          </div>
        )}

        {/* Bloco Criar Minha Igreja para contas com apenas acesso básico de membro */}
        {!isAdmin && !pendingCommand && eligibilityData?.eligible && (
          <div className="church-home-create-section">
            <div className="church-home-create-box">
              <div className="church-home-create-icon" aria-hidden="true">
                <Church size={20} />
              </div>
              <div className="church-home-create-info">
                <span className="church-home-create-title">Quer iniciar sua comunidade?</span>
                <span className="church-home-create-desc">
                  Cadastre sua própria igreja e torne-se o administrador responsável por ela.
                </span>
              </div>
            </div>
            <button
              id="btn-goto-create-church"
              className="btn btn-secondary church-home-create-btn"
              onClick={() => setIsCreateModalOpen(true)}
              type="button"
              aria-label="Criar minha igreja"
            >
              <PlusCircle size={15} />
              Criar minha igreja
            </button>
          </div>
        )}

        {/* Notificação se o membro já é administrador ativo em outra igreja e sem comando pendente */}
        {!isAdmin && !pendingCommand && eligibilityData && !eligibilityData.eligible && eligibilityData.reason === 'already_admin' && (
          <div className="church-home-admin-limit-notice" role="note">
            <ShieldAlert size={16} className="church-home-admin-limit-icon" aria-hidden="true" />
            <span>
              Sua conta já administra ativamente outra igreja{eligibilityData.activeAdminChurchName ? ` (${eligibilityData.activeAdminChurchName})` : ''}. Pelas regras de governança, uma conta pode administrar no máximo uma igreja por vez.
            </span>
          </div>
        )}

        {/* Aviso de estado — funcionalidades futuras */}
        <div className="church-home-notice" role="note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            {isAdmin
              ? 'O planejamento e a condução dos cultos estarão disponíveis nos próximos incrementos.'
              : 'Seu acesso foi confirmado. O cronograma e as escalas estarão disponíveis em breve.'}
          </span>
        </div>

        {/* Botão sair */}
        <button
          id="btn-signout-home"
          className="btn btn-secondary church-home-signout-btn"
          onClick={signOut}
          type="button"
          aria-label="Sair da conta"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sair
        </button>
      </div>

      {/* Modal Criar Minha Igreja / Recuperação */}
      <CreateChurchModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(createdChurch) => {
          setIsCreateModalOpen(false);
          setPendingCommand(null);
          if (createdChurch?.church_id && recordCreationConfirmation) {
            recordCreationConfirmation(createdChurch);
          }
          if (createdChurch?.church_id && refreshAccess) {
            refreshAccess(createdChurch.church_id);
          }
        }}
      />

      <style>{`
        .church-home-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          background: var(--bg-secondary);
          background-image: radial-gradient(
            ellipse at 30% 70%,
            var(--primary-surface) 0%,
            transparent 60%
          );
        }

        .church-home-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          padding: 40px 36px;
          width: 100%;
          max-width: 440px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (max-width: 480px) {
          .church-home-card {
            padding: 32px 20px;
          }
        }

        /* Cabeçalho — logo + nome da igreja */
        .church-home-header {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          margin-bottom: 24px;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .church-home-logo {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary-surface);
          border: 1.5px solid var(--primary-border);
          border-radius: var(--radius-lg);
          color: var(--primary);
        }

        .church-home-logo svg {
          width: 26px;
          height: 26px;
        }

        .church-home-header-text {
          min-width: 0;
        }

        .church-home-church-name {
          font-size: 17px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0 0 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: -0.2px;
        }

        .church-home-app-label {
          font-size: 12px;
          color: var(--primary);
          font-weight: 600;
          margin: 0;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }

        /* Saudação */
        .church-home-welcome {
          width: 100%;
          text-align: center;
          margin-bottom: 14px;
        }

        .church-home-greeting-label {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 4px;
          font-weight: 500;
        }

        .church-home-member-name {
          font-size: 24px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.4px;
          line-height: 1.2;
          word-break: break-word;
        }

        /* Badge de perfil */
        .church-home-profile-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: var(--radius-full, 9999px);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.3px;
          margin-bottom: 24px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .church-home-profile-badge--admin {
          background: var(--primary-surface);
          border-color: var(--primary-border);
          color: var(--primary);
        }

        /* Bloco de administração de membros */
        .church-home-admin-section {
          width: 100%;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 16px;
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .church-home-admin-box {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .church-home-admin-icon {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .church-home-admin-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .church-home-admin-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .church-home-admin-desc {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .church-home-admin-btn {
          width: 100%;
          justify-content: center;
          font-weight: 700;
        }

        /* Aviso de limite de administração para admin */
        .church-home-admin-limit-notice {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          background: var(--status-pending-bg);
          border: 1px solid var(--status-pending-border);
          border-radius: var(--radius-md);
          width: 100%;
          margin-bottom: 20px;
          font-size: 12px;
          color: var(--status-pending-text);
          line-height: 1.45;
        }

        .church-home-admin-limit-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        /* Bloco de criar igreja para membro com acesso básico */
        .church-home-create-section {
          width: 100%;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 16px;
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .church-home-create-box {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .church-home-create-icon {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .church-home-create-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .church-home-create-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .church-home-create-desc {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .church-home-create-btn {
          width: 100%;
          justify-content: center;
          gap: 6px;
          font-weight: 700;
        }

        /* Aviso de estado */
        .church-home-notice {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 12px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          width: 100%;
          margin-bottom: 20px;
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .church-home-notice svg {
          flex-shrink: 0;
          margin-top: 1px;
          color: var(--text-muted);
        }

        /* Botão sair */
        .church-home-signout-btn {
          width: 100%;
          justify-content: center;
        }
      `}</style>
    </div>
  );
}
