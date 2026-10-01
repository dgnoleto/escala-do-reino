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

        {/* Menu de Navegação Principal - Botões Separados e Responsivos */}
        <nav className="main-nav" aria-label="Navegação Principal">
          <button
            type="button"
            className={`nav-btn ${activeTab === 'live' ? 'active' : ''} ${isLive ? 'pulse-live' : ''}`}
            onClick={() => setActiveTab('live')}
            title="Ao Vivo (Culto em andamento)"
            data-tooltip="Ao Vivo"
            aria-label="Ao Vivo"
          >
            <div className="nav-btn-icon-wrapper">
              <Radio size={18} />
              {isLive && <span className="nav-live-dot" />}
            </div>
            <span className="nav-btn-text">Ao Vivo</span>
            {isLive && <span className="nav-badge-live">LIVE</span>}
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
            title="Cronograma Macro"
            data-tooltip="Cronograma Macro"
            aria-label="Cronograma Macro"
          >
            <div className="nav-btn-icon-wrapper">
              <Calendar size={18} />
            </div>
            <span className="nav-btn-text">Cronograma Macro</span>
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'my-schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('my-schedule')}
            title="Minha Escala"
            data-tooltip="Minha Escala"
            aria-label="Minha Escala"
          >
            <div className="nav-btn-icon-wrapper">
              <UserCheck size={18} />
            </div>
            <span className="nav-btn-text">Minha Escala</span>
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'backstage' ? 'active' : ''}`}
            onClick={() => setActiveTab('backstage')}
            title="Bastidores"
            data-tooltip="Bastidores"
            aria-label="Bastidores"
          >
            <div className="nav-btn-icon-wrapper">
              <ShieldAlert size={18} />
            </div>
            <span className="nav-btn-text">Bastidores</span>
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'planning' ? 'active' : ''}`}
            onClick={() => setActiveTab('planning')}
            title="Planejamento"
            data-tooltip="Planejamento"
            aria-label="Planejamento"
          >
            <div className="nav-btn-icon-wrapper">
              <Sliders size={18} />
            </div>
            <span className="nav-btn-text">Planejamento</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              className={`nav-btn ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
              title="Administração"
              data-tooltip="Administração"
              aria-label="Administração"
            >
              <div className="nav-btn-icon-wrapper">
                <FileText size={18} />
              </div>
              <span className="nav-btn-text">Administração</span>
              <span className="admin-chip">Admin</span>
            </button>
          )}

          <button
            type="button"
            className={`nav-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
            title="Histórico (1 ano)"
            data-tooltip="Histórico"
            aria-label="Histórico"
          >
            <div className="nav-btn-icon-wrapper">
              <Clock size={18} />
            </div>
            <span className="nav-btn-text">Histórico</span>
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
          flex-shrink: 0;
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
          white-space: nowrap;
        }

        .church-pill {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          background: rgba(99, 102, 241, 0.12);
          color: var(--primary-light);
          font-weight: 600;
          white-space: nowrap;
          flex-shrink: 0;
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
          white-space: nowrap;
        }

        .live-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          box-shadow: 0 0 8px #10b981;
          animation: pulseLiveDot 2s infinite;
        }

        /* Barra de Navegação - Botões Separados, Sem Barra de Rolagem */
        .main-nav {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0;
          background: transparent;
          flex-shrink: 0;
        }

        .nav-btn,
        .nav-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 38px;
          padding: 0 13px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
          position: relative;
          user-select: none;
          text-decoration: none;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .nav-btn:hover,
        .nav-link:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.18);
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
        }

        .nav-btn.active,
        .nav-link.active {
          color: #ffffff;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
          border-color: var(--primary-light);
          box-shadow: 0 2px 12px var(--primary-glow);
        }

        .nav-btn:active,
        .nav-link:active {
          transform: scale(0.96);
        }

        .nav-btn-icon-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          position: relative;
          flex-shrink: 0;
        }

        .nav-live-dot {
          display: none;
          position: absolute;
          top: -3px;
          right: -3px;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 6px #ef4444;
          animation: pulseLiveDot 1.5s infinite;
        }

        @keyframes pulseLiveDot {
          0% { transform: scale(0.85); opacity: 0.8; }
          50% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(0.85); opacity: 0.8; }
        }

        .nav-badge-live {
          font-size: 9px;
          padding: 2px 6px;
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

        [data-theme='light'] .nav-btn,
        [data-theme='light'] .nav-link {
          background: rgba(0, 0, 0, 0.03);
          border-color: rgba(0, 0, 0, 0.08);
          color: var(--text-secondary);
        }

        [data-theme='light'] .nav-btn:hover,
        [data-theme='light'] .nav-link:hover {
          background: rgba(0, 0, 0, 0.06);
          border-color: rgba(0, 0, 0, 0.15);
          color: var(--text-primary);
        }

        [data-theme='light'] .nav-btn.active,
        [data-theme='light'] .nav-link.active {
          color: #ffffff;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
          border-color: var(--primary-light);
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

        @media (max-width: 1240px) {
          .nav-btn,
          .nav-link {
            width: 40px;
            height: 38px;
            padding: 0;
            gap: 0;
          }

          .nav-btn-text,
          .nav-badge-live,
          .admin-chip {
            display: none !important;
          }

          .nav-live-dot {
            display: block;
          }

          /* Micro-tooltip no hover quando estiver no modo responsivo de ícones */
          .nav-btn[data-tooltip]::after,
          .nav-link[data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            top: calc(100% + 8px);
            left: 50%;
            transform: translateX(-50%) translateY(4px);
            background: #0f172a;
            color: #f8fafc;
            border: 1px solid var(--border-subtle);
            padding: 5px 9px;
            border-radius: var(--radius-sm);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease, transform 0.15s ease;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
            z-index: 1000;
          }

          [data-theme='light'] .nav-btn[data-tooltip]::after,
          [data-theme='light'] .nav-link[data-tooltip]::after {
            background: #ffffff;
            color: #0f172a;
            border-color: rgba(0, 0, 0, 0.12);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
          }

          .nav-btn[data-tooltip]:hover::after,
          .nav-link[data-tooltip]:hover::after {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        @media (max-width: 900px) {
          .hide-mobile {
            display: none !important;
          }
          .church-pill {
            display: none !important;
          }
        }

        @media (max-width: 768px) {
          .header-inner {
            flex-wrap: wrap;
            padding: 10px 16px;
            gap: 12px;
          }

          .brand-section {
            order: 1;
            flex: 1;
            min-width: auto;
          }

          .header-actions {
            order: 2;
            gap: 8px;
          }

          .main-nav {
            order: 3;
            width: 100%;
            justify-content: center;
            padding-top: 8px;
            border-top: 1px solid var(--border-subtle);
            gap: 8px;
          }
        }

        @media (max-width: 480px) {
          .brand-subtitle {
            display: none !important;
          }
          .brand-title {
            font-size: 14px;
          }
          .nav-btn,
          .nav-link {
            width: 36px;
            height: 36px;
          }
          .main-nav {
            gap: 4px;
          }
        }
      `}</style>
    </header>
  );
}
