import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import {
  fetchServiceTemplatesRemote,
  getServiceTemplateRemote,
  updateServiceTemplateRemote,
  createServiceTemplateRemote,
  normalizeNfcText
} from '../src/utils/serviceTemplateService.js';

// Prepara bundle com componentes React reais e AppContext
const cacheDir = path.resolve('node_modules/.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const bundlePath = path.join(cacheDir, 'codex-third-review.bundle.mjs');

await build({
  stdin: {
    contents: `
      export { AppProvider, useApp } from './src/context/AppContext.jsx';
      export { default as AdminView } from './src/components/AdminView.jsx';
      export { default as PlanningView } from './src/components/PlanningView.jsx';
    `,
    resolveDir: process.cwd(),
    loader: 'jsx',
  },
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom', 'lucide-react'],
});

const { AppProvider, useApp, AdminView } = await import(
  pathToFileURL(bundlePath).href
);

// Mock básico de ambiente DOM para Node.js
if (!globalThis.document) {
  globalThis.document = {
    documentElement: {
      setAttribute: () => {},
      getAttribute: () => null,
    },
    getElementById: () => null,
  };
}

const TEST_CHURCH_ID = '01700000-0000-4000-8000-000000000001';

describe('Suíte de Testes da Terceira Revisão do Codex (Frentes A e B)', () => {

  // ==========================================================================
  // Frente A1: ReferenceError ao salvar descrição (AdminView -> AppContext -> service)
  // ==========================================================================
  test('A1: AdminView -> AppContext salva modelo com descrição preenchida sem ReferenceError', async () => {
    let contextRef;
    function TestConsumer() {
      contextRef = useApp();
      return null;
    }

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          { initialUserId: 'marcos' },
          React.createElement(TestConsumer),
          React.createElement(AdminView)
        )
      );
    });

    const root = renderer.root;

    // 1. Alterna para a aba de templates
    const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
    assert.ok(templatesTabBtn, 'Aba de modelos deve existir');
    await act(async () => {
      templatesTabBtn.props.onClick();
    });

    // 2. Localiza o primeiro modelo da lista e clica em editar
    const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
    assert.ok(editBtn, 'Botão de editar modelo deve existir');
    await act(async () => {
      editBtn.props.onClick();
    });

    // 3. Edita o campo de descrição com texto não-vazio contendo acentuação
    const descInput = root.findByProps({ id: 'template-desc-input' });
    assert.ok(descInput, 'Campo de descrição deve estar presente no formulário de edição');

    const newDescriptionText = 'Culto com celebração litúrgica, comunhão e ordenança pastoral.';
    await act(async () => {
      descInput.props.onChange({ target: { value: newDescriptionText } });
    });

    // 4. Submete o formulário via botão real #btn-save-template
    const saveBtn = root.findByProps({ id: 'btn-save-template' });
    assert.ok(saveBtn, 'Botão de salvar modelo deve existir');

    let submitError = null;
    try {
      await act(async () => {
        const form = root.findByType('form');
        await form.props.onSubmit({ preventDefault: () => {} });
      });
    } catch (err) {
      submitError = err;
    }

    assert.equal(submitError, null, 'Submissão não deve disparar exceção ReferenceError: normalizeNfcText');

    // 5. Verifica se a descrição foi salva no contexto com normalização correta
    const updated = contextRef.serviceTemplates[0];
    assert.equal(updated.description, normalizeNfcText(newDescriptionText));
  });

  // ==========================================================================
  // Frente A2: Proteção de integridade contra formulário antigo após reconciliação
  // ==========================================================================
  test('A2: Reconciliação remota com novo serviço bloqueia formulário antigo e impede remoção do 2º serviço', async () => {
    let contextRef;
    function TestConsumer() {
      contextRef = useApp();
      return null;
    }

    // Inicializa o contexto com um modelo que possui 1 serviço paralelo
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AppProvider,
          { initialUserId: 'marcos' },
          React.createElement(TestConsumer),
          React.createElement(AdminView)
        )
      );
    });

    const root = renderer.root;

    // Configura modelo inicial com 1 serviço
    const targetTemplateId = contextRef.serviceTemplates[0].id;
    await act(async () => {
      contextRef.updateServiceTemplate(targetTemplateId, {
        name: 'Culto Básico',
        parallelServices: [
          { teamId: 'limpeza', serviceName: 'Limpeza do Templo', prepRequiredMinutes: 60, isDefaultActive: true }
        ]
      });
    });

    // Alterna para a aba de templates
    const templatesTabBtn = root.findByProps({ id: 'tab-admin-templates' });
    assert.ok(templatesTabBtn, 'Aba de modelos deve existir');
    await act(async () => {
      templatesTabBtn.props.onClick();
    });

    // Abre o formulário de edição na interface
    await act(async () => {
      const editBtn = root.findByProps({ id: 'btn-edit-template-0' });
      editBtn.props.onClick();
    });

    // Simula falha remota / desconexão enquanto o formulário está aberto
    await act(async () => {
      contextRef.setIsDataStale(true);
    });

    // Outra sessão adiciona um 2º serviço paralelo no servidor e reconcilia
    await act(async () => {
      // Reconciliação: os dados remotos chegam com 2 serviços
      contextRef.setIsDataStale(false);
      // Atualiza o store simulando retorno reconciliado do servidor
      const oldTpl = contextRef.serviceTemplates.find(t => t.id === targetTemplateId);
      contextRef.updateServiceTemplate(targetTemplateId, {
        name: oldTpl.name,
        parallelServices: [
          { teamId: 'limpeza', serviceName: 'Limpeza do Templo', prepRequiredMinutes: 60, isDefaultActive: true },
          { teamId: 'portaria', serviceName: 'Portaria & Estacionamento', prepRequiredMinutes: 30, isDefaultActive: true }
        ]
      }, { syncUpdate: true });
    });

    // Confirma que agora o store possui 2 serviços
    const storeTemplateBeforeSave = contextRef.serviceTemplates.find(t => t.id === targetTemplateId);
    assert.equal(storeTemplateBeforeSave.parallelServices.length, 2, 'Servidor/store possui 2 serviços');

    // 1. Verifica que na interface o aviso de desatualização de formulário está visível
    const outdatedWarning = root.findAllByProps({ id: 'template-outdated-warning' });
    assert.equal(outdatedWarning.length, 1, 'Banner de formulário desatualizado deve ser exibido');

    // 2. Verifica que o botão de salvar está desabilitado
    const saveBtn = root.findByProps({ id: 'btn-save-template' });
    assert.equal(saveBtn.props.disabled, true, 'Botão de salvar deve estar desabilitado para formulário desatualizado');

    // 3. Tentar submeter o formulário antigo via contexto é bloqueado e NÃO remove o 2º serviço
    const stalePayload = {
      name: 'Culto Básico Tentativa Antiga',
      parallelServices: [
        { teamId: 'limpeza', serviceName: 'Limpeza do Templo', prepRequiredMinutes: 60, isDefaultActive: true }
      ]
    };

    let result;
    await act(async () => {
      result = await contextRef.updateServiceTemplate(targetTemplateId, stalePayload, {
        originParallelServicesCount: 1 // contagem de quando o form foi aberto
      });
    });

    assert.equal(result.success, false, 'Mutação com dados desatualizados deve ser rejeitada');
    assert.equal(result.conflict, true, 'Deve sinalizar conflito de versão');

    // 4. Garante que o 2º serviço NÃO foi apagado
    const storeTemplateAfterAttempt = contextRef.serviceTemplates.find(t => t.id === targetTemplateId);
    assert.equal(storeTemplateAfterAttempt.parallelServices.length, 2, 'O 2º serviço não pode ter sido removido');

    // 5. Clica no botão de recarregar dados do servidor no formulário
    const reloadBtn = root.findByProps({ id: 'btn-reload-template-from-server' });
    assert.ok(reloadBtn, 'Botão de carregar dados atuais deve estar disponível');
    await act(async () => {
      reloadBtn.props.onClick();
    });

    // 6. Após recarga explícita, o banner desaparece
    const outdatedWarningAfterReload = root.findAllByProps({ id: 'template-outdated-warning' });
    assert.equal(outdatedWarningAfterReload.length, 0, 'Banner deve sumir após recarga explícita');
  });

  // ==========================================================================
  // Frente A3: Estado de desatualização inconsistente
  // ==========================================================================
  test('A3.1: Criação de modelo é bloqueada pelo contexto quando isDataStale ou isTemplatesStale é true', () => {
    let contextRef;
    function TestConsumer() {
      contextRef = useApp();
      return null;
    }

    TestRenderer.create(
      React.createElement(
        AppProvider,
        { initialUserId: 'marcos' },
        React.createElement(TestConsumer)
      )
    );

    // Ativa sinal de desatualização
    act(() => {
      contextRef.setIsDataStale(true);
    });

    const res = contextRef.addServiceTemplate({
      name: 'Culto Proibido em Estado Stale',
      activities: []
    });

    assert.equal(res.success, false, 'addServiceTemplate deve ser bloqueado quando isDataStale é true');
    assert.match(res.error, /desatualizados/i);
  });

  test('A3.2: Sucesso na consulta de modelos NÃO libera isDataStale se outra consulta falhou', async () => {
    let contextRef;
    function TestConsumer() {
      contextRef = useApp();
      return null;
    }

    // Mock onde modelos respondem com sucesso, mas tipos de evento falham com erro 500
    const mixedClient = {
      rpc: async (fn) => {
        if (fn === 'list_service_templates') {
          return { data: [], error: null };
        }
        if (fn === 'list_event_types' || fn === 'list_church_event_types') {
          return { data: null, error: { message: 'Falha no servidor', code: '500' } };
        }
        if (fn === 'list_standard_activities') {
          return { data: [], error: null };
        }
        if (fn === 'list_cancellation_reasons') {
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
      schema: () => mixedClient
    };

    await act(async () => {
      TestRenderer.create(
        React.createElement(
          AppProvider,
          {
            initialUserId: 'marcos',
            churchId: TEST_CHURCH_ID,
            supabaseClient: mixedClient
          },
          React.createElement(TestConsumer)
        )
      );
    });

    // Reexecuta reloadRemoteData
    await act(async () => {
      await contextRef.reloadRemoteData();
    });

    // isTemplatesStale deve ser false, mas isEventTypesStale é true e isDataStale DEVE permanecer true!
    assert.equal(contextRef.isTemplatesStale, false, 'Domínio de modelos teve sucesso');
    assert.equal(contextRef.isEventTypesStale, true, 'Domínio de tipos de evento falhou');
    assert.equal(contextRef.isDataStale, true, 'isDataStale global DEVE permanecer true se qualquer domínio falhar');
  });

  // ==========================================================================
  // Frente A4: Resposta inválida da listagem remota ({ data: null, error: null })
  // ==========================================================================
  test('A4: fetchServiceTemplatesRemote rejeita { data: null, error: null } como erro e não como lista vazia', async () => {
    const brokenClient = {
      rpc: async (fn) => {
        if (fn === 'list_service_templates') {
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }
    };

    const res = await fetchServiceTemplatesRemote(brokenClient, TEST_CHURCH_ID);

    assert.equal(res.success, false, 'data: null deve retornar success: false');
    assert.match(res.error, /estruturalmente inválida/i);
    assert.deepEqual(res.data, [], 'Em caso de erro retorna array vazio');
  });

  // ==========================================================================
  // Frente B1: Preservação exata do contrato SQL 022 na migration 024
  // ==========================================================================
  test('B1: 024_service_template_instantiation_security.sql preserva integralmente o contrato do SQL 022', () => {
    const sql022 = fs.readFileSync(path.resolve('docs/sql/022_service_templates.sql'), 'utf-8');
    const sql024 = fs.readFileSync(path.resolve('docs/sql/024_service_template_instantiation_security.sql'), 'utf-8');

    // 1. Assinatura idêntica
    assert.ok(sql024.includes('create or replace function public.instantiate_service_template('));
    assert.ok(sql024.includes('p_command_id uuid,'));
    assert.ok(sql024.includes('p_church_id uuid,'));
    assert.ok(sql024.includes('p_template_id uuid'));
    assert.ok(sql024.includes('returns jsonb'));

    // 2. Chave parallelServices em camelCase e NÃO snake_case
    assert.ok(sql024.includes("'parallelServices', v_parallel_services"), 'Deve usar parallelServices em camelCase');
    assert.ok(!sql024.includes("'parallel_services', v_parallel_services"), 'NÃO pode usar parallel_services');

    // 3. Filtro de apoios ativos is_default_active = true
    assert.ok(sql024.includes('where stps.template_id = p_template_id and stps.is_default_active = true;'));

    // 4. Campos completos das atividades do SQL 022
    assert.ok(sql024.includes("'musics', '[]'::jsonb"));
    assert.ok(sql024.includes("'responsibleMemberId', null"));
    assert.ok(sql024.includes("'responsibleTeamId', null"));
    assert.ok(sql024.includes("'roster', '[]'::jsonb"));

    // 5. Campos completos dos serviços paralelos do SQL 022
    assert.ok(sql024.includes("'name', stps.service_name"));
    assert.ok(sql024.includes("'teamId', stps.team_id"));
    assert.ok(sql024.includes("'prepRequiredMinutes', stps.prep_required_minutes"));

    // 6. Única adição: verificação estrita de autorização
    assert.ok(sql024.includes('app_private.has_church_settings_access(p_church_id, false)'));

    // 7. Ownership postgres e privilégios revogados de anon/service_role/public
    assert.ok(sql024.includes('alter function public.instantiate_service_template(uuid, uuid, uuid) owner to postgres;'));
    assert.ok(sql024.includes('revoke all on function public.instantiate_service_template(uuid, uuid, uuid) from public, anon, service_role;'));
    assert.ok(sql024.includes('grant execute on function public.instantiate_service_template(uuid, uuid, uuid) to authenticated;'));
  });

  // ==========================================================================
  // Frente B2: Rollback fiel restaurando a definição base anterior à 024
  // ==========================================================================
  test('B2: 024_rollback.sql restaura fielmente o SQL 022 e documenta reabertura da falha', () => {
    const sqlRollback = fs.readFileSync(path.resolve('docs/sql/024_rollback.sql'), 'utf-8');

    // 1. Contém documentação expressa do risco de reabertura da falha de autorização
    assert.ok(sqlRollback.includes('reabre a vulnerabilidade de autorização'), 'Deve documentar o risco de segurança');
    assert.ok(sqlRollback.includes('cross-church leakage'), 'Deve mencionar cross-church leakage');

    // 2. Restaura o contrato SQL 022 sem has_church_settings_access
    assert.ok(!sqlRollback.includes('has_church_settings_access'), 'Rollback não deve conter a checagem que está sendo revertida');
    assert.ok(sqlRollback.includes("'parallelServices', v_parallel_services"), 'Deve restaurar parallelServices camelCase');
    assert.ok(sqlRollback.includes('where stps.template_id = p_template_id and stps.is_default_active = true;'));
    assert.ok(sqlRollback.includes("'musics', '[]'::jsonb"));

    // 3. Restaura owner postgres e permissões
    assert.ok(sqlRollback.includes('alter function public.instantiate_service_template(uuid, uuid, uuid) owner to postgres;'));
    assert.ok(sqlRollback.includes('grant execute on function public.instantiate_service_template(uuid, uuid, uuid) to authenticated;'));
  });

  // ==========================================================================
  // Frente B3: Preflight e Verify robustos
  // ==========================================================================
  test('B3: 024_preflight.sql e 024_verify.sql implementam verificações de segurança e bloqueio transacional', () => {
    const preflightSql = fs.readFileSync(path.resolve('docs/sql/024_preflight.sql'), 'utf-8');
    const verifySql = fs.readFileSync(path.resolve('docs/sql/024_verify.sql'), 'utf-8');

    // Preflight
    assert.ok(preflightSql.includes("set_config('lock_timeout', '2s'"), 'Preflight deve configurar lock_timeout 2s');
    assert.ok(preflightSql.includes('public.instantiate_service_template(uuid, uuid, uuid)'), 'Preflight confere assinatura exata');
    assert.ok(preflightSql.includes('app_private.has_church_settings_access'), 'Preflight confere helper de autorização');
    assert.ok(preflightSql.includes('parallelServices'), 'Preflight confere definição-base');

    // Verify
    assert.ok(verifySql.includes('proc_exists'), 'Verify checa existência da RPC');
    assert.ok(verifySql.includes('rpc_hardened'), 'Verify checa SECURITY DEFINER e timeouts');
    assert.ok(verifySql.includes('access_check_verified'), 'Verify checa autorização');
    assert.ok(verifySql.includes('contract_preserved'), 'Verify checa preservação contratual');
    assert.ok(verifySql.includes('privileges_verified'), 'Verify checa privilégios');
    assert.ok(verifySql.includes('Usuário anônimo'), 'Verify documenta cenários de ensaio');
    assert.ok(verifySql.includes('Administrador de outra igreja'), 'Verify documenta teste de cross-church');
  });
});
