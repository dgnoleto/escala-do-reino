import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Retorna true somente se ambas as variáveis de ambiente estão definidas
 * e não são os valores de placeholder do .env.example.
 */
export function isSupabaseConfigured() {
  return (
    typeof supabaseUrl === 'string' &&
    supabaseUrl.startsWith('https://') &&
    typeof supabaseKey === 'string' &&
    supabaseKey.length > 20 &&
    !supabaseKey.includes('preencha')
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
