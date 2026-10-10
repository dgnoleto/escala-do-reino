import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import {
  Send,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  X,
  RefreshCw,
  Clock,
  ShieldCheck,
  Info
} from 'lucide-react';
import {
  validateRecipientEmail,
  isUncertainInvitationResponse,
  validateReceiptPayload,
  formatInvitationErrorMessage,
  savePendingInvitationCommand,
  loadPendingInvitationCommand,
  removePendingInvitationCommand,
  checkPendingOperationConflict,
} from '../utils/invitationCommandService';

/**
 * IssueInvitationModal — modal administrativo para emissão e reemissão de convites de acesso.
 *
 * Regras estritas:
 * - Vinculado ao ID real do membro (suporta homônimos).
 * - Coleta e valida o e-mail do destinatário.
 * - Confirmação explícita em caso de reemissão (invalida convite aberto e cancela solicitação de nome anterior).
 * - O link bruto gerado reside exclusivamente na memória deste componente durante a exibição.
 * - Não persiste o token em localStorage, histórico ou recibos.
 * - Tratamento de falha no clipboard: oferece seleção/cópia manual sem fingir sucesso.
 * - Replay com raw_token nulo informa a não-recuperabilidade e a necessidade de reemissão explícita.
 */
export default function IssueInvitationModal({
  member,
  churchId,
  churchName,
  isOpen,
  onClose,
  onSuccess,
  isReissue = false,
}) {
  const { session, getAuthSnapshot } = useAuth();
  const userId = session?.user?.id;

  const [detectedReissue, setDetectedReissue] = useState(false);
  const [checkingReissue, setCheckingReissue] = useState(false);
  const [reissueCheckStatus, setReissueCheckStatus] = useState('idle'); // 'idle' | 'checking' | 'detected' | 'uncertain' | 'clear'

  const memberId = member?.member_id || member?.id;
  const memberName = member?.display_name;

  // Avalia conflito com operações pendentes existentes no storage (D3)
  const pendingConflict = typeof window !== 'undefined' && window.sessionStorage && userId
    ? checkPendingOperationConflict(window.sessionStorage, userId, {
        action: 'issue_invitation',
        churchId,
        targetId: memberId,
      })
    : { allowed: true, isRetry: false };

  const hasOtherPending = !pendingConflict.allowed && pendingConflict.reason === 'other_target_pending';

  const isReissueMode = Boolean(
    isReissue ||
    member?.isReissue ||
    member?.hasOpenInvite ||
    member?.status === 'open' ||
    member?.status === 'expired' ||
    detectedReissue ||
    reissueCheckStatus === 'detected' ||
    reissueCheckStatus === 'uncertain' ||
    reissueCheckStatus === 'checking'
  );

  const [emailInput, setEmailInput] = useState('');
  const [confirmReissue, setConfirmReissue] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Estado do link recém-emitido (em memória apenas)
  const [issuedResult, setIssuedResult] = useState(null);
  const [copyState, setCopyState] = useState('idle'); // 'idle' | 'copied' | 'failed'
  const linkInputRef = useRef(null);

  const activeCommandRef = useRef(null);
  const isSubmittingSyncRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // Recupera comando pendente em caso de recarga
    if (typeof window !== 'undefined' && window.sessionStorage && userId && memberId) {
      const saved = loadPendingInvitationCommand(window.sessionStorage, userId, 'issue_invitation', memberId);
      if (saved && saved.churchId === churchId && saved.memberId === memberId) {
        activeCommandRef.current = saved;
        if (saved.recipientEmail) setEmailInput(saved.recipientEmail);

        // Tenta consultar recibo do comando salvo
        (async () => {
          if (!supabase) return;
          try {
            const { data: recData, error: recErr } = await supabase.schema('public').rpc('get_invitation_command_receipt', {
              p_command_id: saved.commandId,
            });
            if (!isMountedRef.current) return;
            if (!recErr && Array.isArray(recData) && recData.length > 0) {
              const validation = validateReceiptPayload('issue_invitation', recData[0], {
                commandId: saved.commandId,
                churchId,
                memberId,
              });
              if (validation.valid) {
                const payload = validation.payload;
                activeCommandRef.current = null;
                removePendingInvitationCommand(window.sessionStorage, userId, 'issue_invitation', memberId);
                setIssuedResult({
                  ...payload,
                  raw_token: null,
                  link_unrecoverable: true,
                });
                if (onSuccess) onSuccess(payload);
              }
            }
          } catch {}
        })();
      }
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [userId, churchId, memberId, onSuccess]);

  useEffect(() => {
    if (!supabase || !churchId || !memberId) return;
    let isCurrent = true;
    setCheckingReissue(true);
    setReissueCheckStatus('checking');

    (async () => {
      try {
        const [invRes, reqRes] = await Promise.all([
          supabase.schema('public').rpc('list_church_invitations', {
            p_church_id: churchId,
            p_status_filter: 'open',
            p_limit: 50,
            p_offset: 0,
          }),
          supabase.schema('public').rpc('list_church_access_requests', {
            p_church_id: churchId,
            p_status_filter: 'pending',
            p_limit: 50,
            p_offset: 0,
          }),
        ]);

        if (!isCurrent) return;

        // Erro na consulta não fornece garantia de ausência (D1)
        if (invRes?.error || reqRes?.error) {
          setReissueCheckStatus('uncertain');
          setCheckingReissue(false);
          return;
        }

        const invRows = Array.isArray(invRes?.data) ? invRes.data : [];
        const reqRows = Array.isArray(reqRes?.data) ? reqRes.data : [];

        const hasOpen = invRows.some((inv) => (inv.member_id === memberId));
        const hasPendingReq = reqRows.some((req) => (req.member_id === memberId));

        if (hasOpen || hasPendingReq) {
          setDetectedReissue(true);
          setReissueCheckStatus('detected');
        } else {
          // Se a contagem total extrapola a primeira página, não há garantia estrita de ausência
          const invTotal = invRows.length > 0 ? Number(invRows[0].total_count || 0) : 0;
          const reqTotal = reqRows.length > 0 ? Number(reqRows[0].total_count || 0) : 0;
          if (invTotal > invRows.length || reqTotal > reqRows.length) {
            setReissueCheckStatus('uncertain');
          } else {
            setReissueCheckStatus('clear');
          }
        }
      } catch {
        if (!isCurrent) return;
        setReissueCheckStatus('uncertain');
      } finally {
        if (isCurrent) {
          setCheckingReissue(false);
        }
      }
    })();

    return () => { isCurrent = false; };
  }, [churchId, memberId]);

  if (!isOpen || !member) return null;

  function handleCloseModal() {
    if (submitting || isSubmittingSyncRef.current) return;
    // Fechar o modal visualmente não cancela nem descarta uma operação incerta em trânsito (C4 / PRD)
    setIssuedResult(null);
    setEmailInput('');
    setConfirmReissue(false);
    setErrorMessage(null);
    setCopyState('idle');
    activeCommandRef.current = null;
    onClose();
  }

  /**
   * Tenta copiar o link gerado para a área de transferência.
   */
  async function handleCopyLink(link) {
    if (!link) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        setCopyState('copied');
        setTimeout(() => {
          if (isMountedRef.current) setCopyState('idle');
        }, 3000);
      } else {
        throw new Error('Clipboard API não disponível');
      }
    } catch {
      setCopyState('failed');
      if (linkInputRef.current) {
        linkInputRef.current.focus();
        linkInputRef.current.select();
      }
    }
  }

  function handleSelectManual() {
    if (linkInputRef.current) {
      linkInputRef.current.focus();
      linkInputRef.current.select();
    }
  }

  /**
   * Executa a emissão ou reemissão chamando issue_church_invitation.
   */
  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (submitting || isSubmittingSyncRef.current) return;

    if (hasOtherPending || !pendingConflict.allowed) {
      setErrorMessage('Existe uma operação de emissão pendente para outro membro aguardando reconciliação com o servidor. Conclua ou reconcilie a operação pendente antes de emitir um novo convite.');
      return;
    }

    if (isReissueMode && !confirmReissue) {
      setErrorMessage('É necessário confirmar que está ciente da substituição do convite anterior ou proposta pendente.');
      return;
    }

    // Se já há um comando incerto ativo, preserva estritamente os parâmetros originais
    let command = activeCommandRef.current;
    if (pendingConflict.isRetry && pendingConflict.existingCommand) {
      command = pendingConflict.existingCommand;
      activeCommandRef.current = command;
    }
    let targetEmail = '';

    if (command && command.recipientEmail) {
      targetEmail = command.recipientEmail;
    } else {
      const emailValidation = validateRecipientEmail(emailInput);
      if (!emailValidation.valid) {
        setErrorMessage(emailValidation.error);
        return;
      }
      targetEmail = emailValidation.email;
      command = {
        commandId: crypto.randomUUID(),
        action: 'issue_invitation',
        churchId,
        memberId,
        recipientEmail: targetEmail,
        userId,
      };
      activeCommandRef.current = command;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        savePendingInvitationCommand(window.sessionStorage, userId, command);
      }
    }

    isSubmittingSyncRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    const snapshot = getAuthSnapshot();

    try {
      const { data, error } = await supabase.schema('public').rpc('issue_church_invitation', {
        p_command_id: command.commandId,
        p_church_id: churchId,
        p_member_id: memberId,
        p_recipient_email: targetEmail,
      });

      if (!isMountedRef.current) return;
      if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

      const isUncertain = isUncertainInvitationResponse(error, data, 'issue_invitation');

      if (isUncertain) {
        // Consulta recibo antes de reportar erro
        try {
          const { data: recData, error: recErr } = await supabase.schema('public').rpc('get_invitation_command_receipt', {
            p_command_id: command.commandId,
          });

          if (!isMountedRef.current) return;
          if (getAuthSnapshot().sessionId !== snapshot.sessionId || getAuthSnapshot().userId !== snapshot.userId) return;

          if (!recErr && Array.isArray(recData) && recData.length > 0) {
            const validation = validateReceiptPayload('issue_invitation', recData[0], {
              commandId: command.commandId,
              churchId,
              memberId,
            });
            if (validation.valid) {
              const payload = validation.payload;
              activeCommandRef.current = null;
              if (typeof window !== 'undefined' && window.sessionStorage) {
                removePendingInvitationCommand(window.sessionStorage, userId, 'issue_invitation');
              }
              setIssuedResult({
                ...payload,
                raw_token: null,
                link_unrecoverable: true,
              });
              if (onSuccess) onSuccess(payload);
              return;
            }
          }
        } catch {}

        setErrorMessage('A resposta do servidor demorou mais que o esperado. Não reemita automaticamente; tente novamente mantendo o mesmo comando.');
        return;
      }

          if (error) {
        activeCommandRef.current = null;
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingInvitationCommand(window.sessionStorage, userId, 'issue_invitation', memberId);
        }
        setErrorMessage(formatInvitationErrorMessage(error));
        return;
      }

      const row = data[0];
      activeCommandRef.current = null;
      if (typeof window !== 'undefined' && window.sessionStorage) {
        removePendingInvitationCommand(window.sessionStorage, userId, 'issue_invitation', memberId);
      }

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const inviteUrl = row.raw_token ? `${origin}/#/invite?token=${row.raw_token}` : null;

      setIssuedResult({
        ...row,
        inviteUrl,
        link_unrecoverable: !row.raw_token,
      });

      if (onSuccess) onSuccess(row);

    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(formatInvitationErrorMessage(err));
    } finally {
      isSubmittingSyncRef.current = false;
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  }

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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-invite-title">
      <div className="modal-card modal-card--invite">
        <div className="modal-header">
          <div className="modal-title-row">
            <Send size={18} color="var(--primary)" />
            <h2 id="modal-invite-title">Emitir Convite de Acesso</h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={handleCloseModal}
            disabled={submitting}
            aria-label="Fechar modal de convite"
          >
            <X size={18} />
          </button>
        </div>

        {/* 1. Tela de Sucesso / Link Gerado */}
        {issuedResult ? (
          <div className="invite-result-container">
            <div className="invite-result-header">
              <div className="invite-badge-success" aria-hidden="true">
                <ShieldCheck size={28} color="#10b981" />
              </div>
              <h3>Convite Emitido com Sucesso!</h3>
              <p>
                O convite para <strong>{memberName}</strong> foi registrado para o e-mail{' '}
                <strong>{issuedResult.recipient_email}</strong>.
              </p>
            </div>

            {issuedResult.previous_invitation_revoked && (
              <div className="alert-banner alert-banner--warning" role="status">
                <AlertTriangle size={15} />
                <span>O convite aberto anterior deste membro foi revogado automaticamente.</span>
              </div>
            )}

            {issuedResult.previous_request_cancelled && (
              <div className="alert-banner alert-banner--warning" role="status">
                <AlertTriangle size={15} />
                <span>A solicitação de alteração de nome pendente foi cancelada pela nova emissão.</span>
              </div>
            )}

            {issuedResult.raw_token ? (
              <div className="invite-link-box">
                <label htmlFor="generated-invite-link" className="form-label">
                  Link de Acesso (Compartilhamento Manual):
                </label>
                <div className="invite-link-input-group">
                  <input
                    id="generated-invite-link"
                    ref={linkInputRef}
                    type="text"
                    readOnly
                    value={issuedResult.inviteUrl}
                    className="form-input invite-link-input"
                    aria-label="Link de convite gerado"
                    onClick={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className={`btn ${copyState === 'copied' ? 'btn-success' : 'btn-primary'}`}
                    onClick={() => handleCopyLink(issuedResult.inviteUrl)}
                    id="btn-copy-invite-link"
                  >
                    {copyState === 'copied' ? (
                      <>
                        <Check size={14} /> Copiado!
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> Copiar
                      </>
                    )}
                  </button>
                </div>

                {copyState === 'failed' && (
                  <div className="alert-banner alert-banner--warning" style={{ marginTop: '8px' }}>
                    <AlertCircle size={14} />
                    <span>Não foi possível copiar automaticamente para a área de transferência. Selecione e copie o link acima manualmente.</span>
                  </div>
                )}

                <div className="invite-meta-row">
                  <div className="invite-meta-item">
                    <Clock size={13} color="var(--text-muted)" />
                    <span>Vencimento do prazo: <strong>{formatExpiresAt(issuedResult.expires_at)}</strong> (72 horas)</span>
                  </div>
                </div>

                <p className="invite-security-notice">
                  <strong>Atenção:</strong> Por segurança, este link é exibido apenas neste momento e não será armazenado no banco de dados. Compartilhe-o diretamente com o destinatário antes de fechar este diálogo.
                </p>
              </div>
            ) : (
              <div className="invite-unrecoverable-box" role="alert">
                <AlertTriangle size={24} color="#f59e0b" />
                <h4>Link não recuperável (Comando Replay)</h4>
                <p>
                  Este comando de emissão já havia sido executado anteriormente. Por motivos de segurança criptográfica, o token original de 256 bits não é armazenado no banco de dados e não pode ser recuperado.
                </p>
                <p>
                  Caso o link original tenha sido perdido antes do compartilhamento, confirme uma <strong>reemissão explícita</strong> para gerar um novo convite.
                </p>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCloseModal}
                id="btn-close-invite-success"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          /* 2. Formulário de Emissão */
          <form onSubmit={handleSubmit}>
            <div className="invite-context-card">
              <div className="invite-context-row">
                <span className="invite-context-label">Comunidade:</span>
                <strong>{churchName}</strong>
              </div>
              <div className="invite-context-row">
                <span className="invite-context-label">Membro destinatário:</span>
                <strong>{memberName}</strong>
              </div>
            </div>

            <p className="modal-desc" style={{ marginTop: '12px' }}>
              Informe o endereço de e-mail da pessoa. O resgate exigirá que ela autentique-se com este mesmo e-mail confirmado.
            </p>

            {hasOtherPending && (
              <div className="alert-banner alert-banner--warning" role="alert" style={{ marginBottom: '14px' }}>
                <AlertTriangle size={16} />
                <span>Existe uma operação de emissão pendente para outro membro aguardando reconciliação com o servidor. Conclua ou reconcilie a pendência antes de emitir um novo convite.</span>
              </div>
            )}

            {errorMessage && (
              <div className="alert-banner alert-banner--error" role="alert" style={{ marginBottom: '14px' }}>
                <AlertCircle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label htmlFor="invite-recipient-email" className="form-label">
                E-mail do destinatário:
              </label>
              <input
                id="invite-recipient-email"
                type="email"
                className="form-input"
                placeholder="exemplo@dominio.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={submitting || hasOtherPending || Boolean(activeCommandRef.current && activeCommandRef.current.memberId === memberId)}
                autoFocus
                required
              />
              <div className="input-hint">
                <span>Será verificado pelo servidor durante o resgate</span>
              </div>
            </div>

            <div className="invite-reissue-notice-box">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <Info size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Caso este membro já possua um convite aberto anterior ou proposta de nome pendente, a emissão irá invalidá-los e gerar um novo prazo de 72 horas.
                </span>
              </div>

              <label className="checkbox-label" style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={confirmReissue}
                  onChange={(e) => setConfirmReissue(e.target.checked)}
                  disabled={submitting || hasOtherPending}
                />
                <span>Estou ciente de que um convite anterior ou proposta pendente será substituído.</span>
              </label>
            </div>

            <div className="modal-actions" style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseModal}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || hasOtherPending || !emailInput.trim() || (isReissueMode && !confirmReissue)}
                id="btn-submit-issue-invite"
              >
                {submitting ? (
                  <>
                    <RefreshCw size={14} className="spin-icon" /> Gerando convite…
                  </>
                ) : (
                  <>
                    <Send size={14} /> Gerar link de convite
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      <style>{`
        .modal-card--invite {
          max-width: 520px;
        }

        .invite-context-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .invite-context-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
        }

        .invite-context-label {
          color: var(--text-muted);
        }

        .invite-reissue-notice-box {
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          border-radius: var(--radius-md);
          padding: 12px;
          margin-top: 10px;
        }

        .invite-result-header {
          text-align: center;
          margin-bottom: 16px;
        }

        .invite-badge-success {
          width: 52px;
          height: 52px;
          background: #ecfdf5;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 10px;
        }

        .invite-result-header h3 {
          margin: 0 0 4px;
          font-size: 18px;
          color: var(--text-primary);
        }

        .invite-result-header p {
          margin: 0;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .invite-link-box {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 14px;
          margin-top: 12px;
        }

        .invite-link-input-group {
          display: flex;
          gap: 8px;
          margin-top: 6px;
        }

        .invite-link-input {
          font-family: monospace;
          font-size: 12px;
        }

        .invite-meta-row {
          margin-top: 10px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .invite-meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .invite-security-notice {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px dashed var(--border-subtle);
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        .invite-unrecoverable-box {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: var(--radius-md);
          padding: 16px;
          text-align: center;
          margin-top: 12px;
        }

        .invite-unrecoverable-box h4 {
          margin: 8px 0 6px;
          font-size: 15px;
          color: #92400e;
        }

        .invite-unrecoverable-box p {
          margin: 0 0 8px;
          font-size: 13px;
          color: #b45309;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
