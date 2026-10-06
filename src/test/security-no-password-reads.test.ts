import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Auditoría 06-10-2026 (#3): tras la migración 20261006142000 el rol `authenticated` ya no puede leer
// smtp_password / imap_password. Un `select("*")` o una lista con esas columnas sobre email_accounts
// fallaría con "permission denied" en producción: aquí se vigila que el frontend no lo haga.
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "test" && n !== "node_modules") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(n) && !/types\.ts$/.test(n)) out.push(p);
  }
  return out;
}

const files = walk(join(__dirname, ".."));
// from("email_accounts") (la tabla, no la vista _safe) seguido de .select(...) hasta el cierre de paréntesis
const SELECT_RE = /from\(\s*["']email_accounts["'](?:\s+as\s+any)?\s*\)\s*\.select\(\s*([^)]*)\)/g;

describe("el frontend no lee las contraseñas de email_accounts", () => {
  it("ningún select de la tabla pide * ni las columnas de contraseña", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(SELECT_RE)) {
        checked++;
        const args = m[1];
        if (/^\s*$/.test(args) || /["'`][^"'`]*\*[^"'`]*["'`]/.test(args) || /smtp_password|imap_password/.test(args)) {
          bad.push(`${f}: ${m[0].slice(0, 100)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(10); // la expresión sí encuentra las lecturas reales
    expect(bad).toEqual([]);
  });
  it("la migración quita el SELECT de tabla y concede sólo columnas sin contraseña", () => {
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261006142000_revoke_password_select.sql"), "utf8");
    expect(sql).toMatch(/revoke select on public\.email_accounts from authenticated/);
    expect(sql).toMatch(/column_name\s+not in \('smtp_password', 'imap_password'\)/);
    expect(sql).toMatch(/revoke select \(smtp_password, imap_password\) on public\.email_accounts from authenticated, anon/);
  });
});

describe("adjuntos de campaña en bucket privado", () => {
  it("CampaignSequences sube a campaign-attachments con <user.id>/ como primer segmento y guarda el bucket", () => {
    const src = readFileSync(join(__dirname, "../components/campaigns/CampaignSequences.tsx"), "utf8");
    expect(src).toMatch(/const ATTACH_BUCKET = "campaign-attachments"/);
    expect(src).toMatch(/const path = `\$\{user\.id\}\/\$\{campaignId\}\/\$\{selectedStep\.id\}\//);
    expect(src).toMatch(/\{ name: file\.name, bucket: ATTACH_BUCKET, path,/);
    expect(src).toMatch(/\.from\(attachBucket\(target\)\)\.remove/);
  });
});
