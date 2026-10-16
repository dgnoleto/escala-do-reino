# Guia de Execução do Ensaio de Concorrência Física — Incremento 015

Este guia descreve o procedimento operacional para validação de concorrência real entre duas sessões PostgreSQL independentes no Incremento 015 (Fonte Real de Dependências Litúrgicas), com foco na **prevenção estrita de dupla substituição concorrente** (Achado B2-04 e B2-06).

## 1. Princípios e Regras de Governança
- **Base local exclusiva:** Executar apenas em container Docker local autorizado ou instância de laboratório em loopback (`127.0.0.1` / `::1`). Guardas antecipadas no script abortam conexões remotas ou privadas não-loopback.
- **Proibição absoluta:** NUNCA executar em bases de produção, piloto ou instâncias remotas compartilhadas (`jvpctgqudvjealzileib`, etc.).
- **Barreira observável:** A Sessão A não utiliza pausas cegas (`pg_sleep` arbitrário); ela consulta ativamente `pg_locks` e `pg_stat_activity` para certificar que a Sessão B está enfileirada no bloqueio antes de liberar seu commit.
- **Assertivas exatas de estado final:** A Sessão B valida não apenas a exceção `P0020` com mensagem indicando alocação já substituída, mas inspeciona fisicamente que exatamente 1 alocação substituta ativa existe.
- **Teardown completo e reversibilidade:** O ensaio limpa 100% das fixtures sintéticas na conclusão da Sessão B, garantindo zero resíduos no banco de dados.

## 2. Roteiro de Execução em Dois Terminais

### Terminal 1 (Sessão A — Bloqueador / Primeiro Escritor)
```bash
psql -h 127.0.0.1 -p 54321 -U postgres -d postgres -f docs/sql/concurrency/015_concurrency_session_a.sql
```

### Terminal 2 (Sessão B — Segundo Escritor Concorrente)
```bash
psql -h 127.0.0.1 -p 54321 -U postgres -d postgres -f docs/sql/concurrency/015_concurrency_session_b.sql
```

## 3. Comportamento Esperado e Critério de Aceite
1. A **Sessão A** adquire lock na alocação original, grava o status `replaced` e aguarda a detecção da Sessão B na tabela `pg_locks`.
2. A **Sessão B** tenta a substituição concorrente do mesmo registro original, aguarda a liberação do lock da Sessão A e, ao prosseguir, detecta que a alocação não está mais ativa.
3. A **Sessão B** é rejeitada determinística e compulsoriamente com o código canônico `P0020` (*"Alocação já substituída por outra transação"*).
4. O bloco de assertivas na Sessão B confirma:
   - Exatamente uma única alocação substituta ativa gerada pela Sessão A (`01500000-0000-4000-8000-000000000015`).
   - Alocação original em status `replaced` com ponteiro para a substituição.
   - Zero duplicações ou inconsistências.
5. O bloco de teardown remove todas as fixtures da faixa sintética `01500000-...` com zero resíduos.
