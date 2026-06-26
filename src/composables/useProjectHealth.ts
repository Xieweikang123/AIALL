import { ref } from "vue";
import {
  buildCodeReviewPrompt,
  fetchProjectHealthScan,
  healthIssueCount,
  type ProjectHealthScanResult,
} from "../services/projectHealthScanClient";

export function useProjectHealth(projectPath: { value: string }, projectOpened: { value: boolean }) {
  const healthScan = ref<ProjectHealthScanResult | null>(null);
  const healthScanning = ref(false);
  const healthError = ref("");
  let scanGeneration = 0;
  let lastScannedPath = "";

  async function runHealthScan() {
    const path = projectPath.value.trim();
    if (!path || !projectOpened.value) return;
    const gen = ++scanGeneration;
    healthScanning.value = true;
    healthError.value = "";
    try {
      const result = await fetchProjectHealthScan(path);
      if (gen !== scanGeneration) return;
      if (!result.ok) {
        healthError.value = result.error || "体检失败";
        healthScan.value = null;
        return;
      }
      healthScan.value = result;
      lastScannedPath = path;
    } catch (error) {
      if (gen !== scanGeneration) return;
      healthError.value = error instanceof Error ? error.message : "体检失败";
    } finally {
      if (gen === scanGeneration) healthScanning.value = false;
    }
  }

  function resetHealthScan() {
    scanGeneration += 1;
    healthScan.value = null;
    healthError.value = "";
    healthScanning.value = false;
    lastScannedPath = "";
  }

  function ensureHealthScan() {
    if (!projectOpened.value || !projectPath.value.trim()) return;
    const path = projectPath.value.trim();
    if (healthScanning.value) return;
    if (healthScan.value?.ok && lastScannedPath === path) return;
    void runHealthScan();
  }

  function buildAnalysisPrompt(): string {
    if (!healthScan.value?.ok) return "";
    return buildCodeReviewPrompt(healthScan.value);
  }

  function onProjectClosed() {
    resetHealthScan();
  }

  function onProjectPathChanged() {
    if (lastScannedPath && lastScannedPath !== projectPath.value.trim()) {
      healthScan.value = null;
      lastScannedPath = "";
    }
  }

  return {
    healthScan,
    healthScanning,
    healthError,
    healthIssueCount: () => healthIssueCount(healthScan.value),
    runHealthScan,
    resetHealthScan,
    ensureHealthScan,
    buildAnalysisPrompt,
    onProjectClosed,
    onProjectPathChanged,
  };
}
