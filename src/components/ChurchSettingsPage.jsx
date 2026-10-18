import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Church, Save, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import {
  CHURCH_LOGO_BUCKET, validateChurchSettings, validateChurchLogo, churchLogoPath,
  settingsStorageKey, readPendingSettings, settingsErrorMessage, isDefinitiveSettingsError,
} from '../utils/churchSettingsService';

export default function ChurchSettingsPage({ onBack }) {
  const { session, sessionId, churchAccess, getAuthSnapshot } = useAuth();
  const userId = session?.user?.id;
  const churchId = churchAccess?.church_id;
  const allowed = Boolean(userId && churchId && churchAccess?.is_admin);
  const context = `${userId}:${sessionId}:${churchId}:${allowed}`;
  const liveContext = useRef(context);
  liveContext.current = context;
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const [profile, setProfile] = useState(null);
  const [address, setAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(true);
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

  function handleError(err) {
    setError(settingsErrorMessage(err));
    if (err?.code === '40001') setNeedsReload(true);
    if (['42501', '28000'].includes(err?.code)) {
      setForbidden(true);
      setProfile(null);
      setLogoUrl(null);
      setLogoFile(null);
    }
  }

  async function loadProfile() {
    if (!isCurrent()) return;
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const { data, error: rpcError } = await supabase.schema('public').rpc('get_church_settings', { p_church_id: churchId });
      if (!isCurrent()) return;
      if (rpcError) throw rpcError;
      const row = data?.[0];
      if (!row || row.church_id !== churchId || !Number.isSafeInteger(row.profile_revision)) throw new Error('Invalid profile');
      setProfile(row);
      setNeedsReload(false);
      setAddress(row.address || '');
      setMapsUrl(row.google_maps_url || '');
      setLogoFile(null);
      setRemoveLogo(false);
      setLogoUrl(null);
      if (row.logo_path) {
        const { data: signed, error: signedError } = await supabase.storage.from(CHURCH_LOGO_BUCKET).createSignedUrl(row.logo_path, 300);
        if (!isCurrent()) return;
        if (signedError) setError('Não foi possível carregar a logo. Você pode tentar recarregar os dados.');
        else setLogoUrl(signed?.signedUrl || null);
      }
    } catch (err) {
      if (isCurrent()) handleError(err);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (allowed) {
      try {
        setPending(readPendingSettings(window.sessionStorage, userId, churchId));
      } catch {
        setStorageError(true);
        setError('Não foi possível recuperar o salvamento pendente desta aba. A edição está bloqueada para evitar duplicação.');
      }
      loadProfile();
    } else setLoading(false);
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
    if (!logoFile) return;
    const objectUrl = URL.createObjectURL(logoFile);
    setLogoUrl(objectUrl);
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
    await loadProfile();
    if (isCurrent()) setSuccess(true);
  }

  async function save(event) {
    event.preventDefault();
    if (busyRef.current || !isCurrent() || !online || !profile || pending || storageError || needsReload) return;
    const { errors, data } = validateChurchSettings({ address, googleMapsUrl: mapsUrl });
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
        p_address: data.address, p_google_maps_url: data.googleMapsUrl, p_logo_path: logoPath || null,
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
    <main className="church-settings-page"><div className="card church-settings-card">
      <p role="alert">O cadastro da igreja é exclusivo de administradores ativos desta igreja.</p>
      <button className="btn btn-secondary" onClick={onBack}>Voltar</button>
    </div></main>
  );
  const disabled = busy || loading || Boolean(pending) || !online || storageError || needsReload;
  return (
    <main className="church-settings-page">
      <div className="card church-settings-card">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={busy}><ArrowLeft size={16} /> Voltar</button>
        <h1><Church size={24} /> Dados da Igreja</h1>
        <p>Atualize o endereço, a localização e a logo da sua igreja.</p>
        {!online && <p role="status">Sem conexão. Aguarde a reconexão para salvar.</p>}
        {error && <p role="alert">{error}</p>}
        {success && <p role="status">Alterações salvas com sucesso.</p>}
        {storageError && <p role="alert">O armazenamento desta aba está indisponível ou contém um comando inválido. A edição está bloqueada.</p>}
        {pending && <div className="church-settings-pending" role="status">
          <p>Existe um salvamento ainda não confirmado. Verifique o resultado antes de editar novamente.</p>
          <button type="button" className="btn btn-primary" onClick={retry} disabled={busy || !online}><RefreshCw size={16} /> Verificar salvamento</button>
        </div>}
        {loading ? <p role="status">Carregando cadastro…</p> : profile && <form onSubmit={save}>
          <p><strong>Igreja:</strong> {profile.name}</p>
          <p><strong>Fuso horário:</strong> {profile.timezone}</p>
          <fieldset disabled={disabled}>
            <label htmlFor="church-settings-address">Endereço da igreja</label>
            <textarea id="church-settings-address" className="form-input" value={address} maxLength={500} rows={3} onChange={(e) => { setAddress(e.target.value); setSuccess(false); }} />
            <label htmlFor="church-settings-maps">Link do Google Maps</label>
            <input id="church-settings-maps" className="form-input" type="url" value={mapsUrl} maxLength={1024} placeholder="https://maps.app.goo.gl/..." onChange={(e) => { setMapsUrl(e.target.value); setSuccess(false); }} />
            <label htmlFor="church-settings-logo">Logo da igreja</label>
            <input id="church-settings-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const message = validateChurchLogo(file);
              if (message) { setError(message); e.target.value = ''; return; }
              setLogoFile(file); setRemoveLogo(false); setError(null); setSuccess(false);
            }} />
            <small>PNG, JPEG ou WebP, até 2 MB.</small>
            {!removeLogo && logoUrl && <img className="church-settings-logo-preview" src={logoUrl} alt="Prévia da logo da igreja" />}
            {(logoFile || profile.logo_path) && <button type="button" className="btn btn-secondary" onClick={() => { setLogoFile(null); setRemoveLogo(true); setLogoUrl(null); setSuccess(false); }}>Remover logo</button>}
            <button type="submit" className="btn btn-primary"><Save size={16} /> {busy ? 'Salvando…' : 'Salvar alterações'}</button>
          </fieldset>
        </form>}
        {!loading && !pending && !storageError && <button type="button" className="btn btn-secondary" onClick={loadProfile} disabled={busy || !online}><RefreshCw size={16} /> Recarregar dados</button>}
      </div>
    </main>
  );
}
