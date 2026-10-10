import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, KeyRound, AlertCircle, CheckCircle2, ArrowLeft, RefreshCw } from 'lucide-react';

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
   Tela de Login principal com suporte a Google e E-mail/Senha
──────────────────────────────────────────────────────────── */
export default function LoginPage() {
  const {
    signInWithGoogle,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
    updateUserPassword,
    authError,
    setAuthError,
    isConfigured,
    pendingInviteToken,
    isPasswordRecovery,
  } = useAuth();

  // Modos de formulário: 'login' | 'register' | 'forgot_password' | 'update_password'
  const [mode, setMode] = useState(isPasswordRecovery ? 'update_password' : 'login');

  useEffect(() => {
    if (isPasswordRecovery) {
      setMode('update_password');
    }
  }, [isPasswordRecovery]);

  // Formulário em memória (senhas nunca são persistidas em storage)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState(null);

  const missingConfig = !isConfigured;

  async function handleGoogleLogin() {
    if (loading) return;
    setLoading(true);
    setAuthError(null);
    setInfoMessage(null);

    const { error } = await signInWithGoogle();
    if (error) {
      setLoading(false);
    }
  }

  async function handleEmailPasswordSubmit(e) {
    e.preventDefault();
    if (loading || missingConfig) return;

    setLoading(true);
    setAuthError(null);
    setInfoMessage(null);

    try {
      if (mode === 'login') {
        const { error } = await signInWithPassword(email, password);
        if (error) {
          setAuthError(error.message || 'Falha ao autenticar com e-mail e senha.');
        }
      } else if (mode === 'register') {
        if (password !== confirmPassword) {
          setAuthError('As senhas informadas não coincidem.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setAuthError('A senha deve ter pelo menos 6 caracteres.');
          setLoading(false);
          return;
        }

        const { data, error } = await signUpWithPassword(email, password);
        if (error) {
          setAuthError(error.message || 'Não foi possível concluir o cadastro.');
        } else {
          // Se session for nula, significa que a confirmação de e-mail é exigida pelo Auth
          if (!data?.session) {
            setInfoMessage('Cadastro realizado! Enviamos um e-mail de confirmação. Por favor, confirme seu e-mail antes de acessar.');
            setPassword('');
            setConfirmPassword('');
          }
        }
      } else if (mode === 'forgot_password') {
        const { error } = await resetPasswordForEmail(email);
        if (error) {
          setAuthError(error.message || 'Não foi possível solicitar a recuperação.');
        } else {
          setInfoMessage('Se houver uma conta registrada com este e-mail, enviamos as instruções de recuperação de senha.');
        }
      } else if (mode === 'update_password') {
        if (password !== confirmPassword) {
          setAuthError('As senhas informadas não coincidem.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setAuthError('A nova senha deve ter pelo menos 6 caracteres.');
          setLoading(false);
          return;
        }

        const { error } = await updateUserPassword(password);
        if (error) {
          setAuthError(error.message || 'Falha ao atualizar a senha.');
        } else {
          setInfoMessage('Senha atualizada com sucesso! Acessando sua conta…');
          setPassword('');
          setConfirmPassword('');
        }
      }
    } finally {
      setLoading(false);
    }
  }

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
        <p className="login-subtitle">Acesso e Identidade</p>

        {pendingInviteToken && (
          <div className="login-invite-badge" role="status">
            <span>Você possui um convite em andamento. Conecte-se com o e-mail convidado.</span>
          </div>
        )}

        {/* Aviso de configuração ausente */}
        {missingConfig && (
          <div className="login-alert login-alert--warning" role="alert" aria-live="polite">
            <AlertCircle size={16} />
            <span>
              Configuração do Supabase ausente. Defina{' '}
              <code>VITE_SUPABASE_URL</code> e{' '}
              <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> no arquivo{' '}
              <code>.env.local</code>.
            </span>
          </div>
        )}

        {/* Mensagens de Sucesso / Informativas */}
        {infoMessage && (
          <div className="login-alert login-alert--success" role="status" aria-live="polite">
            <CheckCircle2 size={16} />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Erro de autenticação */}
        {authError && !missingConfig && (
          <div className="login-alert login-alert--error" role="alert" aria-live="assertive">
            <AlertCircle size={16} />
            <span>{authError}</span>
          </div>
        )}

        {/* 1. MODO: ATUALIZAR SENHA (Callback de Recuperação) */}
        {mode === 'update_password' ? (
          <form onSubmit={handleEmailPasswordSubmit} className="login-email-form">
            <h2 className="login-form-heading">Definir Nova Senha</h2>
            <p className="login-form-subheading">Digite a nova senha para sua conta.</p>

            <div className="form-group">
              <label htmlFor="login-new-password" className="form-label">Nova senha:</label>
              <input
                id="login-new-password"
                type="password"
                className="form-input"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading || missingConfig}
                autoFocus
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-confirm-new-password" className="form-label">Confirmar nova senha:</label>
              <input
                id="login-confirm-new-password"
                type="password"
                className="form-input"
                placeholder="Repita a nova senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading || missingConfig}
                required
              />
            </div>

            <button
              id="btn-submit-update-password"
              type="submit"
              className="btn btn-primary login-btn-submit"
              disabled={loading || missingConfig || !password}
            >
              {loading ? <Spinner /> : 'Salvar Nova Senha'}
            </button>
          </form>
        ) : mode === 'forgot_password' ? (
          /* 2. MODO: ESQUECI MINHA SENHA */
          <form onSubmit={handleEmailPasswordSubmit} className="login-email-form">
            <h2 className="login-form-heading">Recuperação de Senha</h2>
            <p className="login-form-subheading">Informe seu e-mail cadastrado para receber o link de redefinição.</p>

            <div className="form-group">
              <label htmlFor="login-reset-email" className="form-label">E-mail cadastrado:</label>
              <input
                id="login-reset-email"
                type="email"
                className="form-input"
                placeholder="seu.email@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading || missingConfig}
                autoFocus
                required
              />
            </div>

            <button
              id="btn-submit-reset-password"
              type="submit"
              className="btn btn-primary login-btn-submit"
              disabled={loading || missingConfig || !email}
            >
              {loading ? <Spinner /> : 'Enviar Link de Recuperação'}
            </button>

            <button
              type="button"
              className="btn btn-link login-toggle-link"
              onClick={() => {
                setMode('login');
                setAuthError(null);
                setInfoMessage(null);
              }}
              disabled={loading}
            >
              <ArrowLeft size={13} /> Voltar ao login
            </button>
          </form>
        ) : (
          /* 3. MODOS NORMAIS: LOGIN OU CADASTRO */
          <>
            {/* Botão Google (Opção rápida) */}
            <button
              id="btn-google-login"
              className="login-btn-google"
              onClick={handleGoogleLogin}
              disabled={loading || missingConfig}
              aria-busy={loading}
              aria-label={loading ? 'Conectando com o Google…' : 'Entrar com Google'}
              type="button"
            >
              {loading ? <Spinner /> : <GoogleIcon />}
              <span>{loading ? 'Redirecionando…' : 'Entrar com Google'}</span>
            </button>

            <div className="login-divider">
              <span>ou com e-mail e senha</span>
            </div>

            <form onSubmit={handleEmailPasswordSubmit} className="login-email-form">
              <div className="form-group">
                <label htmlFor="login-email-input" className="form-label">E-mail:</label>
                <input
                  id="login-email-input"
                  type="email"
                  className="form-input"
                  placeholder="seu.email@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || missingConfig}
                  required
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="login-password-input" className="form-label">Senha:</label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      className="btn-link-forgot"
                      onClick={() => {
                        setMode('forgot_password');
                        setAuthError(null);
                        setInfoMessage(null);
                      }}
                      tabIndex={0}
                    >
                      Esqueci a senha
                    </button>
                  )}
                </div>
                <input
                  id="login-password-input"
                  type="password"
                  className="form-input"
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || missingConfig}
                  required
                />
              </div>

              {mode === 'register' && (
                <div className="form-group">
                  <label htmlFor="login-confirm-password" className="form-label">Confirmar senha:</label>
                  <input
                    id="login-confirm-password"
                    type="password"
                    className="form-input"
                    placeholder="Repita a senha"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading || missingConfig}
                    required
                  />
                </div>
              )}

              <button
                id={mode === 'login' ? 'btn-email-login' : 'btn-email-register'}
                type="submit"
                className="btn btn-primary login-btn-submit"
                disabled={loading || missingConfig || !email || !password}
              >
                {loading ? <Spinner /> : mode === 'login' ? 'Entrar com E-mail' : 'Criar Nova Conta'}
              </button>
            </form>

            <div className="login-toggle-mode">
              {mode === 'login' ? (
                <p>
                  Não possui uma conta?{' '}
                  <button
                    type="button"
                    className="btn-link-mode"
                    onClick={() => {
                      setMode('register');
                      setAuthError(null);
                      setInfoMessage(null);
                    }}
                    id="btn-switch-to-register"
                  >
                    Cadastre-se
                  </button>
                </p>
              ) : (
                <p>
                  Já possui uma conta?{' '}
                  <button
                    type="button"
                    className="btn-link-mode"
                    onClick={() => {
                      setMode('login');
                      setAuthError(null);
                      setInfoMessage(null);
                    }}
                    id="btn-switch-to-login"
                  >
                    Fazer login
                  </button>
                </p>
              )}
            </div>
          </>
        )}

        <p className="login-legal">
          Acesso restrito a membros autorizados ou convidados.
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
          padding: 36px 32px;
          width: 100%;
          max-width: 420px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .login-logo {
          width: 58px;
          height: 58px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary-surface);
          border: 2px solid var(--primary-border);
          border-radius: var(--radius-lg);
          margin-bottom: 16px;
          color: var(--primary);
        }

        .login-logo svg {
          width: 30px;
          height: 30px;
        }

        .login-title {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
          text-align: center;
          margin: 0 0 2px;
        }

        .login-subtitle {
          font-size: 12px;
          font-weight: 600;
          color: var(--primary);
          text-align: center;
          margin: 0 0 16px;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }

        .login-invite-badge {
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          border-radius: var(--radius-md);
          padding: 8px 12px;
          font-size: 12px;
          color: var(--primary);
          text-align: center;
          margin-bottom: 16px;
          width: 100%;
          line-height: 1.4;
        }

        .login-alert {
          width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          font-size: 13px;
          line-height: 1.4;
          margin-bottom: 16px;
        }

        .login-alert--error {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
        }

        .login-alert--warning {
          background: #fffbeb;
          border: 1px solid #fde68a;
          color: #b45309;
        }

        .login-alert--success {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
        }

        .login-btn-google {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--bg-card);
          color: var(--text-primary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }

        .login-btn-google:hover:not(:disabled) {
          background: var(--bg-surface);
          border-color: var(--primary);
        }

        .login-divider {
          width: 100%;
          display: flex;
          align-items: center;
          text-align: center;
          margin: 16px 0;
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
        }

        .login-divider::before,
        .login-divider::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid var(--border-subtle);
        }

        .login-divider span {
          padding: 0 10px;
        }

        .login-email-form {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .login-form-heading {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          text-align: center;
        }

        .login-form-subheading {
          font-size: 12px;
          color: var(--text-secondary);
          margin: 0 0 10px;
          text-align: center;
        }

        .login-btn-submit {
          width: 100%;
          padding: 10px;
          font-size: 14px;
          margin-top: 4px;
        }

        .btn-link-forgot {
          background: none;
          border: none;
          color: var(--primary);
          font-size: 11px;
          cursor: pointer;
          padding: 0;
        }

        .btn-link-forgot:hover {
          text-decoration: underline;
        }

        .login-toggle-mode {
          margin-top: 16px;
          font-size: 13px;
          color: var(--text-secondary);
          text-align: center;
        }

        .btn-link-mode {
          background: none;
          border: none;
          color: var(--primary);
          font-weight: 600;
          cursor: pointer;
          padding: 0;
        }

        .btn-link-mode:hover {
          text-decoration: underline;
        }

        .login-toggle-link {
          margin-top: 8px;
          font-size: 12px;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }

        .login-legal {
          font-size: 11px;
          color: var(--text-muted);
          text-align: center;
          margin: 20px 0 0;
        }
      `}</style>
    </div>
  );
}
