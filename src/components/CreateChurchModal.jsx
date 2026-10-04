import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  Church,
  MapPin,
  Clock,
  ShieldAlert,
  X,
  AlertCircle,
  Loader2,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Info
} from 'lucide-react';
import {
  validateAndNormalizeChurchInput,
  dispatchChurchCreation,
  checkChurchReceipt,
  loadPendingChurchCommand,
  removePendingChurchCommand,
  getChurchCommandSessionGeneration,
} from '../utils/churchCommandService';

const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo / Rio (UTC-3)' },
  { value: 'America/Manaus', label: 'Manaus / Amazonas (UTC-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá / Mato Grosso (UTC-4)' },
  { value: 'America/Belem', label: 'Belém / Pará (UTC-3)' },
  { value: 'America/Fortaleza', label: 'Fortaleza / Ceará / Piauí (UTC-3)' },
  { value: 'America/Recife', label: 'Recife / Pernambuco / RN (UTC-3)' },
  { value: 'America/Bahia', label: 'Salvador / Bahia (UTC-3)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho / Rondônia (UTC-4)' },
  { value: 'America/Boa_Vista', label: 'Boa Vista / Roraima (UTC-4)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco / Acre (UTC-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC-2)' },
  { value: 'UTC', label: 'UTC (Tempo Universal Coordenado)' },
  { value: 'Europe/Lisbon', label: 'Lisboa / Portugal (UTC+0 / UTC+1)' },
  { value: 'America/New_York', label: 'Nova York / EUA (UTC-5 / UTC-4)' },
];

/**
 * Detecta o fuso horário local do navegador ou retorna o padrão recomendado.
 */
function getBrowserSuggestedTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') {
      const match = TIMEZONE_OPTIONS.find((opt) => opt.value === tz);
      if (match) return tz;
    }
  } catch (err) {
    // Silently fallback
  }
  return 'America/Sao_Paulo';
}

export default function CreateChurchModal({ isOpen, onClose, onSuccess }) {
  const { session, sessionId, getAuthSnapshot } = useAuth();
  const userId = session?.user?.id;

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sugestão de nome a partir dos metadados de login (permanece visível e editável)
  const suggestedCreatorName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    '';

  const [name, setName] = useState('');
  const [creatorName, setCreatorName] = useState(suggestedCreatorName);
  const [timezone, setTimezone] = useState(getBrowserSuggestedTimezone);
  const [address, setAddress] = useState('');
  const [googleMapsUrl, setGoogleMapsUrl] = useState('');
  const [defaultDurationPolicy, setDefaultDurationPolicy] = useState('warn');

  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [uncertainCommandId, setUncertainCommandId] = useState(null);

  // Fecha o modal e limpa estados se a sessão for encerrada ou trocada
  useEffect(() => {
    if (!userId && isOpen && onClose) {
      setIsSubmitting(false);
      setIsRecovering(false);
      setUncertainCommandId(null);
      onClose();
    }
  }, [userId, isOpen, onClose]);

  // Inicializa o nome sugerido se mudar a sessão
  useEffect(() => {
    if (suggestedCreatorName && !creatorName) {
      setCreatorName(suggestedCreatorName);
    }
  }, [suggestedCreatorName]);

  // Ao abrir, verifica se há comando incerto salvo no storage para esta conta
  useEffect(() => {
    if (isOpen && typeof window !== 'undefined' && window.sessionStorage && userId) {
      const pending = loadPendingChurchCommand(window.sessionStorage, userId);
      if (pending?.commandId) {
        setUncertainCommandId(pending.commandId);
        if (pending.churchData?.name) setName(pending.churchData.name);
        if (pending.churchData?.creatorName) setCreatorName(pending.churchData.creatorName);
        if (pending.churchData?.timezone) setTimezone(pending.churchData.timezone);
        if (pending.churchData?.address) setAddress(pending.churchData.address);
        if (pending.churchData?.googleMapsUrl) setGoogleMapsUrl(pending.churchData.googleMapsUrl);
        if (pending.churchData?.defaultDurationPolicy) {
          setDefaultDurationPolicy(pending.churchData.defaultDurationPolicy);
        }
      }
    }
  }, [isOpen, userId]);

  const modalRef = useRef(null);

  // Acessibilidade: foco contido, foco inicial e controle de Escape
  useEffect(() => {
    if (!isOpen) return;

    // Foco inicial no primeiro input após montagem
    const timer = setTimeout(() => {
      const firstInput = modalRef.current?.querySelector('input#church-name');
      if (firstInput) {
        firstInput.focus();
      }
    }, 50);

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (!isSubmitting && !isRecovering) {
          onClose();
        }
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, isRecovering, onClose]);

  if (!isOpen) return null;

  async function handleRecoverUncertainCommand() {
    const liveAuth = getAuthSnapshot ? getAuthSnapshot() : { userId, sessionId };
    const currentUserId = liveAuth.userId;
    const currentSessionId = liveAuth.sessionId;
    if (!uncertainCommandId || !currentUserId || !supabase) return;
    const recoveringCommandId = uncertainCommandId;
    const initialServiceGen = getChurchCommandSessionGeneration();

    const isLiveValid = () => {
      if (!isMountedRef.current) return false;
      const nowAuth = getAuthSnapshot ? getAuthSnapshot() : { userId: session?.user?.id, sessionId };
      if (!nowAuth.userId || nowAuth.userId !== currentUserId) return false;
      if (nowAuth.sessionId !== currentSessionId) return false;
      if (getChurchCommandSessionGeneration() !== initialServiceGen) return false;
      return true;
    };

    setIsRecovering(true);
    setSubmitError(null);

    try {
      const result = await checkChurchReceipt({
        supabaseClient: supabase,
        commandId: recoveringCommandId,
        sessionGeneration: initialServiceGen,
        isSessionValid: isLiveValid,
      });

      // Descartar se o componente foi desmontado ou a sessão/usuário mudou
      if (!isLiveValid() || result.status === 'STALE_SESSION') {
        return;
      }

      if (result.status === 'RECEIPT_FOUND') {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          removePendingChurchCommand(window.sessionStorage, currentUserId, recoveringCommandId);
        }
        setUncertainCommandId(null);
        if (onSuccess) onSuccess(result.record);
        return;
      }

      if (result.status === 'RECEIPT_EMPTY') {
        setSubmitError(
          'O registro anterior ainda não foi encontrado no servidor. Você pode tentar enviar novamente.'
        );
      } else {
        setSubmitError(
          result.error?.message || result.error || 'Falha ao verificar recibo anterior. Verifique sua conexão e tente novamente.'
        );
      }
    } catch (err) {
      if (!isLiveValid()) {
        return;
      }
      setSubmitError('Erro ao consultar recibo de recuperação.');
    } finally {
      if (isLiveValid()) {
        setIsRecovering(false);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);

    const validation = validateAndNormalizeChurchInput({
      name,
      creatorName,
      timezone,
      address,
      googleMapsUrl,
      defaultDurationPolicy,
    });

    if (!validation.isValid) {
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors({});
    const liveAuth = getAuthSnapshot ? getAuthSnapshot() : { userId, sessionId };
    const currentUserId = liveAuth.userId;
    const currentSessionId = liveAuth.sessionId;
    if (!currentUserId) {
      setSubmitError('Usuário não autenticado.');
      return;
    }
    const initialServiceGen = getChurchCommandSessionGeneration();

    const isLiveValid = () => {
      if (!isMountedRef.current) return false;
      const nowAuth = getAuthSnapshot ? getAuthSnapshot() : { userId: session?.user?.id, sessionId };
      if (!nowAuth.userId || nowAuth.userId !== currentUserId) return false;
      if (nowAuth.sessionId !== currentSessionId) return false;
      if (getChurchCommandSessionGeneration() !== initialServiceGen) return false;
      return true;
    };

    setIsSubmitting(true);

    try {
      const result = await dispatchChurchCreation({
        supabaseClient: supabase,
        storage: typeof window !== 'undefined' ? window.sessionStorage : null,
        userId: currentUserId,
        churchData: validation.normalizedData,
        sessionGeneration: initialServiceGen,
        isSessionValid: isLiveValid,
      });

      if (!isLiveValid() || result.status === 'STALE_SESSION') {
        return;
      }

      if (result.status === 'SUCCESS') {
        setUncertainCommandId(null);
        if (onSuccess) onSuccess(result.data);
        return;
      }

      if (result.status === 'UNCERTAIN') {
        setUncertainCommandId(result.commandId);
        setSubmitError(
          'A resposta do servidor demorou ou foi interrompida. O comando está seguro e você pode verificar o resultado.'
        );
        return;
      }

      if (result.status === 'STORAGE_ERROR') {
        setSubmitError(result.error);
        return;
      }

      // Rejeição definitiva
      setSubmitError(result.error || 'Não foi possível criar a igreja.');
    } catch (err) {
      if (!isLiveValid()) {
        return;
      }
      setSubmitError('Erro inesperado ao processar criação da igreja.');
    } finally {
      if (isLiveValid()) {
        setIsSubmitting(false);
      }
    }
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isSubmitting && !isRecovering) {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-church-modal-title"
      onClick={handleBackdropClick}
    >
      <div className="modal-container" ref={modalRef}>
        {/* Cabeçalho */}
        <div className="modal-header">
          <div className="modal-header-icon" aria-hidden="true">
            <Church size={22} />
          </div>
          <div className="modal-header-text">
            <h2 id="create-church-modal-title" className="modal-title">Criar minha igreja</h2>
            <p className="modal-subtitle">Cadastre sua igreja e torne-se o primeiro administrador</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting || isRecovering}
            aria-label="Fechar"
            id="btn-close-create-church-modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Alerta de comando incerto em recuperação */}
        {uncertainCommandId && (
          <div className="uncertain-alert" role="alert">
            <div className="uncertain-alert-icon" aria-hidden="true">
              <AlertCircle size={18} />
            </div>
            <div className="uncertain-alert-content">
              <strong>Envio anterior não confirmado</strong>
              <p>Houve uma interrupção recente. Você pode verificar se a igreja já foi criada no servidor antes de tentar novamente.</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm uncertain-recover-btn"
                onClick={handleRecoverUncertainCommand}
                disabled={isRecovering || isSubmitting}
                id="btn-check-uncertain-church"
              >
                {isRecovering ? (
                  <>
                    <Loader2 size={13} className="spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} />
                    Verificar no servidor
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Erro geral de envio */}
        {submitError && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} className="error-banner-icon" />
            <span>{submitError}</span>
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} noValidate className="modal-form">
          {/* Nome da igreja */}
          <div className="form-group">
            <label htmlFor="input-church-name" className="form-label">
              Nome da igreja <span className="required-star">*</span>
            </label>
            <input
              id="input-church-name"
              type="text"
              className={`form-input ${fieldErrors.name ? 'is-invalid' : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Ministério Shalom"
              maxLength={160}
              disabled={isSubmitting || isRecovering}
              autoFocus
              required
            />
            <div className="field-footer">
              {fieldErrors.name ? (
                <span className="field-error">{fieldErrors.name}</span>
              ) : (
                <span className="field-hint">Como sua comunidade é conhecida</span>
              )}
              <span className="char-count">{name.length}/160</span>
            </div>
          </div>

          {/* Nome do criador como membro */}
          <div className="form-group">
            <label htmlFor="input-creator-name" className="form-label">
              Seu nome de exibição na igreja <span className="required-star">*</span>
            </label>
            <input
              id="input-creator-name"
              type="text"
              className={`form-input ${fieldErrors.creatorName ? 'is-invalid' : ''}`}
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="Ex.: João Silva"
              maxLength={120}
              disabled={isSubmitting || isRecovering}
              required
            />
            <div className="field-footer">
              {fieldErrors.creatorName ? (
                <span className="field-error">{fieldErrors.creatorName}</span>
              ) : (
                <span className="field-hint">Você será cadastrado como membro e primeiro administrador</span>
              )}
              <span className="char-count">{creatorName.length}/120</span>
            </div>
          </div>

          {/* Fuso horário IANA */}
          <div className="form-group">
            <label htmlFor="select-church-timezone" className="form-label">
              Fuso horário de referência <span className="required-star">*</span>
            </label>
            <div className="select-wrapper">
              <select
                id="select-church-timezone"
                className={`form-select ${fieldErrors.timezone ? 'is-invalid' : ''}`}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={isSubmitting || isRecovering}
                required
              >
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value})
                  </option>
                ))}
              </select>
            </div>
            <div className="field-footer">
              {fieldErrors.timezone ? (
                <span className="field-error">{fieldErrors.timezone}</span>
              ) : (
                <span className="field-hint">Os horários dos cultos e escalas utilizarão este fuso</span>
              )}
            </div>
          </div>

          {/* Endereço (opcional) */}
          <div className="form-group">
            <label htmlFor="input-church-address" className="form-label">
              Endereço da igreja <span className="optional-tag">(opcional)</span>
            </label>
            <input
              id="input-church-address"
              type="text"
              className={`form-input ${fieldErrors.address ? 'is-invalid' : ''}`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ex.: Rua das Flores, 120 - Centro"
              maxLength={500}
              disabled={isSubmitting || isRecovering}
            />
            <div className="field-footer">
              {fieldErrors.address ? (
                <span className="field-error">{fieldErrors.address}</span>
              ) : (
                <span className="field-hint">Local físico onde os cultos acontecem</span>
              )}
              <span className="char-count">{address.length}/500</span>
            </div>
          </div>

          {/* Link Google Maps (opcional) */}
          <div className="form-group">
            <label htmlFor="input-church-maps" className="form-label">
              Link do Google Maps <span className="optional-tag">(opcional)</span>
            </label>
            <input
              id="input-church-maps"
              type="url"
              className={`form-input ${fieldErrors.googleMapsUrl ? 'is-invalid' : ''}`}
              value={googleMapsUrl}
              onChange={(e) => setGoogleMapsUrl(e.target.value)}
              placeholder="https://maps.google.com/..."
              disabled={isSubmitting || isRecovering}
            />
            <div className="field-footer">
              {fieldErrors.googleMapsUrl ? (
                <span className="field-error">{fieldErrors.googleMapsUrl}</span>
              ) : (
                <span className="field-hint">Facilita para membros e equipes localizarem a igreja</span>
              )}
            </div>
          </div>

          {/* Política de duração dos cultos */}
          <div className="form-group">
            <label className="form-label">
              Política padrão de duração <span className="required-star">*</span>
            </label>
            <div className="policy-radio-group">
              <label className={`policy-card ${defaultDurationPolicy === 'warn' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="policy"
                  value="warn"
                  checked={defaultDurationPolicy === 'warn'}
                  onChange={() => setDefaultDurationPolicy('warn')}
                  disabled={isSubmitting || isRecovering}
                />
                <div className="policy-card-body">
                  <div className="policy-card-title">
                    <strong>Alertar (recomendado no piloto)</strong>
                    <span className="badge badge-primary">Padrão</span>
                  </div>
                  <p className="policy-card-desc">
                    Emite um alerta visual claro caso a programação exceda o tempo previsto, mas permite salvar e publicar o culto.
                  </p>
                </div>
              </label>

              <label className={`policy-card ${defaultDurationPolicy === 'block' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="policy"
                  value="block"
                  checked={defaultDurationPolicy === 'block'}
                  onChange={() => setDefaultDurationPolicy('block')}
                  disabled={isSubmitting || isRecovering}
                />
                <div className="policy-card-body">
                  <div className="policy-card-title">
                    <strong>Bloquear publicação</strong>
                  </div>
                  <p className="policy-card-desc">
                    Permite rascunhos com excesso, mas exige que a soma dos blocos caiba na janela do culto antes de publicar.
                  </p>
                </div>
              </label>
            </div>
            {fieldErrors.defaultDurationPolicy && (
              <span className="field-error">{fieldErrors.defaultDurationPolicy}</span>
            )}
          </div>

          {/* Nota de governança */}
          <div className="governance-notice">
            <Info size={14} className="governance-icon" />
            <span>
              Ao criar a igreja, sua conta torna-se a <strong>única administradora ativa</strong> desta igreja.
              Pelas regras do sistema, cada conta pode administrar no máximo uma igreja por vez.
            </span>
          </div>

          {/* Ações do rodapé */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting || isRecovering}
              id="btn-cancel-create-church"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-submit-church"
              disabled={isSubmitting || isRecovering}
              id="btn-submit-create-church"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Criando igreja...
                </>
              ) : (
                'Criar igreja'
              )}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 1000;
          animation: fadeIn 0.2s ease;
        }

        .modal-container {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-xl);
          width: 100%;
          max-width: 540px;
          max-height: 90vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .modal-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 20px 24px;
          border-bottom: 1px solid var(--border-subtle);
          position: sticky;
          top: 0;
          background: var(--bg-card);
          z-index: 2;
        }

        .modal-header-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-lg);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .modal-header-text {
          flex: 1;
          min-width: 0;
        }

        .modal-title {
          font-size: 17px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0 0 2px;
          letter-spacing: -0.2px;
        }

        .modal-subtitle {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .modal-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }

        .modal-close-btn:hover:not(:disabled) {
          background: var(--bg-surface);
          color: var(--text-primary);
        }

        .modal-form {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .required-star {
          color: var(--danger, #ef4444);
        }

        .optional-tag {
          font-size: 11px;
          font-weight: normal;
          color: var(--text-muted);
        }

        .form-input, .form-select {
          width: 100%;
          padding: 10px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-size: 14px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }

        .form-input:focus, .form-select:focus {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px var(--primary-surface);
        }

        .form-input.is-invalid, .form-select.is-invalid {
          border-color: var(--danger, #ef4444);
        }

        .field-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          font-size: 11px;
        }

        .field-hint {
          color: var(--text-muted);
          line-height: 1.3;
        }

        .field-error {
          color: var(--danger, #ef4444);
          font-weight: 600;
          line-height: 1.3;
        }

        .char-count {
          color: var(--text-muted);
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }

        .policy-radio-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .policy-card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
        }

        .policy-card:hover {
          border-color: var(--primary-border);
        }

        .policy-card.is-selected {
          border-color: var(--primary);
          background: var(--primary-surface);
        }

        .policy-card input[type="radio"] {
          margin-top: 3px;
          accent-color: var(--primary);
        }

        .policy-card-body {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .policy-card-title {
          font-size: 13px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .badge-primary {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          background: var(--primary);
          color: white;
          border-radius: var(--radius-sm);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .policy-card-desc {
          font-size: 12px;
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.4;
        }

        .governance-notice {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.45;
        }

        .governance-icon {
          color: var(--primary);
          flex-shrink: 0;
          margin-top: 1px;
        }

        .uncertain-alert {
          margin: 16px 24px 0;
          padding: 12px 14px;
          background: var(--status-pending-bg);
          border: 1px solid var(--status-pending-border);
          border-radius: var(--radius-md);
          display: flex;
          gap: 10px;
          font-size: 12px;
          color: var(--status-pending-text);
        }

        .uncertain-alert-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .uncertain-alert-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .uncertain-alert-content p {
          margin: 0;
          line-height: 1.4;
        }

        .uncertain-recover-btn {
          align-self: flex-start;
          gap: 6px;
          margin-top: 2px;
        }

        .error-banner {
          margin: 16px 24px 0;
          padding: 10px 14px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--danger, #ef4444);
          line-height: 1.4;
        }

        .error-banner-icon {
          flex-shrink: 0;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }

        .btn-submit-church {
          min-width: 140px;
          justify-content: center;
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
