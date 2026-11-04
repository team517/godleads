import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT_LIST_COLS } from "@/pages/EmailAccounts";

/* 04-11-2026: la pantalla Cuentas de correo salía vacía ("Conecta una cuenta de envío") porque la
   lista pedía backoff_until a la vista email_accounts_safe y la vista no tenía esa columna
   (PostgREST 400 → la pantalla trata el error como "sin cuentas"). Esta prueba lee la ÚLTIMA
   definición de la vista en supabase/migrations y comprueba que toda columna que pide la lista
   existe en ella. Si añades una columna a la lista, añádela también a la vista (al final). */
function ultimaDefinicionDeLaVista(): string {
  const dir = join(__dirname, "../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let def = "";
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    const m = /create (?:or replace )?view public\.email_accounts_safe[\s\S]*?from public\.email_accounts;/i.exec(sql)
      || /create (?:or replace )?view public\.email_accounts_safe[\s\S]*?from email_accounts;/i.exec(sql);
    if (m) def = m[0];
  }
  return def;
}

describe("Cuentas de correo — columnas de la lista frente a la vista email_accounts_safe", () => {
  it("todas las columnas que pide la lista existen en la última definición de la vista", () => {
    const def = ultimaDefinicionDeLaVista();
    expect(def).toContain("backoff_until");
    const cols = ACCOUNT_LIST_COLS.split(",").map((c) => c.trim()).filter(Boolean);
    expect(cols.length).toBeGreaterThan(30);
    const faltan = cols.filter((c) => !new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`, "i").test(def));
    expect(faltan).toEqual([]);
  });
});
