type ActivityMsg = {
  id: string;
  activityExpanded?: boolean;
  activityDetailed?: boolean;
};

export function createAgentActivityActions(
  patchAssistantMsg: (id: string, patch: Record<string, unknown>) => void,
  schedulePersistChat: () => void,
) {
  function persistField(msg: ActivityMsg, field: "activityExpanded" | "activityDetailed", value: boolean) {
    msg[field] = value;
    patchAssistantMsg(msg.id, { [field]: value });
    schedulePersistChat();
  }

  return {
    toggleActivityExpanded(msg: ActivityMsg) {
      persistField(msg, "activityExpanded", !msg.activityExpanded);
    },
    collapseAgentActivity(msg: ActivityMsg) {
      persistField(msg, "activityExpanded", false);
    },
    toggleActivityDetailed(msg: ActivityMsg) {
      persistField(msg, "activityDetailed", !msg.activityDetailed);
    },
    collapseActivityDetailed(msg: ActivityMsg) {
      persistField(msg, "activityDetailed", false);
    },
  };
}
