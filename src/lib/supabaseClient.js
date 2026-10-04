import { createClient } from '@supabase/supabase-js';

const supabaseUrl = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.VITE_SUPABASE_URL
  : undefined;
const supabaseKey = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  : undefined;

/**
 * Valida a URL do Supabase conforme o ambiente:
 * - Em produção: exige protocolo HTTPS estrito e hostname não vazio.
 * - Em desenvolvimento (import.meta.env.DEV = true): aceita HTTPS ou HTTP
 *   exclusivamente para hostnames de loopback exatos (localhost, 127.0.0.1 ou ::1).
 * - Rejeita credenciais embutidas, URLs malformadas e qualquer outro protocolo.
 *
 * @param {string} url - URL do backend Supabase
 * @param {boolean} [isDev] - Flag de desenvolvimento (padrão: import.meta.env.DEV)
 * @returns {boolean}
 */
export function isValidSupabaseUrl(
  url,
  isDev = (typeof import.meta !== 'undefined' && import.meta.env ? Boolean(import.meta.env.DEV) : false)
) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url);

    // Rejeita credenciais embutidas na URL (ex: http://user:pass@127.0.0.1:54321)
    if (parsed.username || parsed.password) {
      return false;
    }

    // HTTPS: permitido tanto em desenvolvimento quanto em produção
    if (parsed.protocol === 'https:') {
      return Boolean(parsed.hostname);
    }

    // HTTP: estritamente restrito ao modo de desenvolvimento e a loopback
    if (parsed.protocol === 'http:') {
      if (!isDev) return false;

      // Normaliza hostname IPv6 removendo colchetes (ex: '[::1]' -> '::1')
      const normalizedHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

      // Aceita exclusivamente localhost, 127.0.0.1 ou ::1
      const isLoopback = normalizedHost === 'localhost' ||
                         normalizedHost === '127.0.0.1' ||
                         normalizedHost === '::1';

      return isLoopback;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Retorna true somente se a URL e a chave pública estão configuradas corretamente
 * e não contêm valores de placeholder do .env.example.
 *
 * @param {string} [url] - URL a validar (padrão: VITE_SUPABASE_URL)
 * @param {string} [key] - Chave pública a validar (padrão: VITE_SUPABASE_PUBLISHABLE_KEY)
 * @param {boolean} [isDev] - Flag de desenvolvimento
 * @returns {boolean}
 */
export function isSupabaseConfigured(
  url = supabaseUrl,
  key = supabaseKey,
  isDev = (typeof import.meta !== 'undefined' && import.meta.env ? Boolean(import.meta.env.DEV) : false)
) {
  return (
    isValidSupabaseUrl(url, isDev) &&
    typeof key === 'string' &&
    key.length > 20 &&
    !key.includes('preencha')
  );
}

/**
 * Cliente Supabase centralizado.
 * Exportado apenas quando a configuração está completa;
 * caso contrário, permanece null para evitar erros de inicialização.
 */
export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        // Persiste a sessão no localStorage (padrão)
        persistSession: true,
        // Detecta o código/token no fragmento da URL após o redirect do Google
        detectSessionInUrl: true,
      },
    })
  : null;
