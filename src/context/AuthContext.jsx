import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

const AuthContext = createContext(null);

/**
 * AuthProvider — gerencia sessão Supabase Auth e vínculo com a igreja.
 *
 * Estados possíveis de `authState`:
 *   'initializing'      → verificando sessão salva (evita flash de tela errada)
 *   'unauthenticated'   → sem sessão válida → LoginPage
 *   'checking_access'   → sessão válida, consultando vínculo no banco
 *   'access_pending'    → sessão válida, sem vínculo elegível → AccessPendingPage
 *   'access_granted'    → sessão válida, vínculo confirmado → ChurchHomePage
 *   'access_error'      → sessão válida, falha ao consultar vínculo → ErrorPage
 *
 * Regras de segurança:
 * - A identidade deriva exclusivamente de auth.uid() no banco (via Supabase Auth).
 * - O cliente nunca envia user_id, is_admin ou papel como parâmetro.
 * - A função RPC não aceita parâmetros.
 * - Respostas de sessões anteriores são descartadas ao trocar de conta.
 * - Erros de consulta são distinguidos de "sem vínculo" — não colapsam em
 *   'access_pending', para não esconder falhas de infraestrutura.
 */
export function AuthProvider({ children }) {
  const [session, setSession]       = useState(undefined);
  const [authState, setAuthState]   = useState('initializing');
  const [authError, setAuthError]   = useState(null);
  // Dados reais do vínculo; null = sem vínculo confirmado.
  const [churchAccess, setChurchAccess] = useState(null);

  // Ref para cancelar respostas de consultas que chegarem após troca de sessão.
  const currentUserIdRef = useRef(null);

  /**
   * Consulta o vínculo real da conta autenticada chamando a função RPC
   * `app_private.get_my_church_access()` — sem parâmetros.
   *
   * Distingue três casos:
   *  - Lista vazia → 'access_pending' (conta válida, sem vínculo elegível)
   *  - Lista com registros → 'access_granted' (vínculo confirmado)
   *  - Erro → 'access_error' (falha de rede, função ausente ou outro erro)
   *
   * @param {string} expectedUserId — UID da sessão no momento do disparo.
   *   Usado para descartar a resposta se a sessão trocar antes de ela chegar.
   */
  const fetchChurchAccess = useCallback(async (expectedUserId) => {
    if (!supabase || !expectedUserId) return;

    setAuthState('checking_access');
    setChurchAccess(null);
    setAuthError(null);

    try {
      const { data, error } = await supabase.rpc('get_my_church_access');

      // Descartar resposta se a sessão trocou enquanto a consulta estava em voo.
      if (currentUserIdRef.current !== expectedUserId) return;

      if (error) {
        // Erro de rede, função ausente ou outro problema de infraestrutura.
        // NÃO tratar como "sem vínculo" — exibir mensagem de erro com retry.
        console.error('[AuthContext] Falha ao consultar vínculo:', error.message);
        setAuthError(error.message || 'Falha ao verificar o acesso.');
        setAuthState('access_error');
        return;
      }

      if (!data || data.length === 0) {
        // Conta válida, mas sem vínculo elegível com nenhuma igreja.
        setChurchAccess(null);
        setAuthState('access_pending');
        return;
      }

      // Vínculo confirmado. Usar o primeiro registro (uma conta pode ter vínculo
      // com múltiplas igrejas; neste incremento exibe somente o primeiro).
      setChurchAccess(data[0]);
      setAuthState('access_granted');

    } catch (unexpectedErr) {
      if (currentUserIdRef.current !== expectedUserId) return;
      console.error('[AuthContext] Erro inesperado na consulta de vínculo:', unexpectedErr);
      setAuthError('Erro inesperado ao verificar o acesso.');
      setAuthState('access_error');
    }
  }, []);

  /**
   * Limpa o contexto de vínculo e reinicia o estado de acesso.
   * Chamado ao sair ou detectar troca de sessão.
   */
  const clearAccessContext = useCallback(() => {
    setChurchAccess(null);
    setAuthError(null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSession(null);
      setAuthState('unauthenticated');
      return;
    }

    // 1. Recupera sessão existente (localStorage / cookie).
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      if (existingSession) {
        setSession(existingSession);
        currentUserIdRef.current = existingSession.user.id;
        // Chamada assíncrona fora do callback síncrono — evita bloqueio do listener.
        fetchChurchAccess(existingSession.user.id);
      } else {
        setSession(null);
        currentUserIdRef.current = null;
        setAuthState('unauthenticated');
      }
    });

    // 2. Escuta mudanças de estado (login, logout, token refresh, OAuth callback).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        const previousUserId = currentUserIdRef.current;
        const newUserId      = newSession?.user?.id ?? null;

        setSession(newSession);

        if (!newSession) {
          // Logout ou sessão expirada.
          currentUserIdRef.current = null;
          clearAccessContext();
          setAuthState('unauthenticated');
          return;
        }

        if (newUserId !== previousUserId) {
          // Novo login ou troca de conta — descartar dados anteriores.
          clearAccessContext();
          currentUserIdRef.current = newUserId;
          // Consulta fora do callback síncrono — não bloqueia onAuthStateChange.
          setTimeout(() => fetchChurchAccess(newUserId), 0);
        }
        // Se o userId não mudou (ex.: refresh de token), não rebuscar.
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchChurchAccess, clearAccessContext]);

  /**
   * Revalida o vínculo manualmente (ex.: usuário clica "Tentar novamente"
   * ou o aplicativo recupera foco após longa inatividade).
   * Evita chamada se não há sessão ativa.
   */
  function retryAccessCheck() {
    const uid = currentUserIdRef.current;
    if (!uid) return;
    fetchChurchAccess(uid);
  }

  /**
   * Inicia o fluxo OAuth com o Google.
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
        redirectTo: 'http://localhost:3000',
      },
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { error: null };
  }

  /**
   * Encerra a sessão atual — limpa dados de vínculo antes de deslogar.
   */
  async function signOut() {
    if (!supabase) return;
    // Limpar imediatamente para não deixar dados anteriores na tela.
    clearAccessContext();
    currentUserIdRef.current = null;
    setAuthError(null);
    await supabase.auth.signOut();
    // onAuthStateChange completará a transição para 'unauthenticated'.
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        authState,
        authError,
        setAuthError,
        churchAccess,
        signInWithGoogle,
        signOut,
        retryAccessCheck,
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
