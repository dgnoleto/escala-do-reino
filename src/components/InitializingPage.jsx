import React from 'react';

/**
 * Tela de inicialização exibida enquanto o AuthProvider recupera a sessão.
 * Evita que o usuário veja um flash da tela de login ou do protótipo antes
 * de saber se há uma sessão válida.
 */
export default function InitializingPage() {
  return (
    <div className="init-page" role="status" aria-label="Carregando…" aria-live="polite">
      <div className="init-spinner" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <p className="init-label">Carregando…</p>

      <style>{`
        @keyframes initSpin {
          to { transform: rotate(360deg); }
        }

        .init-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          background: var(--bg-secondary);
        }

        .init-spinner svg {
          width: 40px;
          height: 40px;
          color: var(--primary);
          animation: initSpin 0.9s linear infinite;
        }

        .init-label {
          font-size: 14px;
          color: var(--text-muted);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
