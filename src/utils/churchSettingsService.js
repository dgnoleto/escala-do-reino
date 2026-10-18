export const CHURCH_LOGO_BUCKET = 'church-logos';
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function normalizeNfcText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim();
}

export function validateChurchSettings(input = {}) {
  const errors = {};
  let cleanName = null;
  if (input.name !== undefined) {
    cleanName = normalizeNfcText(input.name || '');
    if (!cleanName) {
      errors.name = 'Nome da igreja é obrigatório.';
    } else if (cleanName.length > 160) {
      errors.name = 'Nome da igreja deve ter entre 1 e 160 caracteres.';
    }
  }

  const address = (input.address || '').trim();
  const googleMapsUrl = (input.googleMapsUrl || '').trim();
  if (address.length > 500) errors.address = 'O endereço deve ter até 500 caracteres.';
  if (googleMapsUrl) {
    try {
      const url = new URL(googleMapsUrl);
      const google = /^(?:(?:www|maps)\.)?google\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/i.test(url.hostname);
      const valid = (google && (url.hostname.startsWith('maps.') || /^\/maps(?:\/|$)/.test(url.pathname)))
        || (url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1)
        || (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'));
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !valid || googleMapsUrl.length > 1024) throw new Error();
    } catch {
      errors.googleMapsUrl = 'Informe um link HTTPS válido do Google Maps, com até 1.024 caracteres.';
    }
  }
  return {
    errors,
    data: {
      ...(cleanName !== null ? { name: cleanName } : {}),
      address: address || null,
      googleMapsUrl: googleMapsUrl || null,
    },
  };
}

export function validateChurchLogo(file) {
  if (!file || !LOGO_TYPES[file.type]) return 'Escolha uma imagem PNG, JPEG ou WebP.';
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_LOGO_BYTES) return 'A imagem deve ter até 2 MB e não pode estar vazia.';
  return null;
}

export function churchLogoPath(churchId, file) {
  return `${churchId}/${crypto.randomUUID()}.${LOGO_TYPES[file.type]}`;
}

export function settingsStorageKey(userId, churchId) {
  return `church_settings_cmd_${userId}_${churchId}`;
}

export function readPendingSettings(storage, userId, churchId) {
  const value = storage.getItem(settingsStorageKey(userId, churchId));
  if (!value) return null;
  const command = JSON.parse(value);
  if (command.userId !== userId || command.churchId !== churchId || !command.commandId || !command.params
      || command.params.p_church_id !== churchId || command.params.p_command_id !== command.commandId) {
    throw new Error('Comando de outra conta ou igreja. Não é possível continuar.');
  }
  return command;
}

export function settingsErrorMessage(error) {
  if (error?.code === '42501' || error?.code === '28000') return 'Você não tem mais permissão administrativa nesta igreja.';
  if (error?.code === '40001') return 'Outra pessoa atualizou o cadastro. Recarregue os dados antes de editar novamente.';
  if (error?.code === 'PGRST202' || error?.code === '42883') return 'A edição do cadastro ainda não foi habilitada neste ambiente.';
  if (error?.code === '22004' || error?.code === '23514' || error?.code === '22023') {
    if (error?.message?.includes('Nome da igreja')) return 'Nome da igreja deve ter entre 1 e 160 caracteres.';
    return 'Confira o nome, o endereço, o link do Google Maps e a imagem selecionada.';
  }
  return 'Não foi possível confirmar o salvamento. Verifique o resultado antes de fazer outra alteração.';
}

// Falhas de leitura não podem reutilizar a mensagem de salvamento: nada foi enviado ao servidor.
export function settingsLoadErrorMessage(error, isOnline = true) {
  if (error?.code === 'PGRST202' || error?.code === '42883') return 'A edição do cadastro ainda não foi habilitada neste ambiente.';
  if (!isOnline || /fetch|network|timeout/i.test(error?.message || '')) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
  }
  return 'Não foi possível carregar os dados da igreja. Tente novamente em instantes.';
}

export function isDefinitiveSettingsError(error) {
  return ['42501', '28000', '40001', 'PGRST202', '42883', '23505', '22023', '23514', 'P0002'].includes(error?.code);
}
