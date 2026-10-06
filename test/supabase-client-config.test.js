import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSupabaseUrl, isSupabaseConfigured } from '../src/lib/supabaseClient.js';

describe('Validação da URL do Supabase e Configuração do Cliente (Config Decision)', () => {
  const validKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_valid_publishable_key_1234567890';

  describe('1. Validação de Protocolo HTTPS (Produção e Desenvolvimento)', () => {
    test('aceita URL HTTPS legítima em produção', () => {
      assert.equal(isValidSupabaseUrl('https://meu-projeto.supabase.co', false), true);
    });

    test('aceita URL HTTPS legítima em desenvolvimento', () => {
      assert.equal(isValidSupabaseUrl('https://meu-projeto.supabase.co', true), true);
    });

    test('rejeita HTTPS com credenciais embutidas', () => {
      assert.equal(isValidSupabaseUrl('https://user:password@meu-projeto.supabase.co', true), false);
      assert.equal(isValidSupabaseUrl('https://user:password@meu-projeto.supabase.co', false), false);
    });
  });

  describe('2. Validação de Loopback HTTP (Exclusivo para DEV)', () => {
    test('aceita http://127.0.0.1:54321 em desenvolvimento', () => {
      assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321', true), true);
    });

    test('aceita http://localhost:54321 em desenvolvimento', () => {
      assert.equal(isValidSupabaseUrl('http://localhost:54321', true), true);
    });

    test('aceita IPv6 loopback http://[::1]:54321 em desenvolvimento', () => {
      assert.equal(isValidSupabaseUrl('http://[::1]:54321', true), true);
    });

    test('rejeita loopback HTTP em produção (127.0.0.1)', () => {
      assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321', false), false);
    });

    test('rejeita loopback HTTP em produção (localhost)', () => {
      assert.equal(isValidSupabaseUrl('http://localhost:54321', false), false);
    });

    test('rejeita loopback HTTP em produção (IPv6 [::1])', () => {
      assert.equal(isValidSupabaseUrl('http://[::1]:54321', false), false);
    });

    test('rejeita HTTP loopback com credenciais embutidas', () => {
      assert.equal(isValidSupabaseUrl('http://user:secret@127.0.0.1:54321', true), false);
      assert.equal(isValidSupabaseUrl('http://admin:1234@localhost:54321', true), false);
    });
  });

  describe('3. Rejeição Estrita de Hosts Falsos, IPs de Rede e Domínios Remotos via HTTP', () => {
    test('rejeita falso host localhost.evil.com', () => {
      assert.equal(isValidSupabaseUrl('http://localhost.evil.com:54321', true), false);
      assert.equal(isValidSupabaseUrl('http://localhost.evil.com:54321', false), false);
    });

    test('rejeita falso host 127.0.0.1.evil.com', () => {
      assert.equal(isValidSupabaseUrl('http://127.0.0.1.evil.com:54321', true), false);
      assert.equal(isValidSupabaseUrl('http://127.0.0.1.evil.com:54321', false), false);
    });

    test('rejeita falso host evil-localhost.com', () => {
      assert.equal(isValidSupabaseUrl('http://evil-localhost.com', true), false);
    });

    test('rejeita domínios remotos via HTTP', () => {
      assert.equal(isValidSupabaseUrl('http://meu-projeto.supabase.co', true), false);
      assert.equal(isValidSupabaseUrl('http://api.exemplo.com', true), false);
    });

    test('rejeita IPs de rede local privada (LAN)', () => {
      assert.equal(isValidSupabaseUrl('http://192.168.1.100:54321', true), false);
      assert.equal(isValidSupabaseUrl('http://10.0.0.1:54321', true), false);
      assert.equal(isValidSupabaseUrl('http://172.16.0.1:54321', true), false);
    });

    test('rejeita endereço de bind 0.0.0.0', () => {
      assert.equal(isValidSupabaseUrl('http://0.0.0.0:54321', true), false);
    });
  });

  describe('4. Tratamento de Entradas Malformadas ou Inválidas', () => {
    test('rejeita strings que não são URLs', () => {
      assert.equal(isValidSupabaseUrl('nao-e-uma-url', true), false);
      assert.equal(isValidSupabaseUrl('://invalido', true), false);
    });

    test('rejeita protocolos arbitrários (ftp, javascript, ws)', () => {
      assert.equal(isValidSupabaseUrl('ftp://localhost:54321', true), false);
      assert.equal(isValidSupabaseUrl('javascript:alert(1)', true), false);
      assert.equal(isValidSupabaseUrl('ws://localhost:54321', true), false);
    });

    test('rejeita valores vazios, nulos ou indefinidos', () => {
      assert.equal(isValidSupabaseUrl('', true), false);
      assert.equal(isValidSupabaseUrl('   ', true), false);
      assert.equal(isValidSupabaseUrl(null, true), false);
      assert.equal(isValidSupabaseUrl(undefined, true), false);
      assert.equal(isValidSupabaseUrl(12345, true), false);
    });
  });

  describe('5. Função isSupabaseConfigured (Integração com Validação de Chave Pública)', () => {
    test('retorna true com URL HTTPS e chave pública válida', () => {
      assert.equal(isSupabaseConfigured('https://projeto.supabase.co', validKey, false), true);
    });

    test('retorna true com URL HTTP de loopback em DEV e chave pública válida', () => {
      assert.equal(isSupabaseConfigured('http://127.0.0.1:54321', validKey, true), true);
      assert.equal(isSupabaseConfigured('http://localhost:54321', validKey, true), true);
    });

    test('retorna false com URL HTTP de loopback em PROD mesmo com chave válida', () => {
      assert.equal(isSupabaseConfigured('http://127.0.0.1:54321', validKey, false), false);
    });

    test('retorna false se a chave pública contiver placeholder "preencha"', () => {
      assert.equal(isSupabaseConfigured('https://projeto.supabase.co', 'preencha_com_sua_chave_aqui_123', true), false);
    });

    test('retorna false se a chave pública for curta (< 20 caracteres) ou ausente', () => {
      assert.equal(isSupabaseConfigured('https://projeto.supabase.co', 'chave_curta', true), false);
      assert.equal(isSupabaseConfigured('https://projeto.supabase.co', '', true), false);
      assert.equal(isSupabaseConfigured('https://projeto.supabase.co', null, true), false);
    });

    test('retorna false se a URL for inválida mesmo com chave pública válida', () => {
      assert.equal(isSupabaseConfigured('http://localhost.evil.com', validKey, true), false);
      assert.equal(isSupabaseConfigured('', validKey, true), false);
    });
  });
});
