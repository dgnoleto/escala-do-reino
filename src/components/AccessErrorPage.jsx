import React from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * AccessErrorPage — exibida quando a consulta de vínculo falha por erro
 * de infraestrutura (rede, função ausente, timeout, etc.).
 *
 * IMPORTANTE: um erro de consulta NÃO é tratado como "sem vínculo".
 * A tela oferece:
 *   - Mensagem compreensível sem expor detalhes técnicos.
 *   - Botão "Tentar novamente" que revalida via retryAccessCheck().
 *   - Botão "Sair" para retornar ao login.
 */
export default function AccessErrorPage() {
  const { retryAccessCheck, signOut } = useAuth();

  return (
    <div className="access-error-page" role="main">
      <div className="access-error-card" aria-label="Falha ao verificar o acesso">

        {/* Ícone de erro */}
        <div className="access-error-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
               strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className="access-error-title">Não foi possível verificar o acesso</h1>
        <p className="access-error-description">
          Houve um problema ao consultar suas permissões. Isso pode ser uma
          falha temporária de conexão. Tente novamente ou saia e entre de volta.
        </p>

        <div className="access-error-actions">
          <button
            id="btn-retry-access"
            className="btn btn-primary access-error-retry-btn"
            onClick={retryAccessCheck}
            type="button"
            aria-label="Tentar verificar o acesso novamente"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3.01" />
            </svg>
            Tentar novamente
          </button>

          <button
            id="btn-signout-error"
            className="btn btn-secondary access-error-signout-btn"
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
      </div>

      <style>{`
        .access-error-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          background: var(--bg-secondary);
          background-image: radial-gradient(
            ellipse at 50% 50%,
            var(--status-overrun-bg, rgba(220, 38, 38, 0.06)) 0%,
            transparent 60%
          );
        }

        .access-error-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          padding: 48px 40px;
          width: 100%;
          max-width: 420px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (max-width: 480px) {
          .access-error-card {
            padding: 36px 24px;
          }
        }

        .access-error-icon {
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--status-overrun-bg);
          border: 2px solid var(--status-overrun-border);
          border-radius: var(--radius-lg);
          margin-bottom: 24px;
          color: var(--status-overrun-text);
        }

        .access-error-icon svg {
          width: 32px;
          height: 32px;
        }

        .access-error-title {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-primary);
          text-align: center;
          margin: 0 0 12px;
        }

        .access-error-description {
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
          line-height: 1.6;
          margin: 0 0 28px;
        }

        .access-error-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
        }

        .access-error-retry-btn,
        .access-error-signout-btn {
          width: 100%;
          justify-content: center;
        }
      `}</style>
    </div>
  );
}
