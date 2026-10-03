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
 * Regras de segurança e robustez:
 * - A identidade deriva exclusivamente de auth.uid() no banco (via Supabase Auth).
 * - O cliente nunca envia user_id, is_admin ou papel como parâmetro.
 * - Respostas de sessões anteriores são descartadas (inclusive logout e reentrada com mesmo UID).
 * - Consultas antigas em voo não sobrescrevem resultados mais recentes (sequência monotônica).
 * - Consultas agendadas são canceladas ao sair ou trocar de conta.
 * - Recuperação inicial de sessão e eventos de Auth são estritamente coordenados.
 * - Erros no logout são tratados sem deixar a aplicação em estado inconsistente.
 * - Revalidação automática ao recuperar foco/conexão com limpeza imediata em caso de perda de acesso.
 */
export function AuthProvider({ children }) {
  const [session, setSession]           = useState(undefined);
  const [authState, setAuthState]       = useState('initializing');
  const [authError, setAuthError]       = useState(null);
  const [churchAccess, setChurchAccess] = useState(null);

  // Rastreia o UID da sessão ativa
  const currentUserIdRef    = useRef(null);
  // Identificador da geração da sessão atual: incrementa a cada login/logout para descartar respostas antigas
  const sessionIdRef        = useRef(0);
  // Geração monotônica de eventos de autenticação para evitar que getSession tardio sobrescreva evento mais recente
  const authGenerationRef   = useRef(0);
  // Sequência monotônica para impedir que consulta mais lenta sobrescreva a mais recente
  const requestSeqRef       = useRef(0);
  // Timer agendado de consulta (cancelado em logout ou troca de sessão)
  const scheduledTimerRef   = useRef(null);
  // Flag para coordenar getSession() inicial com evento de onAuthStateChange
  const initialHandledRef   = useRef(false);
  // Ref para acompanhar o estado do vínculo em event listeners de foco/online
  const churchAccessRef     = useRef(null);
  churchAccessRef.current   = churchAccess;

  /**
   * Remove comandos pendentes de membros retidos na sessão para evitar vazamento entre contas.
   */
  function clearMemberCommandStorage() {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const keysToRemove = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && key.startsWith('escala_pending_member_cmd:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
    } catch (err) {
      console.warn('[AuthContext] Falha ao limpar storage de sessão de membros:', err);
    }
  }

  /**
   * Limpa o contexto de vínculo e cancela timers pendentes.
   */
  const clearAccessContext = useCallback(() => {
    setChurchAccess(null);
    churchAccessRef.current = null;
    setAuthError(null);
    if (scheduledTimerRef.current) {
      clearTimeout(scheduledTimerRef.current);
      scheduledTimerRef.current = null;
    }
  }, []);

  /**
   * Consulta o vínculo real da conta autenticada chamando public.get_my_church_access().
   *
   * @param {string} expectedUserId - UID da sessão esperada
   * @param {object} options - { isBackground: boolean } para revalidação silenciosa em foco/reconexão
   */
  const fetchChurchAccess = useCallback(async (expectedUserId, { isBackground = false } = {}) => {
    if (!supabase || !expectedUserId) return;

    // Registra a geração da sessão e a sequência desta requisição
    const thisSessionId = sessionIdRef.current;
    const thisSeq       = ++requestSeqRef.current;

    if (!isBackground) {
      setAuthState('checking_access');
      setChurchAccess(null);
      setAuthError(null);
    }

    try {
      const { data, error } = await supabase.schema('public').rpc('get_my_church_access');

      // Descartar se a sessão mudou ou se uma consulta mais recente já foi disparada
      if (sessionIdRef.current !== thisSessionId || requestSeqRef.current !== thisSeq) {
        return;
      }

      if (error) {
        console.error('[AuthContext] Falha ao consultar vínculo:', error.message);
        if (!isBackground) {
          setAuthError(error.message || 'Falha ao verificar o acesso.');
          setAuthState('access_error');
        } else {
          // Em revalidação de fundo, se o erro indicar perda de permissão, atualizar estado
          if (error.code === '42501' || error.message?.includes('permission')) {
            clearAccessContext();
            setAuthState('access_pending');
          }
        }
        return;
      }

      if (!data || data.length === 0) {
        // Conta válida, mas sem vínculo elegível
        clearAccessContext();
        setAuthState('access_pending');
        return;
      }

      // Vínculo confirmado
      setChurchAccess(data[0]);
      churchAccessRef.current = data[0];
      setAuthState('access_granted');

    } catch (unexpectedErr) {
      if (sessionIdRef.current !== thisSessionId || requestSeqRef.current !== thisSeq) {
        return;
      }
      console.error('[AuthContext] Erro inesperado na consulta de vínculo:', unexpectedErr);
      if (!isBackground) {
        setAuthError('Erro inesperado ao verificar o acesso.');
        setAuthState('access_error');
      }
    }
  }, [clearAccessContext]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSession(null);
      setAuthState('unauthenticated');
      return;
    }

    let isEffectActive = true;
    let hasAuthEventArrived = false;

    // Função de sincronização com nova sessão baseada em ordem de geração
    function applySession(newSession, eventGen) {
      if (!isEffectActive) return;
      if (eventGen < authGenerationRef.current) {
        // Ignora snapshots obsoletos que resolveram fora de ordem
        return;
      }

      const newUserId = newSession?.user?.id ?? null;
      const previousUserId = currentUserIdRef.current;

      setSession(newSession);

      if (!newSession || !newUserId) {
        // Logout ou sessão inválida
        sessionIdRef.current += 1;
        currentUserIdRef.current = null;
        clearAccessContext();
        clearMemberCommandStorage();
        setAuthState('unauthenticated');
        return;
      }

      if (newUserId !== previousUserId) {
        // Nova sessão / troca de conta
        sessionIdRef.current += 1;
        currentUserIdRef.current = newUserId;
        clearAccessContext();
        clearMemberCommandStorage();

        // Cancela timer anterior se houver
        if (scheduledTimerRef.current) {
          clearTimeout(scheduledTimerRef.current);
        }

        // Agenda a consulta evitando bloquear o listener de Auth
        scheduledTimerRef.current = setTimeout(() => {
          scheduledTimerRef.current = null;
          if (isEffectActive && currentUserIdRef.current === newUserId) {
            fetchChurchAccess(newUserId);
          }
        }, 0);
      }
    }

    // 1. Escuta mudanças de estado do Supabase Auth (fonte autoritativa de eventos)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!isEffectActive) return;
        hasAuthEventArrived = true;
        initialHandledRef.current = true;
        const currentGen = ++authGenerationRef.current;
        applySession(newSession, currentGen);
      }
    );

    // 2. Recupera sessão existente salva no storage como fallback se nenhum evento tiver chegado
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      if (!isEffectActive || hasAuthEventArrived || initialHandledRef.current) return;
      initialHandledRef.current = true;
      const currentGen = ++authGenerationRef.current;
      applySession(existingSession, currentGen);
    });

    // 3. Revalidação ao recuperar foco da janela ou reconectar à internet
    function handleFocusOrOnline() {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        currentUserIdRef.current &&
        churchAccessRef.current
      ) {
        fetchChurchAccess(currentUserIdRef.current, { isBackground: true });
      }
    }

    window.addEventListener('focus', handleFocusOrOnline);
    window.addEventListener('online', handleFocusOrOnline);
    document.addEventListener('visibilitychange', handleFocusOrOnline);

    return () => {
      isEffectActive = false;
      subscription.unsubscribe();
      window.removeEventListener('focus', handleFocusOrOnline);
      window.removeEventListener('online', handleFocusOrOnline);
      document.removeEventListener('visibilitychange', handleFocusOrOnline);
      if (scheduledTimerRef.current) {
        clearTimeout(scheduledTimerRef.current);
        scheduledTimerRef.current = null;
      }
    };
  }, [fetchChurchAccess, clearAccessContext]);

  /**
   * Revalida o vínculo manualmente (botão "Tentar novamente").
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
   * Encerra a sessão atual com tratamento seguro de erros.
   * Garante que os dados locais e de membros sejam sempre limpos, mesmo se o servidor falhar.
   */
  async function signOut() {
    if (!supabase) return;

    // Invalida sessões e gerações imediatamente para descartar qualquer resposta em voo
    authGenerationRef.current += 1;
    sessionIdRef.current += 1;
    currentUserIdRef.current = null;
    clearAccessContext();
    clearMemberCommandStorage();
    setAuthError(null);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[AuthContext] Erro retornado ao deslogar:', error.message);
        setAuthError('Erro ao encerrar a sessão no servidor. O aplicativo retornou ao login.');
      }
    } catch (err) {
      console.error('[AuthContext] Erro inesperado ao deslogar:', err);
      setAuthError('Erro inesperado ao encerrar a sessão.');
    } finally {
      setSession(null);
      setAuthState('unauthenticated');
    }
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
