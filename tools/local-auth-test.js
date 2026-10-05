import { supabase, isSupabaseConfigured } from '../src/lib/supabaseClient.js';

/**
 * Avalia as guardas estritas de segurança para a ferramenta de autenticação local:
 * 1. Ambiente DEV ativo (import.meta.env.DEV === true).
 * 2. Origem da página em loopback (localhost, 127.0.0.1 ou ::1).
 * 3. URL do backend Supabase em HTTP loopback na porta 54321, sem credenciais embutidas.
 * 4. Cliente Supabase devidamente configurado com chave pública válida.
 *
 * @param {Object} params
 * @param {boolean} params.isDev - Flag indicando modo DEV
 * @param {string} params.pageUrl - URL completa da página no navegador
 * @param {string} params.supabaseUrl - URL configurada do Supabase (VITE_SUPABASE_URL)
 * @param {boolean} params.isConfigured - Se o cliente Supabase está configurado
 * @returns {{ allowed: boolean, reason: string }}
 */
export function evaluateLabGuards({ isDev, pageUrl, supabaseUrl, isConfigured }) {
  // 1. Modo de desenvolvimento estrito
  if (!isDev) {
    return {
      allowed: false,
      reason: 'Guarda violada: esta ferramenta opera exclusivamente quando import.meta.env.DEV é true.',
    };
  }

  // 2. Página em loopback
  if (!pageUrl || typeof pageUrl !== 'string') {
    return {
      allowed: false,
      reason: 'Guarda violada: URL da página não informada ou inválida.',
    };
  }

  try {
    const pageParsed = new URL(pageUrl);
    const pageHost = pageParsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isPageLoopback = pageHost === 'localhost' || pageHost === '127.0.0.1' || pageHost === '::1';
    if (!isPageLoopback) {
      return {
        allowed: false,
        reason: `Guarda violada: a ferramenta deve ser acessada via loopback (localhost, 127.0.0.1 ou ::1). Host atual: ${pageParsed.hostname}`,
      };
    }
  } catch {
    return {
      allowed: false,
      reason: 'Guarda violada: falha ao analisar a URL da página.',
    };
  }

  // 3. Backend Supabase em HTTP loopback na porta 54321
  if (!supabaseUrl || typeof supabaseUrl !== 'string') {
    return {
      allowed: false,
      reason: 'Guarda violada: VITE_SUPABASE_URL não configurada no ambiente.',
    };
  }

  try {
    const backendParsed = new URL(supabaseUrl);

    if (backendParsed.username || backendParsed.password) {
      return {
        allowed: false,
        reason: 'Guarda violada: a URL do Supabase contém credenciais embutidas proibidas.',
      };
    }

    if (backendParsed.protocol !== 'http:') {
      return {
        allowed: false,
        reason: `Guarda violada: o backend de laboratório local deve usar o protocolo http:. Protocolo atual: ${backendParsed.protocol}`,
      };
    }

    if (backendParsed.port !== '54321') {
      return {
        allowed: false,
        reason: `Guarda violada: a porta do Supabase local deve ser estritamente 54321. Porta atual: ${backendParsed.port || '80'}`,
      };
    }

    const backendHost = backendParsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isBackendLoopback = backendHost === 'localhost' || backendHost === '127.0.0.1' || backendHost === '::1';
    if (!isBackendLoopback) {
      return {
        allowed: false,
        reason: `Guarda violada: o backend do Supabase deve ser loopback (localhost, 127.0.0.1 ou ::1). Host atual: ${backendParsed.hostname}`,
      };
    }
  } catch {
    return {
      allowed: false,
      reason: 'Guarda violada: URL do Supabase inválida.',
    };
  }

  // 4. Configuração completa com chave pública válida
  if (!isConfigured) {
    return {
      allowed: false,
      reason: 'Guarda violada: cliente Supabase não configurado ou chave publicável inválida/ausente.',
    };
  }

  return {
    allowed: true,
    reason: 'Guardas de segurança validadas com sucesso.',
  };
}

/**
 * Renderiza as informações da sessão ativa com segurança no DOM.
 * Constrói elementos e nós de texto literais preenchidos com textContent / createTextNode,
 * garantindo que metadados controlados pelo usuário (como full_name, email, id e datas)
 * nunca sejam interpolados em sinks HTML e não introduzam tags, elementos ou scripts.
 *
 * @param {Object|null} user - Objeto de usuário retornado pelo Supabase Auth
 * @param {Object} [elements] - Elementos de destino opcionais (para injeção ou testes isolados)
 * @param {HTMLElement|null} [elements.sessionBoxEl]
 * @param {HTMLElement|null} [elements.appLaunchAreaEl]
 */
export function renderSession(user, elements = {}) {
  const sessionBoxEl = elements?.sessionBoxEl || (typeof document !== 'undefined' ? document.getElementById('session-box') : null);
  const appLaunchAreaEl = elements?.appLaunchAreaEl || (typeof document !== 'undefined' ? document.getElementById('app-launch-area') : null);

  if (!sessionBoxEl || !appLaunchAreaEl) return;
  if (!user) {
    sessionBoxEl.style.display = 'none';
    sessionBoxEl.innerHTML = '';
    appLaunchAreaEl.style.display = 'none';
    return;
  }

  const safeName = user.user_metadata?.full_name ? String(user.user_metadata.full_name) : '(não informado)';
  const safeEmail = String(user.email || '');
  const safeId = String(user.id || '');
  const createdAt = user.created_at ? new Date(user.created_at).toLocaleString('pt-BR') : '-';

  sessionBoxEl.style.display = 'block';
  sessionBoxEl.innerHTML = '';

  const titleEl = document.createElement('div');
  titleEl.style.fontWeight = '600';
  titleEl.style.marginBottom = '8px';
  titleEl.style.color = 'var(--success-text)';
  titleEl.textContent = '✓ Sessão Supabase Auth Ativa';
  sessionBoxEl.appendChild(titleEl);

  function createFieldRow(label, textValue, isCode = false) {
    const row = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `${label}:`;
    row.appendChild(strong);
    row.appendChild(document.createTextNode(' '));

    if (isCode) {
      const code = document.createElement('code');
      code.style.fontSize = '0.75rem';
      code.textContent = textValue;
      row.appendChild(code);
    } else {
      const textNode = document.createTextNode(textValue);
      textNode.textContent = textValue;
      row.appendChild(textNode);
    }
    return row;
  }

  sessionBoxEl.appendChild(createFieldRow('E-mail', safeEmail));
  sessionBoxEl.appendChild(createFieldRow('Nome', safeName));
  sessionBoxEl.appendChild(createFieldRow('ID do Usuário', safeId, true));
  sessionBoxEl.appendChild(createFieldRow('Criado em', createdAt));

  const noteEl = document.createElement('div');
  noteEl.style.marginTop = '8px';
  noteEl.style.fontSize = '0.75rem';
  noteEl.style.color = 'var(--text-muted)';
  noteEl.innerHTML = `
    Esta sessão é real e compartilhada pelo <code>localStorage</code> da mesma origem com a aplicação.
    Esta ferramenta autentica sua conta de teste. Ela não cria igrejas nem concede administração; essas operações ocorrem pelo fluxo do aplicativo.
  `;
  sessionBoxEl.appendChild(noteEl);

  appLaunchAreaEl.style.display = 'block';
}

/**
 * Inicialização em ambiente de navegador (Vite dev)
 */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isDev = typeof import.meta !== 'undefined' && import.meta.env ? Boolean(import.meta.env.DEV) : false;
  const pageUrl = window.location.href;
  const supabaseUrl = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : undefined;
  const configured = isSupabaseConfigured();

  const guardResult = evaluateLabGuards({
    isDev,
    pageUrl,
    supabaseUrl,
    isConfigured: configured,
  });

  const guardStatusEl = document.getElementById('guard-status');
  const authFormEl = document.getElementById('auth-form');
  const sessionBoxEl = document.getElementById('session-box');
  const appLaunchAreaEl = document.getElementById('app-launch-area');

  const inputEmail = document.getElementById('input-email');
  const inputPassword = document.getElementById('input-password');
  const inputName = document.getElementById('input-name');

  const btnSignup = document.getElementById('btn-signup');
  const btnSignin = document.getElementById('btn-signin');
  const btnSignout = document.getElementById('btn-signout');
  const btnLaunchApp = document.getElementById('btn-launch-app');

  function renderStatusNotice(message, type = 'info') {
    if (!guardStatusEl) return;
    guardStatusEl.className = 'notice';
    if (type === 'error') guardStatusEl.classList.add('notice--error');
    else if (type === 'success') guardStatusEl.classList.add('notice--success');
    else if (type === 'warning') guardStatusEl.classList.add('notice--warning');
    guardStatusEl.textContent = message;
  }

  // Executa guards antes de expor formulário ou chamar qualquer método Auth
  if (!guardResult.allowed) {
    renderStatusNotice(guardResult.reason, 'error');
    if (authFormEl) authFormEl.style.display = 'none';
  } else {
    renderStatusNotice(
      'Ambiente verificado: Vite dev ativo, página e backend em loopback (porta 54321). Pronto para autenticação manual.',
      'success'
    );
    if (authFormEl) authFormEl.style.display = 'block';

    // Inspeciona sessão existente em localStorage sem nenhuma chamada automática de cadastro/login
    if (supabase) {
      supabase.auth.getSession().then(({ data, error }) => {
        if (!error && data?.session?.user) {
          renderSession(data.session.user);
        }
      }).catch(() => {
        // Silencioso em caso de falha de leitura local
      });
    }

    // Ação: Cadastrar nova conta (signUp)
    btnSignup?.addEventListener('click', async () => {
      const email = inputEmail?.value?.trim() || '';
      const password = inputPassword?.value || '';
      const fullName = inputName?.value?.trim() || '';

      if (!email.toLowerCase().endsWith('@example.com')) {
        renderStatusNotice('Erro de validação: utilize estritamente um endereço com domínio @example.com.', 'error');
        return;
      }

      if (!password) {
        renderStatusNotice('Erro de validação: informe a senha para o cadastro.', 'error');
        return;
      }

      renderStatusNotice('Enviando cadastro para a API Supabase Auth local...', 'info');
      btnSignup.disabled = true;
      btnSignin.disabled = true;

      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: fullName ? { full_name: fullName } : undefined,
          },
        });

        // Limpa a senha do campo de formulário imediatamente após a chamada
        if (inputPassword) inputPassword.value = '';

        if (error) {
          renderStatusNotice(`Falha no cadastro: ${error.message}`, 'error');
          return;
        }

        if (data?.session?.user) {
          renderStatusNotice('Cadastro e login realizados com sucesso!', 'success');
          renderSession(data.session.user);
        } else if (data?.user) {
          renderStatusNotice(
            `Conta criada com sucesso (ID: ${data.user.id}). A confirmação de e-mail está pendente. Verifique o Mailpit em http://127.0.0.1:54324 para confirmar antes de entrar.`,
            'warning'
          );
        } else {
          renderStatusNotice('Resposta inesperada da API de cadastro.', 'warning');
        }
      } catch (err) {
        if (inputPassword) inputPassword.value = '';
        renderStatusNotice(`Erro inesperado durante cadastro: ${err?.message || 'erro de rede'}`, 'error');
      } finally {
        btnSignup.disabled = false;
        btnSignin.disabled = false;
      }
    });

    // Ação: Entrar com conta existente (signInWithPassword)
    authFormEl?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = inputEmail?.value?.trim() || '';
      const password = inputPassword?.value || '';

      if (!email.toLowerCase().endsWith('@example.com')) {
        renderStatusNotice('Erro de validação: utilize estritamente um endereço com domínio @example.com.', 'error');
        return;
      }

      if (!password) {
        renderStatusNotice('Erro de validação: informe a senha para autenticação.', 'error');
        return;
      }

      renderStatusNotice('Autenticando contra a API Supabase Auth local...', 'info');
      btnSignup.disabled = true;
      btnSignin.disabled = true;

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        // Limpa a senha do formulário imediatamente após o envio
        if (inputPassword) inputPassword.value = '';

        if (error) {
          renderStatusNotice(`Falha na autenticação: ${error.message}`, 'error');
          return;
        }

        if (data?.session?.user) {
          renderStatusNotice('Autenticação concluída com sucesso!', 'success');
          renderSession(data.session.user);
        } else {
          renderStatusNotice('Sessão não retornada pela API.', 'warning');
        }
      } catch (err) {
        if (inputPassword) inputPassword.value = '';
        renderStatusNotice(`Erro inesperado durante autenticação: ${err?.message || 'erro de rede'}`, 'error');
      } finally {
        btnSignup.disabled = false;
        btnSignin.disabled = false;
      }
    });

    // Ação: Sair (signOut)
    btnSignout?.addEventListener('click', async () => {
      renderStatusNotice('Encerrando sessão...', 'info');
      try {
        await supabase.auth.signOut();
        renderSession(null);
        renderStatusNotice('Sessão encerrada com sucesso.', 'info');
      } catch (err) {
        renderStatusNotice(`Falha ao encerrar sessão: ${err?.message || 'erro de rede'}`, 'error');
      }
    });

    // Ação: Abrir Aplicação
    btnLaunchApp?.addEventListener('click', () => {
      window.location.href = '/';
    });
  }
}
