import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Play,
  CheckCircle2,
  FastForward,
  RotateCcw,
  XCircle,
  Clock,
  Radio,
  Tv,
  Mic,
  AlertTriangle,
  Edit3,
  Power,
  ChevronRight,
  Info,
  Check
} from 'lucide-react';

export default function LiveConsole() {
  const {
    event,
    currentUser,
    isLiturgyLeader,
    isAdmin,
    startService,
    startActivity,
    finishAndNextActivity,
    finishCurrentActivityOnly,
    returnToPending,
    cancelActivity,
    correctActivityTimes,
    finishService,
    cancelReasons,
    breakElapsedSeconds,
    isOnline,
    isDataStale
  } = useApp();

  // Modais de Operação
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState(cancelReasons[0] || '');
  const [timeCorrectionModalOpen, setTimeCorrectionModalOpen] = useState(false);
  const [targetActivityToCorrect, setTargetActivityToCorrect] = useState(null);
  const [correctedStartTime, setCorrectedStartTime] = useState('');
  const [correctedEndTime, setCorrectedEndTime] = useState('');
  const [correctionError, setCorrectionError] = useState('');

  const currentIdx = event.currentActivityIndex;
  const currentAct = event.activities[currentIdx];
  const prevAct = currentIdx > 0 ? event.activities[currentIdx - 1] : null;
  const nextAct = currentIdx + 1 < event.activities.length ? event.activities[currentIdx + 1] : null;

  // Cálculo do Cronômetro Regressivo da Atividade (PRD 7.2)
  const plannedSeconds = (currentAct?.plannedDurationMinutes || 0) * 60;
  const elapsedSeconds = event.activityElapsedSeconds;
  const remainingSeconds = plannedSeconds - elapsedSeconds;
  const isOverrun = remainingSeconds < 0;

  // Formatação MM:SS
  const formatTime = (totalSec) => {
    const absSec = Math.abs(totalSec);
    const mins = Math.floor(absSec / 60);
    const secs = absSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Verificação de Checklist Pendente para a próxima etapa (PRD 9.3 & M29)
  const nextActPendingChecklist = event.checklist.filter(
    c => c.activityId === nextAct?.id && !c.completed
  );

  // Abertura do Modal de Correção
  const openTimeCorrection = (act) => {
    setTargetActivityToCorrect(act);
    setCorrectedStartTime(act.realStartTime || '');
    setCorrectedEndTime(act.realEndTime || '');
    setCorrectionError('');
    setTimeCorrectionModalOpen(true);
  };

  const handleSaveCorrection = () => {
    if (!targetActivityToCorrect) return;
    const res = correctActivityTimes(targetActivityToCorrect.id, correctedStartTime, correctedEndTime);
    if (!res.success) {
      setCorrectionError(res.error);
    } else {
      setTimeCorrectionModalOpen(false);
    }
  };

  const handleCancelCurrentActivity = () => {
    if (!selectedCancelReason) return;
    cancelActivity(selectedCancelReason);
    setCancelModalOpen(false);
  };

  const isControlsDisabled = !isOnline || isDataStale;

  return (
    <div className="live-console-container">
      {/* Barra de Status do Culto & Informações Litúrgicas */}
      <div className="live-status-header card">
        <div className="status-main-col">
          <div className="service-title-row">
            <span className="live-indicator-pill">
              {event.status === "em_andamento" ? (
                <>
                  <span className="live-dot"></span> AO VIVO
                </>
              ) : event.status === "encerrado" ? (
                "CULTO ENCERRADO"
              ) : (
                "AGUARDANDO INÍCIO"
              )}
            </span>
            <h1 className="service-title">{event.title}</h1>
          </div>

          <div className="service-meta-row">
            <div className="meta-item">
              <span className="meta-label">Data e Hora Prevista:</span>
              <span className="meta-val">{event.date} às {event.scheduledStartTime}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Duração Planejada Total:</span>
              <span className="meta-val">{event.plannedDurationMinutes} min</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Início Real do Culto:</span>
              <span className="meta-val highlight">{event.realStartTime || "Não iniciado"}</span>
            </div>
            {event.realEndTime && (
              <div className="meta-item">
                <span className="meta-label">Término Real:</span>
                <span className="meta-val highlight">{event.realEndTime}</span>
              </div>
            )}
          </div>
        </div>

        <div className="liturgy-officer-col">
          <div className="officer-badge">
            <span className="officer-label">Líder da Liturgia (Designado):</span>
            <span className="officer-name">Carlos Oliveira</span>
            {!isLiturgyLeader && (
              <div className="permission-notice">
                <Info size={13} />
                <span>Você está logado como {currentUser.name}. O controle ao vivo é restrito a Carlos Oliveira (PRD 3.2).</span>
              </div>
            )}
          </div>

          {/* Botões Globais de Culto */}
          {event.status === "pronto" && (
            <button
              className="btn btn-success btn-lg"
              onClick={startService}
              disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
            >
              <Play size={18} /> Iniciar Culto Oficialmente
            </button>
          )}

          {event.status === "em_andamento" && (
            <button
              className="btn btn-danger"
              onClick={finishService}
              disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
              title="Encerra o culto, serviços paralelos e intervalos abertos"
            >
              <Power size={16} /> Encerrar Culto
            </button>
          )}
        </div>
      </div>

      {/* Grid Principal: Palco / Etapa Atual + Bastidores Laterais */}
      <div className="live-grid">
        <div className="live-stage-col">
          {/* AVISO DE INTERVALO ENTRE ATIVIDADES (PRD 7.5, Cenário M13) */}
          {event.inBreak && event.status === "em_andamento" && (
            <div className="break-banner card">
              <div className="break-header">
                <Clock size={20} className="pulse-icon" />
                <div>
                  <h3 className="break-title">Intervalo Entre Atividades em Andamento</h3>
                  <p className="break-sub">
                    Registrado sem cronômetro visível para o público. Duração decorrida: <strong>{formatTime(breakElapsedSeconds)}</strong>.
                    Este registro compõe as métricas do piloto e não atribui culpa ou atraso (PRD 7.5).
                  </p>
                </div>
              </div>
              {nextAct && (
                <button
                  className="btn btn-primary"
                  onClick={() => startActivity(currentIdx + 1)}
                  disabled={!isLiturgyLeader || isControlsDisabled}
                >
                  <Play size={16} /> Iniciar Próxima Atividade Agora: {nextAct.title}
                </button>
              )}
            </div>
          )}

          {/* CARD DA ETAPA ATUAL (EM EXECUÇÃO OU PENDENTE) */}
          {currentAct ? (
            <div className={`card current-act-card ${event.currentActivityStatus === 'em_execucao' ? 'is-active-border' : ''}`}>
              <div className="act-header">
                <div className="act-category-row">
                  <span className="badge badge-primary">{currentAct.category}</span>
                  <span className={`badge ${
                    currentAct.status === 'em_execucao' ? 'badge-live' :
                    currentAct.status === 'concluida' ? 'badge-primary' :
                    currentAct.status === 'cancelada' ? 'badge-cancelled' : 'badge-pending'
                  }`}>
                    {currentAct.status === 'em_execucao' ? '● Em Execução no Púlpito' :
                     currentAct.status === 'concluida' ? '✓ Concluída' :
                     currentAct.status === 'cancelada' ? '✕ Cancelada' : 'Aguardando Início'}
                  </span>
                  <span className="act-order">Etapa {currentIdx + 1} de {event.activities.length}</span>
                </div>

                <h2 className="act-title-large">{currentAct.title}</h2>
                <div className="act-responsible">
                  Responsável: <strong>{currentAct.responsibleMemberId}</strong> • Equipe: <strong>{currentAct.responsibleTeamId}</strong>
                </div>
              </div>

              {/* CRONÔMETRO REGRESSIVO DA ATIVIDADE COM INDICAÇÃO DE EXCESSO (PRD 7.2) */}
              <div className="timer-wrapper">
                <div className={`timer-display ${isOverrun ? 'timer-overrun' : ''}`}>
                  <div className="timer-numbers">
                    {isOverrun ? `+${formatTime(remainingSeconds)}` : formatTime(remainingSeconds)}
                  </div>
                  <div className="timer-caption">
                    {isOverrun ? (
                      <span className="overrun-label">
                        <AlertTriangle size={15} /> TEMPO EXCEDIDO (Previsto: {currentAct.plannedDurationMinutes}m)
                      </span>
                    ) : (
                      <span>TEMPO RESTANTE (Duração Prevista: {currentAct.plannedDurationMinutes}m)</span>
                    )}
                  </div>
                </div>

                {/* Histórico da Etapa Atual */}
                <div className="act-time-details">
                  <div className="detail-line">
                    <span>Início Real Registrado:</span>
                    <strong>{currentAct.realStartTime || "—"}</strong>
                  </div>
                  {currentAct.realEndTime && (
                    <div className="detail-line">
                      <span>Término Real:</span>
                      <strong>{currentAct.realEndTime}</strong>
                    </div>
                  )}
                  {currentAct.cancellationReason && (
                    <div className="detail-line text-danger">
                      <span>Motivo do Cancelamento:</span>
                      <strong>{currentAct.cancellationReason}</strong>
                    </div>
                  )}
                  {currentAct.previousAttemptMinutes && (
                    <div className="detail-line text-warning">
                      <span>Tentativa Anterior Interrompida:</span>
                      <strong>{currentAct.previousAttemptMinutes} min (preservado no histórico)</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Ficha Musical Rápida se for Louvor/Oportunidade (PRD 9.1) */}
              {currentAct.musics && currentAct.musics.length > 0 && (
                <div className="quick-music-strip">
                  <div className="music-strip-title">Músicas do Bloco (Ficha Simples):</div>
                  <div className="music-cards-row">
                    {currentAct.musics.map(m => (
                      <div key={m.id} className="mini-music-card">
                        <div className="music-info-line">
                          <span className="song-title">{m.name}</span>
                          <span className="song-key-badge">Tom: {m.key}</span>
                        </div>
                        <div className="song-artist">{m.artist}</div>
                        {m.notes && <div className="song-notes">"{m.notes}"</div>}
                        {m.youtubeUrl && (
                          <a href={m.youtubeUrl} target="_blank" rel="noreferrer" className="youtube-link">
                            Assistir Referência YouTube ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CONTROLES EXCLUSIVOS DA LITURGIA (PRD 7.1, 7.3, 7.4) */}
              <div className="act-action-bar">
                {currentAct.status !== 'em_execucao' ? (
                  <button
                    className="btn btn-success btn-lg"
                    onClick={() => startActivity(currentIdx)}
                    disabled={!isLiturgyLeader || isControlsDisabled}
                  >
                    <Play size={18} /> Iniciar Esta Atividade
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-success"
                      onClick={finishAndNextActivity}
                      disabled={!isLiturgyLeader || isControlsDisabled}
                      title="Encerra a etapa atual e inicia a próxima imediatamente (intervalo: 0s)"
                    >
                      <FastForward size={16} /> Concluir e Iniciar Próxima
                    </button>

                    <button
                      className="btn btn-secondary"
                      onClick={finishCurrentActivityOnly}
                      disabled={!isLiturgyLeader || isControlsDisabled}
                      title="Encerra a etapa e abre intervalo entre atividades"
                    >
                      <CheckCircle2 size={16} /> Apenas Concluir Etapa
                    </button>

                    <button
                      className="btn btn-warning"
                      onClick={returnToPending}
                      disabled={!isLiturgyLeader || isControlsDisabled}
                      title="Devolve para pendente, para a contagem e abre intervalo. Próximo início terá duração integral."
                    >
                      <RotateCcw size={16} /> Devolver para Pendente
                    </button>

                    <button
                      className="btn btn-danger"
                      onClick={() => setCancelModalOpen(true)}
                      disabled={!isLiturgyLeader || isControlsDisabled}
                      title="Cancela com motivo obrigatório previamente cadastrado"
                    >
                      <XCircle size={16} /> Cancelar Atividade
                    </button>
                  </>
                )}

                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => openTimeCorrection(currentAct)}
                  disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
                  title="Corrigir horários reais de início/fim com histórico"
                >
                  <Edit3 size={14} /> Corrigir Horário Real
                </button>
              </div>
            </div>
          ) : (
            <div className="card empty-card">
              <h3>Todas as atividades planejadas foram concluídas.</h3>
              <p>O líder da liturgia pode agora encerrar o culto oficialmente.</p>
            </div>
          )}

          {/* LINHA DE CONTEXTO: ETAPA ANTERIOR & PRÓXIMA ETAPA (PRD 7.1) */}
          <div className="grid-2 step-context-grid">
            {/* Etapa Anterior */}
            <div className="card step-mini-card">
              <div className="step-mini-header">
                <span className="step-tag">Etapa Anterior</span>
                {prevAct && <span className="badge badge-primary">Concluída</span>}
              </div>
              {prevAct ? (
                <div className="step-mini-body">
                  <div className="step-mini-title">{prevAct.title}</div>
                  <div className="step-mini-meta">
                    Duração prevista: {prevAct.plannedDurationMinutes} min • Fim real: {prevAct.realEndTime || "—"}
                  </div>
                  <button
                    className="btn btn-sm btn-secondary time-corr-link"
                    onClick={() => openTimeCorrection(prevAct)}
                    disabled={(!isLiturgyLeader && !isAdmin) || isControlsDisabled}
                  >
                    <Edit3 size={12} /> Corrigir Horário
                  </button>
                </div>
              ) : (
                <div className="step-empty-text">Nenhuma etapa anterior (início do culto).</div>
              )}
            </div>

            {/* Próxima Etapa */}
            <div className="card step-mini-card">
              <div className="step-mini-header">
                <span className="step-tag">Próxima Etapa</span>
                {nextAct && (
                  <span className="badge badge-pending">Prevista ({nextAct.plannedDurationMinutes}m)</span>
                )}
              </div>
              {nextAct ? (
                <div className="step-mini-body">
                  <div className="step-mini-title">{nextAct.title}</div>
                  <div className="step-mini-meta">
                    Responsável: {nextAct.responsibleMemberId} • Equipe: {nextAct.responsibleTeamId}
                  </div>

                  {/* ALERTA DE CHECKLIST PENDENTE (PRD 9.3 & Cenário M29) */}
                  {nextActPendingChecklist.length > 0 && (
                    <div className="pending-prep-alert">
                      <AlertTriangle size={14} color="var(--status-pending-text)" />
                      <span>
                        <strong>Preparação Pendente:</strong> {nextActPendingChecklist.length} item(ns) de checklist não finalizado(s).
                        (Não bloqueia avanço no MVP, PRD 9.3)
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="step-empty-text">Nenhuma etapa posterior (encerramento).</div>
              )}
            </div>
          </div>
        </div>

        {/* COLUNA LATERAL: SERVIÇOS PARALELOS & AVISOS (PRD 7.7) */}
        <div className="live-sidebar-col">
          {/* SERVIÇOS PARALELOS (Acompanham marcos do culto, sem botões individuais) */}
          <div className="card parallel-services-card">
            <div className="card-header-styled">
              <Radio size={18} color="var(--primary)" />
              <h3>Serviços Paralelos (PRD 7.7)</h3>
            </div>
            <p className="parallel-explanation">
              Transmissão e Sonoplastia acompanham o início e fim reais do culto. Não possuem cronômetro nem controle individual de início/fim.
            </p>

            <div className="services-list">
              {event.parallelServices.map(service => (
                <div key={service.id} className="service-row-item">
                  <div className="service-icon-box">
                    {service.id.includes('midia') ? <Tv size={18} /> : <Mic size={18} />}
                  </div>
                  <div className="service-item-info">
                    <div className="service-name-row">
                      <span className="service-name">{service.name}</span>
                      <span className={`badge ${
                        service.status.includes('Em execução') ? 'badge-live' :
                        service.status === 'Finalizado' ? 'badge-cancelled' : 'badge-pending'
                      }`}>
                        {service.status}
                      </span>
                    </div>
                    <div className="service-volunteers">
                      Voluntários: <strong>{service.volunteers.join(', ')}</strong>
                    </div>
                    <div className="service-prep">
                      Preparação planejada: {service.prepRequiredMinutes} min antes do início.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AVISOS OPERACIONAIS INTERNOS (PRD 10.2) */}
          <div className="card internal-alerts-card">
            <div className="card-header-styled">
              <AlertTriangle size={18} color="var(--status-pending-text)" />
              <h3>Avisos Internos do Culto</h3>
            </div>
            <div className="alerts-list">
              {event.internalAlerts.map(alert => (
                <div key={alert.id} className={`alert-box-item ${alert.urgent ? 'urgent' : ''}`}>
                  <div className="alert-item-title">{alert.title}</div>
                  <div className="alert-item-msg">{alert.message}</div>
                  <div className="alert-item-time">{alert.timestamp}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DE CANCELAMENTO COM MOTIVO OBRIGATÓRIO (PRD 7.3 & Cenário M11) */}
      {cancelModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Cancelar Atividade em Execução</h3>
              <button className="close-btn" onClick={() => setCancelModalOpen(false)}>✕</button>
            </div>
            <p className="modal-desc">
              Conforme o <strong>PRD 7.3</strong>, cancelar uma atividade em execução encerra o cronômetro,
              não avança para a próxima etapa e exige a seleção obrigatória de um motivo previamente cadastrado na web.
            </p>

            <div className="form-group">
              <label className="form-label">Selecione o Motivo do Cancelamento:</label>
              <select
                className="form-select"
                value={selectedCancelReason}
                onChange={e => setSelectedCancelReason(e.target.value)}
              >
                {cancelReasons.map((reason, idx) => (
                  <option key={idx} value={reason}>{reason}</option>
                ))}
              </select>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCancelModalOpen(false)}>
                Voltar
              </button>
              <button className="btn btn-danger" onClick={handleCancelCurrentActivity}>
                Confirmar Cancelamento Obrigatório
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CORREÇÃO DE HORÁRIOS REAIS (PRD 7.8 & Cenários M41, M42, M43) */}
      {timeCorrectionModalOpen && targetActivityToCorrect && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Corrigir Horários Reais — {targetActivityToCorrect.title}</h3>
              <button className="close-btn" onClick={() => setTimeCorrectionModalOpen(false)}>✕</button>
            </div>
            <p className="modal-desc">
              O Líder da Liturgia pode retificar o horário real quando o registro no sistema tiver ocorrido com atraso
              ou após retorno de conexão (PRD 7.8). O histórico preserva o momento do registro e os valores anteriores.
            </p>

            {correctionError && (
              <div className="error-banner">
                <AlertTriangle size={16} />
                <span>{correctionError}</span>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Horário de Início Real (ex: 19:15):</label>
              <input
                type="text"
                className="form-input"
                placeholder="HH:MM"
                value={correctedStartTime}
                onChange={e => setCorrectedStartTime(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Horário de Término Real (opcional):</label>
              <input
                type="text"
                className="form-input"
                placeholder="HH:MM"
                value={correctedEndTime}
                onChange={e => setCorrectedEndTime(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setTimeCorrectionModalOpen(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSaveCorrection}>
                Salvar Retificação com Histórico
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .live-console-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .live-status-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 24px;
          gap: 20px;
          flex-wrap: wrap;
        }

        .service-title-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }

        .live-indicator-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          background: var(--status-live-bg);
          color: var(--status-live-text);
          border: 1px solid var(--status-live-border);
          border-radius: var(--radius-full);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.05em;
        }

        .service-title {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .service-meta-row {
          display: flex;
          align-items: center;
          gap: 20px;
          font-size: 13px;
          flex-wrap: wrap;
        }

        .meta-label {
          color: var(--text-muted);
          margin-right: 6px;
        }

        .meta-val {
          font-weight: 600;
          color: var(--text-secondary);
        }

        .meta-val.highlight {
          color: var(--primary);
        }

        .liturgy-officer-col {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .officer-badge {
          background: var(--bg-surface);
          padding: 8px 14px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          font-size: 12px;
        }

        .officer-label {
          color: var(--text-muted);
          display: block;
        }

        .officer-name {
          font-weight: 700;
          color: var(--text-primary);
        }

        .permission-notice {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--status-pending-text);
          font-size: 11px;
          margin-top: 4px;
        }

        .live-grid {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 24px;
        }

        @media (max-width: 1024px) {
          .live-grid {
            grid-template-columns: 1fr;
          }
        }

        .live-stage-col {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .break-banner {
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          border-radius: var(--radius-md);
        }

        .break-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .pulse-icon {
          color: var(--primary);
        }

        .break-title {
          font-size: 15px;
          font-weight: 700;
        }

        .break-sub {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }

        .current-act-card {
          padding: 32px;
          position: relative;
        }

        .is-active-border {
          border-color: var(--status-live-border);
          box-shadow: var(--shadow-sm);
        }

        .act-category-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .act-order {
          font-size: 12px;
          color: var(--text-muted);
          margin-left: auto;
          font-weight: 600;
        }

        .act-title-large {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .act-responsible {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .timer-wrapper {
          margin: 28px 0;
          padding: 24px;
          border-radius: var(--radius-xl);
          background: var(--bg-surface);
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid var(--border-subtle);
          gap: 20px;
          flex-wrap: wrap;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }

        .timer-wrapper.timer-overrun {
          background: var(--status-overrun-bg);
          border-color: var(--status-overrun-border);
        }

        .timer-display {
          display: flex;
          flex-direction: column;
        }

        .timer-numbers {
          font-family: var(--font-mono);
          font-size: 64px;
          font-weight: 800;
          line-height: 1;
          color: var(--text-primary);
          letter-spacing: -0.04em;
        }

        .timer-overrun .timer-numbers {
          color: var(--status-overrun-text);
        }

        .timer-caption {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin-top: 8px;
        }

        .overrun-label {
          color: var(--status-overrun-text);
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 800;
        }

        .act-time-details {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 13px;
        }

        .detail-line {
          display: flex;
          gap: 8px;
        }

        .detail-line span {
          color: var(--text-muted);
        }

        .quick-music-strip {
          margin-bottom: 24px;
          padding: 16px;
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }

        .music-strip-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 10px;
        }

        .music-cards-row {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 12px;
        }

        .mini-music-card {
          padding: 12px;
          background: var(--bg-card);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-subtle);
          font-size: 13px;
        }

        .music-info-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 4px;
        }

        .song-title {
          font-weight: 700;
          color: var(--text-primary);
        }

        .song-key-badge {
          font-size: 11px;
          font-weight: 800;
          background: var(--primary-surface);
          color: var(--primary);
          border: 1px solid var(--primary-border);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .song-artist {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .song-notes {
          font-size: 11px;
          color: var(--text-muted);
          font-style: italic;
          margin-top: 4px;
        }

        .youtube-link {
          font-size: 11px;
          color: var(--primary);
          text-decoration: none;
          display: inline-block;
          margin-top: 6px;
          font-weight: 600;
        }

        .youtube-link:hover {
          text-decoration: underline;
        }

        .act-action-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding-top: 16px;
          border-top: 1px solid var(--border-subtle);
        }

        .step-context-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .step-mini-card {
          padding: 18px;
        }

        .step-mini-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .step-tag {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.05em;
        }

        .step-mini-title {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .step-mini-meta {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .pending-prep-alert {
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: var(--status-pending-bg);
          border: 1px solid var(--status-pending-border);
          border-radius: var(--radius-sm);
          font-size: 11px;
          color: var(--status-pending-text);
        }

        .step-empty-text {
          font-size: 13px;
          color: var(--text-muted);
          font-style: italic;
          padding: 12px 0;
        }

        .time-corr-link {
          margin-top: 8px;
        }

        .live-sidebar-col {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .card-header-styled {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .card-header-styled h3 {
          font-size: 16px;
          font-weight: 700;
        }

        .parallel-explanation {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 16px;
          line-height: 1.4;
        }

        .services-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .service-row-item {
          display: flex;
          gap: 12px;
          padding: 12px;
          background: var(--bg-surface);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
        }

        .service-icon-box {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-sm);
          background: var(--primary-surface);
          border: 1px solid var(--primary-border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary);
        }

        .service-item-info {
          flex: 1;
        }

        .service-name-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }

        .service-name {
          font-size: 13px;
          font-weight: 700;
        }

        .service-volunteers {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .service-prep {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .alerts-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .alert-box-item {
          padding: 12px;
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
        }

        .alert-box-item.urgent {
          border-color: var(--status-pending-border);
          background: var(--status-pending-bg);
        }

        .alert-item-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .alert-item-msg {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .alert-item-time {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 6px;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .modal-title {
          font-size: 18px;
          font-weight: 700;
        }

        .close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 18px;
          cursor: pointer;
        }

        .modal-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 20px;
          line-height: 1.5;
        }

        .modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
        }

        .error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: var(--status-overrun-bg);
          border: 1px solid var(--status-overrun-border);
          border-radius: var(--radius-md);
          color: var(--status-overrun-text);
          font-size: 13px;
          margin-bottom: 16px;
        }
      `}</style>
    </div>
  );
}
