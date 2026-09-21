import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { effectiveDailyLimit, sendDaysMap } from "@/lib/warmup";
import { Button } from "@/components/ui/button";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SavedSignatures } from "@/components/SavedSignatures";
import DOMPurify from "dompurify";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { filterAccounts } from "@/lib/account-filter";
import AddAccountDialog, { type AddAccountMode } from "@/components/accounts/AddAccountDialog";
import AccountsTable from "@/components/accounts/AccountsTable";
import AccountsEmptyState from "@/components/accounts/AccountsEmptyState";
import { configSummary } from "@/lib/account-health";
import ConnectAccountForm from "@/components/accounts/ConnectAccountForm";
import { buildAccountPayload, type ConnectProvider } from "@/lib/account-connect";
import { findDataImages, replaceDataImages, decodeBase64Image, isWorthHosting } from "@/lib/signature-images";
import { accountsCsvTemplate, accountsToCsv, downloadCsv } from "@/lib/accounts-csv";
import { isAgencyAccount } from "@/lib/access";
import { Plus, Upload, Download, CheckCircle, XCircle, Mail, Trash2, RefreshCw, Wifi, Pencil, Tag, X, Check, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, Wand2, Search, Globe, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { applyInChunks, type BulkProgress } from "@/lib/bulk-apply";
import { toast } from "sonner";

const PROVIDER_PRESETS: Record<string, { imap_host: string; imap_port: string; smtp_host: string; smtp_port: string; label: string; help: string }> = {
  gmail: { imap_host: "imap.gmail.com", imap_port: "993", smtp_host: "smtp.gmail.com", smtp_port: "587", label: "Gmail", help: "Usa una Contraseña de aplicación de Google (no tu contraseña normal). Actívala en myaccount.google.com → Seguridad → Contraseñas de aplicaciones." },
  outlook: { imap_host: "outlook.office365.com", imap_port: "993", smtp_host: "smtp.office365.com", smtp_port: "587", label: "Outlook / Hotmail", help: "Usa una Contraseña de aplicación de Microsoft (account.microsoft.com → Seguridad → Opciones de seguridad avanzadas). Ojo: Microsoft ha desactivado el acceso por contraseña (IMAP/SMTP) en muchas cuentas Outlook.com y Microsoft 365; si la verificación falla, tu cuenta necesita conexión OAuth o un buzón con SMTP propio." },
  ionos: { imap_host: "imap.ionos.es", imap_port: "993", smtp_host: "smtp.ionos.es", smtp_port: "587", label: "IONOS", help: "Usa la contraseña de tu buzón de correo IONOS. El usuario es tu dirección de email completa." },
  custom: { imap_host: "", imap_port: "993", smtp_host: "", smtp_port: "587", label: "Personalizado", help: "" },
};

const emptyForm = {
  email: "", first_name: "", last_name: "",
  imap_username: "", imap_password: "", imap_host: "", imap_port: "993",
  smtp_username: "", smtp_password: "", smtp_host: "", smtp_port: "587",
  daily_limit: "50",
  provider: "custom",
};

const WRAPPING_QUOTES_REGEX = /^[\u0022\u0027\u2018\u2019\u201C\u201D`]+|[\u0022\u0027\u2018\u2019\u201C\u201D`]+$/g;

const sanitizeTextValue = (value: string | null | undefined) => String(value ?? "")
  .replace(/\uFEFF/g, "")
  .replace(/\r/g, "")
  .replace(/\n+/g, " ")
  .replace(/\t+/g, " ")
  .trim()
  .replace(WRAPPING_QUOTES_REGEX, "")
  .trim()
  .replace(/\s{2,}/g, " ");

const sanitizeSecretValue = (value: string | null | undefined) => String(value ?? "")
  .replace(/\uFEFF/g, "")
  .replace(/\r/g, "")
  .replace(/\n+/g, "")
  .trim()
  .replace(WRAPPING_QUOTES_REGEX, "")
  .trim();

const sanitizeEmailValue = (value: string | null | undefined) => sanitizeTextValue(value)
  .replace(/[\s,"'`<>]+/g, "")
  .toLowerCase();

const normalizeEmailAccount = <T extends Record<string, any>>(account: T): T => ({
  ...account,
  email: sanitizeEmailValue(account.email),
  first_name: sanitizeTextValue(account.first_name),
  last_name: sanitizeTextValue(account.last_name),
  imap_username: sanitizeEmailValue(account.imap_username || account.email),
  imap_password: sanitizeSecretValue(account.imap_password),
  imap_host: sanitizeTextValue(account.imap_host),
  smtp_username: sanitizeEmailValue(account.smtp_username || account.email),
  smtp_password: sanitizeSecretValue(account.smtp_password),
  smtp_host: sanitizeTextValue(account.smtp_host),
});

type AuthStatusValue = "pass" | "warn" | "fail" | undefined;
function AuthChip({ label, status }: { label: string; status: AuthStatusValue }) {
  const meta =
    status === "pass" ? { cls: "bg-success/10 text-success border-success/30", Icon: ShieldCheck, text: "OK" }
    : status === "warn" ? { cls: "bg-warning/10 text-warning border-warning/30", Icon: ShieldQuestion, text: "Revisar" }
    : status === "fail" ? { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: ShieldAlert, text: "Falta" }
    : { cls: "bg-muted text-muted-foreground border-border", Icon: ShieldQuestion, text: "—" };
  const { Icon } = meta;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
      <Icon className="h-3 w-3" /> {label} {meta.text}
    </span>
  );
}

export default function EmailAccounts() {
  const { user } = useAuth();
  // Instant re-entry: seed from session cache, refresh in background.
  const [accounts, setAccounts] = useState<any[]>(() => cacheGet<any[]>("accounts:list") || []);
  // Días de envío REALES por cuenta (RPC), la misma cuenta que usa el motor para el
  // warm-up. Sin esto la pantalla contaba días de calendario y el límite "subía solo".
  const [sendDaysByAccount, setSendDaysByAccount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(() => !cacheGet<any[]>("accounts:list"));
  const [showBulkIonos, setShowBulkIonos] = useState(false);
  const [ionosRows, setIonosRows] = useState<{ email: string; first_name: string; last_name: string; password: string }[]>([{ email: "", first_name: "", last_name: "", password: "" }]);
  const [ionosImporting, setIonosImporting] = useState(false);
  const [ionosDefaultPassword, setIonosDefaultPassword] = useState("");
  const [ionosDefaultFirstName, setIonosDefaultFirstName] = useState("");
  const [ionosDefaultLastName, setIonosDefaultLastName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<AddAccountMode>("single");
  // SaaS users get ONE entry point ("Añadir cuenta"); the agency keeps the operator toolbar
  // (verify all, DNS, IONOS bulk, signature manager).
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    if (!user) return;
    (supabase as any).from("profiles").select("is_client_manager").eq("user_id", user.id).maybeSingle()
      .then(({ data }: any) => setIsManager(!!data?.is_client_manager));
  }, [user]);
  const isAgency = isAgencyAccount(user?.email ?? null, isManager);
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [addProvider, setAddProvider] = useState<ConnectProvider>("custom");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const draftAccountId = useRef<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [savedTags, setSavedTags] = useState<{ id: string; name: string }[]>([]);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [showTagManager, setShowTagManager] = useState(false);
  // "Crear tag" dialog: one obvious place to create a tag and, optionally, put accounts in it.
  // The three inline inputs (disabled until typed, 7-char-wide placeholders) read as "no se puede".
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [createTagName, setCreateTagName] = useState("");
  const [createTagScope, setCreateTagScope] = useState<"none" | "selected" | "visible">("none");
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState({
    daily_limit: "",
    first_name: "",
    last_name: "",
    imap_host: "",
    imap_port: "",
    imap_username: "",
    imap_password: "",
    smtp_host: "",
    smtp_port: "",
    smtp_username: "",
    smtp_password: "",
    send_start_hour: "",
    send_end_hour: "",
    signature_html: "",
  });
  const [bulkEditFields, setBulkEditFields] = useState<Set<string>>(new Set());
  const [showSlowRamp, setShowSlowRamp] = useState(false);
  const [slowRampForm, setSlowRampForm] = useState({ start: "", increment: "2", target: "30" });
  // Barra de progreso al activar/desactivar el slow ramp en muchas cuentas (como la de importar leads).
  const [rampProgress, setRampProgress] = useState<(BulkProgress & { label: string }) | null>(null);
  // ── Signature manager (apply an HTML signature to all / by tag / selected accounts) ──
  const [showSignature, setShowSignature] = useState(false);
  const [sigHtml, setSigHtml] = useState("");
  const [sigScope, setSigScope] = useState<"all" | "tag" | "selected">("all");
  const [sigTag, setSigTag] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [sigImgUploading, setSigImgUploading] = useState(false);
  const sigImgInputRef = useRef<HTMLInputElement | null>(null);
  // Upload an image to Storage and insert a hosted <img> into the signature HTML. A hosted https
  // URL is what renders reliably in email (Gmail blocks data: URIs); both send-email and the
  // campaign engine keep signature images (sanitizeSignatureRich) so it lands as designed.
  const uploadSigImage = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Sube una imagen (PNG, JPG…)"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error(`"${file.name}" supera 2 MB — usa una imagen más pequeña`); return; }
    setSigImgUploading(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "logo";
      const path = `signatures/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("godtube-media").upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl;
      const imgTag = `<img src="${url}" alt="" style="max-width:180px;height:auto;display:block;margin-top:8px" />`;
      setSigHtml(prev => (prev.trim() ? `${prev}\n${imgTag}` : imgTag));
      toast.success("Imagen añadida a la firma");
    } catch (e: any) { toast.error(`No se pudo subir la imagen: ${e?.message || e}`); }
    finally { setSigImgUploading(false); if (sigImgInputRef.current) sigImgInputRef.current.value = ""; }
  };

  // ── Per-account domain authentication (SPF / DKIM / DMARC) ──
  type AuthStatus = "pass" | "warn" | "fail";
  type DomainAuth = { loading: boolean; spf?: AuthStatus; dkim?: AuthStatus; dmarc?: AuthStatus; error?: boolean; reverifying?: boolean };
  const [domainAuth, setDomainAuth] = useState<Record<string, DomainAuth>>(() => cacheGet<Record<string, DomainAuth>>("accounts:domainAuth") || {});
  const requestedDomainsRef = useRef<Set<string>>(new Set());
  // Broad DKIM selector list so we detect a key whatever the provider (Google,
  // Microsoft, IONOS, Zoho…). If none resolve, DKIM is reported as missing.
  const DKIM_SELECTORS = ["s1-ionos", "s2-ionos", "google", "selector1", "selector2", "default", "dkim", "dkim1", "k1", "k2", "mail", "smtp", "s1", "s2", "mxvault", "key1", "ionos1", "ionos2", "mta", "dk", "email", "zoho", "zmail", "amazonses"];

  const checkDomainAuth = useCallback(async (domain: string) => {
    const d = (domain || "").trim().toLowerCase();
    if (!d) return;
    // Show "cargando" only on the FIRST check. If we already have a (cached) result, refresh
    // it LIVE in the background — the badges stay visible and a tiny pulse (`reverifying`)
    // shows the DNS is being confirmed for real, instead of flashing back to a spinner.
    setDomainAuth(prev => (prev[d] && !prev[d].loading
      ? { ...prev, [d]: { ...prev[d], reverifying: true } }
      : { ...prev, [d]: { ...(prev[d] || {}), loading: true, error: false } }));
    try {
      const { data, error } = await supabase.functions.invoke("check-email-domain-auth", {
        body: { domain: d, selectors: DKIM_SELECTORS },
      });
      const r = data as any;
      if (error || !r || r.error) {
        // Un fallo transitorio del resolver NO debe borrar un resultado bueno anterior: un dominio
        // BIEN configurado no puede pasar a "sin verificar" porque el DNS estuviera saturado.
        setDomainAuth(prev => {
          const had = prev[d];
          if (had && !had.error && (had.spf || had.dkim || had.dmarc)) {
            return { ...prev, [d]: { ...had, loading: false, reverifying: false } };
          }
          return { ...prev, [d]: { loading: false, error: true } };
        });
        return;
      }
      setDomainAuth(prev => ({ ...prev, [d]: { loading: false, spf: r.spf?.status, dkim: r.dkim?.status, dmarc: r.dmarc?.status } }));
    } catch {
      setDomainAuth(prev => {
        const had = prev[d];
        if (had && !had.error && (had.spf || had.dkim || had.dmarc)) {
          return { ...prev, [d]: { ...had, loading: false, reverifying: false } };
        }
        return { ...prev, [d]: { loading: false, error: true } };
      });
    }
  }, []);

  const domainOf = (email: string) => (email || "").split("@")[1]?.trim().toLowerCase() || "";

  // Configuración DNS: primero se ENSEÑA lo ya guardado (instantáneo, sin "comprobando"), y sólo
  // se vuelve a mirar el DNS de los dominios que faltan o que están viejos, y en segundo plano.
  useEffect(() => {
    const domains = Array.from(new Set(accounts.map(a => domainOf(a.email)).filter(Boolean)));
    const pending = domains.filter(d => !requestedDomainsRef.current.has(d));
    if (pending.length === 0) return;
    pending.forEach(d => requestedDomainsRef.current.add(d));
    let cancelled = false;
    const STALE_MS = 24 * 60 * 60 * 1000; // un veredicto de más de un día se reconfirma por detrás

    (async () => {
      // 1) Leer de una vez lo guardado y pintarlo ya. El DNS es público → una sola consulta.
      let cached: Record<string, { spf?: string; dkim?: string; dmarc?: string; checked_at?: string }> = {};
      try {
        const { data } = await (supabase as any).from("domain_auth").select("domain, spf, dkim, dmarc, checked_at").in("domain", pending);
        for (const r of (data || []) as any[]) cached[r.domain] = r;
      } catch { /* si la caché no responde, se comprueba todo en vivo como antes */ }
      if (cancelled) return;
      if (Object.keys(cached).length) {
        setDomainAuth(prev => {
          const next = { ...prev };
          for (const [d, r] of Object.entries(cached)) {
            next[d] = { loading: false, spf: r.spf as any, dkim: r.dkim as any, dmarc: r.dmarc as any };
          }
          return next;
        });
      }

      // 2) Sólo se vuelve a mirar el DNS de lo que falta o está viejo (en segundo plano).
      const now = Date.now();
      const toCheck = pending.filter(d => {
        const c = cached[d];
        if (!c) return true;
        const age = c.checked_at ? now - new Date(c.checked_at).getTime() : Infinity;
        return age > STALE_MS;
      });
      const CONC = 3; // olas pequeñas: no saturar el resolver DNS
      for (let i = 0; i < toCheck.length && !cancelled; i += CONC) {
        await Promise.all(toCheck.slice(i, i + CONC).map(d => checkDomainAuth(d)));
        if (i + CONC < toCheck.length) await new Promise(r => setTimeout(r, 150));
      }
    })();
    return () => { cancelled = true; };
  }, [accounts, checkDomainAuth]);

  const recheckDomain = (domain: string) => {
    const d = (domain || "").trim().toLowerCase();
    requestedDomainsRef.current.add(d);
    checkDomainAuth(d);
  };

  // ── Auto-configure SPF/DKIM/DMARC via the IONOS DNS API ──
  const [dnsConfiguring, setDnsConfiguring] = useState<Record<string, boolean>>({});
  const configureDns = async (domain: string) => {
    const d = (domain || "").trim().toLowerCase();
    if (!d) return;
    setDnsConfiguring(p => ({ ...p, [d]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("configure-dns", { body: { domain: d } });
      if (error) throw error;
      if (!data?.ok) { toast.error(data?.error || "No se pudo configurar el DNS"); return; }
      if (data.configured) {
        toast.success(`DNS de ${d} configurado — ${data.created.length} registro(s) creados. Puede tardar unos minutos en propagarse.`);
      } else {
        toast.success(`${d} ya tenía SPF, DKIM y DMARC correctos.`);
      }
      if (data.warnings?.length) toast.warning(data.warnings[0]);
      // Refresh the SPF/DKIM/DMARC chips once DNS has had a moment to propagate.
      setTimeout(() => recheckDomain(d), 4000);
      setTimeout(() => recheckDomain(d), 15000);
    } catch (e: any) {
      toast.error(`Error al configurar DNS: ${e.message || e}`);
    } finally {
      setDnsConfiguring(p => ({ ...p, [d]: false }));
    }
  };

  // One-click: configure SPF/DKIM/DMARC for ALL account domains at once.
  const [dnsAllRunning, setDnsAllRunning] = useState(false);
  const [dnsAllProgress, setDnsAllProgress] = useState({ current: 0, total: 0 });
  const configureAllDns = async () => {
    const domains = Array.from(new Set(accounts.map(a => domainOf(a.email)).filter(Boolean)));
    if (domains.length === 0) { toast.info("No hay dominios que configurar"); return; }
    setDnsAllRunning(true);
    setDnsAllProgress({ current: 0, total: domains.length });
    let configured = 0, alreadyOk = 0, failed = 0;
    let idx = 0;
    const worker = async () => {
      while (idx < domains.length) {
        const d = domains[idx++];
        try {
          const { data, error } = await supabase.functions.invoke("configure-dns", { body: { domain: d } });
          if (error || !data?.ok) failed++;
          else if (data.configured) configured++;
          else alreadyOk++;
        } catch { failed++; }
        setDnsAllProgress(p => ({ ...p, current: p.current + 1 }));
      }
    };
    // Limit concurrency to 3 to stay friendly with the IONOS API.
    await Promise.all(Array.from({ length: Math.min(3, domains.length) }, worker));
    setDnsAllRunning(false);
    toast.success(`DNS · ${configured} configurados, ${alreadyOk} ya correctos${failed ? `, ${failed} con aviso/fuera de IONOS` : ""}`);
    // Refresh the chips for every domain after a short propagation delay.
    domains.forEach((d, i) => setTimeout(() => recheckDomain(d), 4000 + i * 150));
  };

  // ── Live IMAP connection check (real login test via verify-email-connection) ──
  type ImapCheck = { loading: boolean; ok?: boolean; error?: string; reverifying?: boolean; unverified?: boolean };
  const [imapChecks, setImapChecks] = useState<Record<string, ImapCheck>>(() => cacheGet<Record<string, ImapCheck>>("accounts:imapChecks") || {});
  const [verifyingAll, setVerifyingAll] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });

  // Persist the SETTLED IMAP/DNS results so the next visit paints them instantly (no spinner).
  useEffect(() => {
    const settled = Object.fromEntries(Object.entries(imapChecks).filter(([, v]) => !v.loading).map(([k, v]) => [k, { ...v, reverifying: false }]));
    if (Object.keys(settled).length) cacheSet("accounts:imapChecks", settled);
  }, [imapChecks]);
  useEffect(() => {
    const settled = Object.fromEntries(Object.entries(domainAuth).filter(([, v]) => !(v as { loading?: boolean }).loading).map(([k, v]) => [k, { ...v, reverifying: false }]));
    if (Object.keys(settled).length) cacheSet("accounts:domainAuth", settled);
  }, [domainAuth]);
  const requestedImapRef = useRef<Set<string>>(new Set());

  const checkImap = useCallback(async (accountId: string) => {
    // Only show the "conectando" spinner if we have NOTHING to show yet. If a status is
    // already known (seeded from the stored `status` or the cache), re-verify LIVE in the
    // background — keep the badge and mark it `reverifying` so a tiny pulse shows the status
    // is being confirmed for real (not a fake cache). Only flip it if the check actually fails.
    setImapChecks(prev => (prev[accountId] && !prev[accountId].loading
      ? { ...prev, [accountId]: { ...prev[accountId], reverifying: true } }
      : { ...prev, [accountId]: { ...(prev[accountId] || {}), loading: true } }));
    // A TRANSPORT failure (edge cold start, timeout, 5xx, a network blip) says NOTHING about the
    // mailbox — it only means we could not ASK. Flipping the badge to red on it is why healthy
    // accounts intermittently showed "IMAP sin conexión". Retry once, and if we still cannot ask,
    // keep whatever we already knew instead of inventing a failure.
    let transportErr: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((res) => setTimeout(res, 1200));
      try {
        const { data, error } = await supabase.functions.invoke("verify-email-connection", { body: { account_id: accountId } });
        const r = data as any;
        if (error || !r) { transportErr = error?.message || "sin respuesta del servidor"; continue; }
        if (r.error) { // the check RAN and reported a real problem → that is a genuine red
          setImapChecks(prev => ({ ...prev, [accountId]: { loading: false, ok: false, error: r.error } }));
          return;
        }
        // The server now tells us whether the failure was TRANSIENT (it timed out asking) —
        // that is "no lo pude comprobar", never "el buzón está caído".
        if (r.imap && r.imap.ok === false && r.imap.transient) {
          setImapChecks(prev => {
            const known = prev[accountId];
            return { ...prev, [accountId]: known && known.ok === true
              ? { ...known, loading: false, reverifying: false }
              : { loading: false, unverified: true, error: r.imap?.error } };
          });
          return;
        }
        setImapChecks(prev => ({ ...prev, [accountId]: { loading: false, ok: !!r.imap?.ok, error: r.imap?.error } }));
        return;
      } catch (e: any) {
        transportErr = e?.message || String(e);
      }
    }
    setImapChecks(prev => {
      const known = prev[accountId];
      return {
        ...prev,
        [accountId]: known && known.ok !== undefined
          ? { ...known, loading: false, reverifying: false }               // keep the known status
          : { loading: false, unverified: true, error: transportErr },     // never verified → neutral
      };
    });
  }, []);

  // Trust accounts verified in the last 30 min (show green from stored result);
  // only run a fresh live IMAP login for stale/unverified ones (max 2 at a time).
  useEffect(() => {
    const now = Date.now();
    const RECENT = 30 * 60 * 1000;
    const toVerify: string[] = [];        // not-connected accounts — these genuinely need a live check
    const staleConnected: string[] = [];  // connected-but-stale — re-confirm only a small sample
    const seed: Record<string, ImapCheck> = {};
    for (const a of accounts) {
      if (requestedImapRef.current.has(a.id)) continue;
      requestedImapRef.current.add(a.id);
      const lhc = a.last_health_check ? new Date(a.last_health_check).getTime() : 0;
      const recent = lhc && now - lhc < RECENT;
      // A stored-connected account is TRUSTED: paint it green instantly (no spinner) and do
      // NOT fire a live IMAP login for it. With 100+ accounts, one login per account crawled
      // the page and hammered IONOS. The server-side health monitor (cron every 5 min) keeps
      // the stored status fresh; here we only re-confirm a small SAMPLE live for reassurance.
      if (a.status === "connected") {
        seed[a.id] = { loading: false, ok: true };
        if (!recent) staleConnected.push(a.id);
      } else {
        toVerify.push(a.id);
      }
    }
    if (Object.keys(seed).length) setImapChecks(prev => ({ ...prev, ...seed }));
    const CONFIRM_CAP = 10; // re-confirm at most this many already-green accounts per load
    const finalVerify = [...toVerify, ...staleConnected.slice(0, CONFIRM_CAP)];
    if (finalVerify.length === 0) return;
    let cancelled = false;
    (async () => {
      const CONC = 3;
      for (let i = 0; i < finalVerify.length && !cancelled; i += CONC) {
        await Promise.all(finalVerify.slice(i, i + CONC).map((id: string) => checkImap(id)));
      }
      // Pending accounts that just verified now have a fresh DB status (connected/error) —
      // refresh the list so they show correctly here AND become available to campaigns.
      if (!cancelled && toVerify.length > 0) loadAccounts();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, checkImap]);

  const recheckImap = (accountId: string) => { requestedImapRef.current.add(accountId); checkImap(accountId); };

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    savedTags.forEach(t => tagSet.add(t.name));
    accounts.forEach(a => (a.tags || []).forEach((t: string) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [accounts, savedTags]);

  const filteredAccounts = useMemo(
    () => filterAccounts(accounts, search, filterTag),
    [accounts, filterTag, search],
  );

  const allSelected = filteredAccounts.length > 0 && filteredAccounts.every(a => selectedIds.has(a.id));

  // Escritorio o móvil: sólo se monta UNA de las dos vistas (antes las dos, ocultando una por CSS,
  // y con cientos de buzones eso doblaba el DOM). En móvil las tarjetas salen de 40 en 40.
  const isMobile = useIsMobile();
  const MOBILE_CHUNK = 40;
  const [mobileShown, setMobileShown] = useState(MOBILE_CHUNK);
  useEffect(() => { setMobileShown(MOBILE_CHUNK); }, [search, filterTag]);

  const loadAccounts = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("email_accounts_safe" as any).select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      // A transient query error / timeout (common on the NANO compute tier) must NOT wipe
      // the list — keep whatever is on screen (cache) instead of showing zero accounts.
      if (error) { console.warn("loadAccounts failed, keeping current list:", error.message); return; }
      const normalized = (data || []).map((account: any) => normalizeEmailAccount(account));
      setAccounts(normalized);
      setLoading(false); // la lista ya está: se pinta YA, sin esperar a nada más
      cacheSet("accounts:list", normalized); // instant paint on next visit
      // Los días de envío (para el escalón del slow-ramp) llegan aparte y no retrasan la pantalla.
      void (supabase as any).rpc("my_account_sending_days")
        .then(({ data: sd }: any) => setSendDaysByAccount(sendDaysMap(sd)))
        .catch(() => { /* si falla, effectiveDailyLimit asume 0 días: el escalón inicial, nunca de más */ });
    } catch (e: any) {
      console.warn("loadAccounts threw, keeping current list:", e?.message || e);
    } finally {
      setLoading(false);
    }
  };

  const loadSavedTags = async () => {
    if (!user) return;
    const { data } = await supabase.from("email_tags").select("id, name").eq("user_id", user.id).order("name");
    setSavedTags(data || []);
  };

  const ensureTagSaved = async (tagName: string) => {
    if (!user) return;
    const exists = savedTags.some(t => t.name === tagName);
    if (!exists) {
      await supabase.from("email_tags").upsert({ user_id: user.id, name: tagName }, { onConflict: "user_id,name" } as any);
    }
  };

  const handleCreateTag = async () => {
    const name = newTagInput.trim();
    if (!name || !user) return;
    const { error } = await supabase.from("email_tags").upsert({ user_id: user.id, name }, { onConflict: "user_id,name" } as any);
    if (error) { toast.error(error.message); return; }
    setNewTagInput("");
    toast.success(`Tag "${name}" creado`);
    loadSavedTags();
  };

  /** Create the tag (saved even with no accounts) and, if asked, put the selected / visible
   *  accounts in it. Same writes as the inline flows, in one dialog that is never disabled. */
  const openCreateTag = (scope: "none" | "selected" | "visible") => {
    setCreateTagName("");
    setCreateTagScope(scope);
    setCreateTagOpen(true);
  };
  const handleCreateTagWithScope = async () => {
    const name = createTagName.trim();
    if (!name || !user) return;
    const { error } = await supabase.from("email_tags").upsert({ user_id: user.id, name }, { onConflict: "user_id,name" } as any);
    if (error) { toast.error(error.message); return; }
    const targets = createTagScope === "selected"
      ? accounts.filter(a => selectedIds.has(a.id))
      : createTagScope === "visible" ? filteredAccounts : [];
    let added = 0;
    for (const account of targets) {
      const currentTags: string[] = account.tags || [];
      if (currentTags.includes(name)) continue;
      const { error: upErr } = await supabase.from("email_accounts").update({ tags: [...currentTags, name] } as any).eq("id", account.id);
      if (!upErr) added++;
    }
    toast.success(targets.length > 0 ? `Tag "${name}" creado y aplicado a ${added} cuentas` : `Tag "${name}" creado`);
    setCreateTagOpen(false);
    setCreateTagName("");
    if (targets.length > 0) setSelectedIds(new Set());
    loadSavedTags();
    if (added > 0) loadAccounts();
  };

  const handleDeleteSavedTag = async (tagName: string) => {
    if (!user) return;
    if (!window.confirm(`¿Eliminar el tag "${tagName}"? Se quitará de todas las cuentas que lo tengan.`)) return;
    // Remove from all accounts
    const accountsWithTag = accounts.filter(a => (a.tags || []).includes(tagName));
    for (const account of accountsWithTag) {
      const currentTags: string[] = account.tags || [];
      await supabase.from("email_accounts").update({ tags: currentTags.filter(t => t !== tagName) } as any).eq("id", account.id);
    }
    // Remove from saved tags
    await supabase.from("email_tags").delete().eq("user_id", user.id).eq("name", tagName);
    if (filterTag === tagName) setFilterTag(null);
    toast.success(`Tag "${tagName}" eliminado`);
    loadSavedTags();
    loadAccounts();
  };

  // Renombra un tag EN CASCADA: cuentas (email_accounts.tags), campañas
  // (campaigns.account_tags) y el tag guardado (email_tags). Merge-safe: si el
  // nombre nuevo ya existe, se fusiona (dedup) en vez de duplicar.
  const handleRenameSavedTag = async (oldName: string, rawNew: string) => {
    if (!user) return;
    const newName = rawNew.trim();
    if (!newName || newName === oldName) { setEditingTag(null); return; }

    // 1) Cuentas con el tag viejo → sustituir por el nuevo (dedup)
    const accountsWithOld = accounts.filter(a => (a.tags || []).includes(oldName));
    for (const account of accountsWithOld) {
      const cur: string[] = account.tags || [];
      const next = Array.from(new Set(cur.map(t => (t === oldName ? newName : t))));
      await supabase.from("email_accounts").update({ tags: next } as any).eq("id", account.id);
    }

    // 2) Campañas que apuntan al tag viejo → re-apuntar al nuevo (dedup)
    const { data: camps } = await supabase.from("campaigns").select("id, account_tags").eq("user_id", user.id);
    for (const c of (camps || [])) {
      const tags: string[] = (c as any).account_tags || [];
      if (tags.includes(oldName)) {
        const next = Array.from(new Set(tags.map(t => (t === oldName ? newName : t))));
        await supabase.from("campaigns").update({ account_tags: next } as any).eq("id", c.id);
      }
    }

    // 3) Tag guardado: crear el nuevo (idempotente) + borrar el viejo
    await supabase.from("email_tags").upsert({ user_id: user.id, name: newName }, { onConflict: "user_id,name" } as any);
    await supabase.from("email_tags").delete().eq("user_id", user.id).eq("name", oldName);

    if (filterTag === oldName) setFilterTag(newName);
    setEditingTag(null);
    setEditingTagValue("");
    toast.success(`Tag renombrado: "${oldName}" → "${newName}"`);
    loadSavedTags();
    loadAccounts();
  };

  useEffect(() => { loadAccounts(); loadSavedTags(); }, [user]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAccounts.map(a => a.id)));
    }
  };

  const handleBulkRemoveTag = async (tag: string) => {
    const selected = accounts.filter(a => selectedIds.has(a.id));
    for (const account of selected) {
      const currentTags: string[] = account.tags || [];
      if (currentTags.includes(tag)) {
        await supabase.from("email_accounts").update({ tags: currentTags.filter(t => t !== tag) } as any).eq("id", account.id);
      }
    }
    toast.success(`Tag "${tag}" eliminado de ${selected.length} cuentas`);
    loadAccounts();
  };

  // "Añadir cuenta": valida → guarda → VERIFICA la conexión real (SMTP + IMAP) antes de dar la
  // cuenta por buena. Si el servidor rechaza las credenciales el diálogo sigue abierto con el
  // motivo, y el reintento corrige la MISMA fila (draftAccountId) en vez de crear duplicados.
  const handleAdd = async () => {
    if (!user || adding) return;
    setAddError(null);
    const built = buildAccountPayload(form, addProvider);
    if ("error" in built) { setAddError(built.error); return; }
    const payload = built.payload;
    const draftId = draftAccountId.current;
    if (accounts.some(a => a.id !== draftId && String(a.email || "").toLowerCase() === payload.email)) {
      setAddError("Esa cuenta ya está en tu lista. Si no conecta, edítala desde la tabla.");
      return;
    }
    setAdding(true);
    try {
      let accountId = draftId;
      if (accountId) {
        const { error } = await supabase.from("email_accounts").update(payload as any).eq("id", accountId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase.from("email_accounts")
          .insert({ user_id: user.id, ...payload, status: "pending" } as any).select("id").single();
        if (error) throw new Error(error.message);
        accountId = (data as any).id as string;
        draftAccountId.current = accountId;
      }
      const { data: result, error: fnError } = await supabase.functions.invoke("verify-email-connection", { body: { account_id: accountId } });
      if (fnError) throw new Error(`No se pudo verificar la conexión: ${fnError.message}`);
      if (result?.status === "connected") {
        toast.success("Cuenta conectada — sincronizando bandeja…");
        syncAccountInbox(accountId!);
        draftAccountId.current = null;
        setShowAdd(false);
        setForm({ ...emptyForm });
      } else {
        const reason = result?.smtp?.error || result?.imap?.error || "el servidor no respondió";
        setAddError(`No se pudo conectar: ${reason}. Revisa los datos y vuelve a intentarlo.`);
      }
      loadAccounts();
    } catch (e: any) {
      setAddError(e?.message || "Error inesperado al añadir la cuenta.");
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = (account: any) => {
    setEditingId(account.id);
    setForm({
      email: account.email, first_name: account.first_name || "", last_name: account.last_name || "",
      imap_username: account.imap_username, imap_password: "", imap_host: account.imap_host, imap_port: String(account.imap_port),
      smtp_username: account.smtp_username, smtp_password: "", smtp_host: account.smtp_host, smtp_port: String(account.smtp_port),
      daily_limit: String(account.daily_limit),
      provider: account.imap_host === "imap.gmail.com" ? "gmail" : account.imap_host === "outlook.office365.com" ? "outlook" : account.imap_host === "imap.ionos.es" ? "ionos" : "custom",
    });
    setShowEdit(true);
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const updateData: any = {
      email: form.email, first_name: form.first_name, last_name: form.last_name,
      imap_username: form.imap_username, imap_host: form.imap_host, imap_port: parseInt(form.imap_port),
      smtp_username: form.smtp_username, smtp_host: form.smtp_host, smtp_port: parseInt(form.smtp_port),
      daily_limit: parseInt(form.daily_limit),
    };
    if (form.imap_password) updateData.imap_password = form.imap_password;
    if (form.smtp_password) updateData.smtp_password = form.smtp_password;
    const { error } = await supabase.from("email_accounts").update(updateData).eq("id", editingId);
    if (error) { toast.error(error.message); return; }
    toast.success("Cuenta actualizada");
    setShowEdit(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    loadAccounts();
    handleVerify(editingId);
  };

  const handleAddTag = async (accountId: string, tag: string) => {
    const newTags = tag.split(",").map(t => t.trim()).filter(Boolean);
    if (newTags.length === 0) return;
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;
    const currentTags: string[] = account.tags || [];
    const uniqueNew = newTags.filter(t => !currentTags.includes(t));
    if (uniqueNew.length === 0) return;
    const { error } = await supabase.from("email_accounts").update({ tags: [...currentTags, ...uniqueNew] } as any).eq("id", accountId);
    if (error) { toast.error(error.message); return; }
    for (const t of uniqueNew) await ensureTagSaved(t);
    loadAccounts();
    loadSavedTags();
  };

  const handleRemoveTag = async (accountId: string, tag: string) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;
    const currentTags: string[] = account.tags || [];
    const { error } = await supabase.from("email_accounts").update({ tags: currentTags.filter(t => t !== tag) } as any).eq("id", accountId);
    if (error) { toast.error(error.message); return; }
    loadAccounts();
  };

  const handleDownloadCSV = () => {
    if (!accounts.length) { toast.error("No hay cuentas para exportar"); return; }
    downloadCsv(`cuentas-email-${new Date().toISOString().slice(0,10)}.csv`, accountsToCsv(accounts as any));
    toast.success(`${accounts.length} cuentas exportadas`);
  };
  const handleDownloadTemplate = () => {
    downloadCsv("plantilla-cuentas-email.csv", accountsCsvTemplate());
    toast.success("Plantilla descargada: rellena una fila por cuenta");
  };

  const importCsvFile = (file: File) => {
    if (!file || !user) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const { parseCSV } = await import("@/lib/csv-parser");
      const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
      const cleanCell = (value: string) => value
        .replace(/\uFEFF/g, "")
        .replace(/\r/g, "")
        .replace(/\n+/g, " ")
        .replace(/\t+/g, " ")
        .trim()
        .replace(/^[\u0022\u0027\u2018\u2019\u201C\u201D`]+|[\u0022\u0027\u2018\u2019\u201C\u201D`]+$/g, "")
        .trim();
      const cleanEmail = (value: string) => cleanCell(value).replace(/[\s,"'`]+/g, "").toLowerCase();
      const parsePort = (value: string, fallback: number) => {
        const parsed = parseInt(cleanCell(value), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      const parsed = parseCSV(text);
      if (parsed.length < 2) { toast.error("CSV vacío"); return; }

      const headerCount: Record<string, number> = {};
      const headers = parsed[0].map((header) => {
        const normalized = cleanCell(header).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "column";
        headerCount[normalized] = (headerCount[normalized] || 0) + 1;
        return headerCount[normalized] === 1 ? normalized : `${normalized}_${headerCount[normalized]}`;
      });

      const rows = parsed
        .slice(1)
        .filter(values => values.some(value => cleanCell(value || "")))
        .map(values => {
          const obj: Record<string, string> = {};
          headers.forEach((header, index) => {
            obj[header] = cleanCell(values[index] || "");
          });
          return obj;
        });

      const inserts = rows.map((row) => {
        const email = cleanEmail(row.email || row.e_mail || row.mail || "");
        const firstName = cleanCell(row.first_name || row.firstname || "");
        const lastName = cleanCell(row.last_name || row.lastname || "");
        const imapHost = cleanCell(row.imap_host || "").replace(/,/g, ".");
        const smtpHost = cleanCell(row.smtp_host || "").replace(/,/g, ".");
        const imapPassword = cleanCell(row.imap_password || "");
        const smtpPassword = cleanCell(row.smtp_password || "");

        return {
          user_id: user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          imap_username: cleanEmail(row.imap_username || email),
          imap_password: imapPassword,
          imap_host: imapHost,
          imap_port: parsePort(row.imap_port || "", 993),
          smtp_username: cleanEmail(row.smtp_username || email),
          smtp_password: smtpPassword,
          smtp_host: smtpHost,
          smtp_port: parsePort(row.smtp_port || "", 587),
          status: "pending" as const,
        };
      }).filter(row => emailPattern.test(row.email) && row.imap_host && row.smtp_host);

      if (inserts.length === 0) { toast.error("No se encontraron cuentas válidas"); return; }
      const { toInsert, toUpdate } = await splitNewAndExisting(inserts);
      if (toInsert.length > 0) {
        const { error } = await supabase.from("email_accounts").insert(toInsert);
        if (error) { toast.error(error.message); return; }
      }
      for (const { id, row } of toUpdate) {
        const { email: _e, status: _s, user_id: _u, ...fields } = row as Record<string, unknown>;
        await supabase.from("email_accounts").update(fields).eq("id", id);
      }
      toast.success(
        `${toInsert.length} cuentas nuevas importadas` +
        (toUpdate.length > 0 ? ` · ${toUpdate.length} ya existían y se han actualizado (sin duplicar)` : ""),
      );
      loadAccounts();
    };
    reader.readAsText(file);
  };

  /** Pull a single mailbox into the Unibox right away (IMAP fetch for one account). */
  const syncAccountInbox = async (accountId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ account_id: accountId }),
      });
    } catch { /* background — ignore errors */ }
  };

  /** Split a bulk import into rows that are NEW and rows whose address this user ALREADY has.
   *  Re-importing a corrected CSV must UPDATE the existing mailbox (fixing a wrong password),
   *  never create a second row for the same address — that is how the account list grew to 399
   *  duplicated addresses, each one then synced twice for nothing. Nothing is ever deleted. */
  const splitNewAndExisting = async <T extends { email: string }>(rows: T[]) => {
    if (!user) return { toInsert: rows, toUpdate: [] as { id: string; row: T }[] };
    const existing = new Map<string, string>();
    for (let off = 0; ; off += 1000) {
      const { data } = await supabase.from("email_accounts").select("id, email").eq("user_id", user.id).range(off, off + 999);
      if (!data?.length) break;
      for (const a of data) existing.set(String(a.email).trim().toLowerCase(), a.id);
      if (data.length < 1000) break;
    }
    const toInsert: T[] = [];
    const toUpdate: { id: string; row: T }[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const key = String(r.email).trim().toLowerCase();
      if (seen.has(key)) continue;           // the CSV itself repeating a row
      seen.add(key);
      const id = existing.get(key);
      if (id) toUpdate.push({ id, row: r }); else toInsert.push(r);
    }
    return { toInsert, toUpdate };
  };

  const handleVerify = async (accountId: string) => {
    setVerifying(accountId);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("verify-email-connection", {
        body: { account_id: accountId },
      });
      if (fnError) throw fnError;
      // La función puede devolver null (respuesta vacía sin error): leer result.status
      // reventaba con un TypeError y el usuario solo veía "Error verificando: undefined".
      if (result?.status === "connected") {
        toast.success("Conexión verificada — sincronizando bandeja…");
        // As soon as the mailbox connects, pull its inbox into the Unibox.
        syncAccountInbox(accountId);
      } else if (!result) {
        toast.error("La verificación no devolvió respuesta. Inténtalo de nuevo.");
      } else {
        toast.error(`Error de conexión: ${result.smtp?.error || result.imap?.error || "Error desconocido"}`);
      }
      loadAccounts();
    } catch (e: any) {
      toast.error(`Error verificando: ${e.message}`);
    }
    setVerifying(null);
  };

  const handleVerifyAll = async () => {
    const pending = accounts.filter(a => a.status === "pending" || a.status === "error");
    if (pending.length === 0) { toast.info("No hay cuentas pendientes de verificar"); return; }
    // Concurrent (was one-by-one with a full reload after EACH — crawled with 100+ accounts).
    // CONC=4 stays gentle on IONOS; a single reload at the end; inbox sync is left to the cron.
    setVerifyingAll({ running: true, done: 0, total: pending.length });
    const ids = pending.map(a => a.id);
    let done = 0;
    let connected = 0;
    // IONOS throttles a burst of logins, so a check can TIME OUT on a perfectly good mailbox.
    // Those are collected and retried once, more gently — otherwise a bulk import leaves dozens
    // of healthy accounts sitting in "error" until someone clicks again.
    const retry: string[] = [];
    const verifyOne = async (id: string, collect: boolean) => {
      try {
        const { data } = await supabase.functions.invoke("verify-email-connection", { body: { account_id: id } });
        const r = data as { status?: string; transient?: boolean } | null;
        if (r?.status === "connected") connected += 1;
        else if (r?.transient && collect) retry.push(id);
      } catch { if (collect) retry.push(id); }
      done += 1; setVerifyingAll(v => ({ ...v, done }));
    };
    const CONC = 4;
    for (let i = 0; i < ids.length; i += CONC) {
      await Promise.all(ids.slice(i, i + CONC).map((id) => verifyOne(id, true)));
    }
    if (retry.length > 0) {
      setVerifyingAll({ running: true, done: 0, total: retry.length });
      done = 0;
      for (const id of retry) {                       // one at a time, with a breather
        await verifyOne(id, false);
        await new Promise((res) => setTimeout(res, 400));
      }
    }
    setVerifyingAll({ running: false, done: 0, total: 0 });
    await loadAccounts();
    const failed = pending.length - connected;
    toast.success(
      `Verificación completada: ${connected} conectadas${failed > 0 ? `, ${failed} sin conectar` : ""}` +
      (retry.length > 0 ? ` (${retry.length} reintentadas por timeout)` : ""),
    );
  };



  const handleBulkIonosImport = async () => {
    if (!user) return;
    const validRows = ionosRows.filter(r => r.email.trim() && (r.password.trim() || ionosDefaultPassword.trim()));
    if (validRows.length === 0) { toast.error("Añade al menos una cuenta con email y contraseña"); return; }
    setIonosImporting(true);
    const ionos = PROVIDER_PRESETS.ionos;
    const inserts = validRows.map(r => {
      const pw = r.password.trim() || ionosDefaultPassword.trim();
      const fn = r.first_name.trim() || ionosDefaultFirstName.trim() || null;
      const ln = r.last_name.trim() || ionosDefaultLastName.trim() || null;
      return {
        user_id: user.id,
        email: r.email.trim(),
        first_name: fn,
        last_name: ln,
        imap_username: r.email.trim(),
        imap_password: pw,
        imap_host: ionos.imap_host,
        imap_port: parseInt(ionos.imap_port),
        smtp_username: r.email.trim(),
        smtp_password: pw,
        smtp_host: ionos.smtp_host,
        smtp_port: parseInt(ionos.smtp_port),
        daily_limit: 50,
        status: "pending" as const,
      };
    });
    const { toInsert, toUpdate } = await splitNewAndExisting(inserts);
    if (toInsert.length > 0) {
      const { error } = await supabase.from("email_accounts").insert(toInsert);
      if (error) { toast.error(error.message); setIonosImporting(false); return; }
    }
    for (const { id, row } of toUpdate) {
      const { email: _e, status: _s, user_id: _u, ...fields } = row as Record<string, unknown>;
      await supabase.from("email_accounts").update(fields).eq("id", id);
    }
    toast.success(
      `${toInsert.length} cuentas IONOS nuevas` +
      (toUpdate.length > 0 ? ` · ${toUpdate.length} actualizadas (sin duplicar)` : ""),
    );
    setShowBulkIonos(false);
    setIonosRows([{ email: "", first_name: "", last_name: "", password: "" }]);
    setIonosDefaultPassword("");
    setIonosDefaultFirstName("");
    setIonosDefaultLastName("");
    setIonosImporting(false);
    loadAccounts();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Estás seguro de que quieres eliminar esta cuenta?")) return;
    const { error } = await supabase.from("email_accounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Cuenta eliminada");
    loadAccounts();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`¿Estás seguro de que quieres eliminar ${count} cuenta(s)? Esta acción no se puede deshacer.`)) return;
    // Un solo DELETE en lugar de N peticiones cuyos errores se ignoraban: así un fallo se ve
    // y no se anuncia "eliminadas" con las cuentas todavía ahí.
    const { error } = await supabase.from("email_accounts").delete().in("id", Array.from(selectedIds));
    if (error) { toast.error(error.message); return; }
    toast.success(`${count} cuenta(s) eliminada(s)`);
    setSelectedIds(new Set());
    loadAccounts();
  };

  const openBulkEdit = () => {
    setBulkEditForm({ daily_limit: "", first_name: "", last_name: "", imap_host: "", imap_port: "", imap_username: "", imap_password: "", smtp_host: "", smtp_port: "", smtp_username: "", smtp_password: "", send_start_hour: "", send_end_hour: "", signature_html: "" });
    setBulkEditFields(new Set());
    setShowBulkEdit(true);
  };

  // ── Signature manager ──────────────────────────────────────────────────────
  const openSignatureManager = () => {
    // Prefill with an existing signature (the first account that already has one)
    // so editing/reusing is easy.
    const existing = (accounts.find(a => ((a as any).signature_html || "").trim()) as any)?.signature_html || "";
    setSigHtml(existing);
    setSigScope(selectedIds.size > 0 ? "selected" : "all");
    setSigTag(allTags[0] || "");
    setShowSignature(true);
  };

  // Accounts the signature will be written to, per the chosen scope.
  const signatureTargetIds = useMemo(() => {
    if (sigScope === "selected") return [...selectedIds];
    if (sigScope === "tag") return accounts.filter(a => (a.tags || []).includes(sigTag)).map(a => a.id);
    return filteredAccounts.map(a => a.id); // "all" = everything currently visible
  }, [sigScope, sigTag, accounts, filteredAccounts, selectedIds]);

  /** Sube las imágenes que vengan INCRUSTADAS en la firma (una firma pegada desde fuera suele
   *  traer el logo en base64) y deja su enlace. Incrustadas funcionan en las respuestas manuales
   *  pero NO en los envíos de campaña: Gmail las bloquea y el logo sale roto. */
  const hostSignatureImages = async (html: string): Promise<string> => {
    const imgs = findDataImages(html);
    if (imgs.length === 0) return html;
    const urls = new Map<string, string>();
    for (const img of imgs) {
      if (urls.has(img.whole)) continue;
      const bytes = decodeBase64Image(img.base64);
      if (!bytes || !isWorthHosting(bytes.length)) continue;
      const ext = (img.mime.split("/")[1] || "png").replace(/[^a-z0-9]/g, "") || "png";
      const path = `signatures/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("godtube-media")
        .upload(path, new Blob([bytes as unknown as BlobPart], { type: img.mime }), { contentType: img.mime, upsert: false });
      if (error) continue;   // si falla la subida, se deja la imagen tal cual: nunca se pierde
      urls.set(img.whole, supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl);
    }
    return urls.size > 0 ? replaceDataImages(html, (img) => urls.get(img.whole) || null) : html;
  };

  const applySignature = async () => {
    const ids = signatureTargetIds;
    if (ids.length === 0) { toast.error("No hay cuentas en el alcance elegido"); return; }
    setSigSaving(true);
    const htmlToSave = await hostSignatureImages(sigHtml);
    if (htmlToSave !== sigHtml) { setSigHtml(htmlToSave); toast.info("El logo de la firma se ha subido para que se vea también en las campañas"); }
    // One query for the whole scope (up to all 84 accounts).
    const { error } = await supabase.from("email_accounts").update({ signature_html: htmlToSave } as any).in("id", ids);
    setSigSaving(false);
    if (error) { toast.error(`No se pudo aplicar la firma: ${error.message}`); return; }
    toast.success(sigHtml.trim()
      ? `Firma aplicada a ${ids.length} cuenta(s)`
      : `Firma eliminada de ${ids.length} cuenta(s)`);
    setShowSignature(false);
    loadAccounts();
  };

  const toggleBulkEditField = (field: string) => {
    setBulkEditFields(prev => {
      const next = new Set(prev);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };

  // Slow ramp = increase each account's daily sends gradually to warm mailboxes.
  // Effective daily limit = min((day+1) * increment, target). Day computed from warmup_started_at.
  const rampInfo = (acc: any) => {
    if (!acc?.warmup_enabled || !acc?.warmup_started_at) return null;
    // Mismo cálculo que el motor: la rampa avanza por DÍAS DE ENVÍO REALES (RPC
    // my_account_sending_days), no por calendario. Sin campaña activa → 0 días → se
    // queda en el escalón inicial; fin de semana o día sin envío → no suma.
    const r = effectiveDailyLimit(acc, sendDaysByAccount[acc.id]);
    const target = acc.warmup_limit || acc.daily_limit || 30;
    return { day: r.accRampDay ?? 1, eff: r.limit, target };
  };

  const handleApplySlowRamp = async () => {
    if (!user) return;
    // "todas" = everything the current search/tag actually shows — applying a slow ramp to all
    // 292 mailboxes while the list is filtered to "eric" would be a nasty surprise.
    const ids = selectedIds.size > 0 ? [...selectedIds] : filteredAccounts.map((a) => a.id);
    if (ids.length === 0) { toast.error("No hay cuentas"); return; }
    const increment = Math.max(1, parseInt(slowRampForm.increment) || 2);
    const start = Math.max(0, parseInt(slowRampForm.start) || 0); // 0 = start from increment (legacy)
    const target = Math.max(start || increment, parseInt(slowRampForm.target) || 30);
    const payload: any = {
      warmup_enabled: true,
      warmup_increment: increment,
      warmup_limit: target,
      warmup_day: start,           // repurposed: starting daily limit (día 1)
      warmup_started_at: new Date().toISOString(),
    };
    await applyRampChange(ids, payload, "Activando slow ramp", "activado");
  };

  // El mismo cambio para todas: va por tandas de 25 cuentas, 5 a la vez, y la barra avanza con
  // cada tanda. Antes era un UPDATE por cuenta en fila: con 400 buzones, ~40 s sin ver nada.
  const applyRampChange = async (ids: string[], payload: Record<string, unknown>, label: string, done: string) => {
    if (!user || rampProgress) return;
    setRampProgress({ done: 0, total: ids.length, failed: 0, label });
    const result = await applyInChunks(
      ids,
      async (batch) => await supabase.from("email_accounts").update(payload as any).eq("user_id", user.id).in("id", batch),
      (pr) => setRampProgress({ ...pr, label }),
    );
    // La lista se pone al día YA (sin esperar a recargar 900 cuentas) y luego se confirma con la BD.
    if (result.failed < result.total) {
      const touched = new Set(ids);
      setAccounts((prev) => prev.map((a) => (touched.has(a.id) ? { ...a, ...(payload as any) } : a)));
    }
    if (result.failed > 0) toast.error(`No se pudo aplicar en ${result.failed} de ${result.total} cuenta(s). Vuelve a intentarlo.`);
    else toast.success(`Slow ramp ${done} en ${result.total} cuenta(s)`);
    setRampProgress(null);
    if (result.failed === 0) { setShowSlowRamp(false); setSelectedIds(new Set()); }
    void loadAccounts();
  };

  const handleDisableSlowRamp = async () => {
    if (!user) return;
    // "todas" = everything the current search/tag actually shows — applying a slow ramp to all
    // 292 mailboxes while the list is filtered to "eric" would be a nasty surprise.
    const ids = selectedIds.size > 0 ? [...selectedIds] : filteredAccounts.map((a) => a.id);
    if (ids.length === 0) return;
    await applyRampChange(ids, { warmup_enabled: false }, "Desactivando slow ramp", "desactivado");
  };

  const handleBulkEdit = async () => {
    if (selectedIds.size === 0 || bulkEditFields.size === 0) return;
    const updates: Record<string, any> = {};
    if (bulkEditFields.has("daily_limit") && bulkEditForm.daily_limit) updates.daily_limit = parseInt(bulkEditForm.daily_limit);
    if (bulkEditFields.has("first_name")) updates.first_name = bulkEditForm.first_name;
    if (bulkEditFields.has("last_name")) updates.last_name = bulkEditForm.last_name;
    if (bulkEditFields.has("imap_host") && bulkEditForm.imap_host) updates.imap_host = bulkEditForm.imap_host;
    if (bulkEditFields.has("imap_port") && bulkEditForm.imap_port) updates.imap_port = parseInt(bulkEditForm.imap_port);
    if (bulkEditFields.has("imap_username") && bulkEditForm.imap_username) updates.imap_username = bulkEditForm.imap_username;
    if (bulkEditFields.has("imap_password") && bulkEditForm.imap_password) updates.imap_password = bulkEditForm.imap_password;
    if (bulkEditFields.has("smtp_host") && bulkEditForm.smtp_host) updates.smtp_host = bulkEditForm.smtp_host;
    if (bulkEditFields.has("smtp_port") && bulkEditForm.smtp_port) updates.smtp_port = parseInt(bulkEditForm.smtp_port);
    if (bulkEditFields.has("smtp_username") && bulkEditForm.smtp_username) updates.smtp_username = bulkEditForm.smtp_username;
    if (bulkEditFields.has("smtp_password") && bulkEditForm.smtp_password) updates.smtp_password = bulkEditForm.smtp_password;
    if (bulkEditFields.has("send_start_hour") && bulkEditForm.send_start_hour) updates.send_start_hour = parseInt(bulkEditForm.send_start_hour);
    if (bulkEditFields.has("send_end_hour") && bulkEditForm.send_end_hour) updates.send_end_hour = parseInt(bulkEditForm.send_end_hour);
    if (Object.keys(updates).length === 0) { toast.error("No hay cambios que aplicar"); return; }
    // One query for ALL selected accounts (was N per-row updates — heavy on 84 cuentas).
    const ids = [...selectedIds];
    const { error } = await supabase.from("email_accounts").update(updates).in("id", ids);
    if (error) { toast.error(`No se pudieron aplicar los cambios: ${error.message}`); return; }
    toast.success(`${ids.length} cuenta(s) actualizadas`);
    setShowBulkEdit(false);
    setSelectedIds(new Set());
    loadAccounts();
  };

  const handleProviderChange = (provider: string) => {
    const preset = PROVIDER_PRESETS[provider];
    setForm(prev => ({
      ...prev,
      provider,
      imap_host: preset.imap_host || prev.imap_host,
      imap_port: preset.imap_port,
      smtp_host: preset.smtp_host || prev.smtp_host,
      smtp_port: preset.smtp_port,
      imap_username: provider !== "custom" ? prev.email : prev.imap_username,
      smtp_username: provider !== "custom" ? prev.email : prev.smtp_username,
    }));
  };

  /** "Añadir cuenta" → proveedor elegido: formulario LIMPIO con sus servidores ya puestos. */
  const pickProvider = (provider: "gmail" | "outlook" | "custom") => {
    const preset = PROVIDER_PRESETS[provider];
    setAddProvider(provider);
    setAddError(null);
    setForm({ ...emptyForm, provider, imap_host: preset.imap_host, imap_port: preset.imap_port, smtp_host: preset.smtp_host, smtp_port: preset.smtp_port });
  };

  const renderFormFields = () => {
    const preset = PROVIDER_PRESETS[form.provider] || PROVIDER_PRESETS.custom;
    const isPreset = form.provider !== "custom";
    return (
    <div className="space-y-4">
      {/* Provider selector */}
      <div className="space-y-1">
        <Label>Proveedor</Label>
        <Select value={form.provider} onValueChange={handleProviderChange}>
          <SelectTrigger><SelectValue placeholder="Selecciona proveedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="gmail">Gmail</SelectItem>
            <SelectItem value="outlook">Outlook / Hotmail</SelectItem>
            <SelectItem value="ionos">IONOS</SelectItem>
            <SelectItem value="custom">Personalizado (SMTP/IMAP)</SelectItem>
          </SelectContent>
        </Select>
        {preset.help && (
          <p className="text-xs text-muted-foreground mt-1 p-2 rounded bg-muted/50">
            {preset.help}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label>Email</Label><Input value={form.email} onChange={e => {
          const email = e.target.value;
          setForm(prev => ({
            ...prev, email,
            ...(isPreset ? { imap_username: email, smtp_username: email } : {}),
          }));
        }} placeholder={form.provider === "gmail" ? "tu@gmail.com" : form.provider === "outlook" ? "tu@outlook.com" : "email@domain.com"} /></div>
        <div className="space-y-1"><Label>Límite diario</Label><Input type="number" value={form.daily_limit} onChange={e => setForm({...form, daily_limit: e.target.value})} /></div>
        <div className="space-y-1"><Label>Nombre</Label><Input value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} /></div>
        <div className="space-y-1"><Label>Apellido</Label><Input value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} /></div>
      </div>

      {/* Password field for presets */}
      {isPreset && (
        <div className="space-y-1">
          <Label>Contraseña de aplicación</Label>
          <Input type="password" value={form.imap_password} onChange={e => setForm({...form, imap_password: e.target.value, smtp_password: e.target.value})} placeholder="Contraseña de aplicación" />
        </div>
      )}

      {/* IMAP/SMTP fields - collapsed for presets */}
      {!isPreset && (
        <>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">IMAP</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Usuario</Label><Input value={form.imap_username} onChange={e => setForm({...form, imap_username: e.target.value})} /></div>
            <div className="space-y-1"><Label>Contraseña</Label><Input type="password" value={form.imap_password} onChange={e => setForm({...form, imap_password: e.target.value})} /></div>
            <div className="space-y-1"><Label>Host</Label><Input value={form.imap_host} onChange={e => setForm({...form, imap_host: e.target.value})} placeholder="imap.gmail.com" /></div>
            <div className="space-y-1"><Label>Puerto</Label><Input value={form.imap_port} onChange={e => setForm({...form, imap_port: e.target.value})} /></div>
          </div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SMTP</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Usuario</Label><Input value={form.smtp_username} onChange={e => setForm({...form, smtp_username: e.target.value})} /></div>
            <div className="space-y-1"><Label>Contraseña</Label><Input type="password" value={form.smtp_password} onChange={e => setForm({...form, smtp_password: e.target.value})} /></div>
            <div className="space-y-1"><Label>Host</Label><Input value={form.smtp_host} onChange={e => setForm({...form, smtp_host: e.target.value})} placeholder="smtp.gmail.com" /></div>
            <div className="space-y-1"><Label>Puerto</Label><Input value={form.smtp_port} onChange={e => setForm({...form, smtp_port: e.target.value})} /></div>
          </div>
        </>
      )}
    </div>
  );
  };

  // Cuántas cuentas tienen el dominio bien autenticado — se enseña junto al título.
  const authSummary = configSummary(filteredAccounts.map((a) => {
    const d = domainOf(a.email);
    return { domain: d, auth: domainAuth[d] };
  }));

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-[clamp(26px,2.8vw,31px)] font-semibold leading-[1.1] tracking-[-1px] text-[#0b0d42] dark:text-foreground">Cuentas de Email</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-[#6f7da7] dark:text-muted-foreground">
            <span>{accounts.length > 0 ? "Gestiona todas tus cuentas conectadas" : "Gestiona tus cuentas SMTP/IMAP"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAgency && (
            <>
          {accounts.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleVerifyAll} disabled={verifyingAll.running}>
              {verifyingAll.running
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {verifyingAll.done}/{verifyingAll.total}</>
                : <><Wifi className="h-4 w-4" /> <span className="hidden sm:inline">Verificar todas</span><span className="sm:hidden">Verificar</span></>}
            </Button>
          )}
          {accounts.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2" onClick={configureAllDns} disabled={dnsAllRunning}>
              {dnsAllRunning ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {dnsAllProgress.current}/{dnsAllProgress.total}</>
              ) : (
                <><Wand2 className="h-4 w-4" /> <span className="hidden sm:inline">Configurar DNS</span><span className="sm:hidden">DNS</span></>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowBulkIonos(true)}>
            <Globe className="h-4 w-4" /> <span className="hidden sm:inline">IONOS en bloque</span><span className="sm:hidden">IONOS</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadCSV}>
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Descargar CSV</span><span className="sm:hidden">CSV↓</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setAddMode("bulk"); setShowAdd(true); }}>
            <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Bulk connect</span><span className="sm:hidden">Bulk</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={openSignatureManager}>
            <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Firma</span><span className="sm:hidden">Firma</span>
          </Button>
            </>
          )}
          <button
            type="button"
            className="soft-primary soft-primary-sm inline-flex items-center gap-2"
            onClick={() => { setAddMode("single"); setShowAdd(true); }}
          >
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Añadir cuenta</span><span className="sm:hidden">Añadir</span>
          </button>
          <AddAccountDialog
            open={showAdd}
            onOpenChange={(o) => { setShowAdd(o); if (!o) { draftAccountId.current = null; setAddError(null); } }}
            initialMode={addMode}
            renderForm={(provider) => (
              <ConnectAccountForm provider={provider} form={form} disabled={adding}
                onChange={(patch) => { setAddError(null); setForm(prev => ({ ...prev, ...patch })); }} />
            )}
            submitting={adding}
            submitError={addError}
            onPickProvider={pickProvider}
            onSubmitSingle={handleAdd}
            onCsvFile={importCsvFile}
            onDownloadTemplate={handleDownloadTemplate}
            onDownloadAccounts={handleDownloadCSV}
            accountsCount={accounts.length}
          />
        </div>
      </div>

      {/* Resumen: cuántas hay y cómo está su DNS. Es lo primero que se mira al entrar. */}
      {accounts.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="soft-stat">
            <span className="soft-stat-icon bg-[#eef0ff] text-[#6146ff] dark:bg-primary/15 dark:text-primary"><Mail className="h-5 w-5" /></span>
            <span>
              <span className="block font-display text-[24px] font-semibold leading-none text-foreground">{accounts.length}</span>
              <span className="block text-[13px] text-muted-foreground">Cuentas totales</span>
            </span>
          </div>
          <div className="soft-stat">
            <span className="soft-stat-icon bg-[#e9fbf4] text-[#08a76c] dark:bg-[#08a76c]/15"><ShieldCheck className="h-5 w-5" /></span>
            <span>
              <span className="block font-display text-[24px] font-semibold leading-none text-foreground">{authSummary.ok}</span>
              <span className="block text-[13px] text-muted-foreground">Bien configuradas</span>
            </span>
          </div>
          <div className="soft-stat">
            <span className="soft-stat-icon bg-[#fff0f2] text-[#ef4055] dark:bg-[#ef4055]/15"><ShieldAlert className="h-5 w-5" /></span>
            <span>
              <span className="block font-display text-[24px] font-semibold leading-none text-foreground">{authSummary.bad}</span>
              <span className="block text-[13px] text-muted-foreground">Con registros que faltan</span>
            </span>
          </div>
          <div className="soft-stat">
            <span className="soft-stat-icon bg-[#f0f2f7] text-[#6d7898] dark:bg-muted"><ShieldQuestion className="h-5 w-5" /></span>
            <span>
              <span className="block font-display text-[24px] font-semibold leading-none text-foreground">{authSummary.warn + authSummary.unknown + authSummary.checking}</span>
              <span className="block text-[13px] text-muted-foreground">Requieren configuración</span>
            </span>
          </div>
        </div>
      )}

      {/* Tag filter bar - always visible */}
      <div className="soft-panel flex items-center gap-2 overflow-x-auto px-4 py-3">
        <Tag className="h-4 w-4 shrink-0 text-[#7b55ff]" />
        <button
          onClick={() => setFilterTag(null)}
          className={`soft-tagpill ${!filterTag ? "soft-tagpill-on" : ""}`}
        >
          Todas ({accounts.length})
        </button>
        {allTags.map(tag => {
          const count = accounts.filter(a => (a.tags || []).includes(tag)).length;
          return (
            <div key={tag} className="flex items-center gap-0.5 group">
              <button
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                className={`soft-tagpill rounded-r-none ${filterTag === tag ? "soft-tagpill-on" : ""}`}
              >
                {tag} ({count})
              </button>
              <button
                onClick={() => handleDeleteSavedTag(tag)}
                className={`px-1.5 py-1 rounded-r-full text-xs transition-colors opacity-0 group-hover:opacity-100 ${filterTag === tag ? "bg-primary/80 text-primary-foreground hover:bg-destructive" : "bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"}`}
                title={`Eliminar tag "${tag}"`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <span className="mx-1.5 h-6 w-px shrink-0 bg-border" />
        <button
          type="button"
          onClick={() => openCreateTag(selectedIds.size > 0 ? "selected" : "none")}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] bg-[linear-gradient(90deg,#6650ff,#8b3dff)] px-3.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-[1px]"
        >
          <Plus className="h-3.5 w-3.5" /> Crear tag
        </button>
        <button
          type="button"
          onClick={() => setShowTagManager(true)}
          className="soft-control inline-flex h-9 shrink-0 items-center gap-1.5 px-3.5 text-[13px]"
        >
          <Tag className="h-3.5 w-3.5" /> Ver todos los tags
        </button>
      </div>

      {/* Crear tag — nombre + a qué cuentas aplicarlo. Nunca aparece apagado. */}
      <Dialog open={createTagOpen} onOpenChange={setCreateTagOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Tag className="h-5 w-5" /> Crear tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-tag-name">Nombre del tag</Label>
              <Input
                id="create-tag-name"
                autoFocus
                placeholder="p. ej. ONEPULSO, Cliente X, Warm-up…"
                value={createTagName}
                onChange={e => setCreateTagName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateTagWithScope(); }}
                list="create-tag-suggestions"
              />
              <datalist id="create-tag-suggestions">
                {allTags.map(t => <option key={t} value={t} />)}
              </datalist>
              {allTags.includes(createTagName.trim()) && (
                <p className="text-xs text-muted-foreground">Ese tag ya existe: se añadirán las cuentas que elijas.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Aplicar a</Label>
              <div className="grid gap-2">
                {([
                  { key: "none", label: "Solo crear el tag", hint: "sin cuentas, para usarlo luego" },
                  { key: "selected", label: `Cuentas seleccionadas (${selectedIds.size})`, hint: selectedIds.size === 0 ? "no hay ninguna seleccionada" : "las que has marcado en la lista" },
                  { key: "visible", label: `Todas las visibles (${filteredAccounts.length})`, hint: filterTag ? `las del filtro "${filterTag}"` : "todas las de la lista actual" },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={opt.key === "selected" && selectedIds.size === 0}
                    onClick={() => setCreateTagScope(opt.key)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${createTagScope === opt.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-xs text-muted-foreground">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTagOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateTagWithScope} disabled={!createTagName.trim()} className="gap-1">
              <Plus className="h-4 w-4" /> {createTagScope === "none" ? "Crear tag" : "Crear y aplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag Manager Dialog */}
      <Dialog open={showTagManager} onOpenChange={setShowTagManager}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Tag className="h-5 w-5" /> Todos los tags</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2 mb-4">
            <Input
              placeholder="Nuevo tag…"
              className="h-8 text-sm"
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateTag(); }}
            />
            <Button size="sm" onClick={handleCreateTag} disabled={!newTagInput.trim()} variant={newTagInput.trim() ? "default" : "secondary"} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Crear
            </Button>
          </div>
          {allTags.length === 0 ? (
            <p className="text-[15px] text-muted-foreground text-center py-8">No tienes ningún tag creado.</p>
          ) : (
            <div className="space-y-2">
              {allTags.map(tag => {
                const tagAccounts = accounts.filter(a => (a.tags || []).includes(tag));
                return (
                  <div key={tag} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {editingTag === tag ? (
                          <Input
                            value={editingTagValue}
                            onChange={e => setEditingTagValue(e.target.value)}
                            autoFocus
                            className="h-7 w-40 text-xs"
                            onKeyDown={e => {
                              if (e.key === "Enter") handleRenameSavedTag(tag, editingTagValue);
                              if (e.key === "Escape") { setEditingTag(null); setEditingTagValue(""); }
                            }}
                          />
                        ) : (
                          <Badge variant="secondary" className="text-xs">{tag}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{tagAccounts.length} cuenta{tagAccounts.length !== 1 ? "s" : ""}</span>
                      </div>
                      {tagAccounts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {tagAccounts.slice(0, 5).map(a => (
                            <span key={a.id} className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {a.email}
                            </span>
                          ))}
                          {tagAccounts.length > 5 && (
                            <span className="text-[11px] text-muted-foreground">+{tagAccounts.length - 5} más</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {editingTag === tag ? (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Guardar" onClick={() => handleRenameSavedTag(tag, editingTagValue)}>
                            <Check className="h-3.5 w-3.5 text-primary" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Cancelar" onClick={() => { setEditingTag(null); setEditingTagValue(""); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => { setFilterTag(tag); setShowTagManager(false); }}
                          >
                            Filtrar
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Renombrar tag"
                            onClick={() => { setEditingTag(tag); setEditingTagValue(tag); }}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleDeleteSavedTag(tag)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk IONOS Import Dialog */}
      <Dialog open={showBulkIonos} onOpenChange={setShowBulkIonos}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">Importación masiva IONOS</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            IMAP imap.ionos.es:993 (SSL) · SMTP smtp.ionos.es:587 (STARTTLS) — se configura automáticamente.
          </p>

          {/* Default values section */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Valores por defecto (se aplican si la fila está vacía)</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Nombre</Label>
                <Input placeholder="Nombre por defecto" value={ionosDefaultFirstName} onChange={e => setIonosDefaultFirstName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Apellido</Label>
                <Input placeholder="Apellido por defecto" value={ionosDefaultLastName} onChange={e => setIonosDefaultLastName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contraseña</Label>
                <Input type="password" placeholder="Contraseña por defecto" value={ionosDefaultPassword} onChange={e => setIonosDefaultPassword(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_0.7fr_0.7fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Email *</span><span>Nombre</span><span>Apellido</span><span>Contraseña</span><span></span>
            </div>
            {ionosRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_0.7fr_0.7fr_1fr_auto] gap-2">
                <Input
                  placeholder="usuario@tudominio.com"
                  value={row.email}
                  onChange={e => {
                    const next = [...ionosRows];
                    next[i] = { ...next[i], email: e.target.value };
                    setIonosRows(next);
                  }}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder={ionosDefaultFirstName || "Nombre"}
                  value={row.first_name}
                  onChange={e => {
                    const next = [...ionosRows];
                    next[i] = { ...next[i], first_name: e.target.value };
                    setIonosRows(next);
                  }}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder={ionosDefaultLastName || "Apellido"}
                  value={row.last_name}
                  onChange={e => {
                    const next = [...ionosRows];
                    next[i] = { ...next[i], last_name: e.target.value };
                    setIonosRows(next);
                  }}
                  className="h-8 text-xs"
                />
                <Input
                  type="password"
                  placeholder={ionosDefaultPassword ? "•••• (por defecto)" : "Contraseña"}
                  value={row.password}
                  onChange={e => {
                    const next = [...ionosRows];
                    next[i] = { ...next[i], password: e.target.value };
                    setIonosRows(next);
                  }}
                  className="h-8 text-xs"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    if (ionosRows.length <= 1) return;
                    setIonosRows(ionosRows.filter((_, j) => j !== i));
                  }}
                  disabled={ionosRows.length <= 1}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setIonosRows([...ionosRows, { email: "", first_name: "", last_name: "", password: "" }])}>
              <Plus className="h-3 w-3" /> Añadir fila
            </Button>
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setIonosRows([...ionosRows, ...Array.from({ length: 5 }, () => ({ email: "", first_name: "", last_name: "", password: "" }))])}>
              <Plus className="h-3 w-3" /> +5 filas
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {ionosRows.filter(r => r.email.trim() && (r.password.trim() || ionosDefaultPassword.trim())).length} cuenta(s) válidas
            </span>
          </div>
          <Button
            onClick={handleBulkIonosImport}
            disabled={ionosImporting || ionosRows.filter(r => r.email.trim() && (r.password.trim() || ionosDefaultPassword.trim())).length === 0}
            variant={ionosRows.filter(r => r.email.trim() && (r.password.trim() || ionosDefaultPassword.trim())).length === 0 ? "secondary" : "default"}
            className="w-full gap-2"
          >
            {ionosImporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {ionosImporting ? "Importando..." : `Importar ${ionosRows.filter(r => r.email.trim() && (r.password.trim() || ionosDefaultPassword.trim())).length} cuentas IONOS`}
          </Button>
        </DialogContent>
      </Dialog>


      {accounts.length > 0 && (
        <div className="soft-panel flex flex-wrap items-center gap-3 px-4 py-3.5">
          {/* Search — filters the list; "seleccionar todas" and every bulk action then act on
              exactly what is shown, so "eric" + select-all = only Eric's mailboxes. */}
          <div className="relative order-first w-full sm:w-[290px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8090b4]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cuenta, nombre, host o tag…"
              className="soft-control w-full pl-11 pr-9 font-normal"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} seleccionadas` : "Seleccionar cuentas"}
          </span>
          {search.trim() && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {filteredAccounts.length} de {accounts.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowSlowRamp(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dedaf8] bg-[#faf8ff] px-3.5 text-[12.5px] font-semibold text-[#6249dc] transition-colors hover:border-[#c3b8ff] dark:border-border dark:bg-primary/10 dark:text-primary"
          >
            <TrendingUp className="h-4 w-4" /> Slow ramp {selectedIds.size > 0 ? `(${selectedIds.size})` : `(${filteredAccounts.length})`}
          </button>
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={handleBulkDelete}>
                <Trash2 className="h-3 w-3" /> Eliminar ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openBulkEdit}>
                <Pencil className="h-3 w-3" /> Editar ({selectedIds.size})
              </Button>
              {/* Quick-add to current filter tag */}
              {filterTag && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1"
                    onClick={async () => {
                      const selected = accounts.filter(a => selectedIds.has(a.id));
                      let added = 0;
                      for (const account of selected) {
                        const currentTags: string[] = account.tags || [];
                        if (!currentTags.includes(filterTag)) {
                          await supabase.from("email_accounts").update({ tags: [...currentTags, filterTag] } as any).eq("id", account.id);
                          added++;
                        }
                      }
                      if (added > 0) toast.success(`${added} cuentas añadidas al tag "${filterTag}"`);
                      else toast.info("Las cuentas seleccionadas ya tienen este tag");
                      setSelectedIds(new Set());
                      loadAccounts();
                    }}
                  >
                    <Tag className="h-3 w-3" /> Añadir al tag "{filterTag}"
                  </Button>
                </>
              )}
              <div className="h-4 w-px bg-border" />
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => openCreateTag("selected")}>
                <Tag className="h-3 w-3" /> Crear / añadir tag ({selectedIds.size})
              </Button>
              {allTags.length > 0 && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <span className="text-xs text-muted-foreground">Quitar:</span>
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => handleBulkRemoveTag(tag)}
                      className="px-2 py-0.5 rounded text-[10px] bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      × {tag}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={(open) => { setShowEdit(open); if (!open) { setEditingId(null); setForm({ ...emptyForm }); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Editar cuenta de email</DialogTitle></DialogHeader>
          {renderFormFields()}
          <Button onClick={handleUpdate} className="w-full">Guardar cambios</Button>
        </DialogContent>
      </Dialog>

      {/* Slow Ramp Dialog */}
      <Dialog open={showSlowRamp} onOpenChange={(o) => { if (!rampProgress) setShowSlowRamp(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Slow ramp (calentamiento)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Sube poco a poco los envíos diarios de cada cuenta para calentar los buzones.
              Se aplicará a <b>{selectedIds.size > 0 ? `${selectedIds.size} cuenta(s) seleccionadas` : (search.trim() ? `las ${filteredAccounts.length} cuenta(s) del filtro "${search.trim()}"` : `TODAS las cuentas (${accounts.length})`)}</b>.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Inicio (día 1)</Label>
                <Input type="number" min={0} placeholder="p.ej. 18" value={slowRampForm.start} onChange={(e) => setSlowRampForm({ ...slowRampForm, start: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>+ por día</Label>
                <Input type="number" min={1} value={slowRampForm.increment} onChange={(e) => setSlowRampForm({ ...slowRampForm, increment: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Objetivo (máx/día)</Label>
                <Input type="number" min={1} value={slowRampForm.target} onChange={(e) => setSlowRampForm({ ...slowRampForm, target: e.target.value })} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Deja <b>Inicio</b> vacío para empezar desde el incremento. Con Inicio = 18 y + por día = 2:
              arranca en 18/día y sube 2 cada día (20, 22, 24…) hasta el objetivo.
            </p>
            {(() => {
              const inc = Math.max(1, parseInt(slowRampForm.increment) || 2);
              const startRaw = Math.max(0, parseInt(slowRampForm.start) || 0);
              const base = startRaw > 0 ? startRaw : inc;               // día 1
              const target = Math.max(base, parseInt(slowRampForm.target) || 30);
              const days = [0, 1, 2, 3, 4].map((d) => Math.min(base + d * inc, target));
              const reachDay = Math.max(1, Math.ceil((target - base) / inc) + 1);
              return (
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Previsualización por cuenta</p>
                  <p>Día 1: {days[0]} · Día 2: {days[1]} · Día 3: {days[2]} · Día 4: {days[3]} · Día 5: {days[4]} …</p>
                  <p className="mt-1">Alcanza el objetivo de {target}/día el día {reachDay}.</p>
                </div>
              );
            })()}
          </div>
          {rampProgress && (
            <div className="rounded-xl border border-[rgba(126,139,198,.18)] bg-white/70 p-3 dark:border-border dark:bg-muted/40" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2 font-semibold"><Loader2 className="h-4 w-4 animate-spin text-primary" /> {rampProgress.label}…</span>
                <span className="font-semibold tabular-nums">{rampProgress.done.toLocaleString("es-ES")} / {rampProgress.total.toLocaleString("es-ES")} cuentas</span>
              </div>
              <div
                className="soft-progress mt-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={rampProgress.total}
                aria-valuenow={rampProgress.done}
              >
                <div className="soft-progress-fill" style={{ width: `${rampProgress.total ? Math.round((rampProgress.done / rampProgress.total) * 100) : 0}%`, transition: "width .25s ease" }} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleDisableSlowRamp} disabled={!!rampProgress}>Desactivar</Button>
            <Button onClick={handleApplySlowRamp} disabled={!!rampProgress}>
              {rampProgress ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aplicando…</> : "Activar slow ramp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Dialog */}
      <Dialog open={showBulkEdit} onOpenChange={setShowBulkEdit}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Editar {selectedIds.size} cuentas</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Activa los campos que quieras modificar. Solo se aplicarán los campos marcados.</p>
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">General</p>
            {[
              { key: "daily_limit", label: "Límite diario", type: "number", placeholder: "50" },
              { key: "first_name", label: "Nombre", type: "text", placeholder: "Nombre" },
              { key: "last_name", label: "Apellido", type: "text", placeholder: "Apellido" },
              { key: "send_start_hour", label: "Hora inicio envío", type: "number", placeholder: "9" },
              { key: "send_end_hour", label: "Hora fin envío", type: "number", placeholder: "18" },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="flex items-center gap-3">
                <Checkbox checked={bulkEditFields.has(key)} onCheckedChange={() => toggleBulkEditField(key)} />
                <div className="flex-1 space-y-1">
                  <Label className={`text-xs ${!bulkEditFields.has(key) ? "text-muted-foreground" : ""}`}>{label}</Label>
                  <Input type={type} placeholder={placeholder} disabled={!bulkEditFields.has(key)} value={(bulkEditForm as any)[key]} onChange={e => setBulkEditForm(prev => ({ ...prev, [key]: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>
            ))}

            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">IMAP</p>
            {[
              { key: "imap_host", label: "Host IMAP", type: "text", placeholder: "imap.gmail.com" },
              { key: "imap_port", label: "Puerto IMAP", type: "number", placeholder: "993" },
              { key: "imap_username", label: "Usuario IMAP", type: "text", placeholder: "usuario@domain.com" },
              { key: "imap_password", label: "Contraseña IMAP", type: "password", placeholder: "Nueva contraseña" },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="flex items-center gap-3">
                <Checkbox checked={bulkEditFields.has(key)} onCheckedChange={() => toggleBulkEditField(key)} />
                <div className="flex-1 space-y-1">
                  <Label className={`text-xs ${!bulkEditFields.has(key) ? "text-muted-foreground" : ""}`}>{label}</Label>
                  <Input type={type} placeholder={placeholder} disabled={!bulkEditFields.has(key)} value={(bulkEditForm as any)[key]} onChange={e => setBulkEditForm(prev => ({ ...prev, [key]: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>
            ))}

            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">SMTP</p>
            {[
              { key: "smtp_host", label: "Host SMTP", type: "text", placeholder: "smtp.gmail.com" },
              { key: "smtp_port", label: "Puerto SMTP", type: "number", placeholder: "587" },
              { key: "smtp_username", label: "Usuario SMTP", type: "text", placeholder: "usuario@domain.com" },
              { key: "smtp_password", label: "Contraseña SMTP", type: "password", placeholder: "Nueva contraseña" },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="flex items-center gap-3">
                <Checkbox checked={bulkEditFields.has(key)} onCheckedChange={() => toggleBulkEditField(key)} />
                <div className="flex-1 space-y-1">
                  <Label className={`text-xs ${!bulkEditFields.has(key) ? "text-muted-foreground" : ""}`}>{label}</Label>
                  <Input type={type} placeholder={placeholder} disabled={!bulkEditFields.has(key)} value={(bulkEditForm as any)[key]} onChange={e => setBulkEditForm(prev => ({ ...prev, [key]: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>
            ))}
          </div>
          <Button onClick={handleBulkEdit} className="w-full" disabled={bulkEditFields.size === 0} variant={bulkEditFields.size === 0 ? "secondary" : "default"}>
            Aplicar cambios a {selectedIds.size} cuentas
          </Button>
        </DialogContent>
      </Dialog>

      {/* ── Signature Manager Dialog ── */}
      <Dialog open={showSignature} onOpenChange={setShowSignature}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Firma de correo</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Se añade automáticamente <b>debajo de cada correo</b> (campañas y respuestas del Unibox) de las cuentas elegidas.
          </p>
          <div className="space-y-4">
            {/* Scope */}
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Aplicar a</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "all", label: `Todas (${accounts.length})`, disabled: false },
                  { key: "tag", label: "Por tag", disabled: allTags.length === 0 },
                  { key: "selected", label: `Seleccionadas (${selectedIds.size})`, disabled: selectedIds.size === 0 },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={opt.disabled}
                    onClick={() => setSigScope(opt.key)}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                      sigScope === opt.key ? "border-primary bg-primary/10 text-primary" : "border-border/60 hover:bg-muted"
                    } ${opt.disabled ? "bg-muted text-muted-foreground opacity-70 cursor-not-allowed" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {sigScope === "tag" && (
                <Select value={sigTag} onValueChange={setSigTag}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Elige un tag" /></SelectTrigger>
                  <SelectContent>
                    {allTags.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground">Se aplicará a <b>{signatureTargetIds.length}</b> cuenta(s).</p>
            </div>

            {/* HTML editor + live preview */}
            <div className="space-y-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Firma (HTML)</Label>
              <Textarea
                value={sigHtml}
                onChange={e => setSigHtml(e.target.value)}
                placeholder={'<p>Un saludo,<br><strong>Nombre Apellido</strong><br>Empresa · <a href="https://tuweb.com">tuweb.com</a></p>'}
                className="min-h-[130px] font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                <input ref={sigImgInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadSigImage(f); }} />
                <Button type="button" variant="outline" size="sm" className="gap-1.5 h-8 text-xs" disabled={sigImgUploading} onClick={() => sigImgInputRef.current?.click()}>
                  {sigImgUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Subir imagen (logo)
                </Button>
                <span className="text-[11px] text-muted-foreground">Se inserta como imagen en la firma (máx. 2 MB).</span>
              </div>
              <div className="rounded-md border border-border/60 bg-background p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vista previa</p>
                {sigHtml.trim() ? (
                  <div
                    className="text-sm leading-relaxed break-words [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_p]:my-1"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(sigHtml) }}
                  />
                ) : (
                  <p className="text-xs italic text-muted-foreground">Escribe tu firma HTML arriba para ver aquí cómo queda.</p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Deja el HTML <b>vacío</b> y pulsa Aplicar para <b>quitar</b> la firma de las cuentas elegidas.</p>
            </div>

            <SavedSignatures currentHtml={sigHtml} onLoad={setSigHtml} />
          </div>
          <Button onClick={applySignature} className="w-full" disabled={sigSaving || signatureTargetIds.length === 0} variant={signatureTargetIds.length === 0 ? "secondary" : "default"}>
            {sigSaving ? "Aplicando…" : (sigHtml.trim() ? `Aplicar firma a ${signatureTargetIds.length} cuenta(s)` : `Quitar firma de ${signatureTargetIds.length} cuenta(s)`)}
          </Button>
        </DialogContent>
      </Dialog>


      {accounts.length === 0 ? (
        <AccountsEmptyState
          onAdd={() => { setAddMode("single"); setShowAdd(true); }}
          onBulk={isAgency ? () => { setAddMode("bulk"); setShowAdd(true); } : undefined}
        />
      ) : (
        <>
        {/* Escritorio: tabla de cuentas conectadas (estilo Smartlead, con la autenticación del
            dominio en lugar de sus columnas de warm-up). Móvil conserva las tarjetas. */}
        {!isMobile && (
          <AccountsTable
            accounts={filteredAccounts}
            selectedIds={selectedIds}
            allSelected={allSelected}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleSelectAll}
            imapChecks={imapChecks}
            domainAuth={domainAuth}
            dnsConfiguring={dnsConfiguring}
            verifying={verifying}
            onConfigureDns={configureDns}
            onRecheckDomain={recheckDomain}
            onRecheckImap={recheckImap}
            onEdit={handleEdit}
            onVerify={handleVerify}
            onDelete={handleDelete}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            allTags={allTags}
            filterTag={filterTag}
            rampOf={rampInfo}
          />
        )}
        {isMobile && (
        <div className="grid gap-3 grid-cols-1">
          {filteredAccounts.slice(0, mobileShown).map((account) => (
            <Card key={account.id} className={`hover:shadow-raised transition-shadow ${selectedIds.has(account.id) ? "ring-2 ring-primary/40" : ""} ${filterTag && !(account.tags || []).includes(filterTag) ? "opacity-60 border-dashed" : ""}`}>
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedIds.has(account.id)}
                      onCheckedChange={() => toggleSelect(account.id)}
                    />
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-[15px]">{account.email}</p>
                      <p className="text-xs text-muted-foreground">{account.first_name} {account.last_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Real IMAP connection status (live login test) */}
                    {(() => {
                      const ic = imapChecks[account.id];
                      if (!ic || ic.loading) {
                        return <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> IMAP…</span>;
                      }
                      if (ic.ok) {
                        return (
                          <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                            <CheckCircle className="h-3 w-3" /> IMAP conectado
                            {ic.reverifying && <span title="Verificando la conexión en vivo…" className="inline-flex"><Loader2 className="h-2.5 w-2.5 animate-spin opacity-60" /></span>}
                          </span>
                        );
                      }
                      if (ic.unverified) {
                        // We could not reach the checker — say exactly that instead of accusing
                        // the mailbox of being down.
                        return (
                          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground" title={ic.error || "No se pudo comprobar ahora mismo"}>
                            <ShieldQuestion className="h-3 w-3" /> IMAP sin comprobar
                            <button onClick={() => recheckImap(account.id)} className="ml-1 underline decoration-dotted">reintentar</button>
                          </span>
                        );
                      }
                      return (
                        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive" title={ic.error || "Fallo de conexión IMAP"}>
                          <XCircle className="h-3 w-3" /> IMAP sin conexión
                          <button onClick={() => recheckImap(account.id)} className="ml-1 underline decoration-dotted">reintentar</button>
                        </span>
                      );
                    })()}
                    {account.status === "error" && (
                      <span className="flex items-center gap-1 text-xs font-medium text-destructive"><XCircle className="h-3.5 w-3.5" /> Error</span>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                  {(account.tags || []).map((tag: string) => (
                    <Badge key={tag} variant="secondary" className="text-[11px] gap-1 pr-1">
                      {tag}
                      <button onClick={() => handleRemoveTag(account.id, tag)} className="ml-0.5 rounded-full hover:bg-foreground/10 p-0.5">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  <div className="flex items-center">
                     <Input
                       placeholder="+ tags (coma)"
                       className="h-6 w-28 text-[11px] px-1.5 border-dashed"
                      list={`tags-${account.id}`}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          handleAddTag(account.id, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    <datalist id={`tags-${account.id}`}>
                      {allTags.filter(t => !(account.tags || []).includes(t)).map(t => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Domain authentication: SPF / DKIM / DMARC */}
                {(() => {
                  const dom = domainOf(account.email);
                  const auth = domainAuth[dom];
                  const dkimMissing = auth && !auth.loading && !auth.error && auth.dkim === "fail";
                  return (
                    <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                          Autenticación del dominio
                          {auth?.reverifying && !auth?.loading && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-medium text-success/80" title="Comprobando los registros DNS en vivo…">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" /> en vivo
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => configureDns(dom)}
                            disabled={!dom || dnsConfiguring[dom]}
                            title="Configura SPF, DKIM y DMARC automáticamente vía la API de IONOS"
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline disabled:opacity-50"
                          >
                            {dnsConfiguring[dom] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} Configurar DNS
                          </button>
                          <button
                            onClick={() => recheckDomain(dom)}
                            disabled={!dom || auth?.loading}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3 w-3 ${auth?.loading ? "animate-spin" : ""}`} /> Comprobar
                          </button>
                        </div>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {!dom ? (
                          <span className="text-[10px] text-muted-foreground">Sin dominio</span>
                        ) : auth?.loading ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Comprobando DNS…</span>
                        ) : auth?.error ? (
                          <span className="text-[10px] text-muted-foreground">No verificado — pulsa Comprobar</span>
                        ) : auth ? (
                          <>
                            <AuthChip label="SPF" status={auth.spf} />
                            <AuthChip label="DKIM" status={auth.dkim} />
                            <AuthChip label="DMARC" status={auth.dmarc} />
                          </>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">En cola…</span>
                        )}
                      </div>
                      {dkimMissing && (
                        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-destructive">
                          <ShieldAlert className="h-3 w-3" /> Falta el DKIM en @{dom} — añádelo en tu proveedor para mejorar la entregabilidad.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {(() => {
                  const ramp = rampInfo(account);
                  const effLimit = ramp ? ramp.eff : account.daily_limit;
                  return (
                    <div className="mt-3 flex gap-6 items-end">
                      <div>
                        <p className="text-xs text-muted-foreground">Enviados hoy</p>
                        <p className="font-semibold text-[15px]">{account.sent_today}/{effLimit}</p>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1 flex flex-wrap items-center gap-2">
                          Uso
                          {ramp && (
                            <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5">
                              Slow ramp · Día {ramp.day} · hoy {ramp.eff} → objetivo {ramp.target}
                            </span>
                          )}
                        </p>
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${Math.min((account.sent_today / Math.max(1, effLimit)) * 100, 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleEdit(account)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleVerify(account.id)} disabled={verifying === account.id}>
                    <RefreshCw className={`h-3.5 w-3.5 ${verifying === account.id ? "animate-spin" : ""}`} />
                    {verifying === account.id ? "Verificando..." : "Verificar"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(account.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                {account.last_health_check && (
                  <p className="text-[10px] text-muted-foreground mt-2">Última verificación: {new Date(account.last_health_check).toLocaleString("es")}</p>
                )}
              </CardContent>
            </Card>
          ))}
          {filteredAccounts.length > mobileShown && (
            <button
              type="button"
              className="soft-cta w-full justify-center"
              onClick={() => setMobileShown((n) => n + MOBILE_CHUNK)}
            >
              Ver {Math.min(MOBILE_CHUNK, filteredAccounts.length - mobileShown)} más ({filteredAccounts.length - mobileShown} restantes)
            </button>
          )}
        </div>
        )}
        </>
      )}
    </div>
  );
}
