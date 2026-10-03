import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import MembersPage from './MembersPage';

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
 *
 * Não exibe UUIDs, tokens, e-mails ou qualquer identificador técnico.
 * Não monta AppProvider nem acessa dados fictícios do protótipo.
 *
 * Acessibilidade: foco inicial no título, regiões semânticas, rótulos descritivos.
 */
export default function ChurchHomePage() {
  const { churchAccess, signOut } = useAuth();
  const [currentView, setCurrentView] = useState('home');

  // Campos provêm exclusivamente do retorno da função RPC autenticada.
  const displayName = churchAccess?.display_name ?? '';
  const churchName  = churchAccess?.church_name  ?? '';
  const isAdmin     = churchAccess?.is_admin     ?? false;

  const profileLabel = isAdmin ? 'Administrador' : 'Membro';

  // Navegação para a tela de membros do administrador
  if (currentView === 'members' && isAdmin) {
    return <MembersPage onBack={() => setCurrentView('home')} />;
  }

  return (
    <div className="church-home-page" role="main">
      <div className="church-home-card" aria-label={`Início — ${churchName}`}>

        {/* Cabeçalho da igreja */}
        <div className="church-home-header">
          <div className="church-home-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 22V10L12 3l9 7v12H3z" />
              <path d="M12 3v4M10 7h4" />
              <rect x="9" y="14" width="6" height="8" rx="1" />
            </svg>
          </div>

          <div className="church-home-header-text">
            <h1 className="church-home-church-name">{churchName}</h1>
            <p className="church-home-app-label">Escala do Reino</p>
          </div>
        </div>

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
