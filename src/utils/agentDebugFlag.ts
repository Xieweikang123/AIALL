import { ref } from "vue";
import { lsGet, lsRemove, lsSet } from "./localStorageSafe";

const AGENT_DEBUG_KEY = "aiall-agent-debug";

function loadDebugFlag(): boolean {
  return lsGet(AGENT_DEBUG_KEY) === "1";
}

export const agentDebugEnabled = ref(loadDebugFlag());

export function setAgentDebugEnabled(enabled: boolean): void {
  agentDebugEnabled.value = enabled;
  if (enabled) {
    lsSet(AGENT_DEBUG_KEY, "1");
  } else {
    lsRemove(AGENT_DEBUG_KEY);
  }
}
