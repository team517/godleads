import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { toast } from "sonner";

const FINAL_VERIFICATION_STATUSES = new Set(["valid", "risky", "invalid"]);

const isLeadPendingVerification = (verificationStatus: string | null | undefined) => {
  const s = typeof verificationStatus === "string" ? verificationStatus.trim().toLowerCase() : "";
  return !FINAL_VERIFICATION_STATUSES.has(s);
};

interface VerificationProgress {
  current: number;
  total: number;
  valid: number;
  invalid: number;
  risky: number;
}

interface VerificationContextType {
  verifying: boolean;
  progress: VerificationProgress;
  startVerification: (listId: string | null) => Promise<void>;
}

const VerificationContext = createContext<VerificationContextType | null>(null);

export function useVerification() {
  const ctx = useContext(VerificationContext);
  if (!ctx) throw new Error("useVerification must be inside VerificationProvider");
  return ctx;
}

export function VerificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [verifying, setVerifying] = useState(false);
  const [progress, setProgress] = useState<VerificationProgress>({ current: 0, total: 0, valid: 0, invalid: 0, risky: 0 });
  const abortRef = useRef(false);

  const fetchUnverifiedIds = useCallback(async (listId: string | null, limit?: number) => {
    if (!user) return [];
    const ids: string[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let q = supabase.from("leads").select("id, verification_status").eq("user_id", user.id).order("created_at", { ascending: false }).range(from, from + batchSize - 1);
      if (listId) q = q.eq("list_id", listId);
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) break;
      for (const lead of data) {
        if (isLeadPendingVerification(lead.verification_status)) {
          ids.push(lead.id);
          if (limit && ids.length >= limit) return ids.slice(0, limit);
        }
      }
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return ids;
  }, [user]);

  const verifyBatch = useCallback(async (leadIds: string[]) => {
    const { data, error } = await supabase.functions.invoke("verify-leads", {
      body: { lead_ids: leadIds, skip_coin_check: true },
    });
    if (error) throw new Error(error.message || "Error verificando");
    if (data?.error === "insufficient_coins") throw new Error("Monedas insuficientes");
    return { valid: data?.results?.valid || 0, invalid: data?.results?.invalid || 0, risky: data?.results?.risky || 0 };
  }, []);

  const startVerification = useCallback(async (listId: string | null) => {
    if (!user || verifying) return;
    abortRef.current = false;

    // Count pending
    const allPendingIds = await fetchUnverifiedIds(listId);
    if (!allPendingIds.length) { toast.info("No hay leads sin verificar"); return; }

    // Verification is free — no coin check.
    setVerifying(true);
    setProgress({ current: 0, total: allPendingIds.length, valid: 0, invalid: 0, risky: 0 });

    const toastId = toast.loading(`Verificando 0 / ${allPendingIds.length} leads...`, { duration: Infinity });

    const BATCH_SIZE = 10;
    const PARALLEL = 2; // 2 concurrent batches
    let processed = 0;
    let totalValid = 0, totalInvalid = 0, totalRisky = 0;
    let consecutiveErrors = 0;

    try {
      while (true) {
        if (abortRef.current) break;
        const batchIds = await fetchUnverifiedIds(listId, BATCH_SIZE * PARALLEL);
        if (!batchIds.length) break;

        // Split into PARALLEL sub-batches and run concurrently
        const subBatches: string[][] = [];
        for (let i = 0; i < batchIds.length; i += BATCH_SIZE) {
          subBatches.push(batchIds.slice(i, i + BATCH_SIZE));
        }

        const results = await Promise.allSettled(subBatches.map(sb => verifyBatch(sb)));

        let anySuccess = false;
        for (const r of results) {
          if (r.status === "fulfilled") {
            anySuccess = true;
            totalValid += r.value.valid;
            totalInvalid += r.value.invalid;
            totalRisky += r.value.risky;
            processed += (r.value.valid + r.value.invalid + r.value.risky);
          }
        }

        if (anySuccess) {
          consecutiveErrors = 0;
        } else {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            throw new Error(`Demasiados errores consecutivos. Procesados: ${processed}`);
          }
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        setProgress({ current: processed, total: allPendingIds.length, valid: totalValid, invalid: totalInvalid, risky: totalRisky });
        toast.loading(`Verificando ${processed} / ${allPendingIds.length} leads...`, { id: toastId, duration: Infinity });
      }

      await refreshProfile();
      toast.success(`✅ Verificación completada: ${totalValid} válidos, ${totalRisky} arriesgados, ${totalInvalid} eliminados`, { id: toastId, duration: 6000 });
    } catch (err: any) {
      toast.error(err.message || "Error en la verificación", { id: toastId, duration: 5000 });
    } finally {
      setVerifying(false);
    }
  }, [user, verifying, profile, fetchUnverifiedIds, verifyBatch, refreshProfile]);

  return (
    <VerificationContext.Provider value={{ verifying, progress, startVerification }}>
      {children}
    </VerificationContext.Provider>
  );
}
