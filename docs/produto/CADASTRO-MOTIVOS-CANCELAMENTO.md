# Cadastro e Manutenção de Motivos de Cancelamento de Atividades

Documento normativo e contratual da funcionalidade de motivos de cancelamento na web (Issue #26).
Alinhado ao [PRD do Escala do Reino](../PRD.md) (§4, §7.3; Cenários M11 e M12) e ao [Documento de Arquitetura do Banco](../arquitetura/ARQUITETURA-BANCO.md) (§4.2).

---

## 1. Contexto e Precedência

No MVP do Escala do Reino, durante a execução de um culto, o cancelamento de uma atividade em andamento é uma operação de contingência reservada exclusivamente ao Líder da Liturgia desse evento. 
Para garantir clareza operacional, objetividade litúrgica e proteção das pessoas envolvidas:
- O cancelamento **exige** a seleção de um motivo previamente mantido pelo administrador da igreja na aplicação Web.
- A aplicação **não oferece** cadastro administrativo na tela operacional mobile ou durante o culto (Cenário M12).
- A aplicação **não exige nem permite** justificativas livres ou relatos pessoais detalhados (Cenário M11).

---

## 2. Critérios de Aceite e Regras Decididas

### CA01 — Lista configurável por administrador autorizado na Web
- A lista de motivos pertence exclusivamente à igreja selecionada (multi-tenant isolado por `church_id`).
- Somente administradores ativos da igreja podem cadastrar, alterar, desativar, reativar ou excluir motivos. Usuários sem permissão administrativa têm a operação bloqueada tanto na interface quanto no servidor (erro `42501`).
- Os exemplos iniciais sugeridos pelo sistema (falha técnica, falta de energia, imprevisto de saúde, etc.) são sementes iniciais configuráveis; a igreja pode alterá-los, desativá-los ou excluí-los (caso nunca tenham sido utilizados), sem que o sistema exija opções fixas obrigatórias.

### CA02 — Operação de cancelamento com motivos ativos previamente mantidos
- Durante a condução do culto (`LiveConsole`), o modal de cancelamento de atividade apresenta exclusivamente motivos com status **ativo** (`active = true`).
- A tela operacional não disponibiliza campos de cadastro, edição ou exclusão de motivos.
- Se a igreja não possuir nenhum motivo ativo disponível, a interface exibe um aviso protetivo com orientação e **bloqueia** a confirmação do cancelamento, impedindo cancelamentos sem motivo válido registrado.

### CA03 — Preservação de interpretação e histórico litúrgico
- Ao cancelar uma atividade, o sistema registra:
  1. O snapshot textual do motivo selecionado (`cancellationReason`);
  2. A referência estável do identificador do motivo (`cancellationReasonId`);
  3. O autor da ação (`cancelledBy`) e o timestamp de parada real.
- **Desativação:** Desativar um motivo (`active = false`) remove-o de futuras seleções na liturgia, mas preserva integralmente sua exibição e interpretação em todos os cancelamentos e relatórios históricos passados.
- **Alteração:** Renomear um motivo atualiza seu nome cadastral e gera um registro de auditoria (`Alteração de Motivo`) com os nomes anterior e novo, preservando o snapshot histórico das atividades já canceladas.
- **Proteção contra exclusão física:** Motivos que já foram referenciados em qualquer atividade cancelada histórica **não podem ser excluídos fisicamente** da base. A interface e o servidor rejeitam a exclusão física e instruem a desativação protetiva. Motivos sem histórico podem ser excluídos pelo administrador.

### CA04 — Ausência de justificativa livre e relatos pessoais
- O fluxo de cancelamento litúrgico restringe-se estritamente à seleção de um dos motivos objetivos pré-cadastrados.
- Não há campo de texto aberto (`textarea`), relato de incidentes pessoais ou imputação de culpa a membros da equipe.

---

## 3. Especificação de Campos e Validações

| Campo | Tipo | Validação e Regra |
|---|---|---|
| `id` | `uuid` / `string` | Identificador único e estável da entidade de motivo. |
| `church_id` | `uuid` | Chave estrangeira para a igreja; isolamento estrito por tenant. |
| `name` | `text` | Descrição do motivo. Obrigatório, entre 1 e 120 caracteres. Normalizado em Unicode NFC com remoção de espaços nas extremidades (`trim`). |
| `active` | `boolean` | `true` para motivos disponíveis para seleção; `false` para motivos desativados. |
| `created_at` | `timestamptz` | Momento de criação do registro. |
| `updated_at` | `timestamptz` | Momento da última alteração no motivo. |

### Unicidade de Nomes
- Na mesma igreja, não são permitidos motivos duplicados. A comparação é insensível a maiúsculas/minúsculas e normalizada em NFC:
  `unique (church_id, lower(name))`

---

## 4. Auditoria e Rastreabilidade

Todas as operações administrativas geram eventos de auditoria com retenção de 1 ano (`app_private.audit_entries`):
- `Cadastro de Motivo`: registro de criação com nome cadastrado.
- `Alteração de Motivo`: registro da edição com nome anterior e novo nome.
- `Desativação de Motivo` / `Reativação de Motivo`: registro de mudança de status ativo.
- `Exclusão de Motivo`: registro de remoção física de motivo não utilizado.
