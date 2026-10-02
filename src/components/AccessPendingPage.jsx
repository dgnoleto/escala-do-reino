import React from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Tela exibida para usuários autenticados neste incremento.
 * O acesso real à igreja ainda não foi liberado — aguarda implementação futura
 * de convites, vínculo a membro e aprovação.
 *
 * Mostra: nome e e-mail da conta Google; botão "Sair".
 * Não exibe: tokens, IDs técnicos, painéis do protótipo.
 */
export default function AccessPendingPage() {
  const { session, signOut } = useAuth();

  const user = session?.user;
  // Exibe somente informações de apresentação segura — sem tokens ou IDs internos
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || null;
  const displayEmail = user?.email || null;
  const avatarUrl = user?.user_metadata?.avatar_url || null;

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
        <p className="pending-subtitle">O acesso à igreja ainda não foi liberado.</p>

        <p className="pending-description">
          Para usar o Escala do Reino, você precisa ser convidado por um administrador
          e ter sua conta vinculada a um membro cadastrado. Entre em contato com
          a liderança do seu ministério.
        </p>

        {/* Identificação da conta */}
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

        {/* Botão de saída */}
        <button
          id="btn-signout"
          className="btn btn-secondary pending-signout-btn"
          onClick={signOut}
          type="button"
          aria-label="Sair da conta"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sair
        </button>
      </div>

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
          padding: 48px 40px;
          width: 100%;
          max-width: 440px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (max-width: 480px) {
          .pending-card {
            padding: 36px 24px;
          }
        }

        .pending-icon {
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--status-pending-bg);
          border: 2px solid var(--status-pending-border);
          border-radius: var(--radius-lg);
          margin-bottom: 24px;
          color: var(--status-pending-text);
        }

        .pending-icon svg {
          width: 32px;
          height: 32px;
        }

        .pending-title {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
          text-align: center;
          margin: 0 0 8px;
        }

        .pending-subtitle {
          font-size: 14px;
          font-weight: 600;
          color: var(--status-pending-text);
          text-align: center;
          margin: 0 0 20px;
        }

        .pending-description {
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
          line-height: 1.6;
          margin: 0 0 28px;
        }

        /* Bloco de identificação da conta */
        .pending-account {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          width: 100%;
          margin-bottom: 24px;
        }

        .pending-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          border: 2px solid var(--border-subtle);
        }

        .pending-account-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .pending-account-name {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .pending-account-email {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .pending-signout-btn {
          width: 100%;
          justify-content: center;
        }
      `}</style>
    </div>
  );
}
