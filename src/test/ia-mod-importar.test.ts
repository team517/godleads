// Prueba de verdad de "importar leads" de PulseBot: ejecuta el código del servidor
// (supabase/functions/ia-modificaciones/agente.ts) contra una base de datos simulada en memoria.
import { beforeEach, describe, expect, it } from "vitest";
import { aplicarPendiente, deshacer, ejecutar } from "../../supabase/functions/ia-modificaciones/agente";
import { crearDb } from "./helpers/fake-db";

// 60 filas con la forma del CSV real de Apollo (35 columnas en el original).
const filasApollo = Array.from({ length: 60 }, (_, i) => ({
  id: `SL-${i}`, first_name: `Nombre${i}`, last_name: "Apellido", name: `Nombre${i} Apellido`,
  email: `persona${i}@empresa${i}.es`, personal_email: "", title: "CEO",
  city: "Valencia", organization_name: `Empresa ${i} SL`, organization_primary_domain: `empresa${i}.es`,
  industry: "Construction", organization_linkedin_description: "Texto largo de LinkedIn…", keywords: "a;b",
}));

const CLIENTE = { id: "cli-1", email: "info@seoinnova.es", nombre: "", empresa: "Seo Innova", instrucciones: "", skills: "", enlace: "" };

let db: ReturnType<typeof crearDb>;
let ctx: any;
beforeEach(() => {
  db = crearDb({
    campaigns: [
      { id: "camp-borrador", user_id: "cli-1", name: "LEAD GENERATION", status: "draft" },
      { id: "camp-activa", user_id: "cli-1", name: "PYMES", status: "active" },
      { id: "camp-ajena", user_id: "otro", name: "AJENA", status: "draft" },
    ],
    campaign_steps: [
      { id: "s1", campaign_id: "camp-borrador", step_order: 1, subject: "idea para {{company_name}}", body: "Buenas {{first_name}}, vi {{company_name}} en {{industry}}", delay_days: 0, variants: [], created_at: "1" },
    ],
    ia_mod_uploads: [{ id: "up-1", client_user_id: "cli-1", filename: "leads.csv", kind: "leads", headers: Object.keys(filasApollo[0]), rows: filasApollo, row_count: 60, discarded: 0 }],
  }, ["persona7@empresa7.es"]);
  ctx = { db, cliente: CLIENTE, autor: "hello@onepulso.blog", tarjetas: [] };
});

describe("PulseBot importa leads de verdad", () => {
  it("campaña en borrador: importa YA con la plantilla (sin las 35 columnas del Apollo)", async () => {
    const r: any = await ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-borrador" });
    expect(r.hecho).toBe(true);
    expect(r.importados).toBe(59);          // 60 − 1 bloqueado
    expect(r.bloqueados).toBe(1);
    expect(r.variables_sin_columna_en_el_csv).toEqual([]);
    const lead = db.t.leads.find((l) => l.email === "persona3@empresa3.es")!;
    expect(lead.user_id).toBe("cli-1");
    expect(lead.custom_fields).toEqual({ first_name: "Nombre3", city: "Valencia", company_name: "Empresa 3 SL", organization_name: "Empresa 3 SL", industry: "Construction" });
    expect(db.t.campaign_leads.filter((c) => c.campaign_id === "camp-borrador")).toHaveLength(59);
    const cambio = db.t.ia_mod_changes[0];
    expect(cambio.status).toBe("applied");
    expect(ctx.tarjetas[0]).toMatchObject({ type: "cambio" });
  });

  it("reimportar el mismo archivo no duplica a nadie", async () => {
    await ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-borrador" });
    const r: any = await ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-borrador" });
    expect(r.importados).toBe(0);
    expect(db.t.leads.filter((l) => l.email === "persona3@empresa3.es")).toHaveLength(1);
    expect(db.t.campaign_leads.filter((c) => c.campaign_id === "camp-borrador")).toHaveLength(59);
  });

  it("campaña ACTIVA: no importa hasta Confirmar; al confirmar entran", async () => {
    const r: any = await ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-activa" });
    expect(r.pendiente).toBe(true);
    expect(db.t.leads || []).toHaveLength(0);
    const ch = db.t.ia_mod_changes[0];
    const msg = await aplicarPendiente(db, ch);
    expect(msg).toMatch(/59 leads añadidos/);
    expect(db.t.campaign_leads.filter((c) => c.campaign_id === "camp-activa")).toHaveLength(59);
    expect(ch.status).toBe("applied");
  });

  it("Deshacer quita a los que no han recibido nada y deja a quien ya recibió un correo", async () => {
    await ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-borrador" });
    const ch = db.t.ia_mod_changes[0];
    db.t.campaign_leads[0].current_step = 1; db.t.campaign_leads[0].status = "in_progress";
    const nota = await deshacer(db, ch, "cli-1");
    expect(nota).toMatch(/Quitados 58 leads; 1 ya/);
    expect(db.t.campaign_leads).toHaveLength(1);
    expect(db.t.leads).toHaveLength(1);
  });

  it("formato 'todas' guarda todas las columnas", async () => {
    await ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-borrador", formato: "todas" });
    expect(Object.keys(db.t.leads[0].custom_fields)).toContain("organization_linkedin_description");
  });

  it("nunca en la campaña de otro cliente", async () => {
    await expect(ejecutar(ctx, "importar_leads", { upload_id: "up-1", campaign_id: "camp-ajena" })).rejects.toThrow(/no es de este cliente/);
  });

  it("ver_archivo dice de qué columna sale cada variable de la plantilla", async () => {
    const r: any = await ejecutar(ctx, "ver_archivo", { upload_id: "up-1" });
    expect(r.emails_validos).toBe(60);
    expect(r.plantilla_sale_de).toMatchObject({ first_name: "first_name", company_name: "organization_name", industry: "industry", city: "city" });
  });
});
