# Cadastro e Manutenção de Tipos de Evento e Atividades com Durações Padrão

Documento normativo e contratual da funcionalidade de tipos de evento e atividades na web (Issue #25).
Alinhado ao [PRD do Escala do Reino](PRD.md) (§4, §5 e §6) e ao [Documento de Arquitetura do Banco](ARQUITETURA-BANCO.md).

---

## 1. Contexto e Precedência

No planejamento dos cultos e eventos do Escala do Reino:
- O **Tipo de Evento** define a categoria do evento (ex.: "Culto de Celebração de Domingo", "Culto de Oração e Doutrina", "Ensaio Geral").
- A **Atividade Padrão** define etapas litúrgicas ou de apoio reutilizáveis com uma duração padrão pré-configurada em minutos (ex.: "Louvor e Adoração Congregacional" com 25 min, "Ministração da Palavra" com 45 min, "Avisos" com 8 min).
- As durações padrão servem de base inicial para o planejamento e **não são valores universais obrigatórios** (CA02); cada atividade pode ter sua duração livremente configurada pelo administrador, e cada culto pode ajustar a duração específica da edição sem alterar a definição padrão do cadastro.
- Este cadastro alimenta as histórias seguintes de modelos (#27), criação de edições (#28), programação (#29) e conferência de duração (#30).

---

## 2. Critérios de Aceite e Regras Decididas

### CA01 — Cadastros web com validação no servidor por administrador autorizado
- Tipos de evento e atividades pertencem exclusivamente à igreja selecionada (multi-tenant isolado por `church_id`).
- Somente administradores ativos da igreja podem cadastrar, alterar, desativar, reativar ou excluir tipos e atividades.
- Usuários autenticados sem papel administrativo ativo na igreja têm o acesso rejeitado tanto na interface quanto no servidor (erro `42501`).

### CA02 — Duração padrão configurável sem valores universais impostos
- A duração padrão da atividade é um número inteiro em minutos (entre 1 e 720 minutos), configurável livremente.
- O sistema não impõe 5, 15 ou 20 minutos como opções únicas ou pré-determinadas para todas as atividades.
- Exemplos iniciais no sistema servem de semente configurável e não criam restrição técnica.

### CA03 — Preservação de referências e integridade histórica
- **Independência das edições:** Alterar o nome, descrição ou duração padrão de um tipo ou atividade **não reescreve nem altera retroativamente** os cultos planejados ou realizados no passado. Cada culto preserva os dados vigentes no momento em que foi planejado.
- **Desativação (Inativação):** Desativar um tipo ou atividade (`active = false`) impede sua seleção em novos planejamentos, mas mantém integralmente suas referências e exibição nos cultos e relatórios históricos existentes.
- **Bloqueio de exclusão física sob dependência:** Se um tipo de evento ou atividade padrão já foi utilizado/referenciado em qualquer evento ou cronograma existente na igreja, sua exclusão física é **estritamente bloqueada** no banco e na interface (código `23503` / `reference_in_use`), orientando o administrador a desativar o item. A exclusão física só é permitida caso o cadastro nunca tenha sido utilizado.

### CA04 — Controle restrito à Web e sem administração no aplicativo móvel
- Conforme o PRD §4, ações administrativas de criação, edição e exclusão de tipos e atividades ocorrem exclusivamente na aplicação Web.
- Não são criados controles administrativos no aplicativo Android/iOS ou durante a condução litúrgica em tempo real.

---

## 3. Especificação de Campos e Validações

### 3.1 Tipos de Evento (`app_private.event_types`)

| Campo | Tipo | Validação e Regra |
|---|---|---|
| `id` | `uuid` / `string` | Identificador único e estável da entidade. |
| `church_id` | `uuid` | Chave estrangeira para a igreja (tenant). |
| `name` | `text` | Nome do tipo de evento. Obrigatório, entre 1 e 100 caracteres. Normalizado em Unicode NFC com remoção de espaços nas extremidades (`trim`). |
| `description` | `text` | Descrição opcional (até 255 caracteres, NFC/trim). |
| `active` | `boolean` | `true` para disponível em novos eventos; `false` para inativo. Default `true`. |
| `created_at` | `timestamptz` | Momento de criação. |
| `updated_at` | `timestamptz` | Momento da última modificação. |

- **Unicidade de Tipo:** `unique (church_id, lower(name))` — impede tipos com nomes duplicados na mesma igreja.

### 3.2 Atividades Padrão (`app_private.standard_activities`)

| Campo | Tipo | Validação e Regra |
|---|---|---|
| `id` | `uuid` / `string` | Identificador único e estável da entidade. |
| `church_id` | `uuid` | Chave estrangeira para a igreja (tenant). |
| `name` | `text` | Nome da atividade. Obrigatório, entre 1 e 100 caracteres. Normalizado em Unicode NFC com remoção de espaços nas extremidades (`trim`). |
| `default_duration_minutes` | `integer` | Duração padrão planejada em minutos. Obrigatório, entre 1 e 720 minutos (12 horas). |
| `category` | `text` | Categoria litúrgica opcional (ex.: "Liturgia", "Louvor", "Palavra", "Apoio"). |
| `description` | `text` | Descrição ou observações padrão opcionais (até 255 caracteres, NFC/trim). |
| `active` | `boolean` | `true` para disponível em novos cultos; `false` para inativo. Default `true`. |
| `created_at` | `timestamptz` | Momento de criação. |
| `updated_at` | `timestamptz` | Momento da última modificação. |

- **Unicidade de Atividade:** `unique (church_id, lower(name))` — impede atividades com o mesmo nome na mesma igreja.

---

## 4. Auditoria e Rastreabilidade

Todas as operações administrativas geram registros de auditoria em `app_private.audit_entries` (retenção de 1 ano):
- `Cadastro de Tipo de Evento`: nome cadastrado.
- `Alteração de Tipo de Evento`: registro dos nomes/descrições anterior e novo.
- `Desativação de Tipo de Evento` / `Reativação de Tipo de Evento`.
- `Exclusão de Tipo de Evento`: exclusão de tipo não referenciado.
- `Cadastro de Atividade Padrão`: nome e duração padrão cadastrados.
- `Alteração de Atividade Padrão`: registro das durações e nomes anterior e novo.
- `Desativação de Atividade Padrão` / `Reativação de Atividade Padrão`.
- `Exclusão de Atividade Padrão`: exclusão de atividade não referenciada.
