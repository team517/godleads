import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { Button } from "@/components/ui/button";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SavedSignatures } from "@/components/SavedSignatures";
import DOMPurify from "dompurify";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Upload, Download, CheckCircle, XCircle, Mail, Trash2, RefreshCw, Wifi, Pencil, Tag, X, Check, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const PROVIDER_PRESETS: Record<string, { imap_host: string; imap_port: string; smtp_host: string; smtp_port: string; label: string; help: string }> = {
  gmail: { imap_host: "imap.gmail.com", imap_port: "993", smtp_host: "smtp.gmail.com", smtp_port: "587", label: "Gmail", help: "Usa una Contraseña de aplicación de Google (no tu contraseña normal). Actívala en myaccount.google.com → Seguridad → Contraseñas de aplicaciones." },
  outlook: { imap_host: "outlook.office365.com", imap_port: "993", smtp_host: "smtp.office365.com", smtp_port: "587", label: "Outlook / Hotmail", help: "Usa tu contraseña de Microsoft. Si tienes 2FA activado, genera una Contraseña de aplicación en account.microsoft.com → Seguridad." },
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
    status === "pass" ? { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", Icon: ShieldCheck, text: "OK" }
    : status === "warn" ? { cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: ShieldQuestion, text: "Revisar" }
    : status === "fail" ? { cls: "bg-red-500/10 text-red-600 border-red-500/30", Icon: ShieldAlert, text: "Falta" }
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
  const [loading, setLoading] = useState(() => !cacheGet<any[]>("accounts:list"));
  const [showBulk, setShowBulk] = useState(false);
  const [showBulkIonos, setShowBulkIonos] = useState(false);
  const [ionosRows, setIonosRows] = useState<{ email: string; first_name: string; last_name: string; password: string }[]>([{ email: "", first_name: "", last_name: "", password: "" }]);
  const [ionosImporting, setIonosImporting] = useState(false);
  const [ionosDefaultPassword, setIonosDefaultPassword] = useState("");
  const [ionosDefaultFirstName, setIonosDefaultFirstName] = useState("");
  const [ionosDefaultLastName, setIonosDefaultLastName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [savedTags, setSavedTags] = useState<{ id: string; name: string }[]>([]);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [showTagManager, setShowTagManager] = useState(false);
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
  // ── Signature manager (apply an HTML signature to all / by tag / selected accounts) ──
  const [showSignature, setShowSignature] = useState(false);
  const [sigHtml, setSigHtml] = useState("");
  const [sigScope, setSigScope] = useState<"all" | "tag" | "selected">("all");
  const [sigTag, setSigTag] = useState("");
  const [sigSaving, setSigSaving] = useState(false);

  // ── Per-account domain authentication (SPF / DKIM / DMARC) ──
  type AuthStatus = "pass" | "warn" | "fail";
  type DomainAuth = { loading: boolean; spf?: AuthStatus; dkim?: AuthStatus; dmarc?: AuthStatus; error?: boolean };
  const [domainAuth, setDomainAuth] = useState<Record<string, DomainAuth>>(() => cacheGet<Record<string, DomainAuth>>("accounts:domainAuth") || {});
  const requestedDomainsRef = useRef<Set<string>>(new Set());
  // Broad DKIM selector list so we detect a key whatever the provider (Google,
  // Microsoft, IONOS, Zoho…). If none resolve, DKIM is reported as missing.
  const DKIM_SELECTORS = ["s1-ionos", "s2-ionos", "google", "selector1", "selector2", "default", "dkim", "dkim1", "k1", "k2", "mail", "smtp", "s1", "s2", "mxvault", "key1", "ionos1", "ionos2", "mta", "dk", "email", "zoho", "zmail", "amazonses"];

  const checkDomainAuth = useCallback(async (domain: string) => {
    const d = (domain || "").trim().toLowerCase();
    if (!d) return;
    // Show "cargando" only on the FIRST check. If we already have a (cached) result, refresh
    // it silently — the badges stay visible instead of flashing back to a spinner.
    setDomainAuth(prev => (prev[d] && !prev[d].loading
      ? prev
      : { ...prev, [d]: { ...(prev[d] || {}), loading: true, error: false } }));
    try {
      const { data, error } = await supabase.functions.invoke("check-email-domain-auth", {
        body: { domain: d, selectors: DKIM_SELECTORS },
      });
      const r = data as any;
      if (error || !r || r.error) {
        setDomainAuth(prev => ({ ...prev, [d]: { loading: false, error: true } }));
        return;
      }
      setDomainAuth(prev => ({ ...prev, [d]: { loading: false, spf: r.spf?.status, dkim: r.dkim?.status, dmarc: r.dmarc?.status } }));
    } catch {
      setDomainAuth(prev => ({ ...prev, [d]: { loading: false, error: true } }));
    }
  }, []);

  const domainOf = (email: string) => (email || "").split("@")[1]?.trim().toLowerCase() || "";

  // Auto-check each unique domain once (de-duplicated, sequential to avoid bursts).
  useEffect(() => {
    const domains = Array.from(new Set(accounts.map(a => domainOf(a.email)).filter(Boolean)));
    const toCheck = domains.filter(d => !requestedDomainsRef.current.has(d));
    if (toCheck.length === 0) return;
    toCheck.forEach(d => requestedDomainsRef.current.add(d));
    let cancelled = false;
    (async () => {
      const CONC = 4; // check domains in parallel waves → much faster first load
      for (let i = 0; i < toCheck.length && !cancelled; i += CONC) {
        await Promise.all(toCheck.slice(i, i + CONC).map(d => checkDomainAuth(d)));
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
  type ImapCheck = { loading: boolean; ok?: boolean; error?: string };
  const [imapChecks, setImapChecks] = useState<Record<string, ImapCheck>>(() => cacheGet<Record<string, ImapCheck>>("accounts:imapChecks") || {});

  // Persist the SETTLED IMAP/DNS results so the next visit paints them instantly (no spinner).
  useEffect(() => {
    const settled = Object.fromEntries(Object.entries(imapChecks).filter(([, v]) => !v.loading));
    if (Object.keys(settled).length) cacheSet("accounts:imapChecks", settled);
  }, [imapChecks]);
  useEffect(() => {
    const settled = Object.fromEntries(Object.entries(domainAuth).filter(([, v]) => !(v as { loading?: boolean }).loading));
    if (Object.keys(settled).length) cacheSet("accounts:domainAuth", settled);
  }, [domainAuth]);
  const requestedImapRef = useRef<Set<string>>(new Set());

  const checkImap = useCallback(async (accountId: string) => {
    // Only show the "conectando" spinner if we have NOTHING to show yet. If a status is
    // already known (seeded from the stored `status` or the cache), re-verify SILENTLY in the
    // background — keep the green badge and only flip it if the check actually fails.
    setImapChecks(prev => (prev[accountId] && !prev[accountId].loading
      ? prev
      : { ...prev, [accountId]: { ...(prev[accountId] || {}), loading: true } }));
    try {
      const { data, error } = await supabase.functions.invoke("verify-email-connection", { body: { account_id: accountId } });
      const r = data as any;
      if (error || !r || r.error) {
        setImapChecks(prev => ({ ...prev, [accountId]: { loading: false, ok: false, error: (r?.error || "no verificado") } }));
        return;
      }
      setImapChecks(prev => ({ ...prev, [accountId]: { loading: false, ok: !!r.imap?.ok, error: r.imap?.error } }));
    } catch (e: any) {
      setImapChecks(prev => ({ ...prev, [accountId]: { loading: false, ok: false, error: e?.message } }));
    }
  }, []);

  // Trust accounts verified in the last 30 min (show green from stored result);
  // only run a fresh live IMAP login for stale/unverified ones (max 2 at a time).
  useEffect(() => {
    const now = Date.now();
    const RECENT = 30 * 60 * 1000;
    const toVerify: string[] = [];
    const seed: Record<string, ImapCheck> = {};
    for (const a of accounts) {
      if (requestedImapRef.current.has(a.id)) continue;
      requestedImapRef.current.add(a.id);
      const lhc = a.last_health_check ? new Date(a.last_health_check).getTime() : 0;
      const recent = lhc && now - lhc < RECENT;
      // Paint the STORED status immediately: a connected account shows green on entry, no
      // "conectando" spinner. Re-verify in the background (silently) only if stale.
      if (a.status === "connected") seed[a.id] = { loading: false, ok: true };
      if (a.status !== "connected" || !recent) toVerify.push(a.id);
    }
    if (Object.keys(seed).length) setImapChecks(prev => ({ ...prev, ...seed }));
    if (toVerify.length === 0) return;
    let cancelled = false;
    (async () => {
      const CONC = 2;
      for (let i = 0; i < toVerify.length && !cancelled; i += CONC) {
        await Promise.all(toVerify.slice(i, i + CONC).map((id: string) => checkImap(id)));
      }
    })();
    return () => { cancelled = true; };
  }, [accounts, checkImap]);

  const recheckImap = (accountId: string) => { requestedImapRef.current.add(accountId); checkImap(accountId); };

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    savedTags.forEach(t => tagSet.add(t.name));
    accounts.forEach(a => (a.tags || []).forEach((t: string) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [accounts, savedTags]);

  const filteredAccounts = useMemo(() => {
    if (!filterTag) return accounts;
    // Show all accounts, but sort: accounts WITH the tag first, then the rest
    const withTag = accounts.filter(a => (a.tags || []).includes(filterTag));
    const withoutTag = accounts.filter(a => !(a.tags || []).includes(filterTag));
    return [...withTag, ...withoutTag];
  }, [accounts, filterTag]);

  const allSelected = filteredAccounts.length > 0 && filteredAccounts.every(a => selectedIds.has(a.id));

  const loadAccounts = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.from("email_accounts_safe" as any).select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      // A transient query error / timeout (common on the NANO compute tier) must NOT wipe
      // the list — keep whatever is on screen (cache) instead of showing zero accounts.
      if (error) { console.warn("loadAccounts failed, keeping current list:", error.message); return; }
      const normalized = (data || []).map((account: any) => normalizeEmailAccount(account));
      setAccounts(normalized);
      cacheSet("accounts:list", normalized); // instant paint on next visit
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

  const handleBulkAddTag = async () => {
    const newTags = bulkTagInput.split(",").map(t => t.trim()).filter(Boolean);
    if (newTags.length === 0 || selectedIds.size === 0) return;
    const selected = accounts.filter(a => selectedIds.has(a.id));
    for (const account of selected) {
      const currentTags: string[] = account.tags || [];
      const uniqueNew = newTags.filter(t => !currentTags.includes(t));
      if (uniqueNew.length > 0) {
        await supabase.from("email_accounts").update({ tags: [...currentTags, ...uniqueNew] } as any).eq("id", account.id);
      }
    }
    for (const t of newTags) await ensureTagSaved(t);
    toast.success(`Tags "${newTags.join(", ")}" añadidos a ${selected.length} cuentas`);
    setBulkTagInput("");
    setSelectedIds(new Set());
    loadAccounts();
    loadSavedTags();
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

  const handleAdd = async () => {
    if (!user) return;
    const { error } = await supabase.from("email_accounts").insert({
      user_id: user.id, email: form.email, first_name: form.first_name, last_name: form.last_name,
      imap_username: form.imap_username, imap_password: form.imap_password, imap_host: form.imap_host, imap_port: parseInt(form.imap_port),
      smtp_username: form.smtp_username, smtp_password: form.smtp_password, smtp_host: form.smtp_host, smtp_port: parseInt(form.smtp_port),
      daily_limit: parseInt(form.daily_limit), status: "pending",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Cuenta añadida correctamente");
    setShowAdd(false);
    setForm({ ...emptyForm });
    loadAccounts();
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
    const headers = ["email","first_name","last_name","imap_username","imap_password","imap_host","imap_port","smtp_username","smtp_password","smtp_host","smtp_port"];
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const a of accounts) {
      lines.push(headers.map(h => escape((a as any)[h] ?? "")).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cuentas-email-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${accounts.length} cuentas exportadas`);
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
      const { error } = await supabase.from("email_accounts").insert(inserts);
      if (error) { toast.error(error.message); return; }
      toast.success(`${inserts.length} cuentas importadas`);
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

  const handleVerify = async (accountId: string) => {
    setVerifying(accountId);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke("verify-email-connection", {
        body: { account_id: accountId },
      });
      if (fnError) throw fnError;
      if (result.status === "connected") {
        toast.success("✅ Conexión verificada — sincronizando bandeja…");
        // As soon as the mailbox connects, pull its inbox into the Unibox.
        syncAccountInbox(accountId);
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
    toast.info(`Verificando ${pending.length} cuentas...`);
    for (const account of pending) { await handleVerify(account.id); }
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
    const { error } = await supabase.from("email_accounts").insert(inserts);
    if (error) { toast.error(error.message); setIonosImporting(false); return; }
    toast.success(`${validRows.length} cuentas IONOS importadas correctamente`);
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
    for (const id of selectedIds) {
      await supabase.from("email_accounts").delete().eq("id", id);
    }
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
    return accounts.map(a => a.id); // "all"
  }, [sigScope, sigTag, accounts, selectedIds]);

  const applySignature = async () => {
    const ids = signatureTargetIds;
    if (ids.length === 0) { toast.error("No hay cuentas en el alcance elegido"); return; }
    setSigSaving(true);
    // One query for the whole scope (up to all 84 accounts).
    const { error } = await supabase.from("email_accounts").update({ signature_html: sigHtml } as any).in("id", ids);
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
    // Count only SENDING days (Mon–Fri) since the start date, mirroring the engine's
    // countSendingDays. The ramp advances ONE step per day emails actually go out, so it
    // does NOT climb on weekends (Sat/Sun) — the card stays flat Fri→Sat→Sun→Mon instead of
    // ticking up on days nothing is sent. (Uses the standard Mon–Fri window; matches the
    // engine for the default send_days.)
    const s = new Date(acc.warmup_started_at);
    const startUTC = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    const n = new Date();
    const nowUTC = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    // Reference = the most recent SEND day: today if it's a weekday, else step back to Friday.
    // So on Sat/Sun the card shows the last day that actually sent — the number does NOT tick
    // up on non-send days; it climbs again on Monday when sending resumes.
    let refUTC = nowUTC;
    for (let g = 0; g < 7; g++) {
      const dow = new Date(refUTC).getUTCDay(); // 0 = Sun … 6 = Sat
      if (dow !== 0 && dow !== 6) break;
      refUTC -= 86400000;
    }
    // Count weekdays STRICTLY BEFORE that send day (mirrors the engine's countSendingDays).
    let days = 0;
    for (let t = startUTC; t < refUTC; t += 86400000) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6) days++;
    }
    const inc = acc.warmup_increment || 2;
    const target = acc.warmup_limit || acc.daily_limit || 30;
    // warmup_day (repurposed) = the STARTING daily limit (day 1). If 0/absent, start
    // from `inc` (legacy: inc + days*inc = (days+1)*inc).
    const startBase = acc.warmup_day && acc.warmup_day > 0 ? acc.warmup_day : inc;
    // During warm-up the ramp climbs from startBase up to `target` (the intended daily max).
    // It is deliberately NOT capped by daily_limit — otherwise an account whose daily_limit
    // equals the start (e.g. 18) would read "18" forever and never climb. This mirrors the
    // engine's getEffectiveLimit, which during warm-up uses min(ramp, HARD_CAP), not daily_limit.
    const eff = Math.min(startBase + days * inc, target);
    return { day: days + 1, eff, target };
  };

  const handleApplySlowRamp = async () => {
    if (!user) return;
    const ids = selectedIds.size > 0 ? [...selectedIds] : accounts.map((a) => a.id);
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
    for (const id of ids) {
      await supabase.from("email_accounts").update(payload).eq("id", id);
    }
    toast.success(`Slow ramp activado en ${ids.length} cuenta(s)`);
    setShowSlowRamp(false);
    setSelectedIds(new Set());
    loadAccounts();
  };

  const handleDisableSlowRamp = async () => {
    if (!user) return;
    const ids = selectedIds.size > 0 ? [...selectedIds] : accounts.map((a) => a.id);
    if (ids.length === 0) return;
    for (const id of ids) {
      await supabase.from("email_accounts").update({ warmup_enabled: false } as any).eq("id", id);
    }
    toast.success(`Slow ramp desactivado en ${ids.length} cuenta(s)`);
    setShowSlowRamp(false);
    setSelectedIds(new Set());
    loadAccounts();
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
            <SelectItem value="gmail">📧 Gmail</SelectItem>
            <SelectItem value="outlook">📬 Outlook / Hotmail</SelectItem>
            <SelectItem value="ionos">🌐 IONOS</SelectItem>
            <SelectItem value="custom">⚙️ Personalizado (SMTP/IMAP)</SelectItem>
          </SelectContent>
        </Select>
        {preset.help && (
          <p className="text-xs text-muted-foreground mt-1 p-2 rounded bg-muted/50">
            💡 {preset.help}
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

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">Cuentas de Email</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Gestiona tus cuentas SMTP/IMAP</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {accounts.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleVerifyAll}>
              <Wifi className="h-4 w-4" /> <span className="hidden sm:inline">Verificar todas</span><span className="sm:hidden">Verificar</span>
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
            🌐 <span className="hidden sm:inline">Bulk IONOS</span><span className="sm:hidden">IONOS</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadCSV}>
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">Descargar CSV</span><span className="sm:hidden">CSV↓</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowBulk(!showBulk)}>
            <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Bulk CSV</span><span className="sm:hidden">CSV</span>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={openSignatureManager}>
            <Pencil className="h-4 w-4" /> <span className="hidden sm:inline">Firma</span><span className="sm:hidden">Firma</span>
          </Button>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Añadir Cuenta</span><span className="sm:hidden">Añadir</span></Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display">Añadir cuenta de email</DialogTitle></DialogHeader>
              {renderFormFields()}
              <Button onClick={handleAdd} className="w-full">Añadir cuenta</Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Tag filter bar - always visible */}
      <div className="flex items-center gap-2 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        <button
          onClick={() => setFilterTag(null)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${!filterTag ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
        >
          Todas ({accounts.length})
        </button>
        {allTags.map(tag => {
          const count = accounts.filter(a => (a.tags || []).includes(tag)).length;
          return (
            <div key={tag} className="flex items-center gap-0.5 group">
              <button
                onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                className={`px-2.5 py-1 rounded-l-full text-xs font-medium transition-colors ${filterTag === tag ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
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
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1">
          <Input
            placeholder="Nuevo tag…"
            className="h-7 w-28 text-xs"
            value={newTagInput}
            onChange={e => setNewTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateTag(); }}
          />
          <Button size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={handleCreateTag} disabled={!newTagInput.trim()}>
            <Plus className="h-3 w-3" /> Crear
          </Button>
        </div>
        <div className="h-4 w-px bg-border" />
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowTagManager(true)}>
          <Tag className="h-3 w-3" /> Ver todos los tags
        </Button>
      </div>

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
            <Button size="sm" onClick={handleCreateTag} disabled={!newTagInput.trim()} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Crear
            </Button>
          </div>
          {allTags.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No tienes ningún tag creado.</p>
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
            <DialogTitle className="font-display flex items-center gap-2">🌐 Importación masiva IONOS</DialogTitle>
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
                  placeholder={ionosDefaultPassword ? "•••• (default)" : "Contraseña"}
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
            className="w-full gap-2"
          >
            {ionosImporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {ionosImporting ? "Importando..." : `Importar ${ionosRows.filter(r => r.email.trim() && (r.password.trim() || ionosDefaultPassword.trim())).length} cuentas IONOS`}
          </Button>
        </DialogContent>
      </Dialog>


      {accounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-lg border bg-muted/30 px-3 sm:px-4 py-2.5">
          <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
          <span className="text-sm text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} seleccionadas` : "Seleccionar cuentas"}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowSlowRamp(true)}>
            🐢 Slow ramp {selectedIds.size > 0 ? `(${selectedIds.size})` : "(todas)"}
          </Button>
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
              <div className="flex items-center gap-2">
                 <Input
                   placeholder="Tags separados por coma…"
                   className="h-7 w-48 text-xs"
                  value={bulkTagInput}
                  onChange={e => setBulkTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleBulkAddTag(); }}
                  list="bulk-tags-list"
                />
                <datalist id="bulk-tags-list">
                  {allTags.map(t => <option key={t} value={t} />)}
                </datalist>
                <Button size="sm" variant="secondary" className="h-7 text-xs gap-1" onClick={handleBulkAddTag} disabled={!bulkTagInput.trim()}>
                  <Tag className="h-3 w-3" /> Añadir tag
                </Button>
              </div>
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
      <Dialog open={showSlowRamp} onOpenChange={setShowSlowRamp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">🐢 Slow ramp (calentamiento)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Sube poco a poco los envíos diarios de cada cuenta para calentar los buzones.
              Se aplicará a <b>{selectedIds.size > 0 ? `${selectedIds.size} cuenta(s) seleccionadas` : `TODAS las cuentas (${accounts.length})`}</b>.
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
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleDisableSlowRamp}>Desactivar</Button>
            <Button onClick={handleApplySlowRamp}>Activar slow ramp</Button>
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
          <Button onClick={handleBulkEdit} className="w-full" disabled={bulkEditFields.size === 0}>
            Aplicar cambios a {selectedIds.size} cuentas
          </Button>
        </DialogContent>
      </Dialog>

      {/* ── Signature Manager Dialog ── */}
      <Dialog open={showSignature} onOpenChange={setShowSignature}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">✍️ Firma de correo</DialogTitle></DialogHeader>
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
                    } ${opt.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
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
          <Button onClick={applySignature} className="w-full" disabled={sigSaving || signatureTargetIds.length === 0}>
            {sigSaving ? "Aplicando…" : (sigHtml.trim() ? `Aplicar firma a ${signatureTargetIds.length} cuenta(s)` : `Quitar firma de ${signatureTargetIds.length} cuenta(s)`)}
          </Button>
        </DialogContent>
      </Dialog>

      {showBulk && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6">
            <h3 className="font-display font-semibold mb-2">Importar cuentas desde CSV</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Columnas: Email, First Name, Last Name, IMAP Username, IMAP Password, IMAP Host, IMAP Port, SMTP Username, SMTP Password, SMTP Host, SMTP Port
            </p>
            <Input type="file" accept=".csv" onChange={handleCSV} className="max-w-sm" />
          </CardContent>
        </Card>
      )}

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display font-semibold mb-2">No tienes cuentas de email</h3>
            <p className="text-sm text-muted-foreground">Añade tu primera cuenta o importa varias con CSV.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2">
          {filteredAccounts.map((account) => (
            <Card key={account.id} className={`hover:shadow-md transition-shadow ${selectedIds.has(account.id) ? "ring-2 ring-primary/40" : ""} ${filterTag && !(account.tags || []).includes(filterTag) ? "opacity-60 border-dashed" : ""}`}>
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
                      <p className="font-medium text-sm">{account.email}</p>
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
                        return <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600"><CheckCircle className="h-3 w-3" /> IMAP conectado</span>;
                      }
                      return (
                        <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600" title={ic.error || "Fallo de conexión IMAP"}>
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
                        <span className="text-[11px] font-medium text-muted-foreground">Autenticación del dominio</span>
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
                        <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-red-600">
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
                        <p className="font-semibold text-sm">{account.sent_today}/{effLimit}</p>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1 flex flex-wrap items-center gap-2">
                          Uso
                          {ramp && (
                            <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5">
                              🐢 Slow ramp · Día {ramp.day} · hoy {ramp.eff} → objetivo {ramp.target}
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
        </div>
      )}
    </div>
  );
}
