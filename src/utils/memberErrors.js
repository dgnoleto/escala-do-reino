/**
 * memberErrors.js — Re-exportação e compatibilidade para utilitários de gestão de membros.
 */
export {
  isDefinitiveServerError,
  isUncertainResponse,
  validateAndNormalizeMemberName,
  getMemberCommandStorageKey,
  savePendingMemberCommand,
  loadPendingMemberCommand,
  removePendingMemberCommand,
  clearAllMemberCommandStorage,
  determineAuthTransition,
  classifyReceiptCheckResult,
} from './memberCommandService.js';
