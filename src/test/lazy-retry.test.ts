import { describe, it, expect } from "vitest";
import { isChunkLoadError } from "@/lib/lazy-retry";

describe("isChunkLoadError — stale-deploy chunk detection", () => {
  it("catches the exact 'reading default' screen after a redeploy", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'default')"))).toBe(true);
    expect(isChunkLoadError("Cannot read properties of undefined (reading 'default')")).toBe(true);
  });
  it("catches the module-runtime 'reading call' variant", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'call')"))).toBe(true);
  });
  it("catches Safari and Firefox wording", () => {
    expect(isChunkLoadError(new Error("undefined is not an object (evaluating 'n.default')"))).toBe(true);
    expect(isChunkLoadError(new Error("can't access property \"default\", module is undefined"))).toBe(true);
  });
  it("still catches the fetch-failure forms", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://app/assets/Unibox-x.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 42 failed"))).toBe(true);
  });
  it("does NOT flag a genuine app bug as recoverable", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of null (reading 'foo')"))).toBe(false);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new Error("Something else broke in the reducer"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
