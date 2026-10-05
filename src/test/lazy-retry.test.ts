import { describe, it, expect, beforeEach } from "vitest";
import {
  AUTO_RELOAD_DELAY_MS, AUTO_RELOAD_MAX, AUTO_RELOAD_WINDOW_MS, isChunkLoadError, planChunkRecovery,
  readAutoReloadAttempts, recordAutoReloadAttempt,
} from "@/lib/lazy-retry";

describe("deploy window: what to do when the reload guard refuses", () => {
  const now = 1_000_000;
  it("the immediate reload fired → just wait for it", () => {
    expect(planChunkRecovery({ reloadTriggered: true, attempts: [], now })).toEqual({ action: "reloading" });
    expect(planChunkRecovery({ reloadTriggered: true, attempts: [now - 1, now - 2, now - 3, now - 4], now })).toEqual({ action: "reloading" });
  });
  it("guard refused and no delayed reload yet → keep 'Actualizando…' and reload in ~6 s", () => {
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [], now })).toEqual({ action: "schedule", delayMs: AUTO_RELOAD_DELAY_MS, attempt: 1 });
    expect(AUTO_RELOAD_DELAY_MS).toBe(6000);
  });
  it("up to 3 delayed reloads, then the error screen", () => {
    expect(AUTO_RELOAD_MAX).toBe(3);
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [now - 7000], now })).toMatchObject({ action: "schedule", attempt: 2 });
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [now - 14000, now - 7000], now })).toMatchObject({ action: "schedule", attempt: 3 });
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [now - 21000, now - 14000, now - 7000], now })).toEqual({ action: "give_up" });
  });
  it("old attempts (an earlier deploy) don't count", () => {
    const old = now - AUTO_RELOAD_WINDOW_MS - 1;
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [old, old, old], now })).toMatchObject({ action: "schedule", attempt: 1 });
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [old, now - 7000, now - 1], now })).toMatchObject({ action: "schedule", attempt: 3 });
  });
  it("garbage in the attempt list is ignored", () => {
    expect(planChunkRecovery({ reloadTriggered: false, attempts: [NaN, Infinity, now + 99999], now })).toMatchObject({ action: "schedule", attempt: 1 });
  });

  describe("attempts live in sessionStorage", () => {
    beforeEach(() => sessionStorage.clear());
    it("empty / broken storage reads as no attempts", () => {
      expect(readAutoReloadAttempts()).toEqual([]);
      sessionStorage.setItem("op:chunk-auto-reloads", "{not json");
      expect(readAutoReloadAttempts()).toEqual([]);
      sessionStorage.setItem("op:chunk-auto-reloads", JSON.stringify({ a: 1 }));
      expect(readAutoReloadAttempts()).toEqual([]);
    });
    it("records keep the recent ones and drop the stale ones", () => {
      recordAutoReloadAttempt(now - AUTO_RELOAD_WINDOW_MS - 5);
      recordAutoReloadAttempt(now - 7000);
      recordAutoReloadAttempt(now);
      expect(readAutoReloadAttempts()).toEqual([now - 7000, now]);
    });
    it("round trip with the planner: three records → give up", () => {
      recordAutoReloadAttempt(now - 14000);
      recordAutoReloadAttempt(now - 7000);
      expect(planChunkRecovery({ reloadTriggered: false, attempts: readAutoReloadAttempts(), now })).toMatchObject({ action: "schedule", attempt: 3 });
      recordAutoReloadAttempt(now);
      expect(planChunkRecovery({ reloadTriggered: false, attempts: readAutoReloadAttempts(), now })).toEqual({ action: "give_up" });
    });
  });
});

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
  it("catches the Safari / Firefox dynamic-import failures", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://app/assets/MobileApp-abc.js"))).toBe(true);
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
