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
  dispatchMemberCreation,
  formatListErrorMessage,
  createInitialMemberListState,
  applyMemberListTransition,
  getMemberListViewState,
  createListRequestCoordinator,
  getMemberLifecycleStorageKey,
  savePendingLifecycleCommand,
  loadPendingLifecycleCommand,
  removePendingLifecycleCommand,
  loadAnyPendingMemberCommand,
  classifyLifecycleReceiptCheckResult,
  dispatchMemberRestoration,
  dispatchMemberDeactivation,
} from './memberCommandService.js';

