import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDefinitiveLiturgicalError,
  createChurchTeam,
  createChurchEvent,
  assignEventParticipant,
  replaceEventParticipant,
  finishEventService,
  fetchChurchTeams,
  fetchChurchEvents,
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

test('2. Ciclo do Comando createChurchTeam', async (t) => {
  await t.test('valida parâmetros obrigatórios', async () => {
    const res = await createChurchTeam({ supabase: null, churchId: null, commandId: null, name: null });
    assert.equal(res.status, 'DEFINITIVE_ERROR');
  });

  await t.test('executa criação de equipe com sucesso', async () => {
    const mockSupabase = {
      rpc: async (name, params) => {
        assert.equal(name, 'create_church_team');
        assert.equal(params.p_name, 'Louvor & Adoração');
        return {
          data: [{
            command_id: params.p_command_id,
            action: 'create_church_team',
            church_id: params.p_church_id,
            result_entity_id: 'team-123',
            result_payload: { team_id: 'team-123', name: 'Louvor & Adoração', status: 'active' },
          }],
          error: null,
        };
      },
    };

    const res = await createChurchTeam({
      supabase: mockSupabase,
      churchId: 'church-1',
      commandId: 'cmd-team-1',
      name: 'Louvor & Adoração',
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.data.result_entity_id, 'team-123');
  });
});

test('3. Ciclo do Comando createChurchEvent (Autorização de Criação e Liturgia)', async (t) => {
  await t.test('recusa quando permissão de liturgia é violada por líder de ministério', async () => {
    const mockSupabase = {
      rpc: async () => ({
        data: null,
        error: {
          code: '42501',
          message: 'Apenas administradores podem designar a liderança da liturgia.',
        },
      }),
    };

    const res = await createChurchEvent({
      supabase: mockSupabase,
      churchId: 'church-1',
      commandId: 'cmd-event-1',
      title: 'Culto de Celebração',
      plannedStartAt: '2026-10-18T19:00:00Z',
      plannedEndAt: '2026-10-18T21:00:00Z',
      liturgyLeaderMemberId: 'leader-forbidden-1',
    });

    assert.equal(res.status, 'DEFINITIVE_ERROR');
    assert.match(res.message, /liderança da liturgia/);
  });

  await t.test('cria evento com sucesso para administrador com liturgia informada', async () => {
    const mockSupabase = {
      rpc: async (name, params) => {
        assert.equal(name, 'create_church_event');
        assert.equal(params.p_liturgy_leader_member_id, 'liturgy-leader-1');
        return {
          data: [{
            command_id: params.p_command_id,
            action: 'create_church_event',
            result_entity_id: 'event-100',
            result_payload: { event_id: 'event-100', title: params.p_title, status: 'scheduled' },
          }],
          error: null,
        };
      },
    };

    const res = await createChurchEvent({
      supabase: mockSupabase,
      churchId: 'church-1',
      commandId: 'cmd-event-2',
      title: 'Culto Noturno',
      plannedStartAt: '2026-10-18T19:00:00Z',
      plannedEndAt: '2026-10-18T21:00:00Z',
      liturgyLeaderMemberId: 'liturgy-leader-1',
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.data.result_entity_id, 'event-100');
  });
});

test('4. Ciclo do Comando assignEventParticipant e Aptidão (P0020)', async (t) => {
  await t.test('recusa alocação quando voluntário não possui aptidão homologada (P0020)', async () => {
    const mockSupabase = {
      rpc: async () => ({
        data: null,
        error: {
          code: 'P0020',
          message: 'Membro não possui aptidão ativa homologada para esta função na equipe.',
        },
      }),
    };

    const res = await assignEventParticipant({
      supabase: mockSupabase,
      churchId: 'church-1',
      commandId: 'cmd-asg-1',
      eventId: 'event-1',
      teamId: 'team-louvor',
      memberId: 'member-sem-aptidao',
      teamRoleId: 'role-bateria',
    });

    assert.equal(res.status, 'DEFINITIVE_ERROR');
    assert.match(res.message, /aptidão ativa homologada/);
  });

  await t.test('aloca com sucesso quando parâmetros e aptidão são válidos', async () => {
    const mockSupabase = {
      rpc: async (name, params) => {
        return {
          data: [{
            command_id: params.p_command_id,
            action: 'assign_event_participant',
            result_entity_id: 'asg-777',
            result_payload: { assignment_id: 'asg-777', status: 'scheduled' },
          }],
          error: null,
        };
      },
    };

    const res = await assignEventParticipant({
      supabase: mockSupabase,
      churchId: 'church-1',
      commandId: 'cmd-asg-2',
      eventId: 'event-1',
      teamId: 'team-louvor',
      memberId: 'member-baterista-habilitado',
      teamRoleId: 'role-bateria',
    });

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.data.result_entity_id, 'asg-777');
  });
});

test('5. Mensagens Informativas em dispatchMemberDeactivation (P0015, P0016, P0022, P0023, P0024, P0025)', async (t) => {
  const dummyStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  };

  const testCodes = [
    {
      code: 'P0015',
      expectedMessage: 'último administrador ativo',
    },
    {
      code: 'P0016',
      expectedMessage: 'autoexclusão não permitida',
    },
    {
      code: 'P0022',
      expectedMessage: 'este membro lidera um ou mais ministérios ativos',
    },
    {
      code: 'P0023',
      expectedMessage: 'líder da liturgia em um culto futuro',
    },
    {
      code: 'P0024',
      expectedMessage: 'escalas ativas ou responsabilidade nominal',
    },
    {
      code: 'P0025',
      expectedMessage: 'culto agendado com horário expirado sem encerramento formal',
    },
  ];

  for (const { code, expectedMessage } of testCodes) {
    await t.test(`mapeia mensagem amigável para código ${code}`, async () => {
      dummyStorage._data = {};
      const rpcCaller = async () => ({
        data: null,
        error: {
          code,
          message: `Erro do banco: ${code}`,
        },
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
