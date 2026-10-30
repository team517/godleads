import { supabase } from "@/integrations/supabase/client";

/* Alta manual de UN lead (31-10-2026). El trigger skip_blocked_leads descarta en silencio los
   emails/dominios de "Bloqueados" (devuelve 0 filas): con .single() la pantalla enseñaba
   "Cannot coerce the result to a single JSON object" y en /leads decía "Lead añadido" sin
   haberlo añadido. Ahora se explica el motivo, y si el lead ya existe se reutiliza. */

export type ManualLeadResult =
  | { kind: "ok"; id: string; existed: boolean }
  | { kind: "blocked"; by: string }
  | { kind: "error"; message: string };

/** El motivo del bloqueo (el email o el dominio que está en Bloqueados), o null. */
export async function blockedBy(userId: string, email: string): Promise<string | null> {
  const dom = email.split("@")[1] || "";
  const { data } = await (supabase as any).from("blocklist").select("value, entry_type")
    .eq("user_id", userId).in("value", [email, dom]).limit(5);
  const rows = (data || []) as { value: string; entry_type: string }[];
  const hit = rows.find((r) => r.entry_type === "email" && r.value.toLowerCase() === email)
    || rows.find((r) => r.entry_type === "domain" && r.value.toLowerCase() === dom);
  return hit ? (hit.entry_type === "domain" ? `el dominio ${hit.value}` : hit.value) : null;
}

export function blockedMessage(email: string, by: string): string {
  return `${email} no se ha añadido: ${by} está en tu lista de Bloqueados. Quítalo de Bloqueados si quieres contactarlo.`;
}

export async function addManualLead(
  userId: string, email: string, customFields: Record<string, string>,
  extra: { list_id?: string | null; is_campaign_only?: boolean; reuseExisting?: boolean } = {},
): Promise<ManualLeadResult> {
  const e = email.trim().toLowerCase();
  if (extra.reuseExisting) {
    const { data: found } = await supabase.from("leads").select("id").eq("user_id", userId).eq("email", e).limit(1);
    if (found?.length) return { kind: "ok", id: found[0].id, existed: true };
  }
  const { data, error } = await supabase.from("leads").insert({
    user_id: userId, email: e, custom_fields: customFields,
    ...(extra.list_id !== undefined ? { list_id: extra.list_id } : {}),
    ...(extra.is_campaign_only !== undefined ? { is_campaign_only: extra.is_campaign_only } : {}),
  }).select("id").maybeSingle();
  if (error) return { kind: "error", message: error.message };
  if (data?.id) return { kind: "ok", id: data.id, existed: false };
  const by = await blockedBy(userId, e);
  return by ? { kind: "blocked", by } : { kind: "error", message: "La base de datos no guardó el lead (está filtrado)." };
}
