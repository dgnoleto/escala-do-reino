# Modelos Reutilizáveis de Culto com Atividades e Apoios Padrão

Documento normativo e contratual da funcionalidade de modelos de culto na web (Issue #27).
Alinhado ao [PRD do Escala do Reino](../PRD.md) (§4, §5 e M28) e aos contratos de tipos de evento e atividades ([CADASTRO-TIPOS-ATIVIDADES.md](CADASTRO-TIPOS-ATIVIDADES.md)).

---

## 1. Contexto e Conceituação de Domínio

No planejamento litúrgico do Escala do Reino, a distinção clara entre tipo, modelo e evento é fundamental (§5 do PRD):

1. **Tipo de Evento:** Categoria geral do evento (ex.: "Celebração Geral", "Culto de Doutrina e Oração").
2. **Modelo de Culto (`service_template`):** Estrutura reutilizável de planejamento vinculado a um Tipo de Evento, contendo a sequência padrão de atividades litúrgicas e o rol de serviços paralelos/apoios padrão (portaria/recepção, sonoplastia, transmissão ao vivo).
3. **Edição / Evento:** Instância concreta do culto com data, horários previstos e programação executável.
4. **Atividades e Apoios:**
   - **Sequência Principal:** Atividades litúrgicas com ordem e durações previstas individuais que somam o tempo previsto do culto.
   - **Serviços Paralelos / Apoios:** Atividades contínuas ou de retaguarda que acompanham os marcos do culto (ex.: sonoplastia, transmissão, recepção/portaria) e que possuem tempo de preparação/aquecimento antes do início, sem inflar a soma da sequência principal nem ter cronômetro próprio no MVP (§6, §7.7 e M24/M25/M50).

---

## 2. Critérios de Aceite e Regras Normativas

### CA01 — Organização de atividades principais e serviços paralelos por padrão
- O modelo permite estruturar de forma ordenada as atividades principais (ex.: Boas-vindas, Louvor congregacional, Palavra, Oração final).
- O modelo permite incluir, por padrão, serviços paralelos e apoios técnicos (como portaria/recepção, sonoplastia e transmissão ao vivo) vinculados às suas equipes de trabalho (`teamId`) e minutos de preparação prévia (`prepRequiredMinutes`).
- Administradores autorizados na Web criam, editam, ativam/desativam e excluem modelos de forma segura.

### CA02 — Edição ajustável e independência de instâncias
- Usar o modelo para criar ou preencher um evento gera uma **cópia profunda e desacoplada** (*deep clone*) da estrutura para aquele evento.
- **Ajuste pontual sem efeito colateral:** Remover um apoio (por exemplo, retirar a transmissão de um culto em dia de pane técnica ou culto ao ar livre) ou retirar/inserir atividades naquela edição específica **não altera o modelo original** nem altera outros eventos planejados ou passados.
- Cada edição de culto é soberana sobre sua própria programação e rol de apoios.

### CA03 — Ausência de escala, confirmação ou reserva automática de pessoas
- O modelo define exclusivamente a estrutura litúrgica e de apoios (quais etapas existem, ordem, durações e equipes envolvidas).
- **Invariante estrita:** O modelo **não escala, confirma ou reserva pessoas automaticamente** (`roster: []`, `volunteers: []`, sem atribuição automática de voluntários nominais).
- Cada liderança de equipe preenche sua escala nominal posteriormente no planejamento da edição, e os voluntários não sofrem alocação prematura nem confirmação forçada (§5.1 e M28).

### CA04 — Preservação de eventos e integridade histórica
- **Imutabilidade retroativa:** Modificar um modelo (adicionar ou retirar atividades, alterar tempos padrão, modificar apoios padrão) **não altera eventos já existentes**.
- **Desativação lógica:** Um modelo pode ser desativado (`active = false`), impedindo sua seleção em novos planejamentos, mas mantendo a integridade referencial de eventos anteriores.
- **Proteção contra exclusão acidental:** Se um modelo estiver referenciado por eventos existentes no banco de dados, sua exclusão física é bloqueada com mensagem orientando a desativação lógica (código de integridade `23503`).

---

## 3. Especificação de Estruturas de Dados e Tabelas

### 3.1 Modelos de Culto (`app_private.service_templates`)

| Campo | Tipo | Validação e Regra |
|---|---|---|
| `id` | `uuid` | Chave primária única estável. |
| `church_id` | `uuid` | Chave estrangeira para `app_private.churches(id)` (isolamento multi-tenant). |
| `event_type_id` | `uuid` | Chave estrangeira opcional para `app_private.event_types(id)` (vinculação ao tipo de evento). |
| `name` | `text` | Nome do modelo (1 a 100 caracteres, normalizado em NFC com `trim`). |
| `description` | `text` | Descrição opcional (até 255 caracteres, NFC/trim). |
| `active` | `boolean` | `true` se disponível para uso em novos cultos; default `true`. |
| `created_at` | `timestamptz` | Carimbo de data/hora de criação. |
| `updated_at` | `timestamptz` | Carimbo de última modificação. |

- **Unicidade:** `unique (church_id, lower(name))` impede modelos com nomes duplicados na mesma igreja.

### 3.2 Atividades do Modelo (`app_private.service_template_activities`)

| Campo | Tipo | Validação e Regra |
|---|---|---|
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Isolamento multi-tenant. |
| `template_id` | `uuid` | Vínculo com `service_templates(id)` com `on delete cascade`. |
| `standard_activity_id` | `uuid` | Vínculo opcional de rastreabilidade com `standard_activities(id)` (`on delete set null`). |
| `title` | `text` | Título da atividade (1 a 100 caracteres, NFC/trim). |
| `category` | `text` | Categoria litúrgica (ex.: "Liturgia", "Louvor", "Palavra", "Oração"). |
| `planned_duration_minutes` | `integer` | Duração prevista em minutos (1 a 720 min). |
| `display_order` | `integer` | Ordem de execução na sequência principal (1-based index). |
| `notes` | `text` | Orientações padrão opcionais (até 500 caracteres). |
| `requires_playback` | `boolean` | Flag para avisar a sonoplastia sobre uso de playback (default `false`). |

### 3.3 Apoios / Serviços Paralelos Padrão (`app_private.service_template_parallel_services`)

| Campo | Tipo | Validação e Regra |
|---|---|---|
| `id` | `uuid` | Chave primária. |
| `church_id` | `uuid` | Isolamento multi-tenant. |
| `template_id` | `uuid` | Vínculo com `service_templates(id)` com `on delete cascade`. |
| `team_id` | `text` | Identificador da equipe responsável (ex.: "som", "midia", "recepcao"). |
| `service_name` | `text` | Nome do serviço de apoio (1 a 100 caracteres, NFC/trim). |
| `prep_required_minutes` | `integer` | Minutos de preparação prévia antes do culto (0 a 180 min). |
| `is_default_active` | `boolean` | Se o serviço vem ativo por padrão no modelo (default `true`). |
| `display_order` | `integer` | Ordem de exibição dos apoios. |

---

## 4. Idempotência e Auditoria

Todas as mutações de modelos utilizam recibos de comando para idempotência (`service_template_receipts`) e registram trilha de auditoria em `app_private.audit_entries`:
- `Cadastro de Modelo de Culto`: nome do modelo e tipo vinculado.
- `Alteração de Modelo de Culto`: valores anteriores e novos.
- `Desativação de Modelo de Culto` e `Reativação de Modelo de Culto`.
- `Exclusão de Modelo de Culto`: com verificação de não utilização prévia.
- `Aplicação de Modelo no Evento`: registro do modelo aplicado na edição específica.
