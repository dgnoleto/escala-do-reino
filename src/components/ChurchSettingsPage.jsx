import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Church, Save, RefreshCw, AlertCircle, CheckCircle2, WifiOff, Shield, Trash2, Info,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  CHURCH_LOGO_BUCKET, validateChurchSettings, validateChurchLogo, churchLogoPath,
  settingsStorageKey, readPendingSettings, settingsErrorMessage, settingsLoadErrorMessage, isDefinitiveSettingsError,
} from '../utils/churchSettingsService';

/**
 * Esqueleto com a mesma estrutura do formulário final, para que a página não "salte"
 * quando os dados chegam. Não exibe campos vazios que possam ser confundidos com dados reais.
 */
function SettingsSkeleton() {
  return (
    <div className="church-settings-form" role="status" aria-live="polite">
      <span className="church-settings-sr-only">Carregando dados da igreja…</span>
      <div className="church-settings-identity" aria-hidden="true">
        <div className="church-settings-identity-item">
          <span className="church-settings-skeleton church-settings-skeleton--dt" />
          <span className="church-settings-skeleton church-settings-skeleton--dd" />
        </div>
      </div>
      <div className="church-settings-fieldset" aria-hidden="true">
        <div className="form-group">
          <span className="church-settings-skeleton church-settings-skeleton--label" />
          <span className="church-settings-skeleton church-settings-skeleton--input" />
          <span className="church-settings-skeleton church-settings-skeleton--hint" />
        </div>
        <div className="form-group">
          <span className="church-settings-skeleton church-settings-skeleton--label" />
          <span className="church-settings-skeleton church-settings-skeleton--textarea" />
          <span className="church-settings-skeleton church-settings-skeleton--hint" />
        </div>
        <div className="form-group">
          <span className="church-settings-skeleton church-settings-skeleton--label" />
          <span className="church-settings-skeleton church-settings-skeleton--input" />
          <span className="church-settings-skeleton church-settings-skeleton--hint" />
        </div>
        <div className="form-group">
          <span className="church-settings-skeleton church-settings-skeleton--label" />
          <div className="church-settings-logo-field">
            <span className="church-settings-skeleton church-settings-skeleton--logo" />
            <div className="church-settings-logo-controls">
              <span className="church-settings-skeleton church-settings-skeleton--file" />
              <span className="church-settings-skeleton church-settings-skeleton--hint" />
            </div>
          </div>
        </div>
        <div className="church-settings-actions">
          <span className="church-settings-skeleton church-settings-skeleton--button" />
        </div>
      </div>
    </div>
  );
}

export default function ChurchSettingsPage(props) {
  const auth = useAuth();
  const key = `${auth.session?.user?.id}:${auth.sessionId}:${auth.churchAccess?.church_id}:${Boolean(auth.churchAccess?.is_admin)}`;
  // Uma troca de contexto descarta também formulário, erros e comandos em memória.
  return <ChurchSettingsForm key={key} {...props} auth={auth} />;
}

function ChurchSettingsForm({ onBack, auth }) {
  const { session, sessionId, churchAccess, getAuthSnapshot, reloadChurchAccess } = auth;
  const userId = session?.user?.id;
  const churchId = churchAccess?.church_id;
  const churchName = churchAccess?.church_name || '';
  const allowed = Boolean(userId && churchId && churchAccess?.is_admin);
  const context = `${userId}:${sessionId}:${churchId}:${allowed}`;
  const liveContext = useRef(context);
  liveContext.current = context;
  const mounted = useRef(false);
  const busyRef = useRef(false);
  // Cada leitura recebe um número; somente a mais recente pode alterar a tela.
  const loadSeq = useRef(0);
  // Leitura inicial em voo, reaproveitada quando o efeito é reexecutado no mesmo contexto
  // (StrictMode em desenvolvimento), evitando consultas duplicadas.
  const initialRequest = useRef(null);
  const [profile, setProfile] = useState(null);
  // 'loading' | 'ready' | 'error' | 'not_found' | 'idle'
  const [loadState, setLoadState] = useState(allowed ? 'loading' : 'idle');
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [localPreview, setLocalPreview] = useState(null);
  // A prévia da logo salva é carregada à parte e não bloqueia a edição dos demais campos.
  const [storedLogo, setStoredLogo] = useState({ status: 'none', url: null });
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [success, setSuccess] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);

  function isCurrent() {
    if (!mounted.current || liveContext.current !== context || !allowed) return false;
    const snapshot = getAuthSnapshot();
    return snapshot.userId === userId && snapshot.sessionId === sessionId
      && snapshot.churchId === churchId && snapshot.churchAccess?.is_admin === true;
  }

  function isCurrentLoad(seq) {
    return isCurrent() && loadSeq.current === seq;
  }

  function handleError(err) {
    setError(settingsErrorMessage(err));
    if (err?.code === '40001') setNeedsReload(true);
    if (['42501', '28000'].includes(err?.code)) {
      setForbidden(true);
      setProfile(null);
      setStoredLogo({ status: 'none', url: null });
      setLogoFile(null);
    }
  }

  function requestSettings() {
    // Promise real: o builder do Supabase é apenas "thenable".
    return Promise.resolve().then(() => supabase.schema('public').rpc('get_church_settings', { p_church_id: churchId }));
  }

  function requestInitialSettings() {
    if (initialRequest.current?.context === context) return initialRequest.current.promise;
    const entry = { context, promise: requestSettings() };
    initialRequest.current = entry;
    const clear = () => { if (initialRequest.current === entry) initialRequest.current = null; };
    entry.promise.then(clear, clear);
    return entry.promise;
  }

  async function loadStoredLogo(logoPath, seq) {
    if (!logoPath) { setStoredLogo({ status: 'none', url: null }); return; }
    setStoredLogo({ status: 'loading', url: null });
    try {
      const { data, error: signedError } = await supabase.storage.from(CHURCH_LOGO_BUCKET).createSignedUrl(logoPath, 300);
      if (!isCurrentLoad(seq)) return;
      setStoredLogo(signedError || !data?.signedUrl ? { status: 'error', url: null } : { status: 'ready', url: data.signedUrl });
    } catch {
      if (isCurrentLoad(seq)) setStoredLogo({ status: 'error', url: null });
    }
  }

  async function loadProfile({ initial = false } = {}) {
    if (!isCurrent()) return;
    const seq = ++loadSeq.current;
    // Com dados já confirmados, a recarga mantém o formulário visível (bloqueado) em vez de trocá-lo pelo esqueleto.
    const keepVisible = !initial && Boolean(profile);
    setLoadError(null);
    setSuccess(false);
    if (keepVisible) setRefreshing(true);
    else setLoadState('loading');
    try {
      const { data, error: rpcError } = await (initial ? requestInitialSettings() : requestSettings());
      if (!isCurrentLoad(seq)) return;
      if (rpcError) throw rpcError;
      if (!Array.isArray(data) || data.length > 1) throw new Error('Invalid profile');
      const row = data[0];
      if (data.length === 0) {
        setProfile(null);
        setLoadState('not_found');
        return;
      }
      if (row.church_id !== churchId || !Number.isSafeInteger(row.profile_revision) || row.profile_revision < 0
        || typeof row.name !== 'string' || typeof row.timezone !== 'string'
        || !['address', 'google_maps_url', 'logo_path'].every((field) => row[field] === null || typeof row[field] === 'string')) {
        throw new Error('Invalid profile');
      }
      setProfile(row);
      setNeedsReload(false);
      setName(row.name || '');
      setAddress(row.address || '');
      setMapsUrl(row.google_maps_url || '');
      setLogoFile(null);
      setRemoveLogo(false);
      setLoadState('ready');
      setError(null);
      loadStoredLogo(row.logo_path, seq);
      return true;
    } catch (err) {
      if (!isCurrentLoad(seq)) return;
      if (['42501', '28000'].includes(err?.code)) { handleError(err); return; }
      // Falha de leitura: os valores anteriores (se houver) permanecem, mas a edição fica bloqueada até nova leitura.
      setLoadError(settingsLoadErrorMessage(err, online));
      setLoadState('error');
    } finally {
      if (isCurrentLoad(seq)) setRefreshing(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (allowed) {
      // Contexto novo: nada da sessão/igreja anterior permanece visível durante a consulta.
      setProfile(null);
      setLoadState('loading');
      setLoadError(null);
      setRefreshing(false);
      setName('');
      setAddress('');
      setMapsUrl('');
      setLogoFile(null);
      setRemoveLogo(false);
      setStoredLogo({ status: 'none', url: null });
      try {
        setPending(readPendingSettings(window.sessionStorage, userId, churchId));
      } catch {
        setStorageError(true);
        setError('Não foi possível recuperar o salvamento pendente desta aba. A edição está bloqueada para evitar duplicação.');
      }
      loadProfile({ initial: true });
    } else setLoadState('idle');
    const updateOnline = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      mounted.current = false;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [context]);

  // Apenas a prévia local usa object URLs; os arquivos persistidos ficam em bucket privado.
  useEffect(() => {
    if (!logoFile) { setLocalPreview(null); return undefined; }
    const objectUrl = URL.createObjectURL(logoFile);
    setLocalPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logoFile]);

  function clearCommand(command) {
    const storage = window.sessionStorage;
    const stored = readPendingSettings(storage, userId, churchId);
    if (stored?.commandId === command.commandId) storage.removeItem(settingsStorageKey(userId, churchId));
    setPending(null);
  }

  async function sendCommand(command) {
    const { data, error: rpcError } = await supabase.schema('public').rpc('update_church_settings', command.params);
    if (!isCurrent()) return;
    if (rpcError) {
      if (isDefinitiveSettingsError(rpcError)) clearCommand(command);
      handleError(rpcError);
      return;
    }
    // O servidor devolve o recibo original mesmo em replay; não presumir êxito com resposta incompleta.
    const row = data?.[0];
    if (row?.church_id !== churchId || row?.command_id !== command.commandId || row?.profile_revision !== command.params.p_expected_revision + 1) {
      throw new Error('Unconfirmed command');
    }
    clearCommand(command);
    const reloaded = await loadProfile();
    if (isCurrent() && reloaded) {
      setSuccess(true);
      // CA03: Atualiza o contexto da aplicação para que o cabeçalho e demais telas reflitam o novo nome imediatamente.
      if (typeof reloadChurchAccess === 'function') {
        try {
          await reloadChurchAccess(churchId, { isBackground: true });
        } catch (err) {
          console.warn('[ChurchSettingsPage] Falha ao recarregar contexto:', err);
        }
      }
    }
  }

  async function save(event) {
    event.preventDefault();
    if (busyRef.current || !isCurrent() || !online || !profile || loadState !== 'ready' || refreshing
      || pending || storageError || needsReload) return;
    const { errors, data } = validateChurchSettings({ name, address, googleMapsUrl: mapsUrl });
    if (Object.keys(errors).length) { setError(Object.values(errors).join(' ')); return; }
    if (logoFile && validateChurchLogo(logoFile)) { setError(validateChurchLogo(logoFile)); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      // Exigir armazenamento utilizável antes de iniciar envio de arquivo ou comando.
      const storage = window.sessionStorage;
      const existing = readPendingSettings(storage, userId, churchId);
      if (existing) { setPending(existing); return; }
      const key = settingsStorageKey(userId, churchId);
      storage.setItem(`${key}_probe`, '1');
      storage.removeItem(`${key}_probe`);
      let logoPath = removeLogo ? null : profile.logo_path;
      if (logoFile) {
        logoPath = churchLogoPath(churchId, logoFile);
        const { error: uploadError } = await supabase.storage.from(CHURCH_LOGO_BUCKET).upload(logoPath, logoFile, {
          contentType: logoFile.type, upsert: false,
        });
        if (!isCurrent()) return;
        if (uploadError) {
          setError('Não foi possível enviar a imagem. Nenhuma alteração no cadastro foi salva.');
          return;
        }
      }
      if (!isCurrent()) return;
      const commandId = crypto.randomUUID();
      const command = { userId, churchId, commandId, params: {
        p_church_id: churchId, p_command_id: commandId, p_expected_revision: profile.profile_revision,
        p_name: data.name, p_address: data.address, p_google_maps_url: data.googleMapsUrl, p_logo_path: logoPath || null,
      } };
      storage.setItem(key, JSON.stringify(command));
      setPending(command);
      await sendCommand(command);
    } catch {
      if (isCurrent()) setError('Não foi possível confirmar o salvamento. Se houver uma alteração pendente, use “Verificar salvamento”.');
    } finally {
      busyRef.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  async function retry() {
    if (!pending || busyRef.current || !isCurrent() || !online) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try { await sendCommand(pending); }
    catch { if (isCurrent()) setError(settingsErrorMessage()); }
    finally { busyRef.current = false; if (isCurrent()) setBusy(false); }
  }

  if (!allowed || forbidden) return (
    <main className="church-settings-page">
      <div className="church-settings-denied">
        <div className="church-settings-denied-icon" aria-hidden="true"><Shield size={44} /></div>
        <h1>Acesso Restrito</h1>
        <p role="alert">O cadastro da igreja é exclusivo de administradores ativos desta igreja.</p>
        <button type="button" className="btn btn-secondary" onClick={onBack} aria-label="Voltar para a página inicial">
          <ArrowLeft size={16} /> Voltar ao Início
        </button>
      </div>
    </main>
  );

  const hasProfile = Boolean(profile);
  const formLocked = busy || loadState !== 'ready' || refreshing || Boolean(pending) || !online || storageError || needsReload;
  const canReload = hasProfile && !pending && !storageError;
  const displayedLogo = removeLogo ? null : (localPreview || storedLogo.url);
  const logoPreviewLoading = !removeLogo && !logoFile && storedLogo.status === 'loading';
  const isEmptyProfile = hasProfile && !profile.address && !profile.google_maps_url && !profile.logo_path;

  return (
    <main className="church-settings-page">
      <div className="church-settings-container">

        {/* Barra superior: mesmo padrão de Membros e Ministérios & Equipes */}
        <header className="church-settings-header">
          <button
            id="btn-church-settings-back"
            type="button"
            className="church-settings-back"
            onClick={onBack}
            disabled={busy}
            aria-label="Voltar para a página inicial"
          >
            <ArrowLeft size={18} />
            <span>Início</span>
          </button>
          <div className="church-settings-title-box">
            {churchName && (
              <div className="church-settings-church-badge" title={`Igreja: ${churchName}`}>
                <Church size={14} />
                <span>{churchName}</span>
              </div>
            )}
            <h1 className="church-settings-title">Dados da Igreja</h1>
          </div>
          <span className="church-settings-header-spacer" aria-hidden="true" />
        </header>

        {!online && (
          <div className="church-settings-alert church-settings-alert--warning" role="status">
            <WifiOff size={16} />
            <span>Sem conexão. Aguarde a reconexão para salvar.</span>
          </div>
        )}

        {storageError && (
          <div className="church-settings-alert church-settings-alert--uncertain" role="alert">
            <AlertCircle size={16} />
            <span>O armazenamento desta aba está indisponível ou contém um comando inválido. A edição está bloqueada.</span>
          </div>
        )}

        {pending && (
          <div className="church-settings-alert church-settings-alert--uncertain" role="status">
            <AlertCircle size={18} />
            <div className="church-settings-alert-content">
              <strong>Salvamento ainda não confirmado</strong>
              <p>Existe um salvamento ainda não confirmado. Verifique o resultado antes de editar novamente.</p>
              <div className="church-settings-alert-actions">
                <button type="button" id="btn-church-settings-verify" className="btn btn-primary btn-sm" onClick={retry} disabled={busy || !online}>
                  <RefreshCw size={14} className={busy ? 'church-settings-spin' : ''} /> Verificar salvamento
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="church-settings-alert church-settings-alert--error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {hasProfile && loadState === 'error' && (
          <div className="church-settings-alert church-settings-alert--error" role="alert">
            <AlertCircle size={16} />
            <div className="church-settings-alert-content church-settings-alert-content--row">
              <span>{loadError} A edição fica bloqueada até que os dados atuais sejam confirmados.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadProfile()} disabled={refreshing || !online}>
                <RefreshCw size={13} /> Tentar novamente
              </button>
            </div>
          </div>
        )}

        {success && (
          <div className="church-settings-alert church-settings-alert--success" role="status">
            <CheckCircle2 size={16} />
            <span>Alterações salvas com sucesso.</span>
          </div>
        )}

        <section
          className="church-settings-card"
          aria-labelledby="church-settings-section-title"
          aria-busy={loadState === 'loading' || refreshing}
        >
          <div className="church-settings-card-header">
            <div>
              <h2 id="church-settings-section-title" className="church-settings-section-title">Cadastro da igreja</h2>
              <p className="church-settings-section-subtitle">Atualize o nome, o endereço, a localização e a logo da sua igreja.</p>
            </div>
            {canReload && (
              <button
                type="button"
                id="btn-church-settings-reload"
                className="btn btn-secondary church-settings-refresh"
                onClick={() => loadProfile()}
                disabled={busy || refreshing || !online}
                title="Recarregar dados salvos"
              >
                <RefreshCw size={14} className={refreshing ? 'church-settings-spin' : ''} />
                <span>Recarregar dados</span>
              </button>
            )}
          </div>

          {!hasProfile && loadState === 'loading' && <SettingsSkeleton />}

          {!hasProfile && loadState === 'error' && (
            <div className="church-settings-state church-settings-state--error" role="alert">
              <AlertCircle size={36} />
              <h3>Não foi possível carregar os dados da igreja</h3>
              <p>{loadError}</p>
              <p className="church-settings-state-note">Nenhuma informação foi alterada.</p>
              <div className="church-settings-state-actions">
                <button type="button" id="btn-church-settings-retry" className="btn btn-secondary" onClick={() => loadProfile()} disabled={!online}>
                  <RefreshCw size={15} /> Tentar novamente
                </button>
              </div>
            </div>
          )}

          {!hasProfile && loadState === 'not_found' && (
            <div className="church-settings-state" role="status">
              <Church size={36} />
              <h3>Cadastro da igreja não encontrado</h3>
              <p>Não localizamos o cadastro desta igreja para edição. Nenhuma informação foi alterada.</p>
              <div className="church-settings-state-actions">
                <button type="button" className="btn btn-secondary" onClick={() => loadProfile()} disabled={!online}>
                  <RefreshCw size={15} /> Tentar novamente
                </button>
              </div>
            </div>
          )}

          {hasProfile && (
            <form className="church-settings-form" onSubmit={save}>
              <dl className="church-settings-identity">
                <div className="church-settings-identity-item">
                  <dt>Fuso horário</dt>
                  <dd>{profile.timezone}</dd>
                </div>
              </dl>

              {isEmptyProfile && (
                <div className="church-settings-alert church-settings-alert--info" role="note">
                  <Info size={16} />
                  <span>Esta igreja ainda não possui endereço, link do Google Maps ou logo cadastrados. Preencha o que desejar e salve.</span>
                </div>
              )}

              <fieldset className="church-settings-fieldset" disabled={formLocked}>
                <legend className="church-settings-sr-only">Dados editáveis da igreja</legend>

                <div className="form-group">
                  <label htmlFor="church-settings-name" className="form-label">Nome da igreja</label>
                  <input
                    id="church-settings-name"
                    className="form-input"
                    type="text"
                    value={name}
                    maxLength={160}
                    required
                    placeholder="Nome da igreja"
                    onChange={(e) => { setName(e.target.value); setSuccess(false); }}
                  />
                  <div className="church-settings-hint">
                    <span>Obrigatório</span>
                    <span>{name.length}/160 caracteres</span>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="church-settings-address" className="form-label">Endereço da igreja</label>
                  <textarea
                    id="church-settings-address"
                    className="form-input form-textarea church-settings-textarea"
                    value={address}
                    maxLength={500}
                    rows={3}
                    placeholder="Rua, número, bairro, cidade – UF"
                    onChange={(e) => { setAddress(e.target.value); setSuccess(false); }}
                  />
                  <div className="church-settings-hint">
                    <span>Opcional</span>
                    <span>{address.length}/500 caracteres</span>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="church-settings-maps" className="form-label">Link do Google Maps</label>
                  <input
                    id="church-settings-maps"
                    className="form-input"
                    type="url"
                    value={mapsUrl}
                    maxLength={1024}
                    placeholder="https://maps.app.goo.gl/..."
                    onChange={(e) => { setMapsUrl(e.target.value); setSuccess(false); }}
                  />
                  <div className="church-settings-hint">
                    <span>Opcional. Use o link de compartilhamento do Google Maps (HTTPS).</span>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="church-settings-logo" className="form-label">Logo da igreja</label>
                  <div className="church-settings-logo-field">
                    <div className="church-settings-logo-preview">
                      {displayedLogo ? (
                        <img
                          src={displayedLogo}
                          alt="Prévia da logo da igreja"
                          onError={() => { if (!localPreview) setStoredLogo({ status: 'error', url: null }); }}
                        />
                      ) : logoPreviewLoading ? (
                        <span className="church-settings-skeleton church-settings-skeleton--fill" role="status" aria-label="Carregando logo" />
                      ) : (
                        <Church size={32} aria-hidden="true" />
                      )}
                    </div>
                    <div className="church-settings-logo-controls">
                      <input
                        id="church-settings-logo"
                        className="church-settings-file"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const message = validateChurchLogo(file);
                          if (message) { setError(message); e.target.value = ''; return; }
                          setLogoFile(file); setRemoveLogo(false); setError(null); setSuccess(false);
                        }}
                      />
                      <span className="church-settings-hint">PNG, JPEG ou WebP, até 2 MB.</span>
                      {storedLogo.status === 'error' && !logoFile && !removeLogo && (
                        <span className="church-settings-inline-error">
                          Não foi possível exibir a logo atual; ela continua salva.{' '}
                          <button type="button" className="church-settings-link-btn" onClick={() => loadStoredLogo(profile.logo_path, loadSeq.current)}>
                            Tentar novamente
                          </button>
                        </span>
                      )}
                      {removeLogo && !logoFile && profile.logo_path && (
                        <span className="church-settings-hint">A logo atual será removida ao salvar.</span>
                      )}
                      {(logoFile || (profile.logo_path && !removeLogo)) && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setLogoFile(null); setRemoveLogo(true); setSuccess(false); }}
                        >
                          <Trash2 size={14} /> Remover logo
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="church-settings-actions">
                  <button type="submit" id="btn-church-settings-save" className="btn btn-primary">
                    {busy ? <RefreshCw size={16} className="church-settings-spin" /> : <Save size={16} />}
                    {busy ? 'Salvando…' : 'Salvar alterações'}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
