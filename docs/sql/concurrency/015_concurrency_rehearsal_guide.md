# Guia de Execução do Ensaio de Concorrência Física — Incremento 015

Este guia descreve o procedimento operacional para validação de concorrência real entre duas sessões PostgreSQL independentes no Incremento 015 (Fonte Real de Dependências Litúrgicas), com foco na **prevenção estrita de dupla substituição concorrente** (Achado B2-04).

## 1. Princípios e Regras de Governança
- **Base local exclusiva:** Executar apenas em container Docker local autorizado ou instância de laboratório em loopback (`127.0.0.1`).
- **Proibição absoluta:** NUNCA executar em bases de produção, piloto ou instâncias remotas compartilhadas. Guardas de IP e nome de banco abortarão qualquer tentativa indevida.
- **Isolamento por UUIDs sintéticos:** Utiliza a faixa `01500000-...`, sem interferir nos registros preexistentes.

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
1. A **Sessão A** adquire lock na alocação original, grava o status `replaced` e faz commit.
2. A **Sessão B** tenta a substituição concorrente do mesmo registro original, aguarda a liberação do lock da Sessão A e, ao prosseguir, detecta que a alocação não está mais ativa.
3. A **Sessão B** é rejeitada determinística e compulsoriamente com o código canônico `P0020` (*"Alocação original foi substituída concorrentemente ou alterada"*).
4. O resultado final no banco comprova:
   - Uma única alocação substituta ativa gerada pela Sessão A (`01500000-0000-4000-8000-000000000015`).
   - Zero duplicações ou inconsistências.
