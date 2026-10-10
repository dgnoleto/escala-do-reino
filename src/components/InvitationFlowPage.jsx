import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  Church,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Edit3,
  LogOut,
  RefreshCw,
  X,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import {
  isValidInviteTokenFormat,
  validateProposedName,
  isUncertainInvitationResponse,
  validateReceiptPayload,
  saveAccessRequestMarker,
  formatInvitationErrorMessage,
  savePendingInvitationCommand,
  loadPendingInvitationCommand,
  removePendingInvitationCommand,
  checkPendingOperationConflict,
} from '../utils/invitationCommandService';

/**
 * InvitationFlowPage — tela de resgate de convite para a pessoa convidada.
 *
 * Atende aos requisitos:
 * 1. Acessível via rota /#/invite?token=... ou token pendente em sessionStorage.
 * 2. Disponível mesmo sem churchAccess ou se o usuário já administra outra igreja.
 * 3. Token Base64URL com formato e caixa estritamente preservados (sem trim ou lowercase).
 * 4. Antes da validação pelo backend, não exibe dados privados (igreja, membro ou destinatário).
 * 5. Conta errada, convite inválido ou expirado exibem mensagem genérica:
 *    "Convite inválido, expirado ou não associado a esta conta."
 * 6. Opção "Sair desta conta" para alternar para a conta correta preservando o convite.
 * 7. Confirmação do nome cadastrado envia p_expected_display_name idêntico ao retornado pelo servidor.
 * 8. Proposta de outro nome consome o convite e cria solicitação pendente sem liberar acesso.
 * 9. Descarte de respostas caso a sessão mude ou haja cancelamento explícito.
 */
export default function InvitationFlowPage({ token, onClearToken }) {
  const {
    session,
    signOutPreservingInvite,
    reloadChurchAccess,
    getAuthSnapshot
  } = useAuth();

  const user = session?.user;
  const userEmail = user?.email;
  const userId = user?.id;

  // Estado da verificação inicial dos detalhes
  const [detailsState, setDetailsState] = useState('checking'); // 'checking' | 'valid' | 'invalid' | 'error'
  const [invitationDetails, setInvitationDetails] = useState(null);
  const [detailsError, setDetailsError] = useState(null);

  // Modo de resgate: 'choose' | 'propose' | 'success_confirm' | 'success_propose'
  const [mode, setMode] = useState('choose');
  const [proposedNameInput, setProposedNameInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [confirmedResult, setConfirmedResult] = useState(null);

  // Comando congelado em voo para idempotência
  const activeCommandRef = useRef(null);
  const isSubmittingSyncRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Reconcilia um comando com resposta incerta chamando get_invitation_command_receipt.
   */
  async function checkReceipt(commandId, action, expectedParams) {
    if (!supabase) return { confirmed: false };
    try {
      const { data, error } = await supabase.schema('public').rpc('get_invitation_command_receipt', {
        p_command_id: commandId,
      });

      if (error || !Array.isArray(data) || data.length === 0) {
        return { confirmed: false };
      }

      const receipt = data[0];
      const validation = validateReceiptPayload(action, receipt, expectedParams);
      if (validation.valid) {
        return { confirmed: true, payload: validation.payload };
      }
      return { confirmed: false };
    } catch {
      return { confirmed: false };
    }
  }

  /**
   * Consulta os detalhes autorizados do convite via get_invitation_details.
   * Não revela dados sensíveis se o convite for inválido ou não pertencer a este e-mail.
   * Restaura e reconcilia comandos retidos antes de interpretar um convite consumido como inválido.
   */
  const loadDetails = useCallback(async () => {
    if (!token || !isValidInviteTokenFormat(token)) {
      setDetailsState('invalid');
      setDetailsError('Convite inválido, expirado ou não associado a esta conta.');
      return;
    }

    if (!supabase || !user) {
      setDetailsState('checking');
      return;
    }

    setDetailsState('checking');
    setDetailsError(null);

    // Verifica se há comando pendente para este token/usuário
    const pendingConfirm = typeof window !== 'undefined' && window.sessionStorage && userId
      ? loadPendingInvitationCommand(window.sessionStorage, userId, 'redeem_confirm_name')
      : null;
    const pendingPropose = typeof window !== 'undefined' && window.sessionStorage && userId
      ? loadPendingInvitationCommand(window.sessionStorage, userId, 'redeem_propose_name')
      : null;
    const savedCmd = (pendingConfirm && (!pendingConfirm.token || pendingConfirm.token === token))
      ? pendingConfirm
      : (pendingPropose && (!pendingPropose.token || pendingPropose.token === token))
        ? pendingPropose
        : null;

    if (savedCmd) {
      activeCommandRef.current = savedCmd;
    }

    const snapshot = getAuthSnapshot();

    try {
      const { data, error } = await supabase.schema('public').rpc('get_invitation_details', {
        p_raw_token: token,
      });

      if (!isMountedRef.current) return;
      if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

      const row = Array.isArray(data) && data.length > 0 ? data[0] : null;

      if (!row || !row.is_valid) {
        // Se o convite está consumido ou não-válido, verifica recibo do comando salvo antes de falhar
        if (savedCmd) {
          const receiptCheck = await checkReceipt(savedCmd.commandId, savedCmd.action, {
            commandId: savedCmd.commandId,
            churchId: savedCmd.churchId,
            memberId: savedCmd.memberId,
          });

          if (!isMountedRef.current) return;
          if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

          if (receiptCheck.confirmed) {
            activeCommandRef.current = null;
            if (typeof window !== 'undefined' && window.sessionStorage) {
              removePendingInvitationCommand(window.sessionStorage, userId, savedCmd.action);
              if (savedCmd.action === 'redeem_propose_name') {
                saveAccessRequestMarker(window.sessionStorage, userId, receiptCheck.payload);
              }
            }
            if (onClearToken) onClearToken();
            setConfirmedResult(receiptCheck.payload);
            setMode(savedCmd.action === 'redeem_confirm_name' ? 'success_confirm' : 'success_propose');
            setDetailsState('valid');
            if (savedCmd.action === 'redeem_confirm_name') {
              await reloadChurchAccess(receiptCheck.payload.church_id);
            }
            return;
          }
        }

        setDetailsState('invalid');
        setDetailsError('Convite inválido, expirado ou não associado a esta conta.');
        return;
      }

      setInvitationDetails(row);
      setDetailsState('valid');
    } catch {
      if (!isMountedRef.current) return;
      setDetailsState('invalid');
      setDetailsError('Convite inválido, expirado ou não associado a esta conta.');
    }
  }, [token, user, userId, getAuthSnapshot, onClearToken, reloadChurchAccess]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  /**
   * Confirmação do nome cadastrado (concede acesso básico).
   */
  async function handleConfirmName() {
    if (isSubmitting || isSubmittingSyncRef.current || !invitationDetails || !user) return;

    const conflict = typeof window !== 'undefined' && window.sessionStorage && userId
      ? checkPendingOperationConflict(window.sessionStorage, userId, {
          action: 'redeem_confirm_name',
          churchId: invitationDetails.church_id,
          targetId: token,
        })
      : { allowed: true, isRetry: false };

    if (!conflict.allowed || (activeCommandRef.current && activeCommandRef.current.action !== 'redeem_confirm_name')) {
      setActionError('Existe uma proposta de alteração de nome pendente de resolução. Não é permitido confirmar enquanto o resultado for desconhecido.');
      return;
    }

    let command = activeCommandRef.current;
    if (conflict.isRetry && conflict.existingCommand) {
      command = conflict.existingCommand;
      activeCommandRef.current = command;
    } else if (!command || command.action !== 'redeem_confirm_name') {
      command = {
        commandId: crypto.randomUUID(),
        action: 'redeem_confirm_name',
        token,
        expectedDisplayName: invitationDetails.member_display_name,
        churchId: invitationDetails.church_id,
        memberId: invitationDetails.member_id,
        userId,
      };
      activeCommandRef.current = command;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        savePendingInvitationCommand(window.sessionStorage, userId, command);
      }
    }

    isSubmittingSyncRef.current = true;
    setIsSubmitting(true);
    setActionError(null);
    const snapshot = getAuthSnapshot();

    try {
      const { data, error } = await supabase.schema('public').rpc('redeem_invitation_confirm_name', {
        p_command_id: command.commandId,
        p_raw_token: token,
        p_expected_display_name: invitationDetails.member_display_name,
      });

      if (!isMountedRef.current) return;
      if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

      const isUncertain = isUncertainInvitationResponse(error, data, 'redeem_confirm_name');

      if (isUncertain) {
        // Tenta reconciliar recibo antes de falhar
        const receiptCheck = await checkReceipt(command.commandId, 'redeem_confirm_name', {
          commandId: command.commandId,
          churchId: invitationDetails.church_id,
          memberId: invitationDetails.member_id,
        });

        if (!isMountedRef.current) return;
        if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

        if (receiptCheck.confirmed) {
          activeCommandRef.current = null;
          if (typeof window !== 'undefined' && window.sessionStorage) {
            removePendingInvitationCommand(window.sessionStorage, userId, 'redeem_confirm_name');
          }
          if (onClearToken) onClearToken();
          setConfirmedResult(receiptCheck.payload);
          setMode('success_confirm');
          await reloadChurchAccess(receiptCheck.payload.church_id);
          return;
        }

        setActionError('A resposta do servidor demorou mais que o esperado. Clique em "Tentar novamente" para verificar a confirmação.');
        return;
      }

      if (error) {
        activeCommandRef.current = null;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingInvitationCommand(window.sessionStorage, userId, 'redeem_confirm_name');
        }
        setActionError(formatInvitationErrorMessage(error, 'invitee'));
        return;
      }

      const result = data[0];
      activeCommandRef.current = null;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        removePendingInvitationCommand(window.sessionStorage, userId, 'redeem_confirm_name');
      }
      if (onClearToken) onClearToken();
      setConfirmedResult(result);
      setMode('success_confirm');

      // Atualiza o vínculo da igreja sem efeito colateral de criação
      await reloadChurchAccess(result.church_id);

    } catch (err) {
      if (!isMountedRef.current) return;
      setActionError(formatInvitationErrorMessage(err, 'invitee'));
    } finally {
      isSubmittingSyncRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  /**
   * Envio de proposta de outro nome (não concede acesso, gera access_request).
   */
  async function handleProposeName(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isSubmitting || isSubmittingSyncRef.current || !invitationDetails || !user) return;

    const conflict = typeof window !== 'undefined' && window.sessionStorage && userId
      ? checkPendingOperationConflict(window.sessionStorage, userId, {
          action: 'redeem_propose_name',
          churchId: invitationDetails.church_id,
          targetId: token,
        })
      : { allowed: true, isRetry: false };

    if (!conflict.allowed || (activeCommandRef.current && activeCommandRef.current.action !== 'redeem_propose_name')) {
      setActionError('Existe uma confirmação de acesso pendente de resolução. Não é permitido propor outro nome enquanto o resultado for desconhecido.');
      return;
    }

    let command = activeCommandRef.current;
    if (conflict.isRetry && conflict.existingCommand) {
      command = conflict.existingCommand;
      activeCommandRef.current = command;
    }
    let cleanProposedName = '';

    if (command && command.action === 'redeem_propose_name' && command.proposedDisplayName) {
      cleanProposedName = command.proposedDisplayName;
    } else {
      const validation = validateProposedName(proposedNameInput, invitationDetails.member_display_name);
      if (!validation.valid) {
        setActionError(validation.error);
        return;
      }
      cleanProposedName = validation.name;
      command = {
        commandId: crypto.randomUUID(),
        action: 'redeem_propose_name',
        token,
        proposedDisplayName: cleanProposedName,
        churchId: invitationDetails.church_id,
        memberId: invitationDetails.member_id,
        userId,
      };
      activeCommandRef.current = command;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        savePendingInvitationCommand(window.sessionStorage, userId, command);
      }
    }

    isSubmittingSyncRef.current = true;
    setIsSubmitting(true);
    setActionError(null);
    const snapshot = getAuthSnapshot();

    try {
      const { data, error } = await supabase.schema('public').rpc('redeem_invitation_propose_name', {
        p_command_id: command.commandId,
        p_raw_token: token,
        p_proposed_display_name: cleanProposedName,
      });

      if (!isMountedRef.current) return;
      if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

      const isUncertain = isUncertainInvitationResponse(error, data, 'redeem_propose_name');

      if (isUncertain) {
        const receiptCheck = await checkReceipt(command.commandId, 'redeem_propose_name', {
          commandId: command.commandId,
          churchId: invitationDetails.church_id,
          memberId: invitationDetails.member_id,
        });

        if (!isMountedRef.current) return;
        if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

        if (receiptCheck.confirmed) {
          activeCommandRef.current = null;
          if (typeof window !== 'undefined' && window.sessionStorage) {
            removePendingInvitationCommand(window.sessionStorage, userId, 'redeem_propose_name');
            saveAccessRequestMarker(window.sessionStorage, userId, receiptCheck.payload);
          }
          if (onClearToken) onClearToken();
          setConfirmedResult(receiptCheck.payload);
          setMode('success_propose');
          return;
        }

        setActionError('A resposta do servidor demorou mais que o esperado. Clique em "Tentar novamente" para verificar o envio da proposta.');
        return;
      }

      if (error) {
        activeCommandRef.current = null;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingInvitationCommand(window.sessionStorage, userId, 'redeem_propose_name');
        }
        setActionError(formatInvitationErrorMessage(error, 'invitee'));
        return;
      }

      const result = data[0];
      activeCommandRef.current = null;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        removePendingInvitationCommand(window.sessionStorage, userId, 'redeem_propose_name');
        saveAccessRequestMarker(window.sessionStorage, userId, result);
      }
      if (onClearToken) onClearToken();
      setConfirmedResult(result);
      setMode('success_propose');

    } catch (err) {
      if (!isMountedRef.current) return;
      setActionError(formatInvitationErrorMessage(err, 'invitee'));
    } finally {
      isSubmittingSyncRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  // Formatação de data/hora
  function formatExpiresAt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  // 1. Caso de Sucesso: Confirmação de Nome (Acesso Concedido)
  if (mode === 'success_confirm') {
    return (
      <div className="invite-page" role="main">
        <div className="invite-card">
          <div className="invite-icon-box invite-icon-box--success" aria-hidden="true">
            <CheckCircle2 size={36} color="var(--primary)" />
          </div>

          <h1 className="invite-title">Acesso Confirmado!</h1>
          <p className="invite-subtitle">
            Bem-vindo(a) à comunidade <strong>{confirmedResult?.church_name || invitationDetails?.church_name}</strong>.
          </p>

          <div className="invite-info-box">
            <div className="invite-info-row">
              <span className="invite-info-label">Nome cadastrado:</span>
              <strong className="invite-info-value">{confirmedResult?.display_name || invitationDetails?.member_display_name}</strong>
            </div>
            <div className="invite-info-row">
              <span className="invite-info-label">Perfil concedido:</span>
              <span className="badge badge-primary">Membro</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => reloadChurchAccess(confirmedResult?.church_id)}
            style={{ width: '100%', marginTop: '16px' }}
          >
            Acessar a Igreja <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // 2. Caso de Sucesso: Proposta de Nome Enviada (Aguardando Aprovação)
  if (mode === 'success_propose') {
    return (
      <div className="invite-page" role="main">
        <div className="invite-card">
          <div className="invite-icon-box invite-icon-box--info" aria-hidden="true">
            <Clock size={36} color="var(--primary)" />
          </div>

          <h1 className="invite-title">Proposta Enviada para Análise</h1>
          <p className="invite-subtitle">
            Sua proposta de nome foi enviada aos administradores da comunidade <strong>{invitationDetails?.church_name}</strong>.
          </p>

          <div className="invite-info-box">
            <div className="invite-info-row">
              <span className="invite-info-label">Nome original:</span>
              <span className="invite-info-value">{confirmedResult?.original_display_name || invitationDetails?.member_display_name}</span>
            </div>
            <div className="invite-info-row">
              <span className="invite-info-label">Nome proposto:</span>
              <strong className="invite-info-value" style={{ color: 'var(--primary)' }}>
                {confirmedResult?.proposed_display_name}
              </strong>
            </div>
            <div className="invite-info-row">
              <span className="invite-info-label">Prazo de análise:</span>
              <span className="invite-info-value">{formatExpiresAt(confirmedResult?.expires_at || invitationDetails?.expires_at)}</span>
            </div>
          </div>

          <p className="invite-note" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '14px 0 20px', lineHeight: 1.5 }}>
            O convite foi consumido. O seu acesso será liberado assim que um administrador aprovar o nome proposto. Você pode acompanhar a situação nesta mesma aba.
          </p>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => reloadChurchAccess()}
            style={{ width: '100%' }}
          >
            Acompanhar Solicitação
          </button>
        </div>
      </div>
    );
  }

  // 3. Verificando Detalhes
  if (detailsState === 'checking') {
    return (
      <div className="invite-page" role="main">
        <div className="invite-card">
          <div className="invite-icon-box" aria-hidden="true">
            <RefreshCw size={32} className="spin-icon" color="var(--primary)" />
          </div>
          <h1 className="invite-title">Verificando Convite…</h1>
          <p className="invite-subtitle">Validando os dados de acesso da sua conta.</p>
        </div>
      </div>
    );
  }

  // 4. Convite Inválido, Expirado ou Não Associado
  if (detailsState === 'invalid') {
    return (
      <div className="invite-page" role="main">
        <div className="invite-card">
          <div className="invite-icon-box invite-icon-box--error" aria-hidden="true">
            <ShieldAlert size={36} color="#ef4444" />
          </div>

          <h1 className="invite-title">Convite Não Disponível</h1>
          <p className="invite-subtitle">
            {detailsError || 'Convite inválido, expirado ou não associado a esta conta.'}
          </p>

          {userEmail && (
            <p className="invite-account-badge" aria-label={`Conectado como ${userEmail}`}>
              Conectado como: <strong>{userEmail}</strong>
            </p>
          )}

          <div className="invite-actions-column">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={signOutPreservingInvite}
              id="btn-switch-account-invite"
            >
              <LogOut size={15} /> Sair desta conta para usar outro e-mail
            </button>

            <button
              type="button"
              className="btn btn-link"
              onClick={onClearToken}
              id="btn-cancel-invite"
              style={{ marginTop: '8px', color: 'var(--text-muted)', fontSize: '0.85rem' }}
            >
              Cancelar e continuar no aplicativo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 5. Convite Válido — Apresentação dos Detalhes e Ações
  return (
    <div className="invite-page" role="main">
      <div className="invite-card" aria-label="Aceitar convite de acesso">
        <div className="invite-icon-box" aria-hidden="true">
          <Church size={36} color="var(--primary)" />
        </div>

        <h1 className="invite-title">Convite de Acesso</h1>
        <p className="invite-subtitle">
          Você foi convidado(a) para participar da comunidade <strong>{invitationDetails.church_name}</strong>.
        </p>

        {actionError && (
          <div className="alert-banner alert-banner--error" role="alert" style={{ marginBottom: '16px' }}>
            <AlertCircle size={16} />
            <span>{actionError}</span>
          </div>
        )}

        <div className="invite-details-box">
          <div className="invite-info-row">
            <span className="invite-info-label">Nome cadastrado:</span>
            <strong className="invite-info-value">{invitationDetails.member_display_name}</strong>
          </div>
          <div className="invite-info-row">
            <span className="invite-info-label">Comunidade:</span>
            <span className="invite-info-value">{invitationDetails.church_name}</span>
          </div>
          <div className="invite-info-row">
            <span className="invite-info-label">Válido até:</span>
            <span className="invite-info-value">{formatExpiresAt(invitationDetails.expires_at)}</span>
          </div>
        </div>

        {mode === 'choose' && (
          <div className="invite-actions-flow">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={handleConfirmName}
              disabled={isSubmitting || Boolean(activeCommandRef.current && activeCommandRef.current.action === 'redeem_propose_name')}
              id="btn-confirm-name"
              style={{ width: '100%', marginBottom: '10px' }}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="spin-icon" /> Confirmando…
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} /> Confirmar meu nome como "{invitationDetails.member_display_name}"
                </>
              )}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (activeCommandRef.current && activeCommandRef.current.action === 'redeem_confirm_name') return;
                setMode('propose');
                setActionError(null);
                setProposedNameInput('');
              }}
              disabled={isSubmitting || Boolean(activeCommandRef.current && activeCommandRef.current.action === 'redeem_confirm_name')}
              id="btn-propose-other-name"
              style={{ width: '100%', marginBottom: '16px' }}
            >
              <Edit3 size={15} /> Propor outro nome
            </button>

            <div className="invite-secondary-actions" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-link"
                onClick={signOutPreservingInvite}
                style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}
              >
                <LogOut size={13} /> Sair desta conta para entrar com outro e-mail
              </button>
            </div>
          </div>
        )}

        {mode === 'propose' && (
          <form onSubmit={handleProposeName} className="invite-propose-form">
            <div className="form-group" style={{ textAlign: 'left', marginBottom: '14px' }}>
              <label htmlFor="input-proposed-name" className="form-label">
                Qual o seu nome correto?
              </label>
              <input
                id="input-proposed-name"
                type="text"
                className="form-input"
                placeholder="Ex: Maria Alice de Souza"
                value={proposedNameInput}
                onChange={(e) => setProposedNameInput(e.target.value)}
                maxLength={120}
                disabled={isSubmitting}
                autoFocus
                required
              />
              <div className="input-hint" style={{ marginTop: '4px' }}>
                <span>{proposedNameInput.trim().length}/120 caracteres</span>
                <span>Deve ser diferente do nome atualmente cadastrado</span>
              </div>
            </div>

            <p className="invite-propose-warning" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: '14px' }}>
              Ao propor outro nome, o convite será consumido e uma solicitação será enviada aos administradores para análise dentro do prazo restante do convite. O acesso será liberado somente após a aprovação.
            </p>

            <div className="modal-actions" style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setMode('choose');
                  setActionError(null);
                }}
                disabled={isSubmitting}
              >
                Voltar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !proposedNameInput.trim()}
                id="btn-submit-propose-name"
              >
                {isSubmitting ? 'Enviando proposta…' : 'Enviar proposta de nome'}
              </button>
            </div>
          </form>
        )}
      </div>

      <style>{`
        .invite-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          background: var(--bg-secondary);
          background-image: radial-gradient(
            ellipse at 50% 20%,
            var(--primary-surface) 0%,
            transparent 70%
          );
        }

        .invite-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
          padding: 40px 32px;
          width: 100%;
          max-width: 460px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .invite-icon-box {
          width: 68px;
          height: 68px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--primary-surface);
          border: 2px solid var(--primary-border);
          border-radius: var(--radius-lg);
          margin-bottom: 20px;
        }

        .invite-icon-box--success {
          background: #ecfdf5;
          border-color: #a7f3d0;
        }

        .invite-icon-box--error {
          background: #fef2f2;
          border-color: #fecaca;
        }

        .invite-title {
          font-size: 22px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0 0 8px;
          letter-spacing: -0.3px;
        }

        .invite-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: 0 0 20px;
        }

        .invite-details-box, .invite-info-box {
          width: 100%;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 20px;
          text-align: left;
        }

        .invite-info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          gap: 8px;
        }

        .invite-info-label {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .invite-info-value {
          color: var(--text-primary);
          text-align: right;
          word-break: break-word;
        }

        .invite-account-badge {
          font-size: 13px;
          color: var(--text-secondary);
          background: var(--bg-surface);
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          margin-bottom: 20px;
        }

        .invite-actions-column {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .invite-actions-flow {
          width: 100%;
        }

        .invite-propose-form {
          width: 100%;
        }

        .spin-icon {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
