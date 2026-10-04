import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Church, ShieldCheck, User, LogOut, RefreshCw } from 'lucide-react';
import CreateChurchModal from './CreateChurchModal';
import { loadPendingChurchCommand } from '../utils/churchCommandService';

/**
 * SelectChurchPage — exibida quando a conta autenticada possui múltiplos
 * vínculos autorizados e precisa escolher explicitamente a igreja a consultar (M61 / PRD).
 *
 * Garante que nenhuma igreja seja selecionada silenciosamente como fallback.
 */
export default function SelectChurchPage() {
  const { availableAccesses, selectChurch, signOut, session, recordCreationConfirmation } = useAuth();
  const userEmail = session?.user?.email ?? '';
  const userId = session?.user?.id;

  const [pendingCommand, setPendingCommand] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage && userId) {
      const cmd = loadPendingChurchCommand(window.sessionStorage, userId);
      setPendingCommand(cmd);
    }
  }, [userId, isCreateModalOpen]);

  return (
    <div className="select-church-page" role="main" aria-label="Seleção de Igreja">
      <div className="select-church-card">
        <div className="select-church-header">
          <div className="select-church-icon-box" aria-hidden="true">
            <Church size={32} />
          </div>
          <h1 className="select-church-title">Selecione sua Comunidade</h1>
          <p className="select-church-subtitle">
            Sua conta possui acesso a mais de uma igreja cadastrada. Escolha qual deseja acessar agora:
          </p>
          {userEmail && (
            <p className="select-church-email" aria-label={`Conta: ${userEmail}`}>
              {userEmail}
            </p>
          )}
        </div>

        {/* Card de Recuperação Acessível: comando pendente retido no storage para esta conta */}
        {pendingCommand && (
          <div
            className="select-church-recovery-card"
            style={{
              background: 'var(--primary-surface, #eff6ff)',
              border: '1.5px solid var(--primary, #2563eb)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              textAlign: 'left',
            }}
            role="region"
            aria-label="Comando de criação de igreja pendente de confirmação"
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <RefreshCw size={20} className="spin" color="var(--primary, #2563eb)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Envio de igreja pendente de confirmação
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  Existe um comando de criação não confirmado para a igreja{' '}
                  <strong>{pendingCommand.churchData?.name || 'solicitada'}</strong>.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsCreateModalOpen(true)}
              id="btn-recover-pending-church-select"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} />
              Verificar resultado / Recuperar
            </button>
          </div>
        )}

        <div className="select-church-list" role="region" aria-label="Igrejas disponíveis">
          {availableAccesses && availableAccesses.map((acc) => (
            <button
              key={acc.church_id}
              className="select-church-item-btn"
              onClick={() => selectChurch(acc.church_id)}
              type="button"
              aria-label={`Acessar ${acc.church_name} como ${acc.is_admin ? 'Administrador' : 'Membro'}`}
            >
              <div className="select-church-item-info">
                <span className="select-church-item-name">{acc.church_name}</span>
                <span className="select-church-item-member">
                  <User size={13} aria-hidden="true" />
                  {acc.display_name}
                </span>
              </div>
              <span className={`select-church-badge ${acc.is_admin ? 'is-admin' : 'is-member'}`}>
                {acc.is_admin && <ShieldCheck size={13} aria-hidden="true" />}
                {acc.is_admin ? 'Administrador' : 'Membro'}
              </span>
            </button>
          ))}
        </div>

        <div className="select-church-footer">
          <button
            className="btn btn-secondary select-church-signout-btn"
            onClick={signOut}
            type="button"
            aria-label="Sair da conta"
          >
            <LogOut size={16} aria-hidden="true" />
            Sair da conta
          </button>
        </div>
      </div>

      {/* Modal Criar Minha Igreja / Recuperação */}
      <CreateChurchModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(createdChurch) => {
          setIsCreateModalOpen(false);
          setPendingCommand(null);
          if (createdChurch?.church_id && recordCreationConfirmation) {
            recordCreationConfirmation(createdChurch);
          }
          if (createdChurch?.church_id && selectChurch) {
            selectChurch(createdChurch.church_id);
          }
        }}
      />

      <style>{`
        .select-church-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          background: var(--bg-secondary);
        }
        .select-church-card {
          width: 100%;
          max-width: 480px;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 16px;
          padding: 32px 24px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
        }
        .select-church-header {
          text-align: center;
          margin-bottom: 24px;
        }
        .select-church-icon-box {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: var(--primary-light, #eff6ff);
          color: var(--primary, #2563eb);
          margin-bottom: 16px;
        }
        .select-church-title {
          font-size: 1.35rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 8px;
        }
        .select-church-subtitle {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.45;
          margin-bottom: 6px;
        }
        .select-church-email {
          font-size: 0.8rem;
          color: var(--text-muted, #64748b);
          font-weight: 500;
        }
        .select-church-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 24px;
        }
        .select-church-item-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          background: var(--bg-secondary);
          border: 1.5px solid var(--border-color);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.15s ease-in-out;
          text-align: left;
          width: 100%;
        }
        .select-church-item-btn:hover,
        .select-church-item-btn:focus-visible {
          border-color: var(--primary, #2563eb);
          background: var(--bg-primary);
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.08);
          outline: none;
        }
        .select-church-item-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .select-church-item-name {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--text-primary);
        }
        .select-church-item-member {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .select-church-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .select-church-badge.is-admin {
          background: #fef3c7;
          color: #92400e;
        }
        .select-church-badge.is-member {
          background: #e2e8f0;
          color: #475569;
        }
        .select-church-footer {
          display: flex;
          justify-content: center;
          border-top: 1px solid var(--border-color);
          padding-top: 20px;
        }
        .select-church-signout-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}
