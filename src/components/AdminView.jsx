import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  UserPlus,
  Shield,
  Tag,
  Users,
  AlertCircle,
  CheckCircle2,
  Send,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Power,
  Calendar,
  Clock,
  Layers
} from 'lucide-react';
import { isReasonUsedInActivities } from '../utils/cancellationReasonService';
import {
  isEventTypeUsed,
  isStandardActivityUsed,
  canDeleteEventType,
  canDeleteStandardActivity
} from '../utils/eventTypeActivityService';
import {
  isTemplateUsedInEvents,
  canDeleteServiceTemplate
} from '../utils/serviceTemplateService';

const VALID_ADMIN_TABS = ['event_types', 'templates', 'activities', 'reasons', 'invites', 'liturgy', 'members'];

const resolveInitialTab = (tab) => {
  if (!tab || tab === 'cadastros' || !VALID_ADMIN_TABS.includes(tab)) return 'event_types';
  return tab;
};

// Presets recomendados de serviços paralelos da igreja (Issue #27)
const PARALLEL_SERVICE_PRESETS = [
  { teamId: 'limpeza', serviceName: 'Limpeza do Templo', prepRequiredMinutes: 60 },
  { teamId: 'apoio', serviceName: 'Organização das Cadeiras & Templo', prepRequiredMinutes: 60 },
  { teamId: 'recepcao', serviceName: 'Recepção & Boas-Vindas', prepRequiredMinutes: 20 },
  { teamId: 'portaria', serviceName: 'Portaria & Estacionamento', prepRequiredMinutes: 30 },
  { teamId: 'som', serviceName: 'Sonoplastia & Retorno', prepRequiredMinutes: 30 },
  { teamId: 'midia', serviceName: 'Transmissão ao Vivo & Mídia', prepRequiredMinutes: 20 }
];

export default function AdminView({ onBack, initialTab = 'event_types' } = {}) {
  const {
    church,
    members,
    teams,
    cancelReasons,
    eventTypes,
    standardActivities,
    serviceTemplates = [],
    accessInvites,
    currentUser,
    isAdmin,
    addCancelReason,
    updateCancelReason,
    toggleCancelReasonStatus,
    deleteCancelReason,
    addEventType,
    updateEventType,
    toggleEventTypeStatus,
    deleteEventType,
    addStandardActivity,
    updateStandardActivity,
    toggleStandardActivityStatus,
    deleteStandardActivity,
    addServiceTemplate,
    updateServiceTemplate,
    toggleServiceTemplateStatus,
    deleteServiceTemplate,
    sendAccessInvite,
    designateLiturgyLeader,
    event,
    events = [],
    addAuditLog,
    isOnline,
    isDataStale,
    isTemplatesStale,
    isEventTypesStale,
    isActivitiesStale,
    isReasonsStale,
    beginEditingTemplate,
    cancelEditingTemplate,
    remoteLoading,
    remoteError,
    reloadRemoteData
  } = useApp();

  const [activeAdminTab, setActiveAdminTab] = useState(() => resolveInitialTab(initialTab));

  React.useEffect(() => {
    if (initialTab) {
      setActiveAdminTab(resolveInitialTab(initialTab));
    }
  }, [initialTab]);

  const handleTabKeyDown = (e) => {
    const tabKeys = ['event_types', 'templates', 'activities', 'reasons', 'invites', 'liturgy', 'members'];
    const currentIdx = tabKeys.indexOf(activeAdminTab);
    if (currentIdx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIdx = (currentIdx + 1) % tabKeys.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIdx = (currentIdx - 1 + tabKeys.length) % tabKeys.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = tabKeys.length - 1;
    }
    if (nextIdx !== -1) {
      const nextTab = tabKeys[nextIdx];
      setActiveAdminTab(nextTab);
      const btnId = `tab-admin-${nextTab.replace('_', '-')}`;
      setTimeout(() => {
        const el = document.getElementById(btnId);
        if (el) el.focus();
      }, 0);
    }
  };

  // Formulário de Convite de Acesso (PRD 3.1 & Cenário M40)
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMemberName, setInviteMemberName] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState(false);

  // Formulário de Motivo de Cancelamento (PRD 7.3 & Cenário M12)
  const [newReasonText, setNewReasonText] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [reasonSuccess, setReasonSuccess] = useState('');
  const [editingReasonId, setEditingReasonId] = useState(null);
  const [editingReasonText, setEditingReasonText] = useState('');
  const [editingError, setEditingError] = useState('');

  // Formulário de Tipos de Evento (PRD §5 - Issue #25)
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeDesc, setNewTypeDesc] = useState('');
  const [typeError, setTypeError] = useState('');
  const [typeSuccess, setTypeSuccess] = useState('');
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [editingTypeName, setEditingTypeName] = useState('');
  const [editingTypeDesc, setEditingTypeDesc] = useState('');
  const [editingTypeError, setEditingTypeError] = useState('');

  // Formulário de Atividades Padrão com Duração (PRD §5 - Issue #25)
  const [newActName, setNewActName] = useState('');
  const [newActDuration, setNewActDuration] = useState(10);
  const [newActCategory, setNewActCategory] = useState('Liturgia');
  const [newActDesc, setNewActDesc] = useState('');
  const [actError, setActError] = useState('');
  const [actSuccess, setActSuccess] = useState('');
  const [editingActId, setEditingActId] = useState(null);
  const [editingActName, setEditingActName] = useState('');
  const [editingActDuration, setEditingActDuration] = useState(10);
  const [editingActCategory, setEditingActCategory] = useState('Liturgia');
  const [editingActDesc, setEditingActDesc] = useState('');
  const [editingActError, setEditingActError] = useState('');

  // Formulário de Modelos Reutilizáveis de Culto (PRD §5 - Issue #27)
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateEventTypeId, setTemplateEventTypeId] = useState('');
  const [templateActivities, setTemplateActivities] = useState([
    { title: 'Boas-Vindas e Oração Inicial', category: 'Liturgia', plannedDurationMinutes: 5, notes: '' },
    { title: 'Louvor e Adoração Congregacional', category: 'Louvor', plannedDurationMinutes: 25, notes: '' },
    { title: 'Ministração da Palavra', category: 'Palavra', plannedDurationMinutes: 45, notes: '' },
    { title: 'Bênção e Encerramento', category: 'Liturgia', plannedDurationMinutes: 5, notes: '' }
  ]);
  const [templateParallelServices, setTemplateParallelServices] = useState([
    { teamId: 'limpeza', serviceName: 'Limpeza do Templo', prepRequiredMinutes: 60, isDefaultActive: true },
    { teamId: 'apoio', serviceName: 'Organização das Cadeiras & Templo', prepRequiredMinutes: 60, isDefaultActive: true },
    { teamId: 'recepcao', serviceName: 'Recepção & Boas-Vindas', prepRequiredMinutes: 20, isDefaultActive: true },
    { teamId: 'portaria', serviceName: 'Portaria & Estacionamento', prepRequiredMinutes: 30, isDefaultActive: true },
    { teamId: 'som', serviceName: 'Sonoplastia & Retorno', prepRequiredMinutes: 30, isDefaultActive: true },
    { teamId: 'midia', serviceName: 'Transmissão ao Vivo & Mídia', prepRequiredMinutes: 20, isDefaultActive: true }
  ]);
  const [templateError, setTemplateError] = useState('');
  const [templateSuccess, setTemplateSuccess] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editingTemplateOrigin, setEditingTemplateOrigin] = useState(null);
  const [hadSyncFailureWhileEditing, setHadSyncFailureWhileEditing] = useState(false);
  const [selectedStandardActForTemplate, setSelectedStandardActForTemplate] = useState('');

  React.useEffect(() => {
    if (editingTemplateId && (isDataStale || isTemplatesStale || remoteError)) {
      setHadSyncFailureWhileEditing(true);
    }
  }, [editingTemplateId, isDataStale, isTemplatesStale, remoteError]);

  // Estados de Reordenação e Serviços Paralelos (Issue #27)
  const [draggedActivityIdx, setDraggedActivityIdx] = useState(null);
  const [customServiceName, setCustomServiceName] = useState('');
  const [customServiceTeamId, setCustomServiceTeamId] = useState('apoio');
  const [customServicePrepMinutes, setCustomServicePrepMinutes] = useState(30);

  // Designação da Liderança da Liturgia (PRD 3.2 & Cenário M05)
  const [selectedEventIdForLiturgy, setSelectedEventIdForLiturgy] = useState(() => (event?.id || events?.[0]?.id || ''));
  const targetEventForLiturgy = events.find(e => e.id === selectedEventIdForLiturgy) || event || {};
  const [selectedLiturgyLeader, setSelectedLiturgyLeader] = useState(() => (targetEventForLiturgy?.liturgyLeaderId || ''));
  const [liturgySuccess, setLiturgySuccess] = useState('');
  const [liturgyError, setLiturgyError] = useState('');

  // Proteção de Acesso (PRD 3.2 & Cenário M40)
  if (!isAdmin) {
    return (
      <div className="card admin-denied-card" style={{ maxWidth: '600px', margin: '2rem auto', textAlign: 'center', padding: '2rem' }}>
        {onBack && (
          <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              id="btn-back-to-home"
              onClick={onBack}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              ← Voltar ao Início da Igreja
            </button>
          </div>
        )}
        <Shield size={48} color="#ef4444" style={{ margin: '0 auto 1rem' }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Acesso Administrativo Restrito</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
          Conforme as regras de governança e permissões da igreja, apenas administradores autorizados
          podem gerenciar cadastros, emitir convites de acesso ou designar lideranças.
        </p>
        <p className="denied-hint" style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Você está conectado como <strong>{currentUser?.name || 'Membro'}</strong> ({currentUser?.role || 'Membro'}).
        </p>
      </div>
    );
  }

  const handleSendInvite = (e) => {
    e.preventDefault();
    if (!inviteEmail || !inviteMemberName) return;

    sendAccessInvite(inviteEmail, inviteMemberName);
    setInviteEmail('');
    setInviteMemberName('');
    setInviteSuccess(true);
    setTimeout(() => setInviteSuccess(false), 3000);
  };

  const handleAddReason = async (e) => {
    e.preventDefault();
    setReasonError('');
    setReasonSuccess('');
    const res = await addCancelReason(newReasonText);
    if (!res.success) {
      setReasonError(res.error);
    } else {
      setNewReasonText('');
      setReasonSuccess('Motivo cadastrado com sucesso!');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleStartEditReason = (reason) => {
    setEditingReasonId(reason.id);
    setEditingReasonText(reason.name);
    setEditingError('');
    setReasonError('');
  };

  const handleSaveEditReason = async (id) => {
    setEditingError('');
    const res = await updateCancelReason(id, editingReasonText);
    if (!res.success) {
      setEditingError(res.error);
    } else {
      setEditingReasonId(null);
      setEditingReasonText('');
      setReasonSuccess('Motivo alterado com sucesso!');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleCancelEditReason = () => {
    setEditingReasonId(null);
    setEditingReasonText('');
    setEditingError('');
  };

  const handleToggleReasonStatus = async (id) => {
    setReasonError('');
    setReasonSuccess('');
    const res = await toggleCancelReasonStatus(id);
    if (!res.success) {
      setReasonError(res.error);
    } else {
      setReasonSuccess(res.active ? 'Motivo reativado com sucesso!' : 'Motivo desativado.');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  const handleDeleteReason = async (id) => {
    setReasonError('');
    setReasonSuccess('');
    const res = await deleteCancelReason(id);
    if (!res.success) {
      setReasonError(res.error);
    } else {
      setReasonSuccess('Motivo excluído com sucesso.');
      setTimeout(() => setReasonSuccess(''), 3000);
    }
  };

  // Handlers para Tipos de Evento (Issue #25)
  const handleAddType = async (e) => {
    e.preventDefault();
    setTypeError('');
    setTypeSuccess('');
    const res = await addEventType(newTypeName, newTypeDesc);
    if (!res.success) {
      setTypeError(res.error);
    } else {
      setNewTypeName('');
      setNewTypeDesc('');
      setTypeSuccess('Tipo de evento cadastrado com sucesso!');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  const handleStartEditType = (type) => {
    setEditingTypeId(type.id);
    setEditingTypeName(type.name);
    setEditingTypeDesc(type.description || '');
    setEditingTypeError('');
    setTypeError('');
  };

  const handleSaveEditType = async (id) => {
    setEditingTypeError('');
    const res = await updateEventType(id, editingTypeName, editingTypeDesc);
    if (!res.success) {
      setEditingTypeError(res.error);
    } else {
      setEditingTypeId(null);
      setEditingTypeName('');
      setEditingTypeDesc('');
      setTypeSuccess('Tipo de evento atualizado com sucesso!');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  const handleCancelEditType = () => {
    setEditingTypeId(null);
    setEditingTypeName('');
    setEditingTypeDesc('');
    setEditingTypeError('');
  };

  const handleToggleTypeStatus = async (id) => {
    setTypeError('');
    setTypeSuccess('');
    const res = await toggleEventTypeStatus(id);
    if (!res.success) {
      setTypeError(res.error);
    } else {
      setTypeSuccess(res.active ? 'Tipo de evento reativado com sucesso!' : 'Tipo de evento desativado.');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  const handleDeleteType = async (id) => {
    setTypeError('');
    setTypeSuccess('');
    const res = await deleteEventType(id);
    if (!res.success) {
      setTypeError(res.error);
    } else {
      setTypeSuccess('Tipo de evento excluído com sucesso.');
      setTimeout(() => setTypeSuccess(''), 3000);
    }
  };

  // Handlers para Atividades Padrão (Issue #25)
  const handleAddActivity = async (e) => {
    e.preventDefault();
    setActError('');
    setActSuccess('');
    const res = await addStandardActivity(newActName, newActDuration, newActCategory, newActDesc);
    if (!res.success) {
      setActError(res.error);
    } else {
      setNewActName('');
      setNewActDuration(10);
      setNewActCategory('Liturgia');
      setNewActDesc('');
      setActSuccess('Atividade padrão cadastrada com sucesso!');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const handleStartEditActivity = (act) => {
    setEditingActId(act.id);
    setEditingActName(act.name);
    setEditingActDuration(act.defaultDurationMinutes);
    setEditingActCategory(act.category || 'Liturgia');
    setEditingActDesc(act.description || '');
    setEditingActError('');
    setActError('');
  };

  const handleSaveEditActivity = async (id) => {
    setEditingActError('');
    const res = await updateStandardActivity(id, editingActName, editingActDuration, editingActCategory, editingActDesc);
    if (!res.success) {
      setEditingActError(res.error);
    } else {
      setEditingActId(null);
      setEditingActName('');
      setEditingActDuration(10);
      setEditingActDesc('');
      setActSuccess('Atividade padrão atualizada com sucesso!');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const handleCancelEditActivity = () => {
    setEditingActId(null);
    setEditingActName('');
    setEditingActDuration(10);
    setEditingActCategory('Liturgia');
    setEditingActDesc('');
    setEditingActError('');
  };

  const handleToggleActivityStatus = async (id) => {
    setActError('');
    setActSuccess('');
    const res = await toggleStandardActivityStatus(id);
    if (!res.success) {
      setActError(res.error);
    } else {
      setActSuccess(res.active ? 'Atividade reativada com sucesso!' : 'Atividade desativada.');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const handleDeleteActivity = async (id) => {
    setActError('');
    setActSuccess('');
    const res = await deleteStandardActivity(id);
    if (!res.success) {
      setActError(res.error);
    } else {
      setActSuccess('Atividade padrão excluída com sucesso.');
      setTimeout(() => setActSuccess(''), 3000);
    }
  };

  const currentTemplateInStore = editingTemplateId ? serviceTemplates.find(t => t.id === editingTemplateId) : null;

  const isFormOutdated = React.useMemo(() => {
    if (!editingTemplateId || !editingTemplateOrigin) return false;
    if (!currentTemplateInStore) return true;

    // Se houve falha de sincronização enquanto o formulário estava aberto e foi reconciliado
    if (hadSyncFailureWhileEditing && !isDataStale && !isTemplatesStale) {
      return true;
    }

    // Se o updatedAt remoto divergir do momento da abertura
    if (editingTemplateOrigin.updatedAt && currentTemplateInStore.updatedAt && editingTemplateOrigin.updatedAt !== currentTemplateInStore.updatedAt) {
      return true;
    }

    // Se a contagem de apoios ou atividades divergir do momento da abertura
    const currentServicesCount = currentTemplateInStore.parallelServices?.length ?? currentTemplateInStore.parallelServicesCount ?? 0;
    if (currentServicesCount !== editingTemplateOrigin.parallelServicesCount) {
      return true;
    }
    const currentActsCount = currentTemplateInStore.activities?.length ?? currentTemplateInStore.activitiesCount ?? 0;
    if (currentActsCount !== editingTemplateOrigin.activitiesCount) {
      return true;
    }

    return false;
  }, [editingTemplateId, editingTemplateOrigin, hadSyncFailureWhileEditing, isDataStale, isTemplatesStale, currentTemplateInStore]);

  const handleReloadFormFromCurrent = () => {
    if (!currentTemplateInStore) return;
    setTemplateName(currentTemplateInStore.name);
    setTemplateDesc(currentTemplateInStore.description || '');
    setTemplateEventTypeId(currentTemplateInStore.eventTypeId || '');
    setTemplateActivities(currentTemplateInStore.activities && currentTemplateInStore.activities.length > 0 ? [...currentTemplateInStore.activities].map((a, i) => ({ ...a, displayOrder: i + 1 })) : []);
    setTemplateParallelServices(currentTemplateInStore.parallelServices && currentTemplateInStore.parallelServices.length > 0 ? [...currentTemplateInStore.parallelServices] : []);
    setEditingTemplateOrigin({
      id: currentTemplateInStore.id,
      updatedAt: currentTemplateInStore.updatedAt || null,
      parallelServicesCount: currentTemplateInStore.parallelServices?.length ?? currentTemplateInStore.parallelServicesCount ?? 0,
      activitiesCount: currentTemplateInStore.activities?.length ?? currentTemplateInStore.activitiesCount ?? 0
    });
    setHadSyncFailureWhileEditing(false);
    if (beginEditingTemplate) {
      beginEditingTemplate(currentTemplateInStore.id);
    }
    setTemplateError('');
  };

  // Handlers para Modelos de Culto (Issue #27)
  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    setTemplateError('');
    setTemplateSuccess('');

    if (isDataStale || isTemplatesStale) {
      setTemplateError('Não é possível salvar: os dados do servidor estão desatualizados. Recarregue os dados da igreja antes de continuar.');
      return;
    }

    if (isFormOutdated) {
      setTemplateError('Não é possível salvar: os dados deste modelo foram atualizados no servidor ou reconciliados após uma desconexão. Carregue os dados atuais antes de salvar.');
      return;
    }

    const orderedActivities = templateActivities.map((act, idx) => ({
      ...act,
      displayOrder: idx + 1
    }));

    const payload = {
      name: templateName,
      description: templateDesc,
      eventTypeId: templateEventTypeId || null,
      activities: orderedActivities,
      parallelServices: templateParallelServices
    };

    if (editingTemplateId) {
      const options = {
        originUpdatedAt: editingTemplateOrigin?.updatedAt,
        originParallelServicesCount: editingTemplateOrigin?.parallelServicesCount,
        originActivitiesCount: editingTemplateOrigin?.activitiesCount
      };
      const res = await updateServiceTemplate(editingTemplateId, payload, options);
      if (!res.success) {
        setTemplateError(res.error);
      } else {
        if (cancelEditingTemplate) {
          cancelEditingTemplate(editingTemplateId);
        }
        setEditingTemplateId(null);
        setEditingTemplateOrigin(null);
        setHadSyncFailureWhileEditing(false);
        setTemplateName('');
        setTemplateDesc('');
        setTemplateEventTypeId('');
        setTemplateSuccess('Modelo de culto atualizado com sucesso!');
        setTimeout(() => setTemplateSuccess(''), 3000);
      }
    } else {
      const res = await addServiceTemplate(payload);
      if (!res.success) {
        setTemplateError(res.error);
      } else {
        setTemplateName('');
        setTemplateDesc('');
        setTemplateEventTypeId('');
        setTemplateSuccess('Modelo de culto cadastrado com sucesso!');
        setTimeout(() => setTemplateSuccess(''), 3000);
      }
    }
  };

  const handleStartEditTemplate = (tpl) => {
    if (tpl.isStale || isDataStale || isTemplatesStale) {
      setTemplateError(`Não é possível editar o modelo "${tpl.name}": os dados estão desatualizados. Recarregue os dados da igreja antes de realizar alterações.`);
      return;
    }
    // Regra B3: Um modelo incompleto não pode ser editado como se estivesse carregado
    if (tpl.isComplete === false || (tpl.activitiesCount > 0 && (!tpl.activities || tpl.activities.length === 0))) {
      setTemplateError(`Não é possível editar o modelo "${tpl.name}" porque seus detalhes completos não foram carregados do servidor. Tente recarregar os dados da igreja.`);
      return;
    }
    setEditingTemplateId(tpl.id);
    setEditingTemplateOrigin({
      id: tpl.id,
      updatedAt: tpl.updatedAt || null,
      parallelServicesCount: Array.isArray(tpl.parallelServices) ? tpl.parallelServices.length : (tpl.parallelServicesCount || 0),
      activitiesCount: Array.isArray(tpl.activities) ? tpl.activities.length : (tpl.activitiesCount || 0)
    });
    setHadSyncFailureWhileEditing(false);
    if (beginEditingTemplate) {
      beginEditingTemplate(tpl.id);
    }
    setTemplateName(tpl.name);
    setTemplateDesc(tpl.description || '');
    setTemplateEventTypeId(tpl.eventTypeId || '');
    setTemplateActivities(tpl.activities && tpl.activities.length > 0 ? [...tpl.activities].map((a, i) => ({ ...a, displayOrder: i + 1 })) : []);
    setTemplateParallelServices(tpl.parallelServices && tpl.parallelServices.length > 0 ? [...tpl.parallelServices] : []);
    setTemplateError('');
    setTemplateSuccess('');
  };

  const handleCancelEditTemplate = () => {
    if (cancelEditingTemplate && editingTemplateId) {
      cancelEditingTemplate(editingTemplateId);
    }
    setEditingTemplateId(null);
    setEditingTemplateOrigin(null);
    setHadSyncFailureWhileEditing(false);
    setTemplateName('');
    setTemplateDesc('');
    setTemplateEventTypeId('');
    setTemplateError('');
  };

  const handleToggleTemplateStatus = async (id) => {
    setTemplateError('');
    setTemplateSuccess('');
    const res = await toggleServiceTemplateStatus(id);
    if (!res.success) {
      setTemplateError(res.error);
    } else {
      setTemplateSuccess(res.active ? 'Modelo de culto reativado com sucesso!' : 'Modelo de culto desativado.');
      setTimeout(() => setTemplateSuccess(''), 3000);
    }
  };

  const handleDeleteTemplate = async (id) => {
    setTemplateError('');
    setTemplateSuccess('');
    const res = await deleteServiceTemplate(id);
    if (!res.success) {
      setTemplateError(res.error);
    } else {
      setTemplateSuccess('Modelo de culto excluído com sucesso.');
      setTimeout(() => setTemplateSuccess(''), 3000);
    }
  };

  const handleAddActivityToTemplate = () => {
    if (selectedStandardActForTemplate) {
      const std = standardActivities.find(a => a.id === selectedStandardActForTemplate);
      if (std) {
        setTemplateActivities(prev => [
          ...prev,
          {
            standardActivityId: std.id,
            title: std.name,
            category: std.category || 'Liturgia',
            plannedDurationMinutes: std.defaultDurationMinutes || 10,
            notes: std.description || ''
          }
        ].map((a, i) => ({ ...a, displayOrder: i + 1 })));
        setSelectedStandardActForTemplate('');
        return;
      }
    }
    setTemplateActivities(prev => [
      ...prev,
      {
        title: `Nova Etapa Litúrgica (${prev.length + 1})`,
        category: 'Liturgia',
        plannedDurationMinutes: 10,
        notes: ''
      }
    ].map((a, i) => ({ ...a, displayOrder: i + 1 })));
  };

  const handleRemoveActivityFromTemplate = (idx) => {
    setTemplateActivities(prev => prev.filter((_, i) => i !== idx).map((a, i) => ({ ...a, displayOrder: i + 1 })));
  };

  // Reordenação de Atividades no Modelo (Issue #27)
  const handleMoveActivityUp = (idx) => {
    if (idx <= 0) return;
    setTemplateActivities(prev => {
      const copy = [...prev];
      const temp = copy[idx - 1];
      copy[idx - 1] = copy[idx];
      copy[idx] = temp;
      return copy.map((a, i) => ({ ...a, displayOrder: i + 1 }));
    });
  };

  const handleMoveActivityDown = (idx) => {
    setTemplateActivities(prev => {
      if (idx >= prev.length - 1) return prev;
      const copy = [...prev];
      const temp = copy[idx + 1];
      copy[idx + 1] = copy[idx];
      copy[idx] = temp;
      return copy.map((a, i) => ({ ...a, displayOrder: i + 1 }));
    });
  };

  const handleActivityDragStart = (e, idx) => {
    setDraggedActivityIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleActivityDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleActivityDrop = (e, dropIdx) => {
    e.preventDefault();
    const fromIdx = draggedActivityIdx !== null ? draggedActivityIdx : parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(fromIdx) || fromIdx === dropIdx || fromIdx < 0 || fromIdx >= templateActivities.length) {
      setDraggedActivityIdx(null);
      return;
    }
    setTemplateActivities(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(dropIdx, 0, moved);
      return copy.map((a, i) => ({ ...a, displayOrder: i + 1 }));
    });
    setDraggedActivityIdx(null);
  };

  const handleToggleParallelServiceInTemplate = (idx) => {
    setTemplateParallelServices(prev =>
      prev.map((s, i) => i === idx ? { ...s, isDefaultActive: !s.isDefaultActive } : s)
    );
  };

  const handlePrepMinutesChange = (idx, val) => {
    const parsed = parseInt(val, 10);
    setTemplateParallelServices(prev =>
      prev.map((s, i) => i === idx ? { ...s, prepRequiredMinutes: isNaN(parsed) ? 0 : Math.max(0, Math.min(180, parsed)) } : s)
    );
  };

  // Handlers para Serviços Paralelos do Modelo (Issue #27 / Correção D)
  // Presets sem duplicação acidental:
  // - Ausente: adiciona
  // - Presente e ativo: preserva, sem duplicar
  // - Presente e inativo: reativa preservando configurações
  const handleAddPresetParallelService = (preset) => {
    setTemplateParallelServices(prev => {
      // Identifica estritamente por serviceName, NUNCA por teamId
      const existsIdx = prev.findIndex(s => s.serviceName.toLowerCase() === preset.serviceName.toLowerCase());
      if (existsIdx >= 0) {
        const existing = prev[existsIdx];
        if (!existing.isDefaultActive) {
          // Reativa serviço sem sobrescrever o tempo de preparação customizado
          return prev.map((s, i) => i === existsIdx ? { ...s, isDefaultActive: true } : s);
        }
        // Já presente e ativo: preserva sem duplicar acidentalmente
        return prev;
      }
      return [
        ...prev,
        {
          ...preset,
          id: `tps-${Date.now()}-${prev.length + 1}`,
          isDefaultActive: true
        }
      ];
    });
  };

  const handleAddCustomParallelService = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!customServiceName.trim()) return;
    setTemplateParallelServices(prev => [
      ...prev,
      {
        id: `tps-${Date.now()}-${prev.length + 1}`,
        teamId: customServiceTeamId || 'apoio',
        serviceName: customServiceName.trim(),
        prepRequiredMinutes: Math.max(0, Math.min(180, parseInt(customServicePrepMinutes, 10) || 0)),
        isDefaultActive: true
      }
    ]);
    setCustomServiceName('');
    setCustomServicePrepMinutes(30);
  };

  const handleRemoveParallelService = (idx) => {
    setTemplateParallelServices(prev => prev.filter((_, i) => i !== idx));
  };

  const calculateAntecedentTime = (prepMinutes, baseTime = '19:00') => {
    const [h, m] = baseTime.split(':').map(Number);
    const baseTotalMinutes = h * 60 + m;
    const startMinutes = (baseTotalMinutes - (prepMinutes || 0) + 1440) % 1440;
    const startH = Math.floor(startMinutes / 60);
    const startM = startMinutes % 60;
    return `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
  };

  const handleDesignateLeader = () => {
    setLiturgySuccess('');
    setLiturgyError('');
    if (!targetEventForLiturgy?.id) {
      setLiturgyError('Nenhum evento selecionado para designação.');
      return;
    }
    designateLiturgyLeader(selectedLiturgyLeader, targetEventForLiturgy.id);
    const memberName = members.find(m => m.id === selectedLiturgyLeader)?.name || 'Membro';
    setLiturgySuccess(`Liderança da Liturgia do evento '${targetEventForLiturgy.title || 'Culto'}' atualizada com sucesso para ${memberName}!`);
    setTimeout(() => setLiturgySuccess(''), 4000);
  };

  const isControlsDisabled = !isOnline || isDataStale;
  const isTemplateControlsDisabled = isControlsDisabled || isTemplatesStale;
  const isTypeControlsDisabled = isControlsDisabled || isEventTypesStale;
  const isActivityControlsDisabled = isControlsDisabled || isActivitiesStale;
  const isReasonControlsDisabled = isControlsDisabled || isReasonsStale;

  return (
    <div className="admin-container">
      {/* Barra de Navegação Superior / Voltar ao Início */}
      {onBack && (
        <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            id="btn-back-to-home"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
          >
            ← Voltar ao Início da Igreja
          </button>
          <span className="badge badge-pending" style={{ fontSize: '0.85rem' }}>
            Igreja: {church?.name || 'Igreja Conectada'}
          </span>
        </div>
      )}

      {/* Banner de Indisponibilidade Remota das Migrações 020-023 */}
      {remoteError && (
        <div
          id="banner-backend-unavailability"
          className="card"
          style={{
            borderLeft: '4px solid #f59e0b',
            background: '#fffbeb',
            color: '#92400e',
            marginBottom: '1.25rem',
            padding: '1rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 600 }}>
            <AlertCircle size={20} color="#d97706" />
            <span>Indisponibilidade de Serviços de Cadastros no Supabase</span>
          </div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            {remoteError}
          </p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#b45309' }}>
            As tabelas ou RPCs das migrações 020 a 023 ainda não estão disponíveis no banco. A interface está em modo de visualização segura; cadastros não serão gravados localmente como falso sucesso.
          </p>
          {reloadRemoteData && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={reloadRemoteData}
              disabled={remoteLoading}
              style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              {remoteLoading ? 'Verificando conexão...' : 'Tentar reconectar'}
            </button>
          )}
        </div>
      )}

      {/* Cabeçalho de Administração */}
      <div className="card admin-header-card">
        <div>
          <div className="tag-row">
            <span className="badge badge-primary">Painel de Administração Web (Exclusivo Admin)</span>
            <span className="badge badge-pending">Igreja: {church.name}</span>
          </div>
          <h1 className="admin-title">Administração da Igreja</h1>
          <p className="admin-subtitle">
            Gerenciamento global restrito a administradores (PRD 3.2, 4 e 5). Configure tipos de evento, modelos de culto,
            atividades com durações padrão, motivos de cancelamento, convites de acesso e designe a liderança da liturgia por evento.
          </p>
        </div>
      </div>

      {/* Sub-Navegação Administrativa Responsiva */}
      <div
        className="admin-nav-tabs"
        role="tablist"
        aria-label="Abas da Administração da Igreja"
        onKeyDown={handleTabKeyDown}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'event_types'}
          aria-controls="panel-admin-event-types"
          tabIndex={activeAdminTab === 'event_types' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'event_types' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('event_types')}
          id="tab-admin-event-types"
        >
          <Calendar size={16} /> Tipos de Evento (PRD §5)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'templates'}
          aria-controls="panel-admin-templates"
          tabIndex={activeAdminTab === 'templates' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'templates' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('templates')}
          id="tab-admin-templates"
        >
          <Layers size={16} /> Modelos de Culto (PRD §5 / #27)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'activities'}
          aria-controls="panel-admin-activities"
          tabIndex={activeAdminTab === 'activities' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'activities' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('activities')}
          id="tab-admin-activities"
        >
          <Clock size={16} /> Atividades & Durações (PRD §5)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'reasons'}
          aria-controls="panel-admin-reasons"
          tabIndex={activeAdminTab === 'reasons' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'reasons' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('reasons')}
          id="tab-admin-reasons"
        >
          <Tag size={16} /> Motivos de Cancelamento Web (PRD 7.3)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'invites'}
          aria-controls="panel-admin-invites"
          tabIndex={activeAdminTab === 'invites' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'invites' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('invites')}
          id="tab-admin-invites"
        >
          <UserPlus size={16} /> Convites de Acesso à Igreja (PRD 3.1)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'liturgy'}
          aria-controls="panel-admin-liturgy"
          tabIndex={activeAdminTab === 'liturgy' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'liturgy' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('liturgy')}
          id="tab-admin-liturgy"
        >
          <Shield size={16} /> Designação da Liturgia por Evento (PRD 3.2)
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeAdminTab === 'members'}
          aria-controls="panel-admin-members"
          tabIndex={activeAdminTab === 'members' ? 0 : -1}
          className={`admin-tab-btn ${activeAdminTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveAdminTab('members')}
          id="tab-admin-members"
        >
          <Users size={16} /> Membros e Aptidões (PRD 3)
        </button>
      </div>

      {/* ABA 1: CONVITES DE ACESSO À IGREJA (PRD 3.1 & Cenário M01, M40) */}
      {activeAdminTab === 'invites' && (
        <div
          role="tabpanel"
          id="panel-admin-invites"
          aria-labelledby="tab-admin-invites"
          tabIndex={0}
          className="grid-2"
        >
          <div className="card">
            <h2 className="tab-sec-title">
              <UserPlus size={18} color="var(--primary)" /> Enviar Convite de Acesso
            </h2>
            <p className="tab-sec-desc">
              O convite permite à pessoa entrar na igreja pelo login Google/Apple. Conforme o PRD 3.1:
              <strong> fazer login sem convite não libera dados da igreja</strong> e somente admin pode emitir convites.
            </p>

            {inviteSuccess && (
              <div className="success-banner">
                <CheckCircle2 size={16} /> Convite enviado com sucesso!
              </div>
            )}

            <form onSubmit={handleSendInvite}>
              <div className="form-group">
                <label className="form-label">Nome Completo do Membro:</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ex: João da Silva"
                  value={inviteMemberName}
                  onChange={e => setInviteMemberName(e.target.value)}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">E-mail do Membro (Conta Google / Apple):</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="membro@gmail.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={isControlsDisabled}
              >
                <Send size={15} /> Emitir Convite Oficial de Acesso
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="tab-sec-title">Convites Emitidos Recentemente</h2>
            <div className="invites-list">
              {accessInvites.map(inv => (
                <div key={inv.id} className="invite-row-item">
                  <div className="inv-info">
                    <div className="inv-name">{inv.memberName}</div>
                    <div className="inv-email">{inv.email}</div>
                    <div className="inv-date">Enviado em: {inv.sentAt}</div>
                  </div>
                  <span className={`badge ${inv.status === 'Aceito' ? 'badge-primary' : 'badge-pending'}`}>
                    {inv.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: DESIGNAÇÃO DA LIDERANÇA DA LITURGIA (PRD 3.2, Cenário M05 & Issue #28 CA03) */}
      {activeAdminTab === 'liturgy' && (
        <div
          role="tabpanel"
          id="panel-admin-liturgy"
          aria-labelledby="tab-admin-liturgy"
          tabIndex={0}
          className="card"
        >
          <h2 className="tab-sec-title">
            <Shield size={18} color="var(--primary)" /> Designação da Liderança da Liturgia por Evento
          </h2>
          <p className="tab-sec-desc">
            A liderança da liturgia é designada por edição do evento (o culto de domingo pode ter uma pessoa, o de quarta outra).
            <strong> Somente o Administrador pode designar e trocar essa liderança</strong> (PRD 3.2, Cenários M05, M40 e Issue #28 CA03).
            Controlar uma edição de culto não concede controle sobre as demais, e ser administrador não concede condução automática.
          </p>

          {liturgySuccess && (
            <div className="success-banner" style={{ marginBottom: '1rem' }}>
              <CheckCircle2 size={16} /> {liturgySuccess}
            </div>
          )}
          {liturgyError && (
            <div className="error-banner" style={{ marginBottom: '1rem', color: '#dc2626' }}>
              <AlertCircle size={16} /> {liturgyError}
            </div>
          )}

          {events.length === 0 ? (
            <div style={{ padding: '1.25rem', background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
              Nenhum culto ou evento cadastrado para esta igreja no momento. Crie um evento no Planejamento de Cultos para poder designar a liderança da liturgia.
            </div>
          ) : (
            <div className="current-event-leader-box">
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label" style={{ fontWeight: 700 }}>Selecione a Edição do Evento:</label>
                <select
                  id="select-admin-liturgy-event"
                  className="form-select"
                  value={selectedEventIdForLiturgy}
                  onChange={e => {
                    setSelectedEventIdForLiturgy(e.target.value);
                    const ev = events.find(item => item.id === e.target.value);
                    if (ev) setSelectedLiturgyLeader(ev.liturgyLeaderId);
                  }}
                  disabled={isControlsDisabled}
                >
                  {events.map(ev => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({ev.date} às {ev.scheduledStartTime}) — Líder Atual: {members.find(m => m.id === ev.liturgyLeaderId)?.name || 'Não designado'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="current-lead-header">
                Evento em Configuração: <strong>{targetEventForLiturgy?.title || 'Culto'}</strong> ({targetEventForLiturgy?.date || ''})
              </div>

              <div className="designation-form-row">
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Selecione o Líder da Liturgia Designado:</label>
                  <select
                    id="select-admin-liturgy-leader"
                    className="form-select"
                    value={selectedLiturgyLeader}
                    onChange={e => setSelectedLiturgyLeader(e.target.value)}
                    disabled={isControlsDisabled}
                  >
                    {members.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name} — Papéis: {m.roles?.join(', ')} ({m.teams?.join(', ')})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  id="btn-save-admin-liturgy-designation"
                  className="btn btn-primary"
                  onClick={handleDesignateLeader}
                  disabled={isControlsDisabled}
                  style={{ marginTop: '22px' }}
                >
                  Salvar Designação do Culto
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 3: MOTIVOS DE CANCELAMENTO PRÉ-CADASTRADOS (PRD 7.3 & Cenário M12) */}
      {activeAdminTab === 'reasons' && (
        <div
          role="tabpanel"
          id="panel-admin-reasons"
          aria-labelledby="tab-admin-reasons"
          tabIndex={0}
          className="grid-2"
        >
          <div className="card">
            <h2 className="tab-sec-title">
              <Tag size={18} color="var(--primary)" /> Cadastrar Motivo de Cancelamento
            </h2>
            <p className="tab-sec-desc">
              Conforme o <strong>PRD 7.3 e Cenário M12</strong>, durante a execução do culto o cancelamento de uma
              atividade exige motivo pré-cadastrado na Web pelo administrador. O mobile ou tela operacional não permite cadastrar motivos na hora da emergência.
            </p>

            {reasonError && (
              <div className="alert alert-danger" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '6px' }}>
                <AlertCircle size={16} />
                <span>{reasonError}</span>
              </div>
            )}

            {reasonSuccess && (
              <div className="alert alert-success" style={{ marginBottom: '14px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '6px' }}>
                <CheckCircle2 size={16} />
                <span>{reasonSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddReason}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Descrição do Motivo Pré-Aprovado:</label>
                  <span style={{ fontSize: '11px', color: newReasonText.length > 120 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newReasonText.length}/120
                  </span>
                </div>
                <input
                  type="text"
                  id="new-cancel-reason-input"
                  className="form-input"
                  placeholder="Ex: Falha no gerador de energia..."
                  value={newReasonText}
                  maxLength={120}
                  onChange={e => {
                    setNewReasonText(e.target.value);
                    if (reasonError) setReasonError('');
                  }}
                  disabled={isReasonControlsDisabled}
                  required
                />
              </div>

              <button
                type="submit"
                id="btn-add-cancel-reason"
                className="btn btn-primary"
                disabled={isReasonControlsDisabled || !newReasonText.trim()}
              >
                <Plus size={15} /> Cadastrar Novo Motivo
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 className="tab-sec-title" style={{ margin: 0 }}>
                Motivos de Cancelamento ({cancelReasons.length})
              </h2>
              <span className="badge badge-primary">
                {cancelReasons.filter(r => r.active !== false).length} Ativos
              </span>
            </div>

            {cancelReasons.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                <Tag size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                <p>Nenhum motivo cadastrado para esta igreja.</p>
              </div>
            ) : (
              <div className="reasons-list">
                {cancelReasons.map((reason, idx) => {
                  const isEditing = editingReasonId === reason.id;
                  const isUsed = isReasonUsedInActivities(reason, event.activities);
                  const isActive = reason.active !== false;

                  return (
                    <div
                      key={reason.id || idx}
                      id={`reason-item-${idx}`}
                      className="reason-item-row"
                      style={{
                        opacity: isActive ? 1 : 0.65,
                        borderColor: isEditing ? 'var(--primary)' : undefined,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: '8px'
                      }}
                    >
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="text"
                              id={`edit-reason-input-${idx}`}
                              className="form-input"
                              value={editingReasonText}
                              maxLength={120}
                              onChange={e => setEditingReasonText(e.target.value)}
                              style={{ flex: 1, fontSize: '13px', padding: '6px 10px' }}
                              autoFocus
                            />
                            <button
                              type="button"
                              id={`btn-save-reason-${idx}`}
                              className="btn btn-primary"
                              onClick={() => handleSaveEditReason(reason.id)}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                              title="Salvar alteração"
                            >
                              <Check size={14} /> Salvar
                            </button>
                            <button
                              type="button"
                              id={`btn-cancel-edit-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={handleCancelEditReason}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                              title="Cancelar edição"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          {editingError && (
                            <span style={{ fontSize: '12px', color: '#ef4444' }}>{editingError}</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                            <span
                              style={{
                                fontWeight: 500,
                                textDecoration: isActive ? 'none' : 'line-through',
                                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)'
                              }}
                            >
                              {reason.name}
                            </span>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              <span className={`badge ${isActive ? 'badge-primary' : 'badge-pending'}`}>
                                {isActive ? 'Ativo' : 'Inativo'}
                              </span>
                              {isUsed && (
                                <span className="badge badge-live" title="Utilizado em registros de atividades do histórico">
                                  Em Histórico
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              id={`btn-edit-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleStartEditReason(reason)}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              title="Alterar descrição do motivo"
                              disabled={isControlsDisabled}
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              type="button"
                              id={`btn-toggle-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleToggleReasonStatus(reason.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isActive ? '#f59e0b' : '#10b981'
                              }}
                              title={isActive ? 'Desativar motivo (preserva histórico)' : 'Reativar motivo para seleção'}
                              disabled={isControlsDisabled}
                            >
                              <Power size={12} style={{ marginRight: '4px' }} />
                              {isActive ? 'Desativar' : 'Ativar'}
                            </button>

                            <button
                              type="button"
                              id={`btn-delete-reason-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleDeleteReason(reason.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isUsed ? 'var(--text-muted)' : '#ef4444',
                                opacity: isUsed ? 0.5 : 1
                              }}
                              title={
                                isUsed
                                  ? 'Motivo utilizado em histórico não pode ser excluído; desative-o em vez de excluir'
                                  : 'Excluir motivo não utilizado'
                              }
                              disabled={isControlsDisabled}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA: TIPOS DE EVENTO (PRD §5 - Issue #25) */}
      {activeAdminTab === 'event_types' && (
        <div
          role="tabpanel"
          id="panel-admin-event-types"
          aria-labelledby="tab-admin-event-types"
          tabIndex={0}
          className="grid-2"
        >
          <div className="card">
            <h2 className="tab-sec-title">
              <Calendar size={18} color="var(--primary)" /> Cadastrar Tipo de Evento
            </h2>
            <p className="tab-sec-desc">
              Tipos definem as categorias de culto e reuniões da igreja (ex: Celebração Geral, Culto de Oração, Ensaio).
              Conforme o <strong>PRD §4 e §5</strong>, o cadastro é exclusivo na Web por administradores.
            </p>

            {typeError && (
              <div className="error-banner" style={{ marginBottom: '16px' }}>
                <AlertCircle size={16} />
                <span>{typeError}</span>
              </div>
            )}

            {typeSuccess && (
              <div className="success-banner" style={{ marginBottom: '16px' }}>
                <CheckCircle2 size={16} />
                <span>{typeSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddType}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Nome do Tipo de Evento:</label>
                  <span style={{ fontSize: '11px', color: newTypeName.length > 100 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newTypeName.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  id="new-event-type-name-input"
                  className="form-input"
                  placeholder="Ex: Culto de Celebração de Domingo"
                  value={newTypeName}
                  maxLength={100}
                  onChange={e => {
                    setNewTypeName(e.target.value);
                    if (typeError) setTypeError('');
                  }}
                  disabled={isTypeControlsDisabled}
                  required
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Descrição ou Objetivo (opcional):</label>
                  <span style={{ fontSize: '11px', color: newTypeDesc.length > 255 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newTypeDesc.length}/255
                  </span>
                </div>
                <input
                  type="text"
                  id="new-event-type-desc-input"
                  className="form-input"
                  placeholder="Ex: Culto principal congregacional com louvor e palavra"
                  value={newTypeDesc}
                  maxLength={255}
                  onChange={e => {
                    setNewTypeDesc(e.target.value);
                    if (typeError) setTypeError('');
                  }}
                  disabled={isTypeControlsDisabled}
                />
              </div>

              <button
                type="submit"
                id="btn-add-event-type"
                className="btn btn-primary"
                disabled={isTypeControlsDisabled || !newTypeName.trim()}
              >
                <Plus size={15} /> Cadastrar Tipo de Evento
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 className="tab-sec-title" style={{ margin: 0 }}>
                Tipos de Evento ({eventTypes.length})
              </h2>
              <span className="badge badge-primary">
                {eventTypes.filter(t => t.active !== false).length} Ativos
              </span>
            </div>

            {eventTypes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                <Calendar size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                <p>Nenhum tipo de evento cadastrado nesta igreja.</p>
              </div>
            ) : (
              <div className="reasons-list">
                {eventTypes.map((type, idx) => {
                  const isEditing = editingTypeId === type.id;
                  const isUsed = isEventTypeUsed(type, [event]);
                  const isActive = type.active !== false;

                  return (
                    <div
                      key={type.id || idx}
                      id={`event-type-item-${idx}`}
                      className="reason-item-row"
                      style={{
                        opacity: isActive ? 1 : 0.65,
                        borderColor: isEditing ? 'var(--primary)' : undefined,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: '8px'
                      }}
                    >
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <input
                            type="text"
                            id={`edit-event-type-name-${idx}`}
                            className="form-input"
                            value={editingTypeName}
                            maxLength={100}
                            onChange={e => setEditingTypeName(e.target.value)}
                            style={{ fontSize: '13px', padding: '6px 10px' }}
                            placeholder="Nome do tipo"
                            autoFocus
                          />
                          <input
                            type="text"
                            id={`edit-event-type-desc-${idx}`}
                            className="form-input"
                            value={editingTypeDesc}
                            maxLength={255}
                            onChange={e => setEditingTypeDesc(e.target.value)}
                            style={{ fontSize: '12px', padding: '6px 10px' }}
                            placeholder="Descrição opcional"
                          />
                          {editingTypeError && (
                            <span style={{ fontSize: '11px', color: '#ef4444' }}>{editingTypeError}</span>
                          )}
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              id={`btn-save-event-type-${idx}`}
                              className="btn btn-primary"
                              onClick={() => handleSaveEditType(type.id)}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <Check size={14} /> Salvar
                            </button>
                            <button
                              type="button"
                              id={`btn-cancel-edit-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={handleCancelEditType}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <X size={14} /> Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: '14px', textDecoration: isActive ? 'none' : 'line-through' }}>
                                {type.name}
                              </strong>
                              {!isActive && (
                                <span className="badge badge-pending" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                  Inativo
                                </span>
                              )}
                              {isUsed && (
                                <span className="badge" style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                                  Em uso
                                </span>
                              )}
                            </div>
                            {type.description && (
                              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {type.description}
                              </p>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              id={`btn-edit-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleStartEditType(type)}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              title="Editar tipo"
                              disabled={isControlsDisabled}
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              type="button"
                              id={`btn-toggle-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleToggleTypeStatus(type.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isActive ? '#f59e0b' : '#10b981'
                              }}
                              title={isActive ? 'Desativar tipo de evento' : 'Reativar tipo de evento'}
                              disabled={isControlsDisabled}
                            >
                              <Power size={12} style={{ marginRight: '4px' }} />
                              {isActive ? 'Desativar' : 'Ativar'}
                            </button>

                            <button
                              type="button"
                              id={`btn-delete-event-type-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleDeleteType(type.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isUsed ? 'var(--text-muted)' : '#ef4444',
                                opacity: isUsed ? 0.5 : 1
                              }}
                              title={
                                isUsed
                                  ? 'Tipo de evento utilizado em histórico não pode ser excluído; desative-o em vez de excluir'
                                  : 'Excluir tipo de evento'
                              }
                              disabled={isControlsDisabled}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA: ATIVIDADES PADRÃO & DURAÇÕES (PRD §5 & CA02 - Issue #25) */}
      {activeAdminTab === 'activities' && (
        <div
          role="tabpanel"
          id="panel-admin-activities"
          aria-labelledby="tab-admin-activities"
          tabIndex={0}
          className="grid-2"
        >
          <div className="card">
            <h2 className="tab-sec-title">
              <Clock size={18} color="var(--primary)" /> Cadastrar Atividade Padrão
            </h2>
            <p className="tab-sec-desc">
              Atividades reutilizáveis para a ordem do culto. Conforme o <strong>PRD §5 (CA02)</strong>,
              as durações padrão são livremente configuráveis (exemplos de 5, 15 ou 20 min não são universais).
            </p>

            {actError && (
              <div className="error-banner" style={{ marginBottom: '16px' }}>
                <AlertCircle size={16} />
                <span>{actError}</span>
              </div>
            )}

            {actSuccess && (
              <div className="success-banner" style={{ marginBottom: '16px' }}>
                <CheckCircle2 size={16} />
                <span>{actSuccess}</span>
              </div>
            )}

            <form onSubmit={handleAddActivity}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Nome da Atividade:</label>
                  <span style={{ fontSize: '11px', color: newActName.length > 100 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newActName.length}/100
                  </span>
                </div>
                <input
                  type="text"
                  id="new-activity-name-input"
                  className="form-input"
                  placeholder="Ex: Louvor e Adoração Congregacional"
                  value={newActName}
                  maxLength={100}
                  onChange={e => {
                    setNewActName(e.target.value);
                    if (actError) setActError('');
                  }}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <div className="grid-2" style={{ gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Duração Padrão (minutos):</label>
                  <input
                    type="number"
                    id="new-activity-duration-input"
                    className="form-input"
                    min={1}
                    max={720}
                    value={newActDuration}
                    onChange={e => {
                      setNewActDuration(parseInt(e.target.value) || '');
                      if (actError) setActError('');
                    }}
                    disabled={isControlsDisabled}
                    required
                  />
                  <small style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                    CA02: Configurável livremente (1 a 720 min)
                  </small>
                </div>

                <div className="form-group">
                  <label className="form-label">Categoria Litúrgica:</label>
                  <select
                    id="new-activity-category-select"
                    className="form-input"
                    value={newActCategory}
                    onChange={e => setNewActCategory(e.target.value)}
                    disabled={isControlsDisabled}
                  >
                    <option value="Liturgia">Liturgia & Direção</option>
                    <option value="Louvor">Louvor & Adoração</option>
                    <option value="Palavra">Ministração da Palavra</option>
                    <option value="Pastoral">Momento Pastoral & Avisos</option>
                    <option value="Apoio">Serviço de Apoio Técnico</option>
                    <option value="Comunhão">Comunhão & Encerramento</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Descrição ou Observação Padrão (opcional):</label>
                  <span style={{ fontSize: '11px', color: newActDesc.length > 255 ? '#ef4444' : 'var(--text-muted)' }}>
                    {newActDesc.length}/255
                  </span>
                </div>
                <input
                  type="text"
                  id="new-activity-desc-input"
                  className="form-input"
                  placeholder="Ex: Bloco de músicas com participação da equipe"
                  value={newActDesc}
                  maxLength={255}
                  onChange={e => {
                    setNewActDesc(e.target.value);
                    if (actError) setActError('');
                  }}
                  disabled={isActivityControlsDisabled}
                />
              </div>

              <button
                type="submit"
                id="btn-add-activity"
                className="btn btn-primary"
                disabled={isActivityControlsDisabled || !newActName.trim() || !newActDuration}
              >
                <Plus size={15} /> Cadastrar Atividade Padrão
              </button>
            </form>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2 className="tab-sec-title" style={{ margin: 0 }}>
                Atividades Cadastradas ({standardActivities.length})
              </h2>
              <span className="badge badge-primary">
                {standardActivities.filter(a => a.active !== false).length} Ativas
              </span>
            </div>

            {standardActivities.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                <Clock size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                <p>Nenhuma atividade padrão cadastrada nesta igreja.</p>
              </div>
            ) : (
              <div className="reasons-list">
                {standardActivities.map((act, idx) => {
                  const isEditing = editingActId === act.id;
                  const isUsed = isStandardActivityUsed(act, event.activities);
                  const isActive = act.active !== false;

                  return (
                    <div
                      key={act.id || idx}
                      id={`activity-item-${idx}`}
                      className="reason-item-row"
                      style={{
                        opacity: isActive ? 1 : 0.65,
                        borderColor: isEditing ? 'var(--primary)' : undefined,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: '8px'
                      }}
                    >
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                              type="text"
                              id={`edit-activity-name-${idx}`}
                              className="form-input"
                              value={editingActName}
                              maxLength={100}
                              onChange={e => setEditingActName(e.target.value)}
                              style={{ flex: 2, fontSize: '13px', padding: '6px 10px' }}
                              placeholder="Nome da atividade"
                              autoFocus
                            />
                            <input
                              type="number"
                              id={`edit-activity-duration-${idx}`}
                              className="form-input"
                              min={1}
                              max={720}
                              value={editingActDuration}
                              onChange={e => setEditingActDuration(parseInt(e.target.value) || '')}
                              style={{ flex: 1, fontSize: '13px', padding: '6px 10px' }}
                              placeholder="Duração (min)"
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select
                              id={`edit-activity-category-${idx}`}
                              className="form-input"
                              value={editingActCategory}
                              onChange={e => setEditingActCategory(e.target.value)}
                              style={{ flex: 1, fontSize: '12px', padding: '6px 10px' }}
                            >
                              <option value="Liturgia">Liturgia</option>
                              <option value="Louvor">Louvor</option>
                              <option value="Palavra">Palavra</option>
                              <option value="Pastoral">Pastoral</option>
                              <option value="Apoio">Apoio</option>
                              <option value="Comunhão">Comunhão</option>
                            </select>
                            <input
                              type="text"
                              id={`edit-activity-desc-${idx}`}
                              className="form-input"
                              value={editingActDesc}
                              maxLength={255}
                              onChange={e => setEditingActDesc(e.target.value)}
                              style={{ flex: 2, fontSize: '12px', padding: '6px 10px' }}
                              placeholder="Observação padrão"
                            />
                          </div>

                          {editingActError && (
                            <span style={{ fontSize: '11px', color: '#ef4444' }}>{editingActError}</span>
                          )}

                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              id={`btn-save-activity-${idx}`}
                              className="btn btn-primary"
                              onClick={() => handleSaveEditActivity(act.id)}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <Check size={14} /> Salvar
                            </button>
                            <button
                              type="button"
                              id={`btn-cancel-edit-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={handleCancelEditActivity}
                              style={{ padding: '6px 10px', fontSize: '12px' }}
                            >
                              <X size={14} /> Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <strong style={{ fontSize: '14px', textDecoration: isActive ? 'none' : 'line-through' }}>
                                {act.name}
                              </strong>
                              <span className="badge" style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
                                <Clock size={10} style={{ marginRight: '3px' }} />
                                {act.defaultDurationMinutes} min
                              </span>
                              <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                {act.category || 'Liturgia'}
                              </span>
                              {!isActive && (
                                <span className="badge badge-pending" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                  Inativa
                                </span>
                              )}
                              {isUsed && (
                                <span className="badge" style={{ fontSize: '10px', padding: '2px 6px', background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                                  No Culto
                                </span>
                              )}
                            </div>
                            {act.description && (
                              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                                {act.description}
                              </p>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              id={`btn-edit-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleStartEditActivity(act)}
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              title="Editar atividade"
                              disabled={isControlsDisabled}
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              type="button"
                              id={`btn-toggle-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleToggleActivityStatus(act.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isActive ? '#f59e0b' : '#10b981'
                              }}
                              title={isActive ? 'Desativar atividade padrão' : 'Reativar atividade padrão'}
                              disabled={isControlsDisabled}
                            >
                              <Power size={12} style={{ marginRight: '4px' }} />
                              {isActive ? 'Desativar' : 'Ativar'}
                            </button>

                            <button
                              type="button"
                              id={`btn-delete-activity-${idx}`}
                              className="btn btn-secondary"
                              onClick={() => handleDeleteActivity(act.id)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: isUsed ? 'var(--text-muted)' : '#ef4444',
                                opacity: isUsed ? 0.5 : 1
                              }}
                              title={
                                isUsed
                                  ? 'Atividade utilizada no culto não pode ser excluída fisicamente; desative-a em vez de excluir'
                                  : 'Excluir atividade'
                              }
                              disabled={isControlsDisabled}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA: MODELOS DE CULTO COM ATIVIDADES E APOIOS PADRÃO (PRD §5 & M28 - Issue #27) */}
      {activeAdminTab === 'templates' && (
        <div
          role="tabpanel"
          id="panel-admin-templates"
          aria-labelledby="tab-admin-templates"
          tabIndex={0}
          className="grid-2"
        >
          {/* Formulário de Criação / Edição de Modelo */}
          <div className="card">
            <h2 className="tab-sec-title">
              <Layers size={18} color="var(--primary)" /> {editingTemplateId ? 'Editar Modelo de Culto' : 'Novo Modelo Reutilizável de Culto'}
            </h2>
            <p className="tab-sec-desc">
              Estruture modelos vinculados ao tipo de evento com a sequência litúrgica e os apoios padrão (como portaria e transmissão).
              Conforme o <strong>PRD §5 e CA03</strong>, o modelo organiza as etapas sem escalar ou reservar pessoas automaticamente.
            </p>

            {templateSuccess && (
              <div className="success-banner">
                <CheckCircle2 size={16} /> {templateSuccess}
              </div>
            )}

            {templateError && (
              <div className="error-banner">
                <AlertCircle size={16} /> {templateError}
              </div>
            )}

            {(isDataStale || isTemplatesStale) && (
              <div
                id="template-stale-warning"
                className="error-banner"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  backgroundColor: '#fffbeb',
                  color: '#92400e',
                  borderColor: '#fcd34d',
                  marginBottom: '1rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={18} color="#b45309" />
                  <span style={{ fontSize: '13px' }}>
                    <strong>Dados desatualizados:</strong> A sincronização com o servidor falhou. O conteúdo existente é exibido apenas para consulta. Edições e aplicações estão bloqueadas até a reconciliação.
                  </span>
                </div>
                {reloadRemoteData && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    id="btn-retry-template-sync"
                    onClick={() => reloadRemoteData()}
                    disabled={remoteLoading}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {remoteLoading ? 'Sincronizando...' : 'Tentar novamente'}
                  </button>
                )}
              </div>
            )}

            {isFormOutdated && (
              <div
                id="template-outdated-warning"
                className="error-banner"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  backgroundColor: '#fffbeb',
                  color: '#92400e',
                  borderColor: '#fcd34d',
                  marginBottom: '1rem',
                  padding: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={18} color="#b45309" />
                  <span style={{ fontSize: '13px' }}>
                    <strong>Dados atualizados no servidor:</strong> Este modelo foi modificado por outra sessão ou sincronizado com novos dados após uma desconexão. Para não sobrescrever alterações remotas (como serviços ou etapas adicionadas), o salvamento está bloqueado.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  id="btn-reload-template-from-server"
                  onClick={handleReloadFormFromCurrent}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Carregar dados atuais
                </button>
              </div>
            )}

            <form onSubmit={handleSaveTemplate}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" htmlFor="template-name-input">
                    Nome do Modelo:
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {templateName.length}/100
                  </span>
                </div>
                <input
                  id="template-name-input"
                  type="text"
                  className="form-input"
                  placeholder="Ex: Culto Dominical com Apoio Completo"
                  maxLength={100}
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  disabled={isControlsDisabled}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="template-event-type-select">
                  Tipo de Evento Vinculado:
                </label>
                <select
                  id="template-event-type-select"
                  className="form-select"
                  value={templateEventTypeId}
                  onChange={e => setTemplateEventTypeId(e.target.value)}
                  disabled={isControlsDisabled}
                >
                  <option value="">-- Selecione o Tipo de Evento (Opcional) --</option>
                  {eventTypes.filter(t => t.active !== false).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" htmlFor="template-desc-input">
                    Descrição do Modelo (Opcional):
                  </label>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {templateDesc.length}/255
                  </span>
                </div>
                <textarea
                  id="template-desc-input"
                  className="form-input"
                  rows={2}
                  placeholder="Finalidade e orientações litúrgicas deste modelo"
                  maxLength={255}
                  value={templateDesc}
                  onChange={e => setTemplateDesc(e.target.value)}
                  disabled={isControlsDisabled}
                />
              </div>

              {/* Construtor de Atividades Principais do Modelo com Reordenação (Issue #27) */}
              <div className="form-group" style={{ background: 'var(--bg-inset)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label className="form-label" style={{ fontWeight: 700, margin: 0 }}>
                    <Clock size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                    Etapas Litúrgicas do Modelo ({templateActivities.length})
                  </label>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                    Duração Litúrgica Total: {templateActivities.reduce((s, a) => s + (parseInt(a.plannedDurationMinutes) || 0), 0)} min
                  </span>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                  Reorganize a sequência litúrgica arrastando e soltando ou usando os botões ▲ e ▼. A numeração é recalculada automaticamente e modificações não alteram eventos já criados (CA04).
                </p>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <select
                    id="template-select-standard-act"
                    className="form-select"
                    value={selectedStandardActForTemplate}
                    onChange={e => setSelectedStandardActForTemplate(e.target.value)}
                    style={{ flex: 1, fontSize: '12px' }}
                    disabled={isControlsDisabled}
                  >
                    <option value="">-- Escolher de Atividades Padrão --</option>
                    {standardActivities.filter(a => a.active !== false).map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.defaultDurationMinutes} min)</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    id="btn-add-activity-to-template"
                    className="btn btn-sm btn-secondary"
                    onClick={handleAddActivityToTemplate}
                    disabled={isControlsDisabled}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Plus size={14} /> Adicionar Etapa
                  </button>
                </div>

                {templateActivities.length === 0 ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                    Nenhuma atividade na sequência principal deste modelo.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {templateActivities.map((act, idx) => (
                      <div
                        key={idx}
                        id={`template-activity-row-${idx}`}
                        draggable={!isControlsDisabled}
                        onDragStart={(e) => handleActivityDragStart(e, idx)}
                        onDragOver={handleActivityDragOver}
                        onDrop={(e) => handleActivityDrop(e, idx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: draggedActivityIdx === idx ? 'var(--bg-card-hover)' : 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '12px',
                          cursor: isControlsDisabled ? 'default' : 'grab',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                          {/* Controles Acessíveis de Subir e Descer */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <button
                              type="button"
                              id={`btn-move-up-template-activity-${idx}`}
                              onClick={() => handleMoveActivityUp(idx)}
                              disabled={isControlsDisabled || idx === 0}
                              title="Mover atividade para cima"
                              aria-label={`Mover ${act.title} para cima`}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                padding: '1px 3px',
                                color: idx === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                                fontSize: '10px',
                                lineHeight: 1
                              }}
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              id={`btn-move-down-template-activity-${idx}`}
                              onClick={() => handleMoveActivityDown(idx)}
                              disabled={isControlsDisabled || idx === templateActivities.length - 1}
                              title="Mover atividade para baixo"
                              aria-label={`Mover ${act.title} para baixo`}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: idx === templateActivities.length - 1 ? 'not-allowed' : 'pointer',
                                padding: '1px 3px',
                                color: idx === templateActivities.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                                fontSize: '10px',
                                lineHeight: 1
                              }}
                            >
                              ▼
                            </button>
                          </div>

                          <span style={{ fontWeight: 800, color: 'var(--primary)', minWidth: '22px' }}>{idx + 1}.</span>
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.title}</span>
                          <span className="badge badge-primary" style={{ fontSize: '10px', padding: '2px 6px' }}>{act.category || 'Liturgia'}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{act.plannedDurationMinutes} min</span>
                          <button
                            type="button"
                            id={`btn-remove-template-act-${idx}`}
                            onClick={() => handleRemoveActivityFromTemplate(idx)}
                            disabled={isControlsDisabled}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                            title="Remover etapa"
                            aria-label={`Remover ${act.title}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Construtor Completo de Serviços Paralelos / Apoios Técnicos com Preparação Prévia (Issue #27) */}
              <div className="form-group" style={{ background: 'var(--bg-inset)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ fontWeight: 700, margin: 0 }}>
                    <Shield size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                    Serviços Paralelos & Apoios Técnicos (Issue #27)
                  </label>
                  <span className="badge badge-secondary" style={{ fontSize: '11px' }}>
                    {templateParallelServices.filter(s => s.isDefaultActive).length} Apoios Ativos
                  </span>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.4 }}>
                  Serviços paralelos (como Limpeza, Som, Portaria e Transmissão) podem iniciar antes do horário do culto.
                  <strong> Eles não somam sua duração ao tempo litúrgico</strong> e <strong>não escalam pessoas automaticamente</strong>.
                </p>

                {/* Presets rápidos de serviços da igreja */}
                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                    Adicionar Serviços Recomendados:
                  </span>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {PARALLEL_SERVICE_PRESETS.map((p, pIdx) => {
                      const matched = templateParallelServices.find(s => s.serviceName.toLowerCase() === p.serviceName.toLowerCase());
                      const isPresent = !!matched;
                      const isActive = isPresent && matched.isDefaultActive !== false;
                      const isInactive = isPresent && !isActive;

                      let label = `+ ${p.serviceName} (${p.prepRequiredMinutes}m prep)`;
                      let buttonTitle = `Adicionar ${p.serviceName}`;
                      if (isActive) {
                        label = `✓ ${p.serviceName} (${matched.prepRequiredMinutes}m prep)`;
                        buttonTitle = `${p.serviceName} já está ativo no modelo`;
                      } else if (isInactive) {
                        label = `↻ Reativar ${p.serviceName} (${matched.prepRequiredMinutes}m prep)`;
                        buttonTitle = `Reativar ${p.serviceName}`;
                      }

                      return (
                        <button
                          key={pIdx}
                          type="button"
                          className="btn btn-sm btn-secondary"
                          id={`btn-preset-service-${p.teamId}`}
                          onClick={() => handleAddPresetParallelService(p)}
                          disabled={isControlsDisabled}
                          title={buttonTitle}
                          style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            background: isActive ? 'rgba(99, 102, 241, 0.15)' : (isInactive ? 'rgba(234, 179, 8, 0.15)' : undefined),
                            borderColor: isActive ? 'var(--primary)' : (isInactive ? '#eab308' : undefined),
                            color: isActive ? 'var(--primary)' : (isInactive ? '#b45309' : undefined)
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Lista de serviços paralelos cadastrados no modelo */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                  {templateParallelServices.length === 0 ? (
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                      Nenhum serviço paralelo configurado para este modelo.
                    </p>
                  ) : (
                    templateParallelServices.map((serv, idx) => (
                      <div
                        key={idx}
                        id={`template-parallel-service-row-${idx}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          padding: '10px 12px',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '12px',
                          opacity: serv.isDefaultActive ? 1 : 0.65
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, margin: 0 }}>
                            <input
                              type="checkbox"
                              id={`parallel-service-active-${idx}`}
                              aria-label={`Ativar serviço ${serv.serviceName}`}
                              checked={serv.isDefaultActive}
                              onChange={() => handleToggleParallelServiceInTemplate(idx)}
                              disabled={isControlsDisabled}
                            />
                            <span style={{ fontWeight: 700, color: serv.isDefaultActive ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {serv.serviceName}
                            </span>
                            <span className="badge badge-secondary" style={{ fontSize: '10px' }}>{serv.teamId}</span>
                          </label>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <label htmlFor={`parallel-service-prep-${idx}`} style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                                Preparação:
                              </label>
                              <input
                                type="number"
                                id={`parallel-service-prep-${idx}`}
                                aria-label={`Minutos de preparação para ${serv.serviceName}`}
                                className="form-input"
                                style={{ width: '56px', padding: '2px 6px', fontSize: '11px', textAlign: 'center' }}
                                min="0"
                                max="180"
                                value={serv.prepRequiredMinutes}
                                onChange={e => handlePrepMinutesChange(idx, e.target.value)}
                                disabled={isControlsDisabled}
                              />
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>min</span>
                            </div>

                            <button
                              type="button"
                              id={`btn-remove-parallel-service-${idx}`}
                              onClick={() => handleRemoveParallelService(idx)}
                              disabled={isControlsDisabled}
                              style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                              title="Remover serviço paralelo"
                              aria-label={`Remover serviço paralelo ${serv.serviceName}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Indicador de Antecedência de Horário */}
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '22px' }}>
                          {serv.prepRequiredMinutes > 0 ? (
                            <span>
                              ⏳ Inicia <strong>{serv.prepRequiredMinutes} min antes</strong> do culto (ex: se o culto for às 19h00, a preparação inicia às <strong>{calculateAntecedentTime(serv.prepRequiredMinutes, '19:00')}</strong>).
                            </span>
                          ) : (
                            <span>⏱ Inicia concomitantemente com a abertura do culto.</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Adicionar serviço paralelo personalizado */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                    Cadastrar Outro Apoio ou Serviço Paralelo:
                  </span>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <label htmlFor="custom-parallel-service-name-input" className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}>
                      Nome do serviço paralelo
                    </label>
                    <input
                      type="text"
                      id="custom-parallel-service-name-input"
                      aria-label="Nome do serviço paralelo"
                      className="form-input"
                      style={{ flex: 2, minWidth: '140px', fontSize: '11px', padding: '6px 8px' }}
                      placeholder="Nome do serviço (ex: Berçário)"
                      value={customServiceName}
                      onChange={e => setCustomServiceName(e.target.value)}
                      disabled={isControlsDisabled}
                    />
                    <label htmlFor="custom-parallel-service-team-select" className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}>
                      Equipe do serviço paralelo
                    </label>
                    <select
                      id="custom-parallel-service-team-select"
                      aria-label="Equipe do serviço paralelo"
                      className="form-select"
                      style={{ flex: 1, minWidth: '100px', fontSize: '11px', padding: '6px 8px' }}
                      value={customServiceTeamId}
                      onChange={e => setCustomServiceTeamId(e.target.value)}
                      disabled={isControlsDisabled}
                    >
                      <option value="apoio">Apoio Geral</option>
                      <option value="limpeza">Limpeza</option>
                      <option value="recepcao">Recepção</option>
                      <option value="portaria">Portaria</option>
                      <option value="som">Sonoplastia</option>
                      <option value="midia">Transmissão</option>
                      <option value="infantil">Ministério Infantil</option>
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <label htmlFor="custom-parallel-service-prep-input" className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}>
                        Minutos de preparação antes do culto
                      </label>
                      <input
                        type="number"
                        id="custom-parallel-service-prep-input"
                        aria-label="Minutos de preparação antes do culto"
                        className="form-input"
                        style={{ width: '56px', fontSize: '11px', padding: '6px 4px', textAlign: 'center' }}
                        min="0"
                        max="180"
                        value={customServicePrepMinutes}
                        onChange={e => setCustomServicePrepMinutes(e.target.value)}
                        disabled={isControlsDisabled}
                        title="Minutos de preparação antes do culto"
                      />
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>min</span>
                    </div>
                    <button
                      type="button"
                      id="btn-add-custom-parallel-service"
                      className="btn btn-sm btn-secondary"
                      onClick={handleAddCustomParallelService}
                      disabled={isControlsDisabled || !customServiceName.trim()}
                      style={{ whiteSpace: 'nowrap', fontSize: '11px' }}
                    >
                      <Plus size={13} /> Adicionar Apoio
                    </button>
                  </div>
                </div>
              </div>

              {/* Aviso Normativo CA03 */}
              <div style={{ padding: '10px 12px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                <strong>Regra Litúrgica (CA03 & PRD §5 / M28):</strong> O modelo define a estrutura e apoios, mas <em>não escala nem confirma pessoas automaticamente</em>. As lideranças definem suas equipes nominalmente após a criação do culto.
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="submit"
                  id="btn-save-template"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={isTemplateControlsDisabled || isFormOutdated}
                >
                  <Check size={16} /> {editingTemplateId ? 'Salvar Alterações do Modelo' : 'Cadastrar Modelo de Culto'}
                </button>
                {editingTemplateId && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCancelEditTemplate}
                    disabled={isControlsDisabled}
                  >
                    <X size={16} /> Cancelar
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Listagem de Modelos Cadastrados */}
          <div className="card">
            <h2 className="tab-sec-title">
              <Layers size={18} color="var(--primary)" /> Modelos de Culto Cadastrados ({serviceTemplates.length})
            </h2>
            <p className="tab-sec-desc">
              Modelos reutilizáveis configurados para a igreja. Alterar ou desativar um modelo preserva integralmente os eventos passados e futuros já planejados (CA04).
            </p>

            {serviceTemplates.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)' }}>
                <Layers size={36} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p>Nenhum modelo de culto cadastrado.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {serviceTemplates.map((tpl, idx) => {
                  const evType = eventTypes.find(t => t.id === tpl.eventTypeId);
                  const totalDur = (tpl.activities || []).reduce((s, a) => s + (parseInt(a.plannedDurationMinutes) || 0), 0);
                  const isUsed = isTemplateUsedInEvents(tpl.id, [event]);
                  const activeServices = (tpl.parallelServices || []).filter(s => s.isDefaultActive !== false);

                  return (
                    <div
                      key={tpl.id}
                      style={{
                        padding: '16px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        opacity: tpl.active ? 1 : 0.6
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>{tpl.name}</h3>
                            <span className={`badge ${tpl.active ? 'badge-primary' : 'badge-secondary'}`}>
                              {tpl.active ? 'Ativo' : 'Desativado'}
                            </span>
                            {tpl.isStale && (
                              <span className="badge" style={{ backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fcd34d', fontSize: '10px' }}>
                                Desatualizado (somente leitura)
                              </span>
                            )}
                            {evType && (
                              <span className="badge badge-secondary" style={{ fontSize: '11px' }}>
                                {evType.name}
                              </span>
                            )}
                          </div>
                          {tpl.description && (
                            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 6px 0' }}>
                              {tpl.description}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            <span><strong>{tpl.activities?.length || 0}</strong> atividades ({totalDur} min)</span>
                            <span>•</span>
                            <span><strong>{activeServices.length}</strong> apoios padrão ({activeServices.map(s => s.serviceName).join(', ') || 'Nenhum'})</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            id={`btn-edit-template-${idx}`}
                            data-template-id={tpl.id}
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleStartEditTemplate(tpl)}
                            title="Editar modelo"
                            disabled={isControlsDisabled}
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleToggleTemplateStatus(tpl.id)}
                            title={tpl.active ? 'Desativar modelo' : 'Reativar modelo'}
                            disabled={isControlsDisabled}
                          >
                            <Power size={12} />
                          </button>
                          <button
                            type="button"
                            id={`btn-delete-template-${idx}`}
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDeleteTemplate(tpl.id)}
                            style={{ color: isUsed ? 'var(--text-muted)' : '#ef4444', opacity: isUsed ? 0.5 : 1 }}
                            title={isUsed ? 'Modelo em uso no histórico não pode ser excluído fisicamente; desative-o' : 'Excluir modelo'}
                            disabled={isControlsDisabled}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 4: MEMBROS E APTIDÕES (PRD 3 & Cenário M35) */}
      {activeAdminTab === 'members' && (
        <div
          role="tabpanel"
          id="panel-admin-members"
          aria-labelledby="tab-admin-members"
          tabIndex={0}
          className="card"
        >
          <h2 className="tab-sec-title">
            <Users size={18} color="var(--primary)" /> Membros Cadastrados & Habilitação de Aptidões
          </h2>
          <p className="tab-sec-desc">
            Cada membro possui cadastro único na igreja. A liderança habilita aptidões (ex: Canto, Dança, Bateria);
            <strong> o membro não se habilita sozinho</strong> (PRD 3 & Cenário M35).
          </p>

          <div className="members-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Membro</th>
                  <th>E-mail</th>
                  <th>Papéis</th>
                  <th>Equipes</th>
                  <th>Aptidões Habilitadas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td>
                      <div className="table-member-cell">
                        <img src={m.avatar} alt={m.name} className="table-avatar" />
                        <span className="table-member-name">{m.name}</span>
                      </div>
                    </td>
                    <td>{m.email}</td>
                    <td>
                      {m.roles.map(r => (
                        <span key={r} className="badge badge-primary" style={{ marginRight: '4px' }}>
                          {r}
                        </span>
                      ))}
                    </td>
                    <td>{m.teams.join(', ')}</td>
                    <td>
                      <div className="skills-chips">
                        {m.skills.map(s => (
                          <span key={s} className="skill-pill">{s}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-primary">Ativo</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .admin-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .admin-header-card {
          padding: 28px;
        }

        .admin-title {
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }

        .admin-subtitle {
          font-size: 14px;
          color: var(--text-secondary);
          max-width: 750px;
          line-height: 1.5;
        }

        .admin-nav-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding-bottom: 4px;
        }

        .admin-tab-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
        }

        .admin-tab-btn:hover {
          color: var(--text-primary);
          background: var(--bg-card-hover);
        }

        .admin-tab-btn.active {
          color: white;
          background: var(--primary);
          border-color: var(--primary);
        }

        .tab-sec-title {
          font-size: 18px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .tab-sec-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 20px;
          line-height: 1.5;
        }

        .invites-list, .reasons-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .invite-row-item, .reason-item-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .inv-name {
          font-weight: 700;
          color: var(--text-primary);
        }

        .inv-email {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .inv-date {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .current-event-leader-box {
          background: var(--bg-inset);
          border: 1px solid var(--border-subtle);
          padding: 20px;
          border-radius: var(--radius-lg);
        }

        .current-lead-header {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }

        .designation-form-row {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .members-table-wrapper {
          overflow-x: auto;
          margin-top: 12px;
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }

        .admin-table th {
          padding: 12px 14px;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-subtle);
        }

        .admin-table td {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .table-member-cell {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .table-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
        }

        .table-member-name {
          font-weight: 700;
          color: var(--text-primary);
        }

        .skills-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .skill-pill {
          font-size: 11px;
          background: var(--bg-surface);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .admin-denied-card {
          padding: 60px 24px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .admin-denied-card h2 {
          font-size: 22px;
          font-weight: 800;
        }

        .admin-denied-card p {
          max-width: 550px;
          font-size: 14px;
          color: var(--text-secondary);
        }

        .denied-hint {
          color: #fbbf24 !important;
          font-size: 13px !important;
        }

        .success-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.4);
          border-radius: var(--radius-md);
          color: #34d399;
          font-size: 13px;
          margin-bottom: 16px;
        }
      `}</style>
    </div>
  );
}
