import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDefinitiveLiturgicalError,
  validateLiturgicalReceipt,
  createChurchTeam,
  assignTeamLeader,
  transferTeamLeadership,
  createTeamRole,
  addTeamMember,
  removeTeamMember,
  grantMemberQualification,
  revokeMemberQualification,
  createChurchEvent,
  assignEventLiturgyLeader,
  startEventService,
  finishEventService,
  cancelChurchEvent,
  assignEventParticipant,
  replaceEventParticipant,
  fetchChurchTeams,
  fetchChurchTeamRoles,
  fetchTeamMembers,
  fetchMemberQualifications,
  fetchChurchEvents,
  fetchEventAssignments,
  savePendingLiturgicalCommand,
  loadPendingLiturgicalCommand,
  removePendingLiturgicalCommand,
} from '../src/utils/liturgicalCommandService.js';

import {
  dispatchMemberDeactivation,
} from '../src/utils/memberCommandService.js';

test('1. Classificação de Erros Litúrgicos e de Domínio (isDefinitiveLiturgicalError)', async (t) => {
  await t.test('classifica erros de negócio e restrições canônicas como definitivos', () => {
    const codes = ['42501', '22000', '22004', '23505', 'P0002', 'P0015', 'P0016', 'P0020', 'P0021', 'P0022', 'P0023', 'P0024', 'P0025'];
    for (const code of codes) {
      assert.equal(isDefinitiveLiturgicalError({ code }), true, `Deve classificar ${code} como definitivo`);
    }
  });

  await t.test('classifica mensagens textuais de restrição como definitivas', () => {
    assert.equal(isDefinitiveLiturgicalError({ message: 'Apenas administradores podem designar a liderança da liturgia.' }), true);
    assert.equal(isDefinitiveLiturgicalError({ message: 'Membro lidera ministério ativo; transfira a liderança da equipe antes de excluí-lo.' }), true);
    assert.equal(isDefinitiveLiturgicalError({ message: 'Membro não possui aptidão ativa homologada para esta função.' }), true);
    assert.equal(isDefinitiveLiturgicalError({ message: 'Membro inativo não pode ser escalado.' }), true);
  });

  await t.test('preserva falhas de rede, 5xx e timeouts como respostas incertas (não definitivas)', () => {
    assert.equal(isDefinitiveLiturgicalError({ status: 500, message: 'Internal Server Error' }), false);
    assert.equal(isDefinitiveLiturgicalError({ message: 'Failed to fetch (network error)' }), false);
    assert.equal(isDefinitiveLiturgicalError({ status: 408, message: 'Request Timeout' }), false);
  });
});

test('2. Validação Estrita de Recibos Litúrgicos (B2-05 / Contraprovas do Cliente)', async (t) => {
  const churchId = '11111111-1111-4111-8111-111111111111';
  const commandId = '22222222-2222-4222-8222-222222222222';
  const teamId = '33333333-3333-4333-8333-333333333333';
  const coherent = {
    command_id: commandId,
    action: 'create_church_team',
    church_id: churchId,
    result_entity_id: teamId,
    result_payload: { team_id: teamId, name: 'Louvor', status: 'active' },
  };

  async function dispatch(data, error = null) {
    return createChurchTeam({
      supabase: { rpc: async () => ({ data, error }) },
      churchId,
      commandId,
      name: 'Louvor',
    });
  }

  await t.test('controle: resposta com recibo coerente confirma sucesso', async () => {
    const res = await dispatch([coherent]);
    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.receipt.command_id, commandId);
    assert.equal(res.receipt.result_entity_id, teamId);
  });

  await t.test('contraprova 1: resposta null sem erro não comprova criação (retorna UNCERTAIN)', async () => {
    const res = await dispatch(null);
    assert.equal(res.status, 'UNCERTAIN');
  });

  await t.test('contraprova 2: array vazio sem erro não comprova criação (retorna UNCERTAIN)', async () => {
    const res = await dispatch([]);
    assert.equal(res.status, 'UNCERTAIN');
  });

  await t.test('contraprova 3: recibo de outro comando/igreja não comprova esta criação (retorna UNCERTAIN)', async () => {
    const res = await dispatch([{
      ...coherent,
      command_id: '44444444-4444-4444-8444-444444444444',
      church_id: '55555555-5555-4555-8555-555555555555',
    }]);
    assert.equal(res.status, 'UNCERTAIN');
  });

  await t.test('contraprova 4: recibo com ação divergente não comprova criação', async () => {
    const res = await dispatch([{
      ...coherent,
      action: 'other_action',
    }]);
    assert.equal(res.status, 'UNCERTAIN');
  });
});

test('3. Ciclo de Comandos de Equipes e Liderança', async (t) => {
  const churchId = 'c1111111-1111-4111-8111-111111111111';
  const commandId = 'c2222222-2222-4222-8222-222222222222';
  const teamId = 't3333333-3333-4333-8333-333333333333';
  const memberId = 'm4444444-4444-4444-8444-444444444444';

  await t.test('createChurchTeam valida parâmetros obrigatórios', async () => {
    const res = await createChurchTeam({ supabase: null, churchId: null, commandId: null, name: null });
    assert.equal(res.status, 'DEFINITIVE_ERROR');
  });

  await t.test('transferTeamLeadership despacha com versão otimista e valida recibo', async () => {
    const mockSupabase = {
      rpc: async (name, params) => {
        assert.equal(name, 'assign_team_leader');
        assert.equal(params.p_team_id, teamId);
        assert.equal(params.p_new_leader_member_id, memberId);
        assert.equal(params.p_expected_version, 1);
        return {
          data: [{
            command_id: params.p_command_id,
            action: 'assign_team_leader',
            church_id: params.p_church_id,
            result_entity_id: teamId,
            result_payload: { team_id: teamId, new_leader_member_id: memberId, version: 2 },
          }],
          error: null,
        };
      },
    };

    const res = await transferTeamLeadership({
      supabase: mockSupabase,
      churchId,
      commandId,
      teamId,
      newLeaderMemberId: memberId,
      expectedVersion: 1,
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.receipt.result_entity_id, teamId);
  });

  await t.test('createTeamRole despacha e valida criação de função técnica', async () => {
    const roleId = 'r5555555-5555-4555-8555-555555555555';
    const mockSupabase = {
      rpc: async (name, params) => {
        assert.equal(name, 'create_team_role');
        return {
          data: [{
            command_id: params.p_command_id,
            action: 'create_team_role',
            church_id: params.p_church_id,
            result_entity_id: roleId,
            result_payload: { team_role_id: roleId, name: 'Bateria' },
          }],
          error: null,
        };
      },
    };

    const res = await createTeamRole({
      supabase: mockSupabase,
      churchId,
      commandId,
      teamId,
      name: 'Bateria',
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.data.name, 'Bateria');
  });

  await t.test('addTeamMember e removeTeamMember executam com sucesso', async () => {
    const membershipId = 'ms666666-6666-4666-8666-666666666666';
    const mockSupabase = {
      rpc: async (name, params) => {
        return {
          data: [{
            command_id: params.p_command_id,
            action: name,
            church_id: params.p_church_id,
            result_entity_id: membershipId,
            result_payload: { membership_id: membershipId, status: name === 'add_team_member' ? 'active' : 'inactive' },
          }],
          error: null,
        };
      },
    };

    const addRes = await addTeamMember({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-add-1',
      teamId,
      memberId,
    });
    assert.equal(addRes.status, 'SUCCESS');

    const remRes = await removeTeamMember({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-rem-1',
      teamId,
      memberId,
    });
    assert.equal(remRes.status, 'SUCCESS');
  });
});

test('4. Ciclo de Aptidões e Qualificações (grant/revoke)', async (t) => {
  const churchId = 'c1111111-1111-4111-8111-111111111111';
  const qualId = 'q7777777-7777-4777-8777-777777777777';

  const mockSupabase = {
    rpc: async (name, params) => ({
      data: [{
        command_id: params.p_command_id,
        action: name,
        church_id: params.p_church_id,
        result_entity_id: qualId,
        result_payload: { qualification_id: qualId, status: name === 'grant_member_qualification' ? 'active' : 'inactive' },
      }],
      error: null,
    }),
  };

  const grantRes = await grantMemberQualification({
    supabase: mockSupabase,
    churchId,
    commandId: 'cmd-g-1',
    memberId: 'm-1',
    teamId: 't-1',
    teamRoleId: 'tr-1',
  });
  assert.equal(grantRes.status, 'SUCCESS');

  const revokeRes = await revokeMemberQualification({
    supabase: mockSupabase,
    churchId,
    commandId: 'cmd-r-1',
    memberId: 'm-1',
    teamId: 't-1',
    teamRoleId: 'tr-1',
  });
  assert.equal(revokeRes.status, 'SUCCESS');
});

test('5. Ciclo de Eventos, Liturgia e Execução', async (t) => {
  const churchId = 'c1111111-1111-4111-8111-111111111111';
  const eventId = 'e8888888-8888-4888-8888-888888888888';

  await t.test('createChurchEvent recusa liturgia informada por não-admin (42501)', async () => {
    const mockSupabase = {
      rpc: async () => ({
        data: null,
        error: { code: '42501', message: 'Apenas administradores podem designar a liderança da liturgia.' },
      }),
    };

    const res = await createChurchEvent({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-ev-1',
      title: 'Culto',
      plannedStartAt: '2026-10-18T19:00:00Z',
      plannedEndAt: '2026-10-18T21:00:00Z',
      liturgyLeaderMemberId: 'leader-forbidden',
    });

    assert.equal(res.status, 'DEFINITIVE_ERROR');
  });

  await t.test('startEventService, finishEventService e cancelChurchEvent executam e validam recibo', async () => {
    const mockSupabase = {
      rpc: async (name, params) => ({
        data: [{
          command_id: params.p_command_id,
          action: name,
          church_id: params.p_church_id,
          result_entity_id: eventId,
          result_payload: { event_id: eventId, action: name },
        }],
        error: null,
      }),
    };

    const startRes = await startEventService({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-start-1',
      eventId,
    });
    assert.equal(startRes.status, 'SUCCESS');

    const finishRes = await finishEventService({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-finish-1',
      eventId,
    });
    assert.equal(finishRes.status, 'SUCCESS');

    const cancelRes = await cancelChurchEvent({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-cancel-1',
      eventId,
      cancelReason: 'Falta de energia elétrica',
    });
    assert.equal(cancelRes.status, 'SUCCESS');
  });
});

test('6. Escala, Alocação e Substituição Concorrente', async (t) => {
  const churchId = 'c1111111-1111-4111-8111-111111111111';
  const asgId = 'a9999999-9999-4999-8999-999999999999';

  await t.test('assignEventParticipant recusa sem aptidão (P0020)', async () => {
    const mockSupabase = {
      rpc: async () => ({
        data: null,
        error: { code: 'P0020', message: 'Membro não possui aptidão ativa homologada para a função.' },
      }),
    };

    const res = await assignEventParticipant({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-asg-fail',
      eventId: 'e-1',
      teamId: 't-1',
      memberId: 'm-1',
      teamRoleId: 'tr-1',
    });
    assert.equal(res.status, 'DEFINITIVE_ERROR');
    assert.match(res.message, /aptidão ativa homologada/);
  });

  await t.test('replaceEventParticipant rejeita alocação já substituída (P0020)', async () => {
    const mockSupabase = {
      rpc: async () => ({
        data: null,
        error: { code: 'P0020', message: 'Alocação original foi substituída concorrentemente ou alterada.' },
      }),
    };

    const res = await replaceEventParticipant({
      supabase: mockSupabase,
      churchId,
      commandId: 'cmd-rep-double',
      assignmentId: asgId,
      replacementMemberId: 'sub-2',
      reason: 'Conflito',
    });
    assert.equal(res.status, 'DEFINITIVE_ERROR');
    assert.match(res.message, /substituída concorrentemente/);
  });
});

test('7. Retenção e Recuperação de Comandos Litúrgicos Pendentes (Storage)', async () => {
  const dummyStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };

  const userId = 'user-test-storage';
  const churchId = 'church-test-storage';
  const cmd = {
    commandId: 'cmd-storage-1',
    churchId,
    action: 'create_church_team',
    name: 'Diaconia',
  };

  assert.equal(loadPendingLiturgicalCommand(dummyStorage, userId, churchId), null);
  assert.equal(savePendingLiturgicalCommand(dummyStorage, userId, cmd), true);

  const loaded = loadPendingLiturgicalCommand(dummyStorage, userId, churchId);
  assert.ok(loaded);
  assert.equal(loaded.commandId, 'cmd-storage-1');
  assert.equal(loaded.name, 'Diaconia');

  assert.equal(removePendingLiturgicalCommand(dummyStorage, userId, churchId), true);
  assert.equal(loadPendingLiturgicalCommand(dummyStorage, userId, churchId), null);
});

test('8. Mensagens Informativas em dispatchMemberDeactivation (P0015, P0016, P0022, P0023, P0024, P0025)', async (t) => {
  const dummyStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };

  const testCodes = [
    { code: 'P0015', expectedMessage: 'último administrador ativo' },
    { code: 'P0016', expectedMessage: 'autoexclusão não permitida' },
    { code: 'P0022', expectedMessage: 'este membro lidera um ou mais ministérios ativos' },
    { code: 'P0023', expectedMessage: 'líder da liturgia em um culto futuro' },
    { code: 'P0024', expectedMessage: 'escalas ativas ou responsabilidade nominal' },
    { code: 'P0025', expectedMessage: 'culto agendado com horário expirado sem encerramento formal' },
  ];

  for (const { code, expectedMessage } of testCodes) {
    await t.test(`mapeia mensagem amigável para código ${code}`, async () => {
      dummyStorage._data = {};
      const rpcCaller = async () => ({
        data: null,
        error: { code, message: `Erro do banco: ${code}` },
      });

      const res = await dispatchMemberDeactivation({
        rpcCaller,
        storage: dummyStorage,
        userId: 'user-admin',
        churchId: 'church-1',
        memberId: 'member-target',
        commandId: `cmd-deact-${code}`,
        expectedUpdatedAt: '2026-10-16T18:00:00.000000Z',
      });

      assert.equal(res.status, 'DEFINITIVE_ERROR');
      assert.match(res.message.toLowerCase(), new RegExp(expectedMessage.toLowerCase()));
    });
  }
});
