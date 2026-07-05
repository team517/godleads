import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { bindCacheUser } from "@/lib/instant-cache";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null; signedIn: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const withAuthTimeout = async <T,>(promise: Promise<T>, timeoutMs = 15000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("La conexión está tardando demasiado. Inténtalo de nuevo en unos segundos."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Bind the instant-cache to this user BEFORE pages mount, so persisted
      // page snapshots hydrate for the right owner (and never across users).
      // Purge ONLY on a real sign-out — a transient null (session still
      // restoring / offline) must not wipe the snapshots.
      if (event === "SIGNED_OUT") bindCacheUser(null);
      else if (session?.user) bindCacheUser(session.user.id);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    withAuthTimeout(supabase.auth.getSession(), 10000)
      .then(({ data: { session } }) => {
        if (session?.user) bindCacheUser(session.user.id);
        setSession(session);
        setUser(session?.user ?? null);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    return {
      error: error?.message ?? null,
      signedIn: Boolean(data.session),
    };
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await withAuthTimeout(supabase.auth.signInWithPassword({ email, password }));
      return { error: error?.message ?? null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo iniciar sesión. Inténtalo de nuevo." };
    }
  };

  const signOut = async () => {
    // Local sign out is instantaneous and doesn't depend on the auth server,
    // which can hang/return 504 and leave the user stuck.
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('signOut local failed, clearing state manually', e);
    }
    bindCacheUser(null); // purge persisted page snapshots on sign-out
    setSession(null);
    setUser(null);
    // Best-effort: clear any persisted Supabase auth keys
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
