import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  determineAuthTransition,
  clearAllMemberCommandStorage,
} from '../utils/memberCommandService';
import {
  clearAllChurchCommandStorage,
  invalidateChurchCommandSession,
} from '../utils/churchCommandService';
import {
  INVITATION_PENDING_TOKEN_KEY,
  extractInviteTokenFromUrl,
  clearInviteTokenFromUrl,
  clearAllInvitationStorageForUser,
} from '../utils/invitationCommandService';

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
export const STORAGE_KEY_SELECTED_CHURCH_PREFIX = 'selected_church_';

export function AuthProvider({ children }) {
  const [session, setSession]                     = useState(undefined);
  const [authState, setAuthState]                 = useState('initializing');
  const [authError, setAuthError]                 = useState(null);
  const [churchAccess, setChurchAccess]           = useState(null);
  const [availableAccesses, setAvailableAccesses] = useState([]);
  const [creationConfirmation, setCreationConfirmation] = useState(null);
  const [pendingInviteToken, setPendingInviteToken] = useState(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const fromUrl = extractInviteTokenFromUrl();
      if (fromUrl) {
        window.sessionStorage.setItem(INVITATION_PENDING_TOKEN_KEY, fromUrl);
        clearInviteTokenFromUrl();
        return fromUrl;
      }
      return window.sessionStorage.getItem(INVITATION_PENDING_TOKEN_KEY) || null;
    }
    return null;
  });
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  // Ref para função viva de aplicação de sessão
  const applySessionRef     = useRef(null);
  // Ref para confirmação viva de criação (vinculada a userId e sessionId)
  const creationConfirmationRef = useRef(null);
  // Rastreia o UID da sessão ativa
  const currentUserIdRef    = useRef(null);
  // Identificador da geração da sessão atual: incrementa a cada login/logout para descartar respostas antigas
  const sessionIdRef        = useRef(0);
  // Geração monotônica de eventos de autenticação para evitar que getSession tardio sobrescreva evento mais recente
  const authGenerationRef   = useRef(0);
  // Sequência monotônica para impedir que consultas de sessão concorrentes sobrescrevam as mais recentes
  const sessionQuerySeqRef  = useRef(0);
  // Rastreia o ciclo de montagem ativo do efeito para descartar consultas em voo após desmontagem ou remontagem
  const effectMountIdRef    = useRef(0);
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
   * Limpa a intenção temporária de convite retida na sessão da aba.
   */
  const clearPendingInviteToken = useCallback(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(INVITATION_PENDING_TOKEN_KEY);
    }
    setPendingInviteToken(null);
  }, []);

  /**
   * Remove comandos pendentes de membros e igrejas retidos na sessão para evitar vazamento entre contas.
   */
  const clearMemberCommandStorage = useCallback(() => {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    clearAllMemberCommandStorage(window.sessionStorage);
    clearAllChurchCommandStorage(window.sessionStorage);
    if (currentUserIdRef.current) {
      clearAllInvitationStorageForUser(window.sessionStorage, currentUserIdRef.current);
    }
  }, []);

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
   * Registra a confirmação de criação de igreja para a sessão e identidade ativas.
   * Usada para preservar a mensagem na tela se a recarga subsequente de acesso falhar.
   */
  const recordCreationConfirmation = useCallback((churchData) => {
    if (!churchData?.church_id) return;
    const uid = currentUserIdRef.current;
    const sid = sessionIdRef.current;
    if (!uid) return;

    const record = {
      churchId: churchData.church_id,
      churchName: churchData.church_name || churchData.name || null,
      userId: uid,
      sessionId: sid,
      confirmedAt: Date.now(),
    };
    creationConfirmationRef.current = record;
    setCreationConfirmation(record);
  }, []);

  /**
   * Limpa a confirmação de criação de igreja ativa.
   */
  const clearCreationConfirmation = useCallback(() => {
    creationConfirmationRef.current = null;
    setCreationConfirmation(null);
  }, []);

  /**
   * Consulta o vínculo real da conta autenticada chamando public.get_my_church_access().
   *
   * @param {string} expectedUserId - UID da sessão esperada
   * @param {object} options - { isBackground: boolean, preferredChurchId: string|null }
   */
  const fetchChurchAccess = useCallback(async (expectedUserId, { isBackground = false, preferredChurchId = null } = {}) => {
    if (!supabase || !expectedUserId) return { success: false, error: 'Supabase ou usuário não configurado.' };

    // Registra a geração da sessão e a sequência desta requisição
    const thisSessionId = sessionIdRef.current;
    const thisSeq       = ++requestSeqRef.current;

    if (preferredChurchId && typeof window !== 'undefined') {
      window.sessionStorage?.setItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId, preferredChurchId);
    }

    if (!isBackground) {
      setAuthState('checking_access');
      setChurchAccess(null);
      setAuthError(null);
    }

    try {
      const { data, error } = await supabase.schema('public').rpc('get_my_church_access');

      // Descartar se a sessão mudou ou se uma consulta mais recente já foi disparada
      if (sessionIdRef.current !== thisSessionId || requestSeqRef.current !== thisSeq) {
        return { success: false, stale: true };
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
            setAvailableAccesses([]);
            setAuthState('access_pending');
          }
        }
        return { success: false, error: error.message || 'Falha ao verificar o acesso.' };
      }

      if (!data || data.length === 0) {
        // Conta válida, mas sem vínculo elegível
        clearAccessContext();
        setAvailableAccesses([]);
        if (typeof window !== 'undefined') {
          window.sessionStorage?.removeItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId);
        }
        setAuthState('access_pending');
        return { success: false, reason: 'access_pending' };
      }

      setAvailableAccesses(data);

      if (data.length === 1) {
        const singleAccess = data[0];
        // Se um destino específico foi solicitado e ele não existe mais:
        if (preferredChurchId && preferredChurchId !== singleAccess.church_id) {
          clearAccessContext();
          if (typeof window !== 'undefined') {
            window.sessionStorage?.removeItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId);
          }
          setAuthError('A igreja selecionada não está mais disponível para esta conta.');
          setAuthState('access_error');
          return { success: false, error: 'A igreja selecionada não está mais disponível para esta conta.' };
        }

        // Vínculo único válido: preserva e seleciona
        if (typeof window !== 'undefined') {
          window.sessionStorage?.setItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId, singleAccess.church_id);
        }
        creationConfirmationRef.current = null;
        setCreationConfirmation(null);
        setChurchAccess(singleAccess);
        churchAccessRef.current = singleAccess;
        setAuthState('access_granted');
        return { success: true, churchAccess: singleAccess };
      }

      // Múltiplos vínculos autorizados (> 1):
      // Determina igreja alvo: 1) preferredChurchId explícito; 2) seleção estável salva no sessionStorage; 3) contexto atual ativo
      const savedChurchId = typeof window !== 'undefined' ? window.sessionStorage?.getItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId) : null;
      const targetChurchId = preferredChurchId || savedChurchId || churchAccessRef.current?.church_id || null;

      if (targetChurchId) {
        const found = data.find((ca) => ca.church_id === targetChurchId);
        if (found) {
          // Destino encontrado e revalidado contra os vínculos autorizados
          if (typeof window !== 'undefined') {
            window.sessionStorage?.setItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId, found.church_id);
          }
          creationConfirmationRef.current = null;
          setCreationConfirmation(null);
          setChurchAccess(found);
          churchAccessRef.current = found;
          setAuthState('access_granted');
          return { success: true, churchAccess: found };
        } else {
          // Destino esperado não encontrado entre os múltiplos vínculos:
          // Não usar data[0] como fallback silencioso! Exigir escolha explícita.
          console.warn(`[AuthContext] Igreja ${targetChurchId} não encontrada entre os ${data.length} vínculos autorizados.`);
          clearAccessContext();
          if (typeof window !== 'undefined') {
            window.sessionStorage?.removeItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + expectedUserId);
          }
          setAuthState('select_church');
          return { success: false, reason: 'select_church' };
        }
      }

      // Múltiplos acessos e nenhuma escolha salva: solicitar seleção explícita
      clearAccessContext();
      setAuthState('select_church');
      return { success: false, reason: 'select_church' };

    } catch (unexpectedErr) {
      if (sessionIdRef.current !== thisSessionId || requestSeqRef.current !== thisSeq) {
        return { success: false, stale: true };
      }
      console.error('[AuthContext] Erro inesperado na consulta de vínculo:', unexpectedErr);
      if (!isBackground) {
        setAuthError('Erro inesperado ao verificar o acesso.');
        setAuthState('access_error');
      }
      return { success: false, error: 'Erro inesperado ao verificar o acesso.' };
    }
  }, [clearAccessContext]);

  /**
   * Coordena consultas assíncronas de sessão no storage (checkSession e revalidações por foco/visibilidade).
   *
   * Regras de coordenação:
   * 1. Captura a geração de auth, a sequência da consulta, a identidade ativa e o ciclo de montagem
   *    de forma síncrona ANTES de iniciar a chamada assíncrona getSession().
   * 2. Descarta o resultado e retorna null se:
   *    - O componente/efeito foi desmontado ou remontado;
   *    - Uma consulta mais recente foi iniciada posteriormente (ordem de concorrência);
   *    - Qualquer evento de autenticação (onAuthStateChange ou signOut) ocorreu em voo;
   *    - A identidade ou sessão ativa foi alterada em voo.
   * 3. Nunca atribui geração nova/superior a um snapshot obsoleto superado por eventos mais recentes.
   * 4. Aplica a sessão legitimamente se e somente se nenhuma invalidação ocorreu.
   * 5. Retorna a sessão aplicada ou null caso seja descartada ou inexistente.
   */
  const coordinateSessionQuery = useCallback(async () => {
    if (!supabase || !applySessionRef.current) return null;

    const startMountId = effectMountIdRef.current;
    const startGen = authGenerationRef.current;
    const startUserId = currentUserIdRef.current;
    const startSessionId = sessionIdRef.current;
    const thisQuerySeq = ++sessionQuerySeqRef.current;

    try {
      const { data: { session: resumedSession } = {} } = await supabase.auth.getSession();

      // 1. Descarta se o efeito foi desmontado ou remontado
      if (!applySessionRef.current || effectMountIdRef.current !== startMountId) {
        return null;
      }

      // 2. Descarta se superada por uma consulta mais recente
      if (sessionQuerySeqRef.current !== thisQuerySeq) {
        return null;
      }

      // 3. Descarta se qualquer evento de Auth chegou durante a requisição
      if (authGenerationRef.current !== startGen) {
        return null;
      }

      // 4. Descarta se a identidade ou sessão foi alterada durante a requisição
      if (currentUserIdRef.current !== startUserId || sessionIdRef.current !== startSessionId) {
        return null;
      }

      // Se há sessão legítima e não houve conflito, aplica com nova geração atômica
      if (resumedSession) {
        const currentGen = ++authGenerationRef.current;
        applySessionRef.current(resumedSession, currentGen);
        return resumedSession;
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSession(null);
      setAuthState('unauthenticated');
      return;
    }

    const thisMountId = ++effectMountIdRef.current;
    let isEffectActive = true;
    let hasAuthEventArrived = false;

    // Função de sincronização com nova sessão baseada em ordem de geração
    function applySession(newSession, eventGen) {
      if (!isEffectActive) return;
      if (eventGen < authGenerationRef.current) {
        // Ignora snapshots obsoletos que resolveram fora de ordem
        return;
      }

      const previousUserId = currentUserIdRef.current;
      const newUserId = newSession?.user?.id ?? null;

      const transition = determineAuthTransition({
        previousUserId,
        newUserId,
        currentGen: eventGen,
        authGen: authGenerationRef.current,
      });

      if (transition.isStale) {
        // Ignora snapshots obsoletos que resolveram fora de ordem
        return;
      }

      setSession(newSession);

      if (transition.type === 'LOGOUT' || transition.type === 'UNAUTHENTICATED') {
        sessionIdRef.current += 1;
        currentUserIdRef.current = null;
        creationConfirmationRef.current = null;
        setCreationConfirmation(null);
        invalidateChurchCommandSession();
        clearAccessContext();
        if (transition.shouldClearMemberStorage) {
          clearMemberCommandStorage();
        }
        setAuthState('unauthenticated');
        return;
      }

      if (transition.type === 'INITIAL_SESSION') {
        // Restauração inicial da mesma conta após reload/montagem.
        // PRESERVA o storage de comandos pendentes sem chamar clearMemberCommandStorage!
        sessionIdRef.current += 1;
        currentUserIdRef.current = newUserId;
        clearAccessContext();

        if (scheduledTimerRef.current) {
          clearTimeout(scheduledTimerRef.current);
        }

        scheduledTimerRef.current = setTimeout(() => {
          scheduledTimerRef.current = null;
          if (isEffectActive && currentUserIdRef.current === newUserId) {
            fetchChurchAccess(newUserId);
          }
        }, 0);
        return;
      }

      if (transition.type === 'ACCOUNT_SWITCH') {
        // Troca efetiva de conta (usuário A -> usuário B).
        // Limpa o storage para garantir isolamento e evitar vazamento de dados.
        sessionIdRef.current += 1;
        creationConfirmationRef.current = null;
        setCreationConfirmation(null);
        if (previousUserId && typeof window !== 'undefined') {
          window.sessionStorage?.removeItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + previousUserId);
        }
        currentUserIdRef.current = newUserId;
        invalidateChurchCommandSession();
        clearAccessContext();
        setAvailableAccesses([]);
        clearMemberCommandStorage();

        if (scheduledTimerRef.current) {
          clearTimeout(scheduledTimerRef.current);
        }

        scheduledTimerRef.current = setTimeout(() => {
          scheduledTimerRef.current = null;
          if (isEffectActive && currentUserIdRef.current === newUserId) {
            fetchChurchAccess(newUserId);
          }
        }, 0);
        return;
      }
    }

    // Registra ref para acesso externo/manual
    applySessionRef.current = applySession;

    // 1. Escuta mudanças de estado do Supabase Auth (fonte autoritativa de eventos)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!isEffectActive) return;
        hasAuthEventArrived = true;
        initialHandledRef.current = true;
        if (event === 'PASSWORD_RECOVERY') {
          setIsPasswordRecovery(true);
        }
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
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;

      if (currentUserIdRef.current && churchAccessRef.current) {
        fetchChurchAccess(currentUserIdRef.current, { isBackground: true });
        return;
      }

      // Se a aba estava deslogada, verifica se outra aba autenticou a conta (ex: confirmação de e-mail)
      if (!currentUserIdRef.current && supabase) {
        coordinateSessionQuery().catch(() => {});
      }
    }

    function handleHashChange() {
      const fromUrl = extractInviteTokenFromUrl();
      if (fromUrl) {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(INVITATION_PENDING_TOKEN_KEY, fromUrl);
        }
        setPendingInviteToken(fromUrl);
        clearInviteTokenFromUrl();
      }
    }

    window.addEventListener('focus', handleFocusOrOnline);
    window.addEventListener('online', handleFocusOrOnline);
    document.addEventListener('visibilitychange', handleFocusOrOnline);
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      isEffectActive = false;
      applySessionRef.current = null;
      effectMountIdRef.current += 1;
      sessionQuerySeqRef.current += 1;
      subscription.unsubscribe();
      window.removeEventListener('focus', handleFocusOrOnline);
      window.removeEventListener('online', handleFocusOrOnline);
      document.removeEventListener('visibilitychange', handleFocusOrOnline);
      window.removeEventListener('hashchange', handleHashChange);
      if (scheduledTimerRef.current) {
        clearTimeout(scheduledTimerRef.current);
        scheduledTimerRef.current = null;
      }
    };
  }, [fetchChurchAccess, clearAccessContext, clearMemberCommandStorage, coordinateSessionQuery]);

  /**
   * Revalida o vínculo manualmente (botão "Tentar novamente").
   */
  /**
   * Revalida o vínculo manualmente (botão "Tentar novamente").
   * Quando uma criação recente foi confirmada, preserva o destino explícito da igreja criada.
   */
  const retryAccessCheck = useCallback(() => {
    const uid = currentUserIdRef.current;
    const sid = sessionIdRef.current;
    if (!uid) return;
    const confirmed = creationConfirmationRef.current;
    const targetChurchId = (confirmed?.userId === uid && (!sid || confirmed?.sessionId === sid))
      ? confirmed.churchId
      : null;
    fetchChurchAccess(uid, { isBackground: false, preferredChurchId: targetChurchId });
  }, [fetchChurchAccess]);

  /**
   * Seleciona explicitamente uma igreja para consulta e invalida o estado anterior (M61 / PRD).
   *
   * @param {string|null} churchId - ID da igreja desejada ou null para exibir a seleção
   */
  const selectChurch = useCallback((churchId) => {
    const uid = currentUserIdRef.current;
    if (!uid) return;
    // Invalida a sequência de consultas anteriores em voo antes de alterar ou limpar o contexto (M61 / PRD)
    requestSeqRef.current += 1;
    clearAccessContext();
    if (churchId) {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.setItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + uid, churchId);
      }
      fetchChurchAccess(uid, { isBackground: false, preferredChurchId: churchId });
    } else {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.removeItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + uid);
      }
      setAuthState('select_church');
    }
  }, [clearAccessContext, fetchChurchAccess]);

  /**
   * Recarrega o vínculo com suporte a seleção de igreja preferencial (ex.: após criar igreja).
   */
  const refreshAccess = useCallback(async (preferredChurchId = null) => {
    const targetId = typeof preferredChurchId === 'object' && preferredChurchId !== null
      ? preferredChurchId.church_id || preferredChurchId.preferredChurchId
      : preferredChurchId;
    const churchName = typeof preferredChurchId === 'object' && preferredChurchId !== null
      ? preferredChurchId.church_name || preferredChurchId.name
      : null;
    if (churchName && targetId) {
      recordCreationConfirmation({ church_id: targetId, church_name: churchName });
    }
    const uid = currentUserIdRef.current;
    if (!uid) return { success: false, error: 'Usuário não autenticado.' };
    return await fetchChurchAccess(uid, { isBackground: false, preferredChurchId: targetId });
  }, [fetchChurchAccess, recordCreationConfirmation]);

  /**
   * Getter estável da identidade e geração da sessão vigentes (fonte viva do AuthContext).
   */
  const getAuthSnapshot = useCallback(() => ({
    userId: currentUserIdRef.current,
    sessionId: sessionIdRef.current,
  }), []);

  /**
   * Recarrega o vínculo diretamente para uma igreja sem o efeito colateral de registrar confirmação de criação.
   */
  const reloadChurchAccess = useCallback(async (preferredChurchId = null) => {
    const uid = currentUserIdRef.current;
    if (!uid) return { success: false, error: 'Usuário não autenticado.' };
    return await fetchChurchAccess(uid, { isBackground: false, preferredChurchId });
  }, [fetchChurchAccess]);

  /**
   * Consulta ativamente a sessão salva no storage (útil após confirmação de e-mail em outra aba).
   * Compartilha a mesma coordenação unificada de sessões para evitar corridas contra eventos posteriores.
   */
  const checkSession = coordinateSessionQuery;

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

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: origin,
      },
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { error: null };
  }

  /**
   * Autenticação via e-mail e senha.
   */
  async function signInWithPassword(email, password) {
    if (!isSupabaseConfigured() || !supabase) {
      const err = new Error('Configuração do Supabase ausente ou inválida.');
      setAuthError(err.message);
      return { error: err };
    }

    setAuthError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data, error: null };
  }

  /**
   * Cadastro de nova conta via e-mail e senha.
   * Não presume login nem acesso caso confirmação de e-mail esteja pendente.
   */
  async function signUpWithPassword(email, password) {
    if (!isSupabaseConfigured() || !supabase) {
      const err = new Error('Configuração do Supabase ausente ou inválida.');
      setAuthError(err.message);
      return { error: err };
    }

    setAuthError(null);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: origin,
      },
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data, error: null };
  }

  /**
   * Solicita envio de link de recuperação de senha por e-mail.
   */
  async function resetPasswordForEmail(email) {
    if (!isSupabaseConfigured() || !supabase) {
      const err = new Error('Configuração do Supabase ausente ou inválida.');
      setAuthError(err.message);
      return { error: err };
    }

    setAuthError(null);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: origin,
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    return { data, error: null };
  }

  /**
   * Atualiza a senha da conta autenticada (usado na recuperação).
   */
  async function updateUserPassword(newPassword) {
    if (!isSupabaseConfigured() || !supabase) {
      const err = new Error('Configuração do Supabase ausente ou inválida.');
      setAuthError(err.message);
      return { error: err };
    }

    setAuthError(null);

    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      setAuthError(error.message);
      return { error };
    }

    setIsPasswordRecovery(false);
    return { data, error: null };
  }

  /**
   * Encerra a sessão atual com tratamento seguro de erros.
   * Garante que os dados locais e de membros sejam sempre limpos, mesmo se o servidor falhar.
   *
   * @param {object} [options]
   * @param {boolean} [options.preserveInvite] - Se true, preserva o token de convite na sessão para troca de conta
   */
  async function signOut(options = {}) {
    if (!supabase) return;

    const preserveInvite = Boolean(options?.preserveInvite);

    // Invalida sessões e gerações imediatamente para descartar qualquer resposta em voo
    authGenerationRef.current += 1;
    sessionIdRef.current += 1;
    creationConfirmationRef.current = null;
    setCreationConfirmation(null);
    invalidateChurchCommandSession();
    const uid = currentUserIdRef.current;
    currentUserIdRef.current = null;
    clearAccessContext();
    setAvailableAccesses([]);
    clearMemberCommandStorage();
    if (uid && typeof window !== 'undefined') {
      window.sessionStorage?.removeItem(STORAGE_KEY_SELECTED_CHURCH_PREFIX + uid);
      clearAllInvitationStorageForUser(window.sessionStorage, uid);
    }
    if (!preserveInvite) {
      clearPendingInviteToken();
    }
    setIsPasswordRecovery(false);
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

  /**
   * Encerra a sessão atual preservando explicitamente a intenção do convite
   * para permitir login com o e-mail correto (M51 / PRD).
   */
  function signOutPreservingInvite() {
    return signOut({ preserveInvite: true });
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        sessionId: sessionIdRef.current,
        getAuthSnapshot,
        authState,
        authError,
        setAuthError,
        churchAccess,
        availableAccesses,
        creationConfirmation,
        recordCreationConfirmation,
        clearCreationConfirmation,
        selectChurch,
        signInWithGoogle,
        signInWithPassword,
        signUpWithPassword,
        resetPasswordForEmail,
        updateUserPassword,
        signOut,
        signOutPreservingInvite,
        retryAccessCheck,
        refreshAccess,
        reloadChurchAccess,
        checkSession,
        pendingInviteToken,
        setPendingInviteToken,
        clearPendingInviteToken,
        isPasswordRecovery,
        setIsPasswordRecovery,
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
