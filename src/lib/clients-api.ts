// Puerta única a la edge function `clients` y utilidades de marca compartidas por /clientes,
// el panel de configuración de cada cliente y la marca de la agencia.
import { supabase } from "@/integrations/supabase/client";
import { extractLogoColor } from "@/lib/logoColor";

/** Devuelve el STATUS además del cuerpo: el tope (402) y la plaza sin precio (501) se
 *  distinguen por código. */
export async function callClients(action: string, payload: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data?.session?.access_token || ""}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let body: any = {};
  try {
    body = await resp.json();
  } catch {
    body = {};
  }
  return { status: resp.status, body };
}

/** Colores rápidos de marca (además del selector y "sacar del logo"). */
export const BRAND_SWATCHES = ["#6E58F1", "#2563EB", "#0EA5E9", "#14B8A6", "#16A34A", "#F59E0B", "#EA580C", "#E11D48", "#DB2777", "#0F172A"];
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Sube un logo al almacén público y devuelve su URL y el color que sale de él. */
export async function uploadBrandLogo(file: File, folder = "client-logos"): Promise<{ url: string; color: string | null }> {
  if (!/^image\//.test(file.type)) throw new Error("Sube una imagen (PNG, JPG, SVG o WebP).");
  if (file.size > 3 * 1024 * 1024) throw new Error("El logo debe pesar menos de 3 MB");
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${folder}/${Date.now()}-${rand}.${ext}`;
  const { error } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("godtube-media").getPublicUrl(path);
  const color = await extractLogoColor(file).catch(() => null);
  return { url: data.publicUrl, color };
}

export type AgencyBranding = {
  slug: string;
  agency_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
};
