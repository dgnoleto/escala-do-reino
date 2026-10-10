import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Header from './components/Header';
import LiveConsole from './components/LiveConsole';
import ScheduleView from './components/ScheduleView';
import MyScheduleView from './components/MyScheduleView';
import BackstageView from './components/BackstageView';
import PlanningView from './components/PlanningView';
import AdminView from './components/AdminView';
import AuditHistoryView from './components/AuditHistoryView';
import LoginPage from './components/LoginPage';
import AccessPendingPage from './components/AccessPendingPage';
import InitializingPage from './components/InitializingPage';
import CheckingAccessPage from './components/CheckingAccessPage';
import AccessErrorPage from './components/AccessErrorPage';
import ChurchHomePage from './components/ChurchHomePage';
import SelectChurchPage from './components/SelectChurchPage';
import InvitationFlowPage from './components/InvitationFlowPage';
import { Info, Sparkles, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

function AppContent() {
  const [activeTab, setActiveTab] = useState('live');
  const [guideOpen, setGuideOpen] = useState(false);
  const { event, currentUser } = useApp();

  return (
    <div className="app-container">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="main-content">
        {activeTab === 'live' && <LiveConsole />}
        {activeTab === 'schedule' && <ScheduleView />}
        {activeTab === 'my-schedule' && <MyScheduleView />}
        {activeTab === 'backstage' && <BackstageView />}
        {activeTab === 'planning' && <PlanningView />}
        {activeTab === 'admin' && <AdminView />}
        {activeTab === 'history' && <AuditHistoryView />}
      </main>

      {/* Guia Rápido de Verificação de Critérios de Aceite do PRD (Piloto Shalom) */}
      <aside className={`prd-acceptance-guide card ${guideOpen ? 'is-expanded' : ''}`} aria-label="Guia de Validação do PRD">
        <div
          className="guide-header"
          onClick={() => setGuideOpen(!guideOpen)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setGuideOpen(!guideOpen)}
          aria-expanded={guideOpen}
        >
          <div className="guide-header-title">
            <Sparkles size={15} color="var(--primary)" />
            <span>Guia de Validação — Piloto Ministério Shalom</span>
          </div>
          <button className="guide-toggle-btn" aria-label={guideOpen ? 'Recolher' : 'Expandir'} tabIndex={-1}>
            {guideOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>

        {guideOpen && (
          <div className="guide-content">
            <p className="guide-intro">
              Esta aplicação foi construída para atender rigorosamente à especificação do <strong>PRD consolidado em 30/09/2026</strong>.
              Você pode testar diretamente os seguintes fluxos e regras:
            </p>

            <div className="scenarios-grid">
              <div className="scenario-item">
                <span className="scen-badge">M07 &amp; M08</span>
                <div className="scen-text">
                  <strong>Cronômetro da Atividade &amp; Tempo Excedido:</strong> Na aba <em>Ao Vivo</em>, inicie uma etapa.
                  O cronômetro regressivo avança e, ao passar de 00:00, conta o excesso em vermelho sem avançar o culto sozinho (PRD 7.2).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M09 &amp; M10</span>
                <div className="scen-text">
                  <strong>Devolver para Pendente:</strong> Pare a atividade atual. Ela retorna ao estado pendente com tentativa
                  preservada e intervalo aberto. Ao reiniciar, começa com a <strong>duração prevista integral</strong> (PRD 7.4).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M11 &amp; M12</span>
                <div className="scen-text">
                  <strong>Cancelar com Motivo Cadastrado:</strong> Cancela a execução exigindo motivo obrigatório pré-cadastrado na Web (PRD 7.3).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M22 &amp; M24</span>
                <div className="scen-text">
                  <strong>Bloqueio de Conflito Litúrgico:</strong> Na aba <em>Planejamento</em>, clique em "Testar Conflito (M22)" para
                  ver o bloqueio automático de alocar Beatriz na Dança e Canto simultâneos no mesmo louvor, com sugestão de aptos (PRD 5.2).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M26</span>
                <div className="scen-text">
                  <strong>Alerta Ignorável de Duração:</strong> No topo da aba <em>Planejamento</em>, o excesso de duração do culto
                  gera alerta visual claro que pode ser ignorado sem travar salvamento (PRD 6).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M46</span>
                <div className="scen-text">
                  <strong>Checklist com Validação Conjunta:</strong> Na aba <em>Bastidores</em>, veja o item de playback que exige 2 confirmações
                  (Líder de Louvor + Sonoplastia) para ser concluído (PRD 9.3).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M42 &amp; M43</span>
                <div className="scen-text">
                  <strong>Correção de Horário Real:</strong> No card da atividade, clique em "Corrigir Horário Real". Rejeita término anterior ao início e salva histórico (PRD 7.8).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M16 &amp; M17</span>
                <div className="scen-text">
                  <strong>Simulação Offline / Desatualizado:</strong> No canto superior direito, alterne para "Offline" ou "Desatualizado" para testar o modo somente leitura (PRD 10.3).
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      <style>{`
        /* ── Guia de Validação do PRD ─────────────────────────────────── */

        /* Mobile: recolhido → botão compacto no canto inferior direito */
        .prd-acceptance-guide {
          position: fixed;
          bottom: 12px;
          right: 16px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          z-index: 400;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          /* Recolhido: largura mínima, apenas o header */
          width: auto;
          max-width: calc(100vw - 32px);
        }

        /* Mobile expandido: ocupa quase toda a largura */
        .prd-acceptance-guide.is-expanded {
          left: 16px;
          right: 16px;
          width: auto;
          max-width: none;
        }

        /* Desktop ≥ 700px: ancora no canto direito, largura fixa */
        @media (min-width: 700px) {
          .prd-acceptance-guide {
            left: auto;
            right: 20px;
            bottom: 16px;
            width: 480px;
            max-width: 480px;
          }
          .prd-acceptance-guide.is-expanded {
            left: auto;
            width: 480px;
            max-width: 480px;
          }
        }

        .guide-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          cursor: pointer;
          background: var(--primary-surface);
          border-bottom: none;
          user-select: none;
          white-space: nowrap;
          gap: 10px;
        }

        /* Borda inferior só aparece quando o conteúdo está exposto */
        .prd-acceptance-guide.is-expanded .guide-header {
          border-bottom: 1px solid var(--primary-border);
        }

        .guide-header:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: -2px;
        }

        .guide-header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 700;
          color: var(--primary);
        }

        /* Ocultar texto no mobile recolhido para manter acionador mínimo */
        @media (max-width: 699px) {
          .prd-acceptance-guide:not(.is-expanded) .guide-header-title span {
            display: none;
          }
        }

        .guide-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .guide-content {
          padding: 14px 16px;
          max-height: 50vh;
          overflow-y: auto;
        }

        .guide-intro {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 12px;
          line-height: 1.5;
        }

        .scenarios-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 8px;
        }

        .scenario-item {
          display: flex;
          gap: 8px;
          padding: 8px 10px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .scen-badge {
          font-size: 10px;
          font-weight: 800;
          color: var(--primary);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          height: fit-content;
          white-space: nowrap;
        }

        .scen-text {
          font-size: 11px;
          color: var(--text-secondary);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}

/**
 * AuthGate — roteia para a tela correta com base no authState.
 *
 * Mapa de estados → telas:
 *   'initializing'    → InitializingPage   (verificando sessão salva)
 *   'unauthenticated' → LoginPage          (sem sessão)
 *   'checking_access' → CheckingAccessPage (consultando vínculo no banco)
 *   'access_pending'  → AccessPendingPage  (sessão válida, sem vínculo elegível)
 *   'access_granted'  → ChurchHomePage     (vínculo confirmado — dados reais)
 *   'access_error'    → AccessErrorPage    (falha de consulta — retry disponível)
 *
 * O protótipo (AppProvider + AppContent) está preservado no código para
 * integração futura, mas NÃO é montado neste incremento.
 * AppContent usa dados fictícios do AppContext e não deve ser exibido
 * como tela de produção.
 */
function AuthGate() {
  const {
    authState,
    pendingInviteToken,
    clearPendingInviteToken,
    isPasswordRecovery,
  } = useAuth();

  // 1. Verificação inicial de sessão salva
  if (authState === 'initializing') {
    return <InitializingPage />;
  }

  // 2. Fluxo prioritário de recuperação/alteração de senha iniciado por link
  if (isPasswordRecovery) {
    return <LoginPage />;
  }

  // 3. Resgate de convite capturado da rota /#/invite?token=... ou retido em sessionStorage
  // Acessível após inicialização da sessão mesmo sem churchAccess ou se já administra outra igreja
  if (pendingInviteToken) {
    if (authState === 'unauthenticated') {
      return <LoginPage />;
    }
    return (
      <InvitationFlowPage
        token={pendingInviteToken}
        onClearToken={clearPendingInviteToken}
      />
    );
  }

  switch (authState) {
    case 'unauthenticated':
      return <LoginPage />;

    case 'checking_access':
      return <CheckingAccessPage />;

    case 'access_pending':
      return <AccessPendingPage />;

    case 'access_granted':
      return <ChurchHomePage />;

    case 'access_error':
      return <AccessErrorPage />;

    case 'select_church':
      return <SelectChurchPage />;

    default:
      // Estado desconhecido — não exibir dados, retornar ao login.
      return <LoginPage />;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
