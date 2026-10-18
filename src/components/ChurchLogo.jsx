import React, { useEffect, useState } from 'react';
import { Church } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { CHURCH_LOGO_BUCKET } from '../utils/churchSettingsService';

// Identidade visual é consultável por membros; o cadastro completo continua exclusivo de admin.
export default function ChurchLogo({ churchId, userId, sessionId }) {
  const [image, setImage] = useState(null);
  const context = `${userId}:${sessionId}:${churchId}`;
  useEffect(() => {
    let active = true;
    setImage(null);
    async function load() {
      try {
        const { data, error } = await supabase.schema('public').rpc('get_church_logo', { p_church_id: churchId });
        const path = data?.[0]?.logo_path;
        if (!active || error || !path?.startsWith(`${churchId}/`)) return;
        const { data: signed, error: signedError } = await supabase.storage.from(CHURCH_LOGO_BUCKET).createSignedUrl(path, 300);
        if (active && !signedError && signed?.signedUrl) setImage({ context, url: signed.signedUrl });
      } catch { /* Ambientes anteriores ao incremento 017 mantêm o ícone padrão. */ }
    }
    if (churchId && userId) load();
    return () => { active = false; };
  }, [churchId, userId, sessionId]);
  if (image?.context === context) return <img src={image.url} alt="" onError={() => setImage(null)} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }} />;
  return <Church size={26} />;
}
