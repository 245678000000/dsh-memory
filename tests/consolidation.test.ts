import { describe, expect, it } from "vitest";
import { createService, globalScope } from "./helpers.ts";

describe("consolidation", () => {
  it("derives a semantic memory and keeps lineage", () => {
    const service = createService();
    const scope = globalScope();
    service.remember({ content: "User likes concise answers.", explicit: true }, scope);
    service.remember({ content: "User likes concise replies.", explicit: true }, scope);
    service.remember({ content: "User likes concise responses.", explicit: true }, scope);
    const derived = service.consolidate(scope);
    expect(derived.length).toBeGreaterThan(0);
    expect(derived[0]?.extractionType).toBe("derived");
    expect(derived[0]?.derivedFrom.length).toBeGreaterThanOrEqual(3);
    const superseded = service.list({ status: "superseded", includeForgotten: true });
    expect(superseded.length).toBeGreaterThanOrEqual(3);
    service.close();
  });
});
