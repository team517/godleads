import { describe, expect, it } from "vitest";
import { signOauthState, verifyOauthState, STATE_TTL_MS } from "../../supabase/functions/_shared/signed-state";

const OWNER = "0dd1ac6c-c03b-4e0d-8905-f652d9647d88";
const SECRET = "secreto-de-prueba";

describe("state OAuth firmado (google-oauth)", () => {
  it("ida y vuelta: devuelve el dueño", async () => {
    const st = await signOauthState(OWNER, SECRET, 1_000_000);
    expect(st.startsWith("v1.")).toBe(true);
    expect(await verifyOauthState(st, SECRET, 1_000_001)).toBe(OWNER);
  });
  it("un UUID suelto (el state antiguo) ya no vale", async () => {
    expect(await verifyOauthState(OWNER, SECRET)).toBeNull();
  });
  it("rechaza una firma con otro secreto o un payload manipulado", async () => {
    const st = await signOauthState(OWNER, SECRET, 1_000_000);
    expect(await verifyOauthState(st, "otro-secreto", 1_000_001)).toBeNull();
    const [v, payload, sig] = st.split(".");
    const forged = btoa(JSON.stringify({ o: "11111111-1111-1111-1111-111111111111", n: "x", e: 9e15 })).replace(/=+$/, "");
    expect(await verifyOauthState(`${v}.${forged}.${sig}`, SECRET, 1_000_001)).toBeNull();
    expect(await verifyOauthState(`${v}.${payload}.${sig.slice(0, -1)}0`, SECRET, 1_000_001)).toBeNull();
  });
  it("caduca a los 15 minutos", async () => {
    const st = await signOauthState(OWNER, SECRET, 1_000_000);
    expect(await verifyOauthState(st, SECRET, 1_000_000 + STATE_TTL_MS - 1)).toBe(OWNER);
    expect(await verifyOauthState(st, SECRET, 1_000_000 + STATE_TTL_MS + 1)).toBeNull();
  });
  it("cada state lleva un nonce distinto", async () => {
    const a = await signOauthState(OWNER, SECRET, 1);
    const b = await signOauthState(OWNER, SECRET, 1);
    expect(a).not.toBe(b);
  });
  it("no firma sin dueño UUID ni sin secreto, y no verifica basura", async () => {
    await expect(signOauthState("no-es-uuid", SECRET)).rejects.toThrow();
    await expect(signOauthState(OWNER, "")).rejects.toThrow();
    for (const junk of ["", "v1", "v1..", "v1.a.b", "x.y.z", "a.b.c.d"]) expect(await verifyOauthState(junk, SECRET)).toBeNull();
    expect(await verifyOauthState("v1.a.b", "")).toBeNull();
  });
});
