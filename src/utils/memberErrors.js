/**
 * memberErrors.js — Utilitários de classificação de erros e respostas para gestão de membros.
 *
 * Distingue rejeições definitivas do servidor (privilégio, restrição, unicidade divergente, cota)
 * de respostas incertas (falha de rede, timeout, 5xx, formato inesperado) para garantir a integridade
 * e idempotência do ciclo de comando.
 */

/**
 * Classifica erros retornados pelo servidor ou PostgREST/Postgres.
 * Rejeições definitivas encerram o ciclo do comando; erros de transporte/rede retêm o comando para reconciliação.
 *
 * @param {object|Error} error - Objeto retornado na chave error do SDK ou capturado em catch
 * @returns {boolean} true se o erro for uma rejeição definitiva pelo servidor
 */
export function isDefinitiveServerError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const status = Number(error.status || 0);

  // Códigos Postgres clássicos de validação, restrição, privilégio ou regra de negócio
  // 42501 = privilégio insuficiente / não autorizado
  // 23514 = check constraint (comprimento de nome inválido)
  // 22004 = parâmetro obrigatório nulo
  // 23505 = violação de unicidade / parâmetros divergentes para mesmo command_id
  // P0002 = igreja não encontrada ou inativa
  // P0004 = limite de requisições excedido
  if (['42501', '23514', '22004', '23505', 'P0002', 'P0004'].includes(code)) {
    return true;
  }

  // HTTP 4xx (exceto 408 Request Timeout)
  if (status >= 400 && status < 500 && status !== 408) {
    return true;
  }

  const msg = String(error.message || '').toLowerCase();
  if (
    msg.includes('não autenticado') ||
    msg.includes('não autorizado') ||
    msg.includes('entre 1 e 120') ||
    msg.includes('parâmetros diferentes') ||
    msg.includes('obrigatório') ||
    msg.includes('não encontrada ou inativa') ||
    msg.includes('limite de requisições excedido')
  ) {
    return true;
  }

  return false;
}

/**
 * Avalia se o resultado de uma criação RPC representa uma resposta incerta.
 *
 * @param {object|Error|null} error - Erro retornado ou capturado
 * @param {Array|null} data - Dados retornados pelo endpoint
 * @returns {boolean} true se a resposta for incerta
 */
export function isUncertainResponse(error, data) {
  if (error) {
    return !isDefinitiveServerError(error);
  }
  // Se não houve erro, mas a resposta de sucesso esperada está ausente ou vazia: formato inválido
  if (!Array.isArray(data) || data.length === 0 || !data[0]?.member_id) {
    return true;
  }
  return false;
}
