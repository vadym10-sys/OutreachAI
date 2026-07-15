import { describe, expect, it } from "vitest";

import { DEFAULT_AI_SDR_STAGE_ORDER, aiSdrStageCompleted, aiSdrStageIndex } from "@/lib/ai-sdr-workflow";

describe("ai sdr workflow helpers", () => {
  it("keeps the expected stage order", () => {
    expect(DEFAULT_AI_SDR_STAGE_ORDER).toEqual([
      "New Lead",
      "Analyzed",
      "Email Generated",
      "Approved",
      "Sent",
      "Follow-up",
      "Completed",
    ]);
  });

  it("computes stage indexes safely", () => {
    expect(aiSdrStageIndex("New Lead")).toBe(0);
    expect(aiSdrStageIndex("Sent")).toBe(4);
    expect(aiSdrStageIndex("unknown")).toBe(0);
  });

  it("marks completed stages based on current stage", () => {
    expect(aiSdrStageCompleted("Approved", "Analyzed")).toBe(true);
    expect(aiSdrStageCompleted("Approved", "Approved")).toBe(true);
    expect(aiSdrStageCompleted("Approved", "Sent")).toBe(false);
  });
});
