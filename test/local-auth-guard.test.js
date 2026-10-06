import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLabGuards } from '../tools/local-auth-test.js';

describe('Guardas de Segurança da Ferramenta de Autenticação Local (Lab Guards)', () => {
  const validParams = {
    isDev: true,
    pageUrl: 'http://127.0.0.1:3000/tools/local-auth-test.html',
    supabaseUrl: 'http://127.0.0.1:54321',
    isConfigured: true,
  };

  test('aprova quando todos os requisitos estão satisfeitos (127.0.0.1)', () => {
    const result = evaluateLabGuards(validParams);
    assert.equal(result.allowed, true);
    assert.match(result.reason, /validadas com sucesso/i);
  });

  test('aprova com localhost na página e no backend', () => {
    const result = evaluateLabGuards({
      ...validParams,
      pageUrl: 'http://localhost:3000/tools/local-auth-test.html',
      supabaseUrl: 'http://localhost:54321',
    });
    assert.equal(result.allowed, true);
  });

  test('aprova com IPv6 loopback [::1] na página e no backend', () => {
    const result = evaluateLabGuards({
      ...validParams,
      pageUrl: 'http://[::1]:3000/tools/local-auth-test.html',
      supabaseUrl: 'http://[::1]:54321',
    });
    assert.equal(result.allowed, true);
  });

  test('rejeita quando isDev é false (produção)', () => {
    const result = evaluateLabGuards({
      ...validParams,
      isDev: false,
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /DEV é true/i);
  });

  test('rejeita se a página não estiver em loopback', () => {
    const falseHosts = [
      'http://192.168.0.10:3000/tools/local-auth-test.html',
      'http://meusite.com/tools/local-auth-test.html',
      'http://localhost.evil.com:3000/tools/local-auth-test.html',
      'http://127.0.0.1.evil.com:3000/tools/local-auth-test.html',
    ];

    for (const host of falseHosts) {
      const result = evaluateLabGuards({
        ...validParams,
        pageUrl: host,
      });
      assert.equal(result.allowed, false, `Deveria rejeitar host de página não loopback: ${host}`);
      assert.match(result.reason, /loopback/i);
    }
  });

  test('rejeita se o backend do Supabase não for na porta 54321', () => {
    const wrongPorts = ['http://127.0.0.1:3000', 'http://127.0.0.1:8000', 'http://127.0.0.1:54322', 'http://127.0.0.1'];
    for (const wrongUrl of wrongPorts) {
      const result = evaluateLabGuards({
        ...validParams,
        supabaseUrl: wrongUrl,
      });
      assert.equal(result.allowed, false, `Deveria rejeitar porta diferente de 54321: ${wrongUrl}`);
      assert.match(result.reason, /54321/i);
    }
  });

  test('rejeita se o backend for HTTPS (roteiro do laboratório exige HTTP loopback)', () => {
    const result = evaluateLabGuards({
      ...validParams,
      supabaseUrl: 'https://127.0.0.1:54321',
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /protocolo http:/i);
  });

  test('rejeita se o backend tiver credenciais embutidas', () => {
    const result = evaluateLabGuards({
      ...validParams,
      supabaseUrl: 'http://admin:secret@127.0.0.1:54321',
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /credenciais/i);
  });

  test('rejeita se o backend não for loopback', () => {
    const falseBackends = [
      'http://192.168.1.100:54321',
      'http://localhost.evil.com:54321',
      'http://127.0.0.1.evil.com:54321',
      'http://meu-supabase.com:54321',
    ];
    for (const backend of falseBackends) {
      const result = evaluateLabGuards({
        ...validParams,
        supabaseUrl: backend,
      });
      assert.equal(result.allowed, false, `Deveria rejeitar backend não loopback: ${backend}`);
      assert.match(result.reason, /loopback/i);
    }
  });

  test('rejeita se o cliente Supabase não estiver devidamente configurado', () => {
    const result = evaluateLabGuards({
      ...validParams,
      isConfigured: false,
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /não configurado/i);
  });
});
