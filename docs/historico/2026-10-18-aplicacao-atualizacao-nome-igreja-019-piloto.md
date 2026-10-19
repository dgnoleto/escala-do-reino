# Aplicação da atualização do nome da igreja no piloto (019)

Data: 18/10/2026. Após a aprovação do ensaio transacional sob ROLLBACK (N01–N13), o responsável executou a aplicação do incremento 019 no projeto Supabase do piloto (`jvpctgqudvjealzileib`) via SQL Editor autenticado como `postgres`.

## Alvo e candidato

- Projeto Supabase **Escala do Reino**, referência `jvpctgqudvjealzileib`, banco `postgres`, PostgreSQL 17.11.
- Candidato: `docs/sql/019_church_name_update.sql`, SHA256 `b238e9bfeb8ebdf3c146962159ca531f53f6814b341add5f21a6477e03c152fa`.
- O candidato instala a RPC `public.update_church_settings` com 7 parâmetros (incluindo `p_name`) e sobrecarga retrocompatível e autônoma de 6 parâmetros.

## Validação no Navegador (localhost:3000)

Na sessão existente do administrador em `http://localhost:3000/`, o fluxo de ponta a ponta foi exercitado e aprovado:
1. **Acesso:** Formulário aberto em **Dados da Igreja** pelo administrador ativo da igreja selecionada.
2. **Edição:** Alteração do campo **Nome da igreja** para o valor desejado com validação e contador de caracteres.
3. **Persistência:** Acionamento de **Salvar alterações**; a requisição RPC com 7 parâmetros foi confirmada com sucesso pelo backend Supabase do piloto.
4. **Sincronização:** O contexto de navegação foi atualizado em segundo plano via `reloadChurchAccess`, refletindo imediatamente o novo nome no cabeçalho e na interface sem necessidade de logout/login.
5. **Aprovação:** Testado e aprovado pelo responsável em 18/10/2026.
