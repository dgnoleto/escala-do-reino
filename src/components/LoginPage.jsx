import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

/* ────────────────────────────────────────────────────────────
   Ícone do Google (SVG oficial sem dependência externa)
──────────────────────────────────────────────────────────── */
function GoogleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────
   Spinner de carregamento acessível
──────────────────────────────────────────────────────────── */
function Spinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ animation: 'loginSpinner 0.8s linear infinite' }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────
   Tela de Login principal
──────────────────────────────────────────────────────────── */
export default function LoginPage() {
  const { signInWithGoogle, authError, setAuthError, isConfigured } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleGoogleLogin() {
    if (loading) return; // evita cliques duplos
    setLoading(true);
    setAuthError(null);

    const { error } = await signInWithGoogle();

    // Se retornou erro imediato (ex.: configuração ausente), para o loading.
    // Se não houve erro, o navegador redireciona; loading fica ativo até sair da página.
    if (error) {
      setLoading(false);
    }
    // Caso de cancelamento: o usuário fecha o popup do Google sem concluir.
    // O Supabase OAuth via redirect não abre popup — redireciona a aba.
    // Se o usuário voltar sem completar, onAuthStateChange não dispara sessão
    // e o estado retorna a 'unauthenticated'; loading será resetado
    // indiretamente porque o componente remonta. Isso é suficiente.
  }

  const missingConfig = !isConfigured;

  return (
    <div className="login-page" role="main">
      <div className="login-card" aria-label="Tela de acesso ao Escala do Reino">

        {/* Identidade visual */}
        <div className="login-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 22V10L12 3l9 7v12H3z" />
            <path d="M12 3v4M10 7h4" />
            <rect x="9" y="14" width="6" height="8" rx="1" />
          </svg>
        </div>

        <h1 className="login-title">Escala do Reino</h1>
        <p className="login-subtitle">Ministério Shalom</p>
        <p className="login-description">
          Organize eventos, equipes e escalas da sua igreja.
        </p>

        {/* Aviso de configuração ausente */}
        {missingConfig && (
          <div className="login-alert login-alert--warning" role="alert" aria-live="polite">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              Configuração do Supabase ausente. Defina{' '}
              <code>VITE_SUPABASE_URL</code> e{' '}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> no arquivo{' '}
              <code>.env.local</code>.
            </span>
          </div>
        )}

        {/* Erro de autenticação */}
        {authError && !missingConfig && (
          <div className="login-alert login-alert--error" role="alert" aria-live="assertive">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>Não foi possível entrar. Tente novamente.</span>
          </div>
        )}

        {/* Botão principal */}
        <button
          id="btn-google-login"
          className="login-btn-google"
          onClick={handleGoogleLogin}
          disabled={loading || missingConfig}
          aria-busy={loading}
          aria-label={loading ? 'Entrando com o Google…' : 'Entrar com Google'}
          type="button"
        >
          {loading ? <Spinner /> : <GoogleIcon />}
          <span>{loading ? 'Redirecionando…' : 'Entrar com Google'}</span>
        </button>

        <p className="login-legal">
          Acesso restrito a membros convidados.
        </p>
      </div>

      {/* Estilos isolados da tela de login */}
      <style>{`
        @keyframes loginSpinner {
          to { transform: rotate(360deg); }
        }

        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          background: var(--bg-secondary);
          /* gradiente sutil usando as variáveis do tema */
          background-image: radial-gradient(
            ellipse at 60% 20%,
            var(--primary-surface) 0%,
            transparent 60%
          );
        }

        .login-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          padding: 48px 40px;
          width: 100%;
          max-width: 400px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @media (max-width: 480px) {
          .login-card {
            padding: 36px 24px;
          }
        }

        /* Logo SVG */
        .login-logo {
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary-surface);
          border: 2px solid var(--primary-border);
          border-radius: var(--radius-lg);
          margin-bottom: 24px;
          color: var(--primary);
        }

        .login-logo svg {
          width: 34px;
          height: 34px;
        }

        .login-title {
          font-size: 22px;
          font-weight: 800;
          color: var(--text-primary);
          text-align: center;
          letter-spacing: -0.3px;
          margin: 0 0 4px;
        }

        .login-subtitle {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary);
          text-align: center;
          margin: 0 0 16px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }

        .login-description {
          font-size: 14px;
          color: var(--text-secondary);
          text-align: center;
          line-height: 1.6;
          margin: 0 0 32px;
        }

        /* Alertas */
        .login-alert {
          width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: var(--radius-md);
          font-size: 13px;
          line-height: 1.5;
          margin-bottom: 20px;
        }

        .login-alert svg {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .login-alert code {
          font-family: var(--font-mono);
          font-size: 11px;
          background: rgba(0,0,0,0.15);
          padding: 1px 5px;
          border-radius: 4px;
        }

        .login-alert--warning {
          background: var(--status-pending-bg);
          border: 1px solid var(--status-pending-border);
          color: var(--status-pending-text);
        }

        .login-alert--error {
          background: var(--status-overrun-bg);
          border: 1px solid var(--status-overrun-border);
          color: var(--status-overrun-text);
        }

        /* Botão Google */
        .login-btn-google {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 14px 20px;
          background: var(--bg-surface);
          border: 1.5px solid var(--border-subtle);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition:
            background var(--transition-fast),
            border-color var(--transition-fast),
            box-shadow var(--transition-fast),
            transform var(--transition-fast);
          margin-bottom: 20px;
          min-height: 52px;
        }

        .login-btn-google:hover:not(:disabled) {
          background: var(--bg-card-hover);
          border-color: var(--border-active);
          box-shadow: var(--shadow-md);
        }

        .login-btn-google:active:not(:disabled) {
          transform: scale(0.98);
        }

        .login-btn-google:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }

        .login-btn-google:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .login-legal {
          font-size: 12px;
          color: var(--text-muted);
          text-align: center;
          line-height: 1.5;
          margin: 0;
        }
      `}</style>
    </div>
  );
}
