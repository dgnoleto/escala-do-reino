import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import LiveConsole from './components/LiveConsole';
import ScheduleView from './components/ScheduleView';
import MyScheduleView from './components/MyScheduleView';
import BackstageView from './components/BackstageView';
import PlanningView from './components/PlanningView';
import AdminView from './components/AdminView';
import AuditHistoryView from './components/AuditHistoryView';
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
      <aside className={`prd-acceptance-guide card ${guideOpen ? 'is-expanded' : ''}`}>
        <div className="guide-header" onClick={() => setGuideOpen(!guideOpen)}>
          <div className="guide-header-title">
            <Sparkles size={16} color="var(--primary)" />
            <span>Guia de Validação dos Critérios do PRD (Piloto Ministério Shalom)</span>
          </div>
          <button className="guide-toggle-btn">
            {guideOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
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
                <span className="scen-badge">M07 & M08</span>
                <div className="scen-text">
                  <strong>Cronômetro da Atividade & Tempo Excedido:</strong> Na aba <em>Ao Vivo</em>, inicie uma etapa.
                  O cronômetro regressivo avança e, ao passar de 00:00, conta o excesso em vermelho sem avançar o culto sozinho (PRD 7.2).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M09 & M10</span>
                <div className="scen-text">
                  <strong>Devolver para Pendente:</strong> Pare a atividade atual. Ela retorna ao estado pendente com tentativa
                  preservada e intervalo aberto. Ao reiniciar, começa com a <strong>duração prevista integral</strong> (PRD 7.4).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M11 & M12</span>
                <div className="scen-text">
                  <strong>Cancelar com Motivo Cadastrado:</strong> Cancela a execução exigindo motivo obrigatório pré-cadastrado na Web (PRD 7.3).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M22 & M24</span>
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
                <span className="scen-badge">M42 & M43</span>
                <div className="scen-text">
                  <strong>Correção de Horário Real:</strong> No card da atividade, clique em "Corrigir Horário Real". Rejeita término anterior ao início e salva histórico (PRD 7.8).
                </div>
              </div>

              <div className="scenario-item">
                <span className="scen-badge">M16 & M17</span>
                <div className="scen-text">
                  <strong>Simulação Offline / Desatualizado:</strong> No canto superior direito, alterne para "Offline" ou "Desatualizado" para testar o modo somente leitura (PRD 10.3).
                </div>
              </div>
            </div>
          </div>
        )}
      </aside>

      <style>{`
        .prd-acceptance-guide {
          position: fixed;
          bottom: 16px;
          right: 24px;
          left: 24px;
          max-width: 1400px;
          margin: 0 auto;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          z-index: 400;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .guide-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          cursor: pointer;
          background: var(--primary-surface);
          border-bottom: 1px solid var(--primary-border);
        }

        .guide-header-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          font-weight: 700;
          color: var(--primary);
        }

        .guide-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }

        .guide-content {
          padding: 18px 20px;
          max-height: 50vh;
          overflow-y: auto;
        }

        .guide-intro {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }

        .scenarios-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
        }

        .scenario-item {
          display: flex;
          gap: 10px;
          padding: 10px 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .scen-badge {
          font-size: 11px;
          font-weight: 800;
          color: var(--primary);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          height: fit-content;
        }

        .scen-text {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
