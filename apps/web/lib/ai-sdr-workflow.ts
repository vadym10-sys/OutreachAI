export const DEFAULT_AI_SDR_STAGE_ORDER = [
  "New Lead",
  "Analyzed",
  "Email Generated",
  "Approved",
  "Sent",
  "Follow-up",
  "Completed",
] as const;

export function aiSdrStageIndex(stage: string): number {
  const index = DEFAULT_AI_SDR_STAGE_ORDER.indexOf(stage as (typeof DEFAULT_AI_SDR_STAGE_ORDER)[number]);
  return index >= 0 ? index : 0;
}

export function aiSdrStageCompleted(currentStage: string, stage: string): boolean {
  return aiSdrStageIndex(stage) <= aiSdrStageIndex(currentStage);
}
