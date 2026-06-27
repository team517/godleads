import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { toast } from "sonner";
import { Plus, Trash2, Users, Upload, UserPlus, Send, Loader2, AlertTriangle, X, FileSpreadsheet, Zap, Download, ShieldCheck } from "lucide-react";
import { parseCSVToObjects } from "@/lib/csv-parser";

const yieldToMain = () => new Promise<void>(r => setTimeout(r, 0));

interface Props { campaignId: string; }

const TABLE_PAGE_SIZE = 100;

export default function CampaignLeads({ campaignId }: Props) {
  const { user } = useAuth();
  // Server-side paginated leads — only current page in memory
  const [pageLeads, setPageLeads] = useState<any[]>([]);
  const [totalLeadCount, setTotalLeadCount] = useState(0);
  const [realLeadCount, setRealLeadCount] = useState(0);
  const [tablePage, setTablePage] = useState(0);
  const [searchFilter, setSearchFilter] = useState("");
  const [loadingPage, setLoadingPage] = useState(false);

  const [leadListCounts, setLeadListCounts] = useState<Record<string, number>>({});
  const [leadLists, setLeadLists] = useState<any[]>([]);
  const [showAddManual, setShowAddManual] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [manualFirstName, setManualFirstName] = useState("");
  const [manualLastName, setManualLastName] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [importing, setImporting] = useState(false);
  const [sendingLeadId, setSendingLeadId] = useState<string | null>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedCampaignLeads, setSelectedCampaignLeads] = useState<Set<string>>(new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const templateFileRef = useRef<HTMLInputElement>(null);

  // Template columns
  const TEMPLATE_COLUMNS = ["first_name", "industry", "city", "company_short_description", "company_name", "website"];

  // CSV review state
  const parsedRowsRef = useRef<Record<string, string>[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvDuplicates, setCsvDuplicates] = useState<Set<string>>(new Set());
  const [csvDeselected, setCsvDeselected] = useState<Set<number>>(new Set());
  const [showCsvReview, setShowCsvReview] = useState(false);
  const [checkDuplicates, setCheckDuplicates] = useState(true);
  const [importingTemplate, setImportingTemplate] = useState(false);
  const [csvParsing, setCsvParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0, active: false });
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, active: false });

  // Personalization state
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [personalizePrompt, setPersonalizePrompt] = useState("");
  const [personalizeFields, setPersonalizeFields] = useState<Set<string>>(new Set());
  const [personalizeColName, setPersonalizeColName] = useState("");
  const [personalizeProgress, setPersonalizeProgress] = useState({ current: 0, total: 0, running: false });

  // Verification state
  const { profile, refreshProfile } = useProfile();
  const [showVerify, setShowVerify] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState({ current: 0, total: 0 });

  const [deletingColumns, setDeletingColumns] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

  // ──────────────────────────────────────────────
  // Lightweight metadata load (no leads fetched)
  // ──────────────────────────────────────────────
  const loadMeta = useCallback(async () => {
    if (!user) return;
    const [listsRes, stepsRes, accRes, campaignRes, countRes] = await Promise.all([
      supabase.from("lead_lists").select("id, name, leads(count)").eq("user_id", user.id),
      supabase.from("campaign_steps").select("*").eq("campaign_id", campaignId).order("step_order"),
      supabase.from("campaign_accounts").select("account_id").eq("campaign_id", campaignId),
      supabase.from("campaigns").select("account_tags").eq("id", campaignId).single(),
      supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId),
    ]);

    setTotalLeadCount(countRes.count || 0);
    setRealLeadCount(countRes.count || 0);

    const listsData = listsRes.data || [];
    setLeadLists(listsData);
    const counts: Record<string, number> = {};
    listsData.forEach((l: any) => { counts[l.id] = l.leads?.[0]?.count || 0; });
    setLeadListCounts(counts);
    setSteps(stepsRes.data || []);

    // Resolve accounts: direct assignments + tag-based
    let allAccIds: string[] = (accRes.data || []).map((a: any) => a.account_id);
    const accountTags: string[] = campaignRes.data?.account_tags || [];
    if (accountTags.length > 0) {
      const { data: tagAccounts } = await supabase
        .from("email_accounts").select("id").eq("status", "connected").overlaps("tags", accountTags);
      if (tagAccounts) {
        for (const ta of tagAccounts) {
          if (!allAccIds.includes(ta.id)) allAccIds.push(ta.id);
        }
      }
    }
    if (allAccIds.length > 0) {
      const { data: accs } = await supabase.from("email_accounts").select("*").in("id", allAccIds).eq("status", "connected");
      setAccounts(accs || []);
    } else {
      setAccounts([]);
    }
  }, [campaignId, user]);

  // ──────────────────────────────────────────────
  // Server-side paginated page load
  // ──────────────────────────────────────────────
  const loadPage = useCallback(async (page: number, search?: string) => {
    if (!user) return;
    setLoadingPage(true);
    const from = page * TABLE_PAGE_SIZE;
    const to = from + TABLE_PAGE_SIZE - 1;

    if (search && search.trim()) {
      const q = search.trim();
      // Fetch campaign leads with join, filter by email on the leads side
      // Use campaign_leads as base to only get leads IN this campaign
      const { data: allCl } = await supabase
        .from("campaign_leads")
        .select("*, leads!inner(email, custom_fields)")
        .eq("campaign_id", campaignId)
        .ilike("leads.email", `%${q}%`)
        .range(from, to);

      const { count } = await supabase
        .from("campaign_leads")
        .select("*, leads!inner(email, custom_fields)", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .ilike("leads.email", `%${q}%`);

      setPageLeads(allCl || []);
      setTotalLeadCount(count || 0);
    } else {
      const [{ data, error }, countRes] = await Promise.all([
        supabase
          .from("campaign_leads")
          .select("*, leads(email, custom_fields)")
          .eq("campaign_id", campaignId)
          .range(from, to),
        supabase
          .from("campaign_leads")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId),
      ]);

      if (!error && data) {
        setPageLeads(data);
      }
      const c = countRes.count || 0;
      setTotalLeadCount(c);
      setRealLeadCount(c);
    }
    setLoadingPage(false);
  }, [campaignId, user]);

  // Initial load
  useEffect(() => { loadMeta(); }, [loadMeta]);
  // Reset to first page when search changes
  useEffect(() => { setTablePage(0); }, [searchFilter]);
  // Load page whenever page/search changes or after meta
  useEffect(() => { loadPage(tablePage, searchFilter); }, [tablePage, searchFilter, loadPage]);

  // Refresh both meta + current page
  const refreshAll = useCallback(async () => {
    await loadMeta();
    await loadPage(tablePage, searchFilter);
  }, [loadMeta, loadPage, tablePage, searchFilter]);

  // Memoize field columns from current page
  const fieldCols = useMemo(() => {
    const allKeys = new Set<string>();
    pageLeads.forEach(cl => {
      const fields = (cl.leads as any)?.custom_fields || {};
      Object.keys(fields).forEach(k => allKeys.add(k));
    });
    return Array.from(allKeys);
  }, [pageLeads]);

  const totalTablePages = Math.max(1, Math.ceil(totalLeadCount / TABLE_PAGE_SIZE));

  const assignList = async (listId: string) => {
    if (!user) return;
    const { data: listLeads } = await supabase.from("leads").select("id").eq("user_id", user.id).eq("list_id", listId);
    if (!listLeads?.length) { toast.info("La lista está vacía"); return; }
    const batchSize = 500;
    let added = 0;
    for (let i = 0; i < listLeads.length; i += batchSize) {
      const batch = listLeads.slice(i, i + batchSize);
      const { error } = await supabase.from("campaign_leads").upsert(
        batch.map(l => ({ campaign_id: campaignId, lead_id: l.id })),
        { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
      );
      if (!error) added += batch.length;
    }
    toast.success(`${added} leads procesados`);
    refreshAll();
  };

  const removeLead = async (clId: string, leadId: string) => {
    const { data: leadData } = await supabase.from("leads").select("is_campaign_only").eq("id", leadId).maybeSingle();
    const { error: unlinkError } = await supabase.from("campaign_leads").delete().eq("id", clId);
    if (unlinkError) { toast.error(unlinkError.message); return; }

    if (leadData?.is_campaign_only) {
      const { count } = await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
      if (!count) await supabase.from("leads").delete().eq("id", leadId);
    }

    toast.success("Lead eliminado de la campaña");
    // Update count and refresh page without full reload
    setTotalLeadCount(c => Math.max(0, c - 1));
    loadPage(tablePage, searchFilter);
  };

  const toggleColumnSelection = (col: string) => {
    setSelectedColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const deleteSelectedColumns = async () => {
    if (selectedColumns.size === 0) return;
    const colNames = Array.from(selectedColumns).join(", ");
    if (!confirm(`¿Eliminar ${selectedColumns.size} columna(s): ${colNames}? No se puede deshacer.`)) return;
    setDeletingColumns(true);
    try {
      // Get all lead IDs for this campaign in batches
      const leadIds: string[] = [];
      let offset = 0;
      while (true) {
        const { data } = await supabase.from("campaign_leads").select("lead_id").eq("campaign_id", campaignId).range(offset, offset + 999);
        if (!data?.length) break;
        leadIds.push(...data.map(d => d.lead_id));
        if (data.length < 1000) break;
        offset += 1000;
      }

      const colsToDelete = Array.from(selectedColumns);
      const batchSize = 50;
      for (let i = 0; i < leadIds.length; i += batchSize) {
        const batch = leadIds.slice(i, i + batchSize);
        const { data } = await supabase.from("leads").select("id, custom_fields").in("id", batch);
        if (!data) continue;
        const toUpdate = data.filter(lead => {
          const fields = (lead.custom_fields as Record<string, any>) || {};
          return colsToDelete.some(col => col in fields);
        });
        if (toUpdate.length > 0) {
          await Promise.all(toUpdate.map(lead => {
            const fields = { ...(lead.custom_fields as Record<string, any>) };
            colsToDelete.forEach(col => delete fields[col]);
            return supabase.from("leads").update({ custom_fields: fields }).eq("id", lead.id);
          }));
        }
      }
      toast.success(`${selectedColumns.size} columna(s) eliminada(s)`);
      setSelectedColumns(new Set());
      loadPage(tablePage, searchFilter);
    } catch (err: any) {
      toast.error(`Error eliminando columnas: ${err.message}`);
    } finally {
      setDeletingColumns(false);
    }
  };

  const handleAddManual = async () => {
    if (!user || !manualEmail.trim()) { toast.error("El email es obligatorio"); return; }
    const email = manualEmail.trim().toLowerCase();

    const customFields: Record<string, string> = {};
    if (manualFirstName.trim()) customFields["first_name"] = manualFirstName.trim();
    if (manualLastName.trim()) customFields["last_name"] = manualLastName.trim();
    if (manualCompany.trim()) customFields["company_name"] = manualCompany.trim();

    const { data, error } = await supabase.from("leads").insert({
      user_id: user.id, email, custom_fields: customFields, is_campaign_only: true,
    }).select("id").single();
    if (error) { toast.error(error.message); return; }

    const { error: linkErr } = await supabase.from("campaign_leads").upsert(
      { campaign_id: campaignId, lead_id: data.id },
      { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
    );
    if (linkErr) { toast.error(linkErr.message); return; }

    toast.success("Lead añadido a la campaña");
    setManualEmail(""); setManualFirstName(""); setManualLastName(""); setManualCompany("");
    setShowAddManual(false);
    setTotalLeadCount(c => c + 1);
    loadPage(tablePage, searchFilter);
  };

  const handleCsvParse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setCsvParsing(true);
    setParseProgress({ current: 0, total: 0, active: true });

    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const worker = new Worker(new URL("@/lib/csv-worker.ts", import.meta.url), { type: "module" });
      const allRows: Record<string, string>[] = [];
      let headers: string[] = [];
      let lastProgressUpdate = 0;
      let pendingProgress: { current: number; total: number } | null = null;
      let rafId: number | null = null;

      const flushProgress = () => {
        if (pendingProgress) {
          setParseProgress({ ...pendingProgress, active: true });
          pendingProgress = null;
        }
        rafId = null;
      };

      worker.onmessage = (msg) => {
        const data = msg.data;
        if (data.type === "error") {
          worker.terminate();
          if (rafId) cancelAnimationFrame(rafId);
          setCsvParsing(false);
          setParseProgress({ current: 0, total: 0, active: false });
          toast.error(data.error);
        } else if (data.type === "headers") {
          headers = data.headers;
          setParseProgress({ current: 0, total: data.totalRawRows, active: true });
        } else if (data.type === "chunk") {
          for (let j = 0; j < data.rows.length; j++) allRows.push(data.rows[j]);
          const now = performance.now();
          pendingProgress = { current: data.processed, total: data.total };
          if (now - lastProgressUpdate > 200) {
            lastProgressUpdate = now;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(flushProgress);
          }
        } else if (data.type === "done") {
          worker.terminate();
          if (rafId) cancelAnimationFrame(rafId);
          setCsvParsing(false);
          setParseProgress({ current: 0, total: 0, active: false });
          if (!allRows.length) { toast.error("No se encontraron leads con email válido"); return; }

          // Check duplicates — only check first page of existing emails for speed
          // Full dedup happens server-side via upsert
          const seenInCsv = new Set<string>();
          const internalDups = new Set<string>();
          allRows.forEach(r => {
            const email = r.email.toLowerCase();
            if (seenInCsv.has(email)) internalDups.add(email);
            seenInCsv.add(email);
          });

          parsedRowsRef.current = allRows;
          setCsvHeaders(headers);
          setCsvRows(allRows.slice(0, 500));
          setCsvDuplicates(internalDups);

          if (checkDuplicates && internalDups.size > 0) {
            const deselected = new Set<number>();
            const seen = new Set<string>();
            allRows.forEach((r, i) => {
              const email = r.email.toLowerCase();
              if (seen.has(email)) deselected.add(i);
              seen.add(email);
            });
            setCsvDeselected(deselected);
          } else {
            setCsvDeselected(new Set());
          }
          setShowCsvReview(true);
        }
      };
      worker.onerror = () => { worker.terminate(); if (rafId) cancelAnimationFrame(rafId); setCsvParsing(false); setParseProgress({ current: 0, total: 0, active: false }); toast.error("Error al procesar el CSV"); };
      worker.postMessage(buffer, [buffer]);
    };
    reader.readAsArrayBuffer(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  // Template CSV handler
  const handleTemplateCsvParse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setImportingTemplate(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const result = parseCSVToObjects(text);
        if ("error" in result) { toast.error(result.error); setImportingTemplate(false); return; }

        const allowedKeys = new Set(["email", ...TEMPLATE_COLUMNS]);
        const aliasMap: Record<string, string> = {
          firstname: "first_name", first: "first_name", nombre: "first_name",
          company: "company_name", empresa: "company_name", companyname: "company_name",
          ciudad: "city", town: "city",
          industria: "industry", sector: "industry",
          description: "company_short_description", company_description: "company_short_description",
          short_description: "company_short_description", companydescription: "company_short_description",
          web: "website", url: "website", sitio_web: "website",
        };
        const normalizeHeader = (h: string): string => aliasMap[h] || h;

        const rows = result.rows.map(row => {
          const obj: Record<string, string> = {};
          Object.entries(row).forEach(([key, value]) => {
            const normalized = normalizeHeader(key);
            if (allowedKeys.has(normalized)) obj[normalized] = value;
          });
          return obj;
        }).filter(r => r.email?.trim());

        if (!rows.length) { toast.error("No se encontraron leads con email válido"); setImportingTemplate(false); return; }

        const orderedRows = rows.map(r => {
          const ordered: Record<string, string> = { email: r.email };
          TEMPLATE_COLUMNS.forEach(col => { ordered[col] = r[col] || ""; });
          return ordered;
        });

        parsedRowsRef.current = orderedRows;
        setCsvDeselected(new Set());
        await confirmCsvImport();
      } catch (err: any) {
        toast.error(`Error procesando plantilla: ${err.message}`);
      }
      setImportingTemplate(false);
    };
    reader.readAsText(file);
    if (templateFileRef.current) templateFileRef.current.value = "";
  };

  const confirmCsvImport = async () => {
    if (!user) return;
    setImporting(true);
    setShowCsvReview(false);
    const allRows = parsedRowsRef.current;
    const selectedRows = allRows.filter((_, i) => !csvDeselected.has(i));
    if (!selectedRows.length) { toast.info("No se seleccionaron leads"); setImporting(false); return; }

    setImportProgress({ current: 0, total: selectedRows.length, active: true });

    try {
      const INSERT_BATCH = 500;
      let totalAdded = 0;
      let processedRows = 0;

      for (let i = 0; i < selectedRows.length; i += INSERT_BATCH) {
        const batchRows = selectedRows.slice(i, i + INSERT_BATCH);
        const batch = batchRows.map(r => {
          const custom_fields: Record<string, string> = {};
          Object.entries(r).forEach(([key, value]) => {
            if (key !== "email" && value?.trim()) custom_fields[key] = value.trim();
          });
          return { user_id: user.id, email: r.email.toLowerCase(), custom_fields, is_campaign_only: true };
        });

        // Insert leads (ignore conflicts on email for same user)
        const { data, error } = await supabase.from("leads").insert(batch).select("id");
        if (error) {
          // If bulk insert fails, try one by one for this batch
          const ids: string[] = [];
          for (const row of batch) {
            const { data: single } = await supabase.from("leads").insert(row).select("id").maybeSingle();
            if (single) ids.push(single.id);
          }
          if (ids.length > 0) {
            await supabase.from("campaign_leads").upsert(
              ids.map(id => ({ campaign_id: campaignId, lead_id: id })),
              { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
            );
            totalAdded += ids.length;
          }
        } else if (data && data.length > 0) {
          // Link to campaign
          const LINK_BATCH = 500;
          const ids = data.map((d: any) => d.id);
          for (let li = 0; li < ids.length; li += LINK_BATCH) {
            const linkBatch = ids.slice(li, li + LINK_BATCH);
            await supabase.from("campaign_leads").upsert(
              linkBatch.map(id => ({ campaign_id: campaignId, lead_id: id })),
              { onConflict: "campaign_id,lead_id", ignoreDuplicates: true }
            );
          }
          totalAdded += ids.length;
        }

        processedRows += batchRows.length;
        setImportProgress({ current: processedRows, total: selectedRows.length, active: true });
        await yieldToMain();
      }

      toast.success(`${totalAdded} leads añadidos a la campaña`);
      setShowCsv(false);
      setCsvRows([]);
      parsedRowsRef.current = [];

      // Just update count + reload current page — no full reload
      setTotalLeadCount(c => c + totalAdded);
      setTablePage(0);
      await loadPage(0, searchFilter);
      await loadMeta();
    } catch (err: any) {
      toast.error(`Error procesando CSV: ${err.message}`);
    }
    setImporting(false);
    setImportProgress({ current: 0, total: 0, active: false });
  };

  const handleSendNow = async (cl: any) => {
    if (!user) return;
    if (steps.length === 0) { toast.error("No hay steps en la secuencia. Crea uno primero."); return; }
    if (accounts.length === 0) { toast.error("No hay cuentas de email asignadas a esta campaña. Asigna una en Options."); return; }

    const lead = cl.leads as any;
    if (!lead?.email) { toast.error("Lead sin email"); return; }

    const stepIndex = Math.min(cl.current_step, steps.length - 1);
    const step = steps[stepIndex];
    const account = accounts[Math.floor(Math.random() * accounts.length)];

    const variants: { subject: string; body: string }[] = Array.isArray(step.variants) ? step.variants : [];
    const allVariants = [
      { subject: step.subject, body: step.body },
      ...variants.map((v: any) => ({ subject: v.subject || step.subject, body: v.body || step.body })),
    ];
    const picked = allVariants[Math.floor(Math.random() * allVariants.length)];
    const customFields = lead.custom_fields || {};

    setSendingLeadId(cl.id);
    try {
      // Respect the campaign's unsubscribe setting + account scope on manual sends too.
      let includeUnsub = false;
      try {
        const { data: camp } = await (supabase as any).from("campaigns")
          .select("include_unsubscribe, unsubscribe_all, unsubscribe_account_ids, unsubscribe_account_tags")
          .eq("id", campaignId).single();
        if (camp?.include_unsubscribe) {
          if (camp.unsubscribe_all ?? true) includeUnsub = true;
          else if ((camp.unsubscribe_account_ids || []).includes(account.id)) includeUnsub = true;
          else if ((camp.unsubscribe_account_tags || []).length) {
            includeUnsub = (((account as any).tags as string[]) || []).some((t) => (camp.unsubscribe_account_tags || []).includes(t));
          }
        }
      } catch { /* default false */ }

      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          campaign_id: campaignId, account_id: account.id, to_email: lead.email,
          subject: picked.subject, body: picked.body, lead_id: cl.lead_id,
          custom_fields: { ...customFields, email: lead.email }, campaign_step_id: step.id,
          include_unsubscribe: includeUnsub,
        }),
      });
      const result = await resp.json();
      if (result.success) {
        toast.success(`✅ Email enviado a ${lead.email}`);
        await supabase.from("campaign_leads").update({
          current_step: cl.current_step + 1,
          last_sent_at: new Date().toISOString(),
          status: cl.current_step + 1 >= steps.length ? "completed" : "in_progress",
        }).eq("id", cl.id);
        loadPage(tablePage, searchFilter);
      } else {
        toast.error(`Error: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(`Error enviando: ${err.message}`);
    }
    setSendingLeadId(null);
  };

  // Poll for active personalization job
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const checkActiveJob = async () => {
      const { data } = await supabase
        .from("personalization_jobs").select("*")
        .eq("campaign_id", campaignId).eq("user_id", user.id)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false }).limit(1);
      if (data && data.length > 0) {
        const job = data[0];
        setActiveJobId(job.id);
        setPersonalizeProgress({ current: job.completed || 0, total: job.total || 0, running: true });
        startPolling(job.id);
      }
    };
    checkActiveJob();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [user, campaignId]);

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from("personalization_jobs").select("completed, total, errors, status").eq("id", jobId).single();
      if (!data) return;
      setPersonalizeProgress({ current: data.completed || 0, total: data.total || 0, running: data.status === "running" || data.status === "pending" });
      if (data.status === "completed" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setActiveJobId(null);
        setPersonalizeProgress(p => ({ ...p, running: false }));
        if (data.status === "completed") {
          toast.success(`Personalización completada: ${data.completed} exitosos, ${data.errors} errores`);
        } else {
          toast.error("La personalización falló");
        }
        loadPage(tablePage, searchFilter);
      }
    }, 3000);
  };

  const handlePersonalize = async () => {
    if (!user || !personalizePrompt.trim() || !personalizeColName.trim() || personalizeFields.size === 0) {
      toast.error("Completa el prompt, selecciona columnas y pon nombre a la columna destino");
      return;
    }

    const colName = personalizeColName.trim().replace(/\s+/g, "_").toLowerCase();
    const selectedFieldNames = Array.from(personalizeFields);

    // Fetch all lead IDs for this campaign
    const leadIds: string[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase.from("campaign_leads").select("lead_id").eq("campaign_id", campaignId).range(offset, offset + 999);
      if (!data?.length) break;
      leadIds.push(...data.map(d => d.lead_id));
      if (data.length < 1000) break;
      offset += 1000;
    }

    const total = leadIds.length;
    const personalizeCost = Math.ceil(total * 0.1);

    if (!profile.infiniteCoins && profile.coins < personalizeCost) {
      toast.error(`Necesitas ${personalizeCost} monedas pero solo tienes ${profile.coins}. Recarga monedas.`);
      return;
    }

    const { data: job, error: jobErr } = await supabase
      .from("personalization_jobs").insert({
        user_id: user.id, campaign_id: campaignId, prompt: personalizePrompt,
        selected_fields: selectedFieldNames, column_name: colName,
        lead_ids: leadIds, total, status: "pending",
      }).select("id").single();

    if (jobErr || !job) { toast.error(`Error creando job: ${jobErr?.message}`); return; }

    setActiveJobId(job.id);
    setPersonalizeProgress({ current: 0, total, running: true });
    setShowPersonalize(false);
    setPersonalizePrompt(""); setPersonalizeFields(new Set()); setPersonalizeColName("");
    toast.success("Personalización iniciada en segundo plano.");

    const { data: { session } } = await supabase.auth.getSession();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/personalize-leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {});

    startPolling(job.id);
  };

  // CSV download — streams from DB instead of memory
  const handleDownloadCsv = async () => {
    if (totalLeadCount === 0) return;
    toast.info("Preparando descarga...");
    const allKeys = new Set<string>();
    const allRows: { email: string; fields: Record<string, any> }[] = [];
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from("campaign_leads").select("leads(email, custom_fields)")
        .eq("campaign_id", campaignId).range(offset, offset + 999);
      if (!data?.length) break;
      for (const cl of data) {
        const lead = cl.leads as any;
        const fields = lead?.custom_fields || {};
        Object.keys(fields).forEach(k => allKeys.add(k));
        allRows.push({ email: lead?.email || "", fields });
      }
      if (data.length < 1000) break;
      offset += 1000;
      await yieldToMain();
    }
    const cols = ["email", ...Array.from(allKeys)];
    const csvHeader = cols.map(c => `"${c}"`).join(",");
    const csvLines = allRows.map(r => {
      return cols.map(c => {
        const val = c === "email" ? r.email : (r.fields[c] || "");
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(",");
    });
    const csvContent = [csvHeader, ...csvLines].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `leads_campaign_${campaignId}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV descargado");
  };

  const handleVerifyLeads = async () => {
    if (totalLeadCount === 0) return;
    const cost = Math.ceil(totalLeadCount * 0.1);
    if (!profile.infiniteCoins && profile.coins < cost) {
      toast.error(`Necesitas ${cost} monedas pero solo tienes ${profile.coins}. Recarga monedas.`);
      return;
    }
    setVerifying(true);
    setVerifyProgress({ current: 0, total: totalLeadCount });
    setShowVerify(false);
    try {
      // Fetch all lead IDs
      const leadIds: string[] = [];
      let offset = 0;
      while (true) {
        const { data } = await supabase.from("campaign_leads").select("lead_id").eq("campaign_id", campaignId).range(offset, offset + 999);
        if (!data?.length) break;
        leadIds.push(...data.map(d => d.lead_id));
        if (data.length < 1000) break;
        offset += 1000;
      }

      const BATCH = 10;
      let totalValid = 0, totalInvalid = 0, totalRisky = 0;
      let consecutiveErrors = 0;
      for (let i = 0; i < leadIds.length; i += BATCH) {
        const batch = leadIds.slice(i, i + BATCH);
        try {
          const { data, error } = await supabase.functions.invoke("verify-leads", { body: { lead_ids: batch } });
          if (error) throw error;
          if (data?.error === "insufficient_coins") { toast.error("Monedas insuficientes"); break; }
          if (data?.results) {
            totalValid += data.results.valid || 0;
            totalInvalid += data.results.invalid || 0;
            totalRisky += data.results.risky || 0;
          }
          consecutiveErrors = 0;
        } catch {
          consecutiveErrors++;
          if (consecutiveErrors >= 5) { toast.error("Demasiados errores, verificación pausada"); break; }
          await new Promise(r => setTimeout(r, 1500));
          i -= BATCH; // retry this batch
          continue;
        }
        setVerifyProgress({ current: Math.min(i + BATCH, leadIds.length), total: leadIds.length });
        await yieldToMain();
      }
      toast.success(`Verificación: ${totalValid} válidos, ${totalRisky} arriesgados, ${totalInvalid} eliminados`);
      refreshProfile();
      refreshAll();
    } catch (err: any) {
      toast.error(err.message);
    }
    setVerifying(false);
  };

  const statusColors: Record<string, string> = {
    pending: "secondary", in_progress: "default", completed: "outline", replied: "default",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Leads ({totalLeadCount.toLocaleString()})</h4>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAddManual(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Añadir manual
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCsv(true)}>
            <Upload className="h-3.5 w-3.5" /> Importar CSV
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 border-primary/30 text-primary"
            disabled={importingTemplate}
            onClick={() => templateFileRef.current?.click()}
          >
            {importingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            Plantilla
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 border-amber-500/30 text-amber-600 dark:text-amber-400"
            disabled={totalLeadCount === 0 || personalizeProgress.running}
            onClick={() => setShowPersonalize(true)}
          >
            <Zap className="h-3.5 w-3.5" /> Personalizar
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1.5"
            disabled={totalLeadCount === 0}
            onClick={handleDownloadCsv}
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            variant="outline" size="sm"
            className="gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            disabled={totalLeadCount === 0 || verifying}
            onClick={() => setShowVerify(true)}
          >
            {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Verificar
          </Button>
          <input ref={templateFileRef} type="file" accept=".csv" className="hidden" onChange={handleTemplateCsvParse} />
        </div>
      </div>

      {leadLists.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center mr-1">Listas:</span>
          {leadLists.map(list => {
            const count = leadListCounts[list.id] || 0;
            return (
              <Button key={list.id} variant="outline" size="sm" className="gap-1" onClick={() => assignList(list.id)}>
                <Plus className="h-3 w-3" /> {list.name} ({count})
              </Button>
            );
          })}
        </div>
      )}

      {/* Add Manual Dialog */}
      <Dialog open={showAddManual} onOpenChange={setShowAddManual}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Añadir lead manualmente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Email *</Label>
              <Input value={manualEmail} onChange={e => setManualEmail(e.target.value)} placeholder="lead@empresa.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={manualFirstName} onChange={e => setManualFirstName(e.target.value)} placeholder="Juan" />
              </div>
              <div className="space-y-1">
                <Label>Apellido</Label>
                <Input value={manualLastName} onChange={e => setManualLastName(e.target.value)} placeholder="García" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Empresa</Label>
              <Input value={manualCompany} onChange={e => setManualCompany(e.target.value)} placeholder="Acme Corp" />
            </div>
            <Button onClick={handleAddManual} className="w-full gap-2">
              <UserPlus className="h-4 w-4" /> Añadir a campaña
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCsv} onOpenChange={(o) => { setShowCsv(o); if (!o) { setCsvRows([]); setShowCsvReview(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Importar leads desde CSV</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El CSV debe tener al menos la columna <strong>email</strong>. Las demás columnas se guardan como variables dinámicas.
            </p>
            <div className="flex items-center gap-2">
              <Checkbox id="check-dups" checked={checkDuplicates} onCheckedChange={(v) => setCheckDuplicates(!!v)} />
              <label htmlFor="check-dups" className="text-sm text-muted-foreground cursor-pointer">Revisar duplicados antes de importar</label>
            </div>
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-center">
              <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">Selecciona un archivo CSV</p>
              <Input ref={fileRef} type="file" accept=".csv" onChange={handleCsvParse} disabled={importing} className="max-w-xs mx-auto" />
            </div>
            {importing && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Importando...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Duplicate Review Dialog */}
      <Dialog open={showCsvReview} onOpenChange={setShowCsvReview}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Revisar {csvDuplicates.size > 0 ? `duplicados (${csvDuplicates.size})` : "leads"} — {parsedRowsRef.current.length.toLocaleString()} total
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {csvDuplicates.size > 0
              ? `Se encontraron ${csvDuplicates.size} emails duplicados (desmarcados). Selecciona los que quieras importar.`
              : `${parsedRowsRef.current.length.toLocaleString()} leads listos para importar.`}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCsvDeselected(new Set())}>Seleccionar todos</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => {
                const d = new Set<number>();
                const seen = new Set<string>();
                parsedRowsRef.current.forEach((r, i) => {
                  const email = r.email.toLowerCase();
                  if (seen.has(email)) d.add(i);
                  seen.add(email);
                });
                setCsvDeselected(d);
              }}
            >Solo nuevos</Button>
            <span className="text-muted-foreground ml-auto">
              {(parsedRowsRef.current.length - csvDeselected.size).toLocaleString()} / {parsedRowsRef.current.length.toLocaleString()} seleccionados
            </span>
          </div>
          <ScrollArea className="max-h-[40vh] rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 w-10"></th>
                  {csvRows.length > 0 && Object.keys(csvRows[0]).map(col => (
                    <th key={col} className="text-left p-2 font-medium capitalize">{col}</th>
                  ))}
                  <th className="text-left p-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, i) => {
                  const isDup = csvDuplicates.has(row.email.toLowerCase());
                  return (
                    <tr key={i} className={`border-t ${isDup ? "bg-amber-50 dark:bg-amber-900/10" : ""}`}>
                      <td className="p-2">
                        <Checkbox
                          checked={!csvDeselected.has(i)}
                          onCheckedChange={(v) => {
                            setCsvDeselected(prev => {
                              const next = new Set(prev);
                              v ? next.delete(i) : next.add(i);
                              return next;
                            });
                          }}
                        />
                      </td>
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="p-2 text-muted-foreground truncate max-w-[150px]">{val || "—"}</td>
                      ))}
                      <td className="p-2">
                        {isDup ? (
                          <Badge variant="outline" className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300">Duplicado</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-300">Nuevo</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
          {parsedRowsRef.current.length > 500 && (
            <p className="text-xs text-muted-foreground text-center">Mostrando vista previa de 500 / {parsedRowsRef.current.length.toLocaleString()} filas</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setShowCsvReview(false); setCsvRows([]); parsedRowsRef.current = []; }}>Cancelar</Button>
            <Button onClick={() => confirmCsvImport()} disabled={parsedRowsRef.current.length - csvDeselected.size === 0 || importing} className="gap-2">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Importar {(parsedRowsRef.current.length - csvDeselected.size).toLocaleString()} leads
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Personalize Dialog */}
      <Dialog open={showPersonalize} onOpenChange={(o) => { if (!personalizeProgress.running) setShowPersonalize(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-amber-500" /> Personalizar con IA</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Prompt para la IA</Label>
              <Textarea value={personalizePrompt} onChange={e => setPersonalizePrompt(e.target.value)} placeholder="Ej: Escribe un primer párrafo personalizado..." rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Columnas de contexto</Label>
              <div className="flex flex-wrap gap-2">
                {fieldCols.map(col => (
                  <label key={col} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox
                      checked={personalizeFields.has(col)}
                      onCheckedChange={(v) => {
                        setPersonalizeFields(prev => {
                          const next = new Set(prev);
                          v ? next.add(col) : next.delete(col);
                          return next;
                        });
                      }}
                    />
                    <span>{col.replace(/_/g, " ")}</span>
                  </label>
                ))}
                {fieldCols.length === 0 && <p className="text-xs text-muted-foreground">No hay columnas disponibles. Importa leads con datos primero.</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre de la nueva columna</Label>
              <Input value={personalizeColName} onChange={e => setPersonalizeColName(e.target.value)} placeholder="Ej: personalized_intro" />
            </div>
            {personalizeProgress.running && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Generando...</span>
                  <span>{personalizeProgress.current} / {personalizeProgress.total}</span>
                </div>
                <Progress value={(personalizeProgress.current / personalizeProgress.total) * 100} />
              </div>
            )}
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Leads a personalizar:</span><span className="font-semibold">{totalLeadCount.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Coste:</span><span className="font-semibold">{Math.ceil(totalLeadCount * 0.1)} monedas</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Saldo:</span><span className="font-semibold">{profile.infiniteCoins ? "∞" : profile.coins} monedas</span></div>
            </div>
            {!profile.infiniteCoins && profile.coins < Math.ceil(totalLeadCount * 0.1) && (
              <p className="text-sm text-destructive">No tienes suficientes monedas.</p>
            )}
            <Button
              onClick={handlePersonalize}
              disabled={personalizeProgress.running || !personalizePrompt.trim() || personalizeFields.size === 0 || !personalizeColName.trim() || (!profile.infiniteCoins && profile.coins < Math.ceil(totalLeadCount * 0.1))}
              className="w-full gap-2"
            >
              {personalizeProgress.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {personalizeProgress.running ? `Generando ${personalizeProgress.current}/${personalizeProgress.total}...` : `Generar para ${totalLeadCount.toLocaleString()} leads`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify Dialog */}
      <Dialog open={showVerify} onOpenChange={setShowVerify}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" /> Verificar Leads</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Leads a verificar:</span><span className="font-semibold">{totalLeadCount.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Coste:</span><span className="font-semibold">{Math.ceil(totalLeadCount * 0.1)} monedas</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Saldo:</span><span className="font-semibold">{profile.infiniteCoins ? "∞" : profile.coins} monedas</span></div>
            </div>
            {!profile.infiniteCoins && profile.coins < Math.ceil(totalLeadCount * 0.1) && (
              <p className="text-sm text-destructive">No tienes suficientes monedas.</p>
            )}
            <Button
              className="w-full gap-2"
              disabled={!profile.infiniteCoins && profile.coins < Math.ceil(totalLeadCount * 0.1)}
              onClick={handleVerifyLeads}
            >
              <ShieldCheck className="h-4 w-4" /> Verificar {totalLeadCount.toLocaleString()} leads
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify Progress */}
      {verifying && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Verificando leads...</span>
            <span>{verifyProgress.current} / {verifyProgress.total}</span>
          </div>
          <Progress value={verifyProgress.total > 0 ? (verifyProgress.current / verifyProgress.total) * 100 : 0} />
        </div>
      )}

      {loadingPage && pageLeads.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (realLeadCount > 0 || searchFilter.trim()) ? (
        <div className="space-y-3">
          {/* Search */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Input
                placeholder="Buscar leads..."
                className="pl-3"
                value={searchFilter}
                onChange={e => { setSearchFilter(e.target.value); setTablePage(0); }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {totalLeadCount.toLocaleString()} leads
            </span>
            {loadingPage && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {/* Bulk actions bar */}
          <div className="flex items-center gap-2 flex-wrap">
            {selectedColumns.size > 0 && (
              <Button
                variant="outline" size="sm"
                className="gap-1.5 text-destructive border-destructive/30"
                disabled={deletingColumns}
                onClick={deleteSelectedColumns}
              >
                {deletingColumns ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Eliminar {selectedColumns.size} columna(s)
              </Button>
            )}
            {selectedCampaignLeads.size > 0 && (
              <>
                <span className="text-sm text-muted-foreground">{selectedCampaignLeads.size} leads seleccionados</span>
                <Button
                  variant="outline" size="sm"
                  className="gap-1.5 text-destructive"
                  disabled={deletingBulk}
                  onClick={async () => {
                    if (!confirm(`¿Eliminar ${selectedCampaignLeads.size} leads de la campaña y del sistema?`)) return;
                    setDeletingBulk(true);
                    const toDelete = pageLeads.filter(cl => selectedCampaignLeads.has(cl.id));
                    const leadIds = toDelete.map(cl => cl.lead_id);
                    const clIds = toDelete.map(cl => cl.id);
                    for (let i = 0; i < clIds.length; i += 100) {
                      await supabase.from("campaign_leads").delete().in("id", clIds.slice(i, i + 100));
                    }
                    for (let i = 0; i < leadIds.length; i += 100) {
                      await supabase.rpc("bulk_delete_leads", { lead_ids: leadIds.slice(i, i + 100) });
                    }
                    toast.success(`${toDelete.length} leads eliminados`);
                    setSelectedCampaignLeads(new Set());
                    setDeletingBulk(false);
                    refreshAll();
                  }}
                >
                  {deletingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Eliminar selección
                </Button>
              </>
            )}
            <Button
              variant="destructive" size="sm"
              className="gap-1.5 ml-auto"
              disabled={deletingBulk || totalLeadCount === 0}
              onClick={async () => {
                if (!confirm(`¿Eliminar TODOS los ${totalLeadCount.toLocaleString()} leads de esta campaña?`)) return;
                setDeletingBulk(true);
                // Delete all campaign_leads
                await supabase.from("campaign_leads").delete().eq("campaign_id", campaignId);
                // Delete campaign-only leads in batches
                let offset = 0;
                while (true) {
                  const { data } = await supabase.from("leads").select("id").eq("user_id", user!.id).eq("is_campaign_only", true).range(offset, offset + 999);
                  if (!data?.length) break;
                  // Check if these leads are orphaned (no campaign_leads)
                  for (let i = 0; i < data.length; i += 100) {
                    const batch = data.slice(i, i + 100).map(d => d.id);
                    await supabase.rpc("bulk_delete_leads", { lead_ids: batch });
                  }
                  if (data.length < 1000) break;
                  offset += 1000;
                }
                toast.success(`Leads eliminados`);
                setSelectedCampaignLeads(new Set());
                setDeletingBulk(false);
                refreshAll();
              }}
            >
              {deletingBulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Eliminar todos ({totalLeadCount.toLocaleString()})
            </Button>
          </div>

          {/* Dynamic table */}
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 w-10">
                      <Checkbox
                        checked={selectedCampaignLeads.size === pageLeads.length && pageLeads.length > 0}
                        onCheckedChange={() => {
                          if (selectedCampaignLeads.size === pageLeads.length) {
                            setSelectedCampaignLeads(new Set());
                          } else {
                            setSelectedCampaignLeads(new Set(pageLeads.map(cl => cl.id)));
                          }
                        }}
                      />
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground w-10">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                    {fieldCols.map(col => (
                      <th key={col} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Checkbox checked={selectedColumns.has(col)} onCheckedChange={() => toggleColumnSelection(col)} className="h-3.5 w-3.5" />
                          <span>{col.replace(/_/g, " ")}</span>
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Step</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2 w-24 text-center text-xs font-medium text-muted-foreground uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pageLeads.map((cl, idx) => {
                    const lead = cl.leads as any;
                    const fields = lead?.custom_fields || {};
                    const globalIdx = tablePage * TABLE_PAGE_SIZE + idx;
                    return (
                      <tr key={cl.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={selectedCampaignLeads.has(cl.id)}
                            onCheckedChange={(v) => {
                              setSelectedCampaignLeads(prev => {
                                const next = new Set(prev);
                                v ? next.add(cl.id) : next.delete(cl.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{globalIdx + 1}</td>
                        <td className="px-3 py-2 font-medium">{lead?.email || "—"}</td>
                        {fieldCols.map(col => (
                          <td key={col} className="px-3 py-2 text-muted-foreground truncate max-w-[180px]">{fields[col] || "—"}</td>
                        ))}
                        <td className="px-3 py-2 text-muted-foreground">{cl.current_step + 1} / {steps.length || "?"}</td>
                        <td className="px-3 py-2"><Badge variant={(statusColors[cl.status] || "secondary") as any}>{cl.status}</Badge></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline" size="sm"
                              className="gap-1 h-7 text-xs"
                              disabled={sendingLeadId === cl.id || cl.status === "completed"}
                              onClick={() => handleSendNow(cl)}
                            >
                              {sendingLeadId === cl.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Enviar
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeLead(cl.id, cl.lead_id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pageLeads.length === 0 && searchFilter.trim() && (
                    <tr><td colSpan={5 + fieldCols.length} className="text-center py-8 text-sm text-muted-foreground">No se encontraron leads con "{searchFilter}"</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalTablePages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Página {tablePage + 1} de {totalTablePages.toLocaleString()}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={tablePage === 0} onClick={() => setTablePage(p => p - 1)}>Anterior</Button>
                <Button variant="outline" size="sm" disabled={tablePage >= totalTablePages - 1} onClick={() => setTablePage(p => p + 1)}>Siguiente</Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        searchFilter.trim() ? (
          <p className="text-sm text-muted-foreground text-center py-8">No se encontraron leads con "{searchFilter}"</p>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No hay leads asignados. Añade leads manualmente, importa un CSV o selecciona una lista.</p>
        )
      )}

      {/* Floating progress banners */}
      {csvParsing && parseProgress.active && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md bg-background border rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Procesando CSV...</span>
            <span className="font-medium">{parseProgress.current.toLocaleString()} / {parseProgress.total.toLocaleString()}</span>
          </div>
          <Progress value={parseProgress.total ? (parseProgress.current / parseProgress.total) * 100 : 0} className="h-2 mt-2" />
        </div>
      )}
      {importProgress.active && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md bg-background border rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Importando leads...</span>
            <span className="font-medium">{importProgress.current.toLocaleString()} / {importProgress.total.toLocaleString()}</span>
          </div>
          <Progress value={importProgress.total ? (importProgress.current / importProgress.total) * 100 : 0} className="h-2 mt-2" />
        </div>
      )}
    </div>
  );
}
