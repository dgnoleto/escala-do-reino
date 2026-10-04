import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderSession } from '../tools/local-auth-test.js';

// Implementação leve e fiel do DOM para ambiente de teste em Node
function parseHtmlInto(html, parentNode, doc) {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [parentNode];

  const tokens = String(html).split(/(<[^>]+>)/g);
  for (const token of tokens) {
    if (!token) continue;
    const current = stack[stack.length - 1];

    if (token.startsWith('</')) {
      const closeTag = token.slice(2, -1).trim().split(/\s+/)[0].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === closeTag) {
          stack.splice(i, stack.length - i);
          break;
        }
      }
    } else if (token.startsWith('<')) {
      const isSelfClosing = token.endsWith('/>');
      const inner = token.slice(1, isSelfClosing ? -2 : -1).trim();
      const firstSpace = inner.search(/\s/);
      const tagName = (firstSpace === -1 ? inner : inner.slice(0, firstSpace)).toLowerCase();
      const el = doc.createElement(tagName);

      if (firstSpace !== -1) {
        const attrStr = inner.slice(firstSpace).trim();
        const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let match;
        while ((match = attrRegex.exec(attrStr)) !== null) {
          const name = match[1].toLowerCase();
          const val = match[2] ?? match[3] ?? match[4] ?? '';
          if (name === 'id') el.id = val;
          else if (name === 'class') el.className = val;
          el.setAttribute(name, val);
        }
      }

      current.appendChild(el);
      if (!isSelfClosing && !voidTags.has(tagName)) {
        stack.push(el);
      }
    } else {
      const decoded = token
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      current.appendChild(doc.createTextNode(decoded));
    }
  }
}

class MockTextNode {
  constructor(text = '') {
    this.nodeType = 3;
    this._text = String(text);
  }
  get textContent() { return this._text; }
  set textContent(val) { this._text = String(val); }
  get data() { return this._text; }
  set data(val) { this._text = String(val); }
}

class MockElement {
  constructor(tagName, doc) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.doc = doc;
    this._id = '';
    this.className = '';
    this.style = {};
    this.attributes = new Map();
    this.childNodes = [];
    this.eventListeners = new Map();
  }

  get id() {
    return this._id;
  }

  set id(val) {
    this._id = String(val);
    if (this.doc && this.doc._elements) {
      this.doc._elements.set(this._id, this);
    }
  }

  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      return child;
    }
    throw new Error('Node not found');
  }

  replaceChildren(...nodes) {
    this.childNodes = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes.set(name.toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.eventListeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  get classList() {
    return {
      add: (...classes) => {
        const current = new Set(this.className ? this.className.split(/\s+/) : []);
        for (const c of classes) current.add(c);
        this.className = [...current].join(' ');
      },
      remove: (...classes) => {
        const current = new Set(this.className ? this.className.split(/\s+/) : []);
        for (const c of classes) current.delete(c);
        this.className = [...current].join(' ');
      },
      contains: (c) => {
        const current = new Set(this.className ? this.className.split(/\s+/) : []);
        return current.has(c);
      },
    };
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(val) {
    this.childNodes = [new MockTextNode(val)];
  }

  get innerHTML() {
    return this.childNodes
      .map((node) => {
        if (node.nodeType === 3) {
          return node.textContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }
        if (node.nodeType === 1) {
          const tag = node.tagName.toLowerCase();
          let attrs = '';
          if (node.id) attrs += ` id="${node.id}"`;
          if (node.className) attrs += ` class="${node.className}"`;
          for (const [k, v] of node.attributes) {
            if (k !== 'id' && k !== 'class') attrs += ` ${k}="${v}"`;
          }
          return `<${tag}${attrs}>${node.innerHTML}</${tag}>`;
        }
        return '';
      })
      .join('');
  }

  set innerHTML(html) {
    this.childNodes = [];
    if (!html || !String(html).trim()) return;
    parseHtmlInto(String(html), this, this.doc);
  }

  querySelector(selector) {
    return querySelectorInternal(this, selector);
  }

  querySelectorAll(selector) {
    const results = [];
    querySelectorAllInternal(this, selector, results);
    return results;
  }
}

function matchesSelector(el, selector) {
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    return el.className && el.className.split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const attrExpr = selector.slice(1, -1);
    if (attrExpr.includes('=')) {
      const [name, rawVal] = attrExpr.split('=');
      const val = rawVal.replace(/^["']|["']$/g, '');
      return el.getAttribute(name.trim()) === val;
    }
    return el.hasAttribute(attrExpr.trim());
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

function querySelectorInternal(root, selector) {
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      if (matchesSelector(child, selector)) return child;
      const found = querySelectorInternal(child, selector);
      if (found) return found;
    }
  }
  return null;
}

function querySelectorAllInternal(root, selector, results) {
  for (const child of root.childNodes) {
    if (child.nodeType === 1) {
      if (matchesSelector(child, selector)) results.push(child);
      querySelectorAllInternal(child, selector, results);
    }
  }
}

function createTestDocument() {
  const elements = new Map();
  const doc = {
    _elements: elements,
    createElement: (tag) => new MockElement(tag, doc),
    createTextNode: (text) => new MockTextNode(text),
    getElementById: (id) => elements.get(id) || null,
    register: (el) => {
      if (el.id) elements.set(el.id, el);
      return el;
    },
  };
  return doc;
}

describe('Regressão de Renderização Segura de Sessão (tools/local-auth-test.js)', () => {
  let doc;
  let sessionBoxEl;
  let appLaunchAreaEl;

  before(() => {
    doc = createTestDocument();
    globalThis.document = doc;
    sessionBoxEl = doc.register(doc.createElement('div'));
    sessionBoxEl.id = 'session-box';
    appLaunchAreaEl = doc.register(doc.createElement('div'));
    appLaunchAreaEl.id = 'app-launch-area';
  });

  test('renderiza nome com marcação HTML como texto literal e impede injeção de elementos no DOM', () => {
    const untrustedName = '<span data-review="untrusted-name">João & Ana</span>';
    const testUser = {
      id: 'usr-safe-01',
      email: 'pastor.teste@example.com',
      created_at: '2026-10-04T12:00:00.000Z',
      user_metadata: { full_name: untrustedName },
    };

    renderSession(testUser, { sessionBoxEl, appLaunchAreaEl });

    // 1. Áreas de exibição ativas
    assert.equal(sessionBoxEl.style.display, 'block');
    assert.equal(appLaunchAreaEl.style.display, 'block');

    // 2. O elemento <span> com data-review NÃO deve existir no DOM
    assert.equal(
      sessionBoxEl.querySelector('[data-review="untrusted-name"]'),
      null,
      'Nenhum elemento com atributo da marcação deve ser criado no DOM'
    );
    assert.equal(
      sessionBoxEl.querySelectorAll('span').length,
      0,
      'A estrutura da ferramenta não deve conter elementos <span> introduzidos pelo nome'
    );

    // 3. O texto literal original deve estar íntegro em textContent
    assert.ok(
      sessionBoxEl.textContent.includes(untrustedName),
      'O nome com marcação deve ser preservado literalmente no textContent'
    );
    assert.ok(
      sessionBoxEl.textContent.includes('pastor.teste@example.com'),
      'O e-mail deve estar presente'
    );
    assert.ok(
      sessionBoxEl.textContent.includes('usr-safe-01'),
      'O ID do usuário deve estar presente'
    );

    // 4. A serialização innerHTML deve escapar os caracteres < > & e não conter a tag crua
    assert.ok(
      sessionBoxEl.innerHTML.includes('&lt;span data-review="untrusted-name"&gt;João &amp; Ana&lt;/span&gt;'),
      'innerHTML deve apresentar a marcação devidamente serializada como entidade'
    );
    assert.ok(
      !sessionBoxEl.innerHTML.includes('<span data-review='),
      'innerHTML não pode conter o elemento cru não-escapado'
    );
  });

  test('neutraliza vetores perigosos com handlers de evento (img onerror, svg onload, script)', () => {
    const xssPayload = '<img src="x" onerror="alert(1)"><svg onload="alert(2)"><script>alert(3)</script>';
    const testUser = {
      id: 'usr-safe-02',
      email: 'xss.teste@example.com',
      created_at: '2026-10-04T14:30:00.000Z',
      user_metadata: { full_name: xssPayload },
    };

    renderSession(testUser, { sessionBoxEl, appLaunchAreaEl });

    // Ausência total de tags perigosas e atributos de evento
    assert.equal(sessionBoxEl.querySelector('img'), null, 'Nenhuma tag <img> deve ser criada');
    assert.equal(sessionBoxEl.querySelector('svg'), null, 'Nenhuma tag <svg> deve ser criada');
    assert.equal(sessionBoxEl.querySelector('script'), null, 'Nenhuma tag <script> deve ser criada');
    assert.equal(sessionBoxEl.querySelector('[onerror]'), null, 'Nenhum atributo onerror deve existir');
    assert.equal(sessionBoxEl.querySelector('[onload]'), null, 'Nenhum atributo onload deve existir');

    // O texto literal deve estar preservado no textContent
    assert.ok(sessionBoxEl.textContent.includes(xssPayload));
    assert.ok(!sessionBoxEl.innerHTML.includes('<img src='));
  });

  test('preserva legitimamente acentos, apóstrofos, & e caracteres < > em nomes reais', () => {
    const legitName = "Pastor D'Ávila & Filhos <Líderes> — São José";
    const testUser = {
      id: 'usr-safe-03',
      email: 'davila@example.com',
      created_at: '2026-10-04T15:00:00.000Z',
      user_metadata: { full_name: legitName },
    };

    renderSession(testUser, { sessionBoxEl, appLaunchAreaEl });

    assert.ok(
      sessionBoxEl.textContent.includes(legitName),
      'Caracteres legítimos como acentos, apóstrofos e ampersands devem ser preservados'
    );
    assert.equal(
      sessionBoxEl.querySelector('lideres'),
      null,
      'O trecho <Líderes> não deve se tornar uma tag no DOM'
    );
  });

  test('trata adequadamente ausência de full_name com fallback amigável', () => {
    const testUser = {
      id: 'usr-safe-04',
      email: 'semnome@example.com',
      created_at: '2026-10-04T16:00:00.000Z',
      user_metadata: {},
    };

    renderSession(testUser, { sessionBoxEl, appLaunchAreaEl });

    assert.ok(sessionBoxEl.textContent.includes('(não informado)'));
  });

  test('limpa a caixa de sessão e oculta botões quando user é null (signOut)', () => {
    renderSession(null, { sessionBoxEl, appLaunchAreaEl });

    assert.equal(sessionBoxEl.style.display, 'none');
    assert.equal(sessionBoxEl.innerHTML, '');
    assert.equal(appLaunchAreaEl.style.display, 'none');
  });
});

describe('Integração de Transporte e Ciclo getSession -> renderSession (tools/local-auth-test.js)', () => {
  const cacheDir = path.resolve(process.cwd(), 'node_modules', '.cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const bundlePath = path.join(cacheDir, 'local-auth-test-bundled.mjs');

  before(async () => {
    // Transpila o módulo tools/local-auth-test.js substituindo apenas o cliente Supabase por transporte simulado
    await build({
      stdin: {
        contents: `export * from './tools/local-auth-test.js';`,
        resolveDir: process.cwd(),
        loader: 'js',
      },
      outfile: bundlePath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      define: {
        'import.meta.env': JSON.stringify({
          DEV: true,
          VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        }),
      },
      plugins: [{
        name: 'review-local-transport',
        setup(builder) {
          builder.onResolve({ filter: /supabaseClient\.js$/ }, () => ({ path: 'transport', namespace: 'review' }));
          builder.onLoad({ filter: /.*/, namespace: 'review' }, () => ({
            contents: `export const supabase = {
              auth: {
                getSession: async () => ({
                  data: {
                    session: {
                      user: globalThis.__reviewSessionUser,
                    },
                  },
                  error: null,
                }),
                signUp: async () => ({ data: {}, error: null }),
                signInWithPassword: async () => ({ data: {}, error: null }),
                signOut: async () => ({ error: null }),
              },
            };
            export const isSupabaseConfigured = () => true;`,
            loader: 'js',
          }));
        },
      }],
    });
  });

  test('inicialização automática via getSession renderiza sessão com segurança sem interpolação em innerHTML', async () => {
    const untrustedName = '<span data-review="untrusted-name">João & Ana</span>';
    globalThis.__reviewSessionUser = {
      id: 'usr-hydrated-01',
      email: 'hydrated@example.com',
      created_at: '2026-10-04T10:00:00.000Z',
      user_metadata: { full_name: untrustedName },
    };

    const doc = createTestDocument();
    const guardStatusEl = doc.register(doc.createElement('div'));
    guardStatusEl.id = 'guard-status';
    const authFormEl = doc.register(doc.createElement('form'));
    authFormEl.id = 'auth-form';
    const sessionBoxEl = doc.register(doc.createElement('div'));
    sessionBoxEl.id = 'session-box';
    const appLaunchAreaEl = doc.register(doc.createElement('div'));
    appLaunchAreaEl.id = 'app-launch-area';

    globalThis.document = doc;
    globalThis.window = {
      location: { href: 'http://127.0.0.1:3000/tools/local-auth-test.html' },
    };

    await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);

    // Aguarda o término da Promise de getSession() e renderSession()
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(sessionBoxEl.style.display, 'block');
    assert.equal(appLaunchAreaEl.style.display, 'block');
    assert.equal(sessionBoxEl.querySelector('[data-review="untrusted-name"]'), null);
    assert.equal(sessionBoxEl.querySelectorAll('span').length, 0);
    assert.ok(sessionBoxEl.textContent.includes(untrustedName));
    assert.ok(!sessionBoxEl.innerHTML.includes('<span data-review='));
    assert.ok(sessionBoxEl.innerHTML.includes('&lt;span data-review="untrusted-name"&gt;João &amp; Ana&lt;/span&gt;'));
  });
});
