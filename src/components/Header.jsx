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
            <Church size={24} color="var(--primary)" />
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
                  <Wifi size={15} color="var(--status-live)" />
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
                  <AlertTriangle size={15} color="var(--status-pending)" />
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
                  <WifiOff size={15} color="var(--status-overrun)" />
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
        }

        .network-warning-bar {
          background: var(--status-pending-bg);
          color: var(--status-pending-text);
          padding: 8px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 600;
          border-bottom: 1px solid var(--status-pending-border);
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
          padding: 10px 20px;
          max-width: 1440px;
          margin: 0 auto;
          gap: 12px;
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
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
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
          background: var(--primary-surface);
          color: var(--primary);
          font-weight: 700;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .brand-subtitle {
          font-size: 12px;
          color: var(--text-muted);
        }

        .live-status {
          color: var(--status-live-text);
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
          background: var(--status-live-dot);
        }

        /* Barra de Navegação - Botões Separados, Sem Barra de Rolagem */
        .main-nav {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0;
          background: transparent;
          flex-shrink: 0;
        }

        .nav-btn,
        .nav-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 36px;
          padding: 0 10px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
          position: relative;
          user-select: none;
          text-decoration: none;
          box-shadow: var(--shadow-sm);
        }

        .nav-btn:hover,
        .nav-link:hover {
          color: var(--text-primary);
          background: var(--bg-card-hover);
          border-color: var(--border-active);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .nav-btn.active,
        .nav-link.active {
          color: var(--primary-contrast);
          background: var(--primary);
          border-color: var(--primary);
          box-shadow: var(--shadow-sm);
          font-weight: 700;
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
          background: var(--status-live);
        }

        .nav-badge-live {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: var(--radius-full);
          background: var(--status-live);
          color: white;
          font-weight: 800;
          letter-spacing: 0.05em;
        }

        .admin-chip {
          font-size: 10px;
          padding: 1px 6px;
          border-radius: var(--radius-full);
          background: var(--status-pending-bg);
          color: var(--status-pending-text);
          border: 1px solid var(--status-pending-border);
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
          color: var(--status-live-text);
          background: var(--status-live-bg);
          border-color: var(--status-live-border);
        }

        .status-btn.stale {
          color: var(--status-pending-text);
          background: var(--status-pending-bg);
          border-color: var(--status-pending-border);
        }

        .status-btn.offline {
          color: var(--status-overrun-text);
          background: var(--status-overrun-bg);
          border-color: var(--status-overrun-border);
        }

        .theme-toggle-btn {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .theme-toggle-btn:hover {
          color: var(--text-primary);
          background: var(--bg-card-hover);
          border-color: var(--border-active);
        }

        .user-profile-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 10px 4px 4px;
          border-radius: var(--radius-full);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          color: var(--text-primary);
          transition: all var(--transition-fast);
        }

        .user-profile-btn:hover {
          background: var(--bg-card-hover);
          border-color: var(--border-active);
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
          background: var(--bg-card);
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
          transition: background var(--transition-fast);
        }

        .dropdown-item:hover {
          background: var(--bg-surface);
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
          transition: background var(--transition-fast);
        }

        .dropdown-user-item:hover {
          background: var(--bg-surface);
        }

        .dropdown-user-item.selected {
          background: var(--primary-surface);
          border-color: var(--primary-border);
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
          color: var(--primary-contrast);
          font-weight: 700;
        }

        @media (max-width: 1360px) {
          .nav-btn,
          .nav-link {
            width: 38px;
            height: 36px;
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
            background: var(--bg-card);
            color: var(--text-primary);
            border: 1px solid var(--border-subtle);
            padding: 5px 9px;
            border-radius: var(--radius-sm);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.15s ease, transform 0.15s ease;
            box-shadow: var(--shadow-md);
            z-index: 1000;
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
