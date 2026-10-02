import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

const AuthContext = createContext(null);

/**
 * AuthProvider — gerencia sessão Supabase Auth.
 *
 * Estados possíveis de `authState`:
 *   'initializing' → verificando sessão salva (evita flash de tela errada)
 *   'unauthenticated' → sem sessão válida → exibe LoginPage
 *   'authenticated' → sessão válida → exibe AccessPendingPage
 */
export function AuthProvider({ children }) {
  // null = ainda não sabemos; Session object ou null após inicialização
  const [session, setSession] = useState(undefined);
  const [authState, setAuthState] = useState('initializing');
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // Configuração ausente: não há sessão possível, vai direto para login
      setSession(null);
      setAuthState('unauthenticated');
      return;
    }

    // 1. Recupera sessão já existente (localStorage / cookie)
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setAuthState(existingSession ? 'authenticated' : 'unauthenticated');
    });

    // 2. Escuta mudanças de estado (login, logout, token refresh, OAuth callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setAuthState(newSession ? 'authenticated' : 'unauthenticated');
        // Limpa erros anteriores quando a sessão muda
        if (newSession) setAuthError(null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  /**
   * Inicia o fluxo OAuth com o Google.
   * Retorna { error } se houver falha imediata (configuração ou rede).
   */
  async function signInWithGoogle() {
    if (!isSupabaseConfigured() || !supabase) {
      const err = new Error('Configuração do Supabase ausente ou inválida.');
      setAuthError(err.message);
      return { error: err };
    }

    setAuthError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // URL de retorno fixo — não usa parâmetros da URL pública
        redirectTo: 'http://localhost:3000',
      },
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    // O navegador será redirecionado; a resposta real chega via onAuthStateChange
    return { error: null };
  }

  /**
   * Encerra a sessão atual e retorna à tela de login.
   */
  async function signOut() {
    if (!supabase) return;
    setAuthError(null);
    await supabase.auth.signOut();
    // onAuthStateChange definirá authState como 'unauthenticated'
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        authState,
        authError,
        setAuthError,
        signInWithGoogle,
        signOut,
        isConfigured: isSupabaseConfigured(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
