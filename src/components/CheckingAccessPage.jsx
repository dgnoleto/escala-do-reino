import React from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * CheckingAccessPage — exibida enquanto o AuthProvider consulta o vínculo
 * da conta autenticada com a igreja (estado 'checking_access').
 *
 * Distinguida de InitializingPage: aqui já sabemos que há sessão e estamos
 * aguardando a resposta da função RPC do banco.
 */
export default function CheckingAccessPage() {
  return (
    <div className="checking-page" role="status" aria-label="Verificando acesso…" aria-live="polite">
      <div className="checking-spinner" aria-hidden="true">
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
      <p className="checking-label">Verificando acesso…</p>

      <style>{`
        @keyframes checkingSpin {
          to { transform: rotate(360deg); }
        }

        .checking-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          background: var(--bg-secondary);
        }

        .checking-spinner svg {
          width: 40px;
          height: 40px;
          color: var(--primary);
          animation: checkingSpin 0.9s linear infinite;
        }

        .checking-label {
          font-size: 14px;
          color: var(--text-muted);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
