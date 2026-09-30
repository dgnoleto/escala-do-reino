import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Clock, Shield, Search, FileText, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

export default function AuditHistoryView() {
  const { auditLogs, church } = useApp();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLogs = auditLogs.filter(log =>
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.authorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.details.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="history-view-container">
      {/* Cabeçalho do Histórico */}
      <div className="card history-header-card">
        <div>
          <div className="tag-row">
            <span className="badge badge-primary">Auditoria Litúrgica & Operacional</span>
            <span className="badge badge-live">Retenção Ativa: 1 Ano (PRD 10.5)</span>
          </div>
          <h1 className="history-title">Histórico de Alterações & Registros</h1>
          <p className="history-subtitle">
            Conforme o <strong>PRD 10.5 e Cenário M36</strong>, todas as ações de início, encerramento, cancelamentos com motivos,
            devoluções para pendente, correções de horários e substituições são imutavelmente registradas com autor e timestamp.
          </p>
        </div>

        <div className="retention-info-chip">
          <Clock size={24} color="#6366f1" />
          <div>
            <div className="ret-title">365 Dias de Retenção</div>
            <div className="ret-desc">Substituiu a proposta de 3 meses</div>
          </div>
        </div>
      </div>

      {/* Barra de Pesquisa */}
      <div className="history-filter-bar">
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="form-input search-input"
            placeholder="Filtrar histórico por autor, ação ou detalhes..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Lista de Registros */}
      <div className="logs-list">
        {filteredLogs.map(log => (
          <div key={log.id} className="card log-card">
            <div className="log-top-row">
              <div className="log-author-info">
                <span className="log-action-title">{log.action}</span>
                <span className="log-author-badge">
                  por <strong>{log.authorName}</strong> ({log.authorRole})
                </span>
              </div>
              <div className="log-time-badge">
                <Clock size={13} /> {log.timestamp}
              </div>
            </div>

            <div className="log-details-text">
              {log.details}
            </div>
          </div>
        ))}

        {filteredLogs.length === 0 && (
          <div className="card empty-log-card">
            <FileText size={36} color="var(--text-muted)" />
            <p>Nenhum registro encontrado correspondente aos filtros de pesquisa.</p>
          </div>
        )}
      </div>

      <style>{`
        .history-view-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .history-header-card {
          padding: 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .history-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .history-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 700px;
          line-height: 1.5;
        }

        .retention-info-chip {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 18px;
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid var(--border-active);
          border-radius: var(--radius-lg);
        }

        .ret-title {
          font-size: 15px;
          font-weight: 800;
        }

        .ret-desc {
          font-size: 11px;
          color: var(--text-secondary);
        }

        .history-filter-bar {
          display: flex;
        }

        .search-input-wrapper {
          position: relative;
          width: 100%;
          max-width: 480px;
        }

        .search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
        }

        .search-input {
          padding-left: 40px;
        }

        .logs-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .log-card {
          padding: 18px 24px;
          transition: all var(--transition-fast);
        }

        .log-card:hover {
          background: var(--bg-card-hover);
        }

        .log-top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }

        .log-author-info {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .log-action-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .log-author-badge {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .log-time-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

        .log-details-text {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .empty-log-card {
          padding: 48px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
