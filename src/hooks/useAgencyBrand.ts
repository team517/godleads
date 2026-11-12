import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalProfile } from "@/contexts/ProfileContext";
import { HEX6, type BrandSide } from "@/components/clients/CoBrand";

/* La agencia de una cuenta de cliente (12-11-2026): nombre, logo y color, para la marca doble
   agencia × cliente y la bienvenida. Lo da el servidor (my_agency_branding: sólo esos tres
   datos de la agencia de QUIEN tiene la sesión). Se recuerda en el navegador para que la barra
   salga bien a la primera, sin parpadeo. */

const LS = (uid: string) => `fl_agency_brand_v1_${uid}`;
const memo = new Map<string, BrandSide | null>();

function leer(uid: string | undefined): BrandSide | null {
  if (!uid) return null;
  if (memo.has(uid)) return memo.get(uid) ?? null;
  try {
    const raw = localStorage.getItem(LS(uid));
    return raw ? (JSON.parse(raw) as BrandSide) : null;
  } catch { return null; }
}

export function rowToAgency(row: { agency_name?: string | null; logo_url?: string | null; brand_color?: string | null } | null | undefined): BrandSide | null {
  if (!row) return null;
  const name = String(row.agency_name || "").trim();
  if (!name) return null;
  const logo = String(row.logo_url || "").trim();
  return {
    name,
    logo: /^https?:\/\//i.test(logo) ? logo : null,
    color: row.brand_color && HEX6.test(row.brand_color) ? row.brand_color.toUpperCase() : null,
  };
}

export function useAgencyBrand(): BrandSide | null {
  const { user } = useAuth();
  const profile = useOptionalProfile();
  const uid = user?.id;
  const isClient = !!profile?.client_login_of;
  const [brand, setBrand] = useState<BrandSide | null>(() => (isClient ? leer(uid) : null));

  useEffect(() => {
    if (!isClient || !uid) { setBrand(null); return; }
    setBrand(leer(uid));
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc("my_agency_branding");
        if (error) return;
        const b = rowToAgency(Array.isArray(data) ? data[0] : data);
        memo.set(uid, b);
        try { b ? localStorage.setItem(LS(uid), JSON.stringify(b)) : localStorage.removeItem(LS(uid)); } catch { /* sin almacenamiento */ }
        if (vivo) setBrand(b);
      } catch { /* sin red: lo recordado */ }
    })();
    return () => { vivo = false; };
  }, [isClient, uid]);

  return isClient ? brand : null;
}
