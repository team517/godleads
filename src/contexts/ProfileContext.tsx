import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
}

interface ProfileContextType {
  profile: ProfileData;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<ProfileData>) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData>({ full_name: null, avatar_url: null, company_name: null, contact_email: null, allowed_routes: null, birthday: null, coins: 0, infiniteCoins: false });

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("full_name, avatar_url, company_name, contact_email, allowed_routes, birthday, coins").eq("user_id", user.id).single();
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
      });
    }
  }, [user]);

  const updateProfile = useCallback(async (updates: Partial<ProfileData>) => {
    if (!user) return;
    const { infiniteCoins, ...dbUpdates } = updates as any;
    await supabase.from("profiles").update(dbUpdates).eq("user_id", user.id);
    setProfile(prev => ({ ...prev, ...updates }));
  }, [user]);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  return (
    <ProfileContext.Provider value={{ profile, refreshProfile, updateProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
