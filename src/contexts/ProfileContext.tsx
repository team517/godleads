import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { PROFILE_BOOT_COLS, profileQueryKey, sharedQuery } from "@/lib/boot-queries";

const INFINITE_COINS_EMAILS = ["hello@onepulso.blog", "eric@dekano-core.es", "alex@vioonyx.com"];

interface ProfileData {
  full_name: string | null;
  avatar_url: string | null;
  company_name: string | null;
  contact_email: string | null;
  allowed_routes: string[] | null;
  birthday: string | null;
  coins: number;
  infiniteCoins: boolean;
  logo_url: string | null;
  brand_color: string | null;
  is_client_manager: boolean;
  /** Marca de "esta cuenta es sólo el acceso de mirar de un cliente" (id del cliente).
   *  La congela RLS: nadie se la pone ni se la quita a sí mismo. */
  client_login_of: string | null;
}

interface ProfileContextType {
  profile: ProfileData;
  /** false en cuanto se ha intentado leer el perfil. Quien decida rutas con
   *  client_login_of DEBE esperar: si no, el cliente ve un parpadeo de la app. */
  loading: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData>({ full_name: null, avatar_url: null, company_name: null, contact_email: null, allowed_routes: null, birthday: null, coins: 0, infiniteCoins: false, logo_url: null, brand_color: null, is_client_manager: false, client_login_of: null });
  const [loading, setLoading] = useState(true);

  // `shared`: the boot read is shared with SubscriptionContext (same row, one request — see
  // boot-queries.ts). Explicit refreshes (after saving the profile) always go to the server.
  // Any argument other than that option (an onClick event, for instance) means "fresh".
  const refreshProfile = useCallback(async (opts?: { shared?: boolean }) => {
    if (!user) { setLoading(false); return; }
    const shared = !!(opts && typeof opts === "object" && "shared" in opts && opts.shared);
    const read = () => sharedQuery<{ data: any; error: any }>(
      profileQueryKey(user.id),
      () => (supabase as any).from("profiles").select(PROFILE_BOOT_COLS).eq("user_id", user.id).single(),
      { fresh: !shared },
    );
    let { data, error } = await read();
    // Un fallo suele ser pasajero (token que se está renovando, red): se reintenta UNA vez.
    if (error) {
      await new Promise((r) => setTimeout(r, 1000));
      ({ data, error } = await read());
    }
    setLoading(false);
    if (error) {
      // Nunca se deja al usuario encerrado en el spinner ni se pisa el perfil que ya se tenía
      // (ProtectedRoute decide rutas con allowed_routes: inventar "sin restricciones" aquí
      // abriría la app entera a un cliente acotado).
      toast.error(`No se pudo cargar tu perfil: ${error.message || error}`);
      return;
    }
    if (data) {
      const contactEmail = data.contact_email?.toLowerCase() ?? "";
      setProfile({
        full_name: data.full_name,
        avatar_url: (data as any).avatar_url,
        company_name: data.company_name,
        contact_email: data.contact_email,
        allowed_routes: (data as any).allowed_routes,
        birthday: (data as any).birthday ?? null,
        coins: (data as any).coins ?? 0,
        infiniteCoins: INFINITE_COINS_EMAILS.includes(contactEmail),
        logo_url: (data as any).logo_url ?? null,
        brand_color: (data as any).brand_color ?? null,
        is_client_manager: (data as any).is_client_manager ?? false,
        client_login_of: (data as any).client_login_of ?? null,
      });
    }
  }, [user]);

  const updateProfile = useCallback(async (updates: Partial<ProfileData>) => {
    if (!user) return;
    const { infiniteCoins, ...dbUpdates } = updates as any;
    const { error } = await supabase.from("profiles").update(dbUpdates).eq("user_id", user.id);
    // Si el guardado falla, el cambio NO se pinta como si se hubiera guardado.
    if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
    setProfile(prev => ({ ...prev, ...updates }));
  }, [user]);

  useEffect(() => { refreshProfile({ shared: true }); }, [refreshProfile]);

  return (
    <ProfileContext.Provider value={{ profile, loading, refreshProfile, updateProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
