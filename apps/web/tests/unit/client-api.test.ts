import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "../../lib/client-api";

describe("client API errors", () => {
  it("keeps Apollo provider failures visible to the user", () => {
    const error = new Error("REQUEST_FAILED:Apollo connection failed. Please verify the Apollo API key and account access.");
    expect(friendlyErrorMessage(error, "Lead search could not be completed.")).toBe(
      "Apollo connection failed. Please verify the Apollo API key and account access."
    );
  });

  it("keeps no-results guidance visible to the user", () => {
    const error = new Error("REQUEST_FAILED:No companies found. Try a broader industry, larger company size, or remove the city filter.");
    expect(friendlyErrorMessage(error, "Lead search could not be completed.")).toBe(
      "No companies found. Try a broader industry, larger company size, or remove the city filter."
    );
  });
});
