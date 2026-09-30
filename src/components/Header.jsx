import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Church,
  Radio,
  Calendar,
  UserCheck,
  ShieldAlert,
  Sliders,
  FileText,
  Clock,
  Wifi,
  WifiOff,
  Sun,
  Moon,
  ChevronDown,
  AlertTriangle
} from 'lucide-react';

export default function Header({ activeTab, setActiveTab }) {
  const {
    church,
    members,
    currentUser,
    setCurrentUserId,
    isAdmin,
    isLiturgyLeader,
    isTeamLeader,
    isOnline,
    setIsOnline,
    isDataStale,
    setIsDataStale,
    lastSyncTime,
    theme,
    setTheme,
    event
  } = useApp();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);

  // Status de execução do culto
  const isLive = event.status === "em_andamento";

  return (
    <header className="header-wrapper">
      {/* Barra de Notificação quando Offline ou Desatualizado (PRD 10.3 / Cenário M16, M17) */}
      {(!isOnline || isDataStale) && (
        <div className="network-warning-bar">
          <div className="warning-content">
            <AlertTriangle size={18} />
            <span>
              {!isOnline
                ? `Sem conexão com o servidor. A aplicação está em modo SOMENTE LEITURA da última informação sincronizada às ${lastSyncTime}. Edições e comandos operacionais estão suspensos.`
                : `Dados potencialmente desatualizados. Última atualização recebida às ${lastSyncTime}. Aguardando confirmação do servidor.`}
            </span>
          </div>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => {
              setIsOnline(true);
              setIsDataStale(false);
            }}
          >
            Reconectar Agora
          </button>
        </div>
      )}

      <div className="header-inner">
        {/* Marca & Igreja */}
        <div className="brand-section">
          <div className="brand-logo">
            <Church size={24} color="#6366f1" />
          </div>
          <div>
            <div className="brand-title">
              <span>Escala do Reino</span>
              <span className="church-pill">{church.name}</span>
            </div>
            <div className="brand-subtitle">
              {isLive ? (
                <span className="live-status">
                  <span className="live-dot"></span> Culto ao vivo em andamento
                </span>
              ) : (
                <span className="service-scheduled">
                  Próximo: {event.title}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Menu de Navegação Principal */}
        <nav className="main-nav">
          <button
            className={`nav-link ${activeTab === 'live' ? 'active' : ''} ${isLive ? 'pulse-live' : ''}`}
            onClick={() => setActiveTab('live')}
          >
            <Radio size={16} />
            <span>Ao Vivo</span>
            {isLive && <span className="nav-badge-live">LIVE</span>}
          </button>

          <button
            className={`nav-link ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            <Calendar size={16} />
            <span>Cronograma Macro</span>
          </button>

          <button
            className={`nav-link ${activeTab === 'my-schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('my-schedule')}
          >
            <UserCheck size={16} />
            <span>Minha Escala</span>
          </button>

          <button
            className={`nav-link ${activeTab === 'backstage' ? 'active' : ''}`}
            onClick={() => setActiveTab('backstage')}
          >
            <ShieldAlert size={16} />
            <span>Bastidores</span>
          </button>

          <button
            className={`nav-link ${activeTab === 'planning' ? 'active' : ''}`}
            onClick={() => setActiveTab('planning')}
          >
            <Sliders size={16} />
            <span>Planejamento</span>
          </button>

          {isAdmin && (
            <button
              className={`nav-link ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              <FileText size={16} />
              <span>Administração</span>
              <span className="admin-chip">Admin</span>
            </button>
          )}

          <button
            className={`nav-link ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={16} />
            <span>Histórico (1 ano)</span>
          </button>
        </nav>

        {/* Controles do Usuário, Tema e Rede */}
        <div className="header-actions">
          {/* Simulador de Rede (PRD 10.3) */}
          <div className="relative-container">
            <button
              className={`status-btn ${!isOnline ? 'offline' : isDataStale ? 'stale' : 'online'}`}
              onClick={() => setNetworkMenuOpen(!networkMenuOpen)}
              title="Simulador de Conexão (PRD 10.3)"
            >
              {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
              <span className="hide-mobile">
                {!isOnline ? 'Offline' : isDataStale ? 'Desatualizado' : 'Online'}
              </span>
              <ChevronDown size={14} />
            </button>

            {networkMenuOpen && (
              <div className="dropdown-menu network-dropdown">
                <div className="dropdown-header">Simulador de Rede (PRD 10.3)</div>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setIsOnline(true);
                    setIsDataStale(false);
                    setNetworkMenuOpen(false);
                  }}
                >
                  <Wifi size={15} color="#10b981" />
                  <div>
                    <div className="dropdown-item-title">Conectado (Normal)</div>
                    <div className="dropdown-item-sub">Comunicação e atualizações ativas</div>
                  </div>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setIsOnline(true);
                    setIsDataStale(true);
                    setNetworkMenuOpen(false);
                  }}
                >
                  <AlertTriangle size={15} color="#f59e0b" />
                  <div>
                    <div className="dropdown-item-title">Informação Desatualizada</div>
                    <div className="dropdown-item-sub">Simula perda de sincronia (M17)</div>
                  </div>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setIsOnline(false);
                    setNetworkMenuOpen(false);
                  }}
                >
                  <WifiOff size={15} color="#ef4444" />
                  <div>
                    <div className="dropdown-item-title">Queda de Conexão</div>
                    <div className="dropdown-item-sub">Modo somente leitura (M16)</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Toggle de Tema */}
          <button
            className="theme-toggle-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Alternar Tema Claro / Escuro"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Seletor Rápido de Papel / Usuário (Simulação de Avaliação do PRD) */}
          <div className="relative-container">
            <button
              className="user-profile-btn"
              onClick={() => setUserMenuOpen(!userMenuOpen)}
            >
              <img src={currentUser.avatar} alt={currentUser.name} className="user-avatar" />
              <div className="user-info-text hide-mobile">
                <div className="user-name">{currentUser.name.split(' ')[0]}</div>
                <div className="user-role-label">
                  {isAdmin
                    ? 'Admin'
                    : isLiturgyLeader
                    ? 'Líder Liturgia'
                    : isTeamLeader
                    ? 'Líder Equipe'
                    : 'Membro'}
                </div>
              </div>
              <ChevronDown size={14} />
            </button>

            {userMenuOpen && (
              <div className="dropdown-menu user-dropdown">
                <div className="dropdown-header">
                  Alternar Perfil Ativo (Piloto Shalom)
                </div>
                <div className="dropdown-desc">
                  Alterne entre papéis para testar as permissões e restrições do PRD 3.2:
                </div>
                <div className="user-list">
                  {members.map(m => {
                    const mIsAdmin = m.roles.includes("admin");
                    const mIsLit = event.liturgyLeaderId === m.id;
                    const mIsTeam = m.roles.includes("lider_equipe");
                    const roleLabel = mIsAdmin
                      ? "Admin Global"
                      : mIsLit
                      ? "Líder da Liturgia"
                      : mIsTeam
                      ? `Líder: ${m.teams[0] || 'Equipe'}`
                      : "Membro da Igreja";

                    return (
                      <button
                        key={m.id}
                        className={`dropdown-user-item ${m.id === currentUser.id ? 'selected' : ''}`}
                        onClick={() => {
                          setCurrentUserId(m.id);
                          setUserMenuOpen(false);
                        }}
                      >
                        <img src={m.avatar} alt={m.name} className="user-avatar-sm" />
                        <div className="user-details">
                          <div className="user-name-full">{m.name}</div>
                          <div className="user-role-detail">{roleLabel}</div>
                        </div>
                        {m.id === currentUser.id && (
                          <span className="active-user-badge">Ativo</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .header-wrapper {
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-subtle);
          position: sticky;
          top: 0;
          z-index: 500;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .network-warning-bar {
          background: #78350f;
          color: #fef3c7;
          padding: 8px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 500;
          border-bottom: 1px solid rgba(245, 158, 11, 0.3);
        }

        .warning-content {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .header-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 24px;
          max-width: 1440px;
          margin: 0 auto;
          gap: 16px;
        }

        .brand-section {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 260px;
        }

        .brand-logo {
          width: 42px;
          height: 42px;
          border-radius: var(--radius-md);
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid var(--border-active);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .brand-title {
          font-size: 16px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.02em;
        }

        .church-pill {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          background: rgba(99, 102, 241, 0.12);
          color: var(--primary-light);
          font-weight: 600;
        }

        .brand-subtitle {
          font-size: 12px;
          color: var(--text-muted);
        }

        .live-status {
          color: #10b981;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .main-nav {
          display: flex;
          align-items: center;
          gap: 4px;
          overflow-x: auto;
          padding: 4px;
          border-radius: var(--radius-lg);
          background: rgba(0, 0, 0, 0.2);
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
        }

        .nav-link:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.05);
        }

        .nav-link.active {
          color: #ffffff;
          background: var(--primary);
          box-shadow: 0 2px 10px var(--primary-glow);
        }

        .nav-badge-live {
          font-size: 9px;
          padding: 2px 5px;
          border-radius: var(--radius-full);
          background: #ef4444;
          color: white;
          font-weight: 800;
          letter-spacing: 0.05em;
        }

        .admin-chip {
          font-size: 10px;
          padding: 1px 6px;
          border-radius: var(--radius-full);
          background: rgba(245, 158, 11, 0.2);
          color: #fbbf24;
          font-weight: 700;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .relative-container {
          position: relative;
        }

        .status-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: var(--radius-full);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          background: transparent;
          transition: all var(--transition-fast);
        }

        .status-btn.online {
          color: #34d399;
          background: rgba(16, 185, 129, 0.1);
          border-color: rgba(16, 185, 129, 0.25);
        }

        .status-btn.stale {
          color: #fbbf24;
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.3);
        }

        .status-btn.offline {
          color: #f87171;
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.3);
        }

        .theme-toggle-btn {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .theme-toggle-btn:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.1);
        }

        .user-profile-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 10px 4px 4px;
          border-radius: var(--radius-full);
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          color: var(--text-primary);
          transition: all var(--transition-fast);
        }

        .user-profile-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.15);
        }

        .user-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
        }

        .user-avatar-sm {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          object-fit: cover;
        }

        .user-info-text {
          text-align: left;
        }

        .user-name {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
        }

        .user-role-label {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1;
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: var(--bg-secondary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          padding: 12px;
          z-index: 600;
          animation: scaleUp 0.18s ease-out;
        }

        .network-dropdown {
          width: 280px;
        }

        .user-dropdown {
          width: 320px;
        }

        .dropdown-header {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          padding: 4px 8px 8px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .dropdown-desc {
          font-size: 12px;
          color: var(--text-secondary);
          padding: 8px 8px;
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 8px 10px;
          border-radius: var(--radius-md);
          background: transparent;
          border: none;
          color: var(--text-primary);
          text-align: left;
          cursor: pointer;
        }

        .dropdown-item:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        .dropdown-item-title {
          font-size: 13px;
          font-weight: 600;
        }

        .dropdown-item-sub {
          font-size: 11px;
          color: var(--text-muted);
        }

        .user-list {
          max-height: 320px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .dropdown-user-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px;
          border-radius: var(--radius-md);
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-primary);
          text-align: left;
          cursor: pointer;
        }

        .dropdown-user-item:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .dropdown-user-item.selected {
          background: rgba(99, 102, 241, 0.12);
          border-color: rgba(99, 102, 241, 0.3);
        }

        .user-details {
          flex: 1;
        }

        .user-name-full {
          font-size: 13px;
          font-weight: 600;
        }

        .user-role-detail {
          font-size: 11px;
          color: var(--text-muted);
        }

        .active-user-badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: var(--radius-full);
          background: var(--primary);
          color: white;
          font-weight: 700;
        }

        @media (max-width: 900px) {
          .hide-mobile {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
