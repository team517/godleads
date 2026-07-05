import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";

import { useProfile } from "@/contexts/ProfileContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Plus, Upload, Search, Users, Trash2, FolderPlus, Folder, FolderOpen, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseCSVToObjects } from "@/lib/csv-parser";
import { useVerification } from "@/contexts/VerificationContext";
import { useSearchParams } from "react-router-dom";
import { cacheGet, cacheSet } from "@/lib/instant-cache";

const FINAL_VERIFICATION_STATUSES = new Set(["valid", "risky", "invalid"]);

const isLeadPendingVerification = (verificationStatus: string | null | undefined) => {
  const s = typeof verificationStatus === "string" ? verificationStatus.trim().toLowerCase() : "";
  return !FINAL_VERIFICATION_STATUSES.has(s);
};

export default function Leads() {
  const { user } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const { verifying, progress: verifyProgress, startVerification } = useVerification();
  // Instant re-entry: seed from session cache (default view), refresh in background.
  const [leads, setLeads] = useState<any[]>(() => cacheGet<any>("leads:first")?.leads || []);
  const [lists, setLists] = useState<any[]>(() => cacheGet<any>("leads:first")?.lists || []);
  const [loading, setLoading] = useState(() => !cacheGet<any>("leads:first"));
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [showAdd, setShowAdd] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [form, setForm] = useState({ email: "", first_name: "", last_name: "", company: "", list_id: "" });
  const [listName, setListName] = useState("");
  const [activeList, setActiveList] = useState<string | null>(null);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [moveTargetList, setMoveTargetList] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;
  const [deleting, setDeleting] = useState(false);

  const [showVerify, setShowVerify] = useState(false);
  const [unverifiedTotalCount, setUnverifiedTotalCount] = useState(0);
  const [loadingUnverifiedCount, setLoadingUnverifiedCount] = useState(false);
  const [verifyAfterImport, setVerifyAfterImport] = useState(false);

  // CSV review state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvDeselected, setCsvDeselected] = useState<Set<number>>(new Set());
  const [showCsvReview, setShowCsvReview] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvPage, setCsvPage] = useState(0);
  const CSV_PAGE_SIZE = 100;
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, active: false });
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0, active: false });

  const load = async () => {
    if (!user) return;
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("leads")
      .select("*, lead_lists(name)", { count: "exact" })
      .eq("user_id", user.id)
      .eq("is_campaign_only", false);
    if (activeList) query = query.eq("list_id", activeList);
    query = query.order("created_at", { ascending: false }).range(from, to);

    const [leadsRes, listsRes] = await Promise.all([
      query,
      supabase.from("lead_lists").select("*, leads(count)").eq("user_id", user.id),
    ]);
    setLeads(leadsRes.data || []);
    setTotalCount(leadsRes.count || 0);
    setLists(listsRes.data || []);
    // Cache only the default entry view (first page, all lists) for instant re-entry.
    if (page === 0 && !activeList) cacheSet("leads:first", { leads: leadsRes.data || [], lists: listsRes.data || [] });
    setLoading(false);
  };

  useEffect(() => { load(); }, [user, page, activeList]);

  const fetchUnverifiedCount = useCallback(async () => {
    if (!user) return 0;
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_campaign_only", false);
    if (activeList) q = q.eq("list_id", activeList);
    q = q.or("verification_status.is.null,verification_status.not.in.(valid,risky,invalid)");
    const { count } = await q;
    return count || 0;
  }, [user, activeList]);

  const openVerifyDialog = useCallback(async () => {
    setShowVerify(true);
    setLoadingUnverifiedCount(true);
    try {
      const count = await fetchUnverifiedCount();
      setUnverifiedTotalCount(count);
    } catch {
      setUnverifiedTotalCount(0);
    } finally {
      setLoadingUnverifiedCount(false);
    }
  }, [fetchUnverifiedCount]);

  const handleAddLead = async () => {
    if (!user || !form.email.trim()) return;
    const custom_fields: Record<string, string> = {};
    if (form.first_name.trim()) custom_fields.first_name = form.first_name.trim();
    if (form.last_name.trim()) custom_fields.last_name = form.last_name.trim();
    if (form.company.trim()) custom_fields.company = form.company.trim();

    const { error } = await supabase.from("leads").insert({
      user_id: user.id,
      email: form.email.trim().toLowerCase(),
      custom_fields,
      list_id: form.list_id || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Lead añadido");
    setShowAdd(false);
    setForm({ email: "", first_name: "", last_name: "", company: "", list_id: "" });
    load();
  };

  const handleCreateList = async () => {
    if (!user || !listName.trim()) return;
    const { error } = await supabase.from("lead_lists").insert({ user_id: user.id, name: listName.trim() });
    if (error) { toast.error(error.message); return; }
    toast.success("Carpeta creada");
    setShowList(false);
    setListName("");
    load();
  };

  const handleDeleteList = async (listId: string) => {
    // Unassign leads first
    await supabase.from("leads").update({ list_id: null }).eq("list_id", listId);
    await supabase.from("lead_lists").delete().eq("id", listId);
    if (activeList === listId) setActiveList(null);
    toast.success("Carpeta eliminada");
    load();
  };

  // Store full parsed data in a ref to avoid massive React state re-renders
  const parsedRowsRef = useRef<Record<string, string>[]>([]);

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setCsvParsing(true);
    setParseProgress({ current: 0, total: 0, active: true });

    // Read as ArrayBuffer and transfer to worker (zero-copy, no memory duplication)
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      const worker = new Worker(new URL("@/lib/csv-worker.ts", import.meta.url), { type: "module" });
      const allRows: Record<string, string>[] = [];
      let headers: string[] = [];
      // Throttle progress updates to max 1 per 200ms to avoid flooding React with re-renders
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
          // Use Array.prototype.push with apply to avoid spread overhead on large arrays
          for (let j = 0; j < data.rows.length; j++) allRows.push(data.rows[j]);
          // Throttle UI updates — batch with requestAnimationFrame
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
          parsedRowsRef.current = allRows;
          setCsvHeaders(headers);
          // Only keep first 500 in state for preview rendering
          setCsvRows(allRows.slice(0, 500));
          setCsvDeselected(new Set());
          setCsvPage(0);
          setShowCsvReview(true);
        }
      };
      worker.onerror = () => { worker.terminate(); if (rafId) cancelAnimationFrame(rafId); setCsvParsing(false); setParseProgress({ current: 0, total: 0, active: false }); toast.error("Error al procesar el CSV"); };
      // Transfer the ArrayBuffer (zero-copy) instead of copying a string
      worker.postMessage(buffer, [buffer]);
    };
    reader.readAsArrayBuffer(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const confirmCsvImport = async () => {
    if (!user) return;
    setCsvImporting(true);
    setShowCsvReview(false);
    const allRows = parsedRowsRef.current;
    // If user deselected some in the preview, filter them; for rows beyond preview, always include
    const selectedRows = allRows.filter((_, i) => !csvDeselected.has(i));
    if (!selectedRows.length) { toast.info("No se seleccionaron leads"); setCsvImporting(false); return; }


    setImportProgress({ current: 0, total: selectedRows.length, active: true });

    try {
      const BATCH_SIZE = 2000;
      let imported = 0;
      // Yield to main thread between batches so UI stays responsive
      const yieldToMain = () => new Promise<void>(r => setTimeout(r, 0));

      for (let i = 0; i < selectedRows.length; i += BATCH_SIZE) {
        const batch = selectedRows.slice(i, i + BATCH_SIZE).map(r => {
          const email = r.email.toLowerCase();
          const custom_fields: Record<string, string> = {};
          Object.entries(r).forEach(([key, value]) => {
            if (key !== "email" && value?.trim()) custom_fields[key] = value.trim();
          });
          return { user_id: user.id, email, custom_fields, list_id: activeList || null };
        });

        const { error } = await supabase.from("leads").insert(batch);
        if (error) { toast.error(error.message); break; }
        imported += batch.length;
        setImportProgress({ current: imported, total: selectedRows.length, active: true });
        // Give browser a chance to paint the progress update
        await yieldToMain();
      }

      const varNames = csvHeaders.filter(h => h !== "email");
      toast.success(`${imported} leads importados. Variables: ${varNames.map(v => `{{${v}}}`).join(", ")}`);
      setCsvRows([]);
      setCsvHeaders([]);
      parsedRowsRef.current = [];
      load();

      if (verifyAfterImport && imported > 0) {
        startVerification(activeList);
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    }
    setCsvImporting(false);
    setImportProgress({ current: 0, total: 0, active: false });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.rpc("bulk_delete_leads", { lead_ids: [id] });
    if (error) { toast.error(`Error: ${error.message}`); return; }
    toast.success("Lead eliminado");
    setSelectedLeads(prev => { const n = new Set(prev); n.delete(id); return n; });
    load();
  };

  const handleBulkMove = async () => {
    if (selectedLeads.size === 0) return;
    const listId = moveTargetList === "__none__" ? null : moveTargetList;
    await supabase.from("leads").update({ list_id: listId }).in("id", Array.from(selectedLeads));
    toast.success(`${selectedLeads.size} leads movidos`);
    setSelectedLeads(new Set());
    setShowMoveDialog(false);
    load();
  };

  const handleBulkDelete = async () => {
    if (selectedLeads.size === 0) return;
    const count = selectedLeads.size;
    const ids = Array.from(selectedLeads);

    // Batch in chunks of 100 for reliability
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase.rpc("bulk_delete_leads", { lead_ids: chunk });
      if (error) { toast.error(`Error eliminando: ${error.message}`); return; }
    }

    toast.success(`${count} leads eliminados`);
    setSelectedLeads(new Set());
    load();
  };

  const handleDeleteAll = async () => {
    if (totalCount === 0) return;
    if (!confirm(`¿Eliminar TODOS los ${totalCount} leads${activeList ? " de esta carpeta" : ""}? No se puede deshacer.`)) return;
    setDeleting(true);
    try {
      // Fetch ALL lead IDs in batches (no 1000 limit)
      let allIds: string[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        let query = supabase.from("leads").select("id").eq("user_id", user!.id);
        if (activeList) query = query.eq("list_id", activeList);
        const { data } = await query.range(from, from + batchSize - 1);
        if (!data?.length) break;
        allIds = [...allIds, ...data.map((d: any) => d.id)];
        if (data.length < batchSize) break;
        from += batchSize;
      }

      if (!allIds.length) { setDeleting(false); return; }

      // Delete in chunks of 100 via RPC
      for (let i = 0; i < allIds.length; i += 100) {
        const chunk = allIds.slice(i, i + 100);
        const { error } = await supabase.rpc("bulk_delete_leads", { lead_ids: chunk });
        if (error) { toast.error(`Error: ${error.message}`); setDeleting(false); return; }
      }
      toast.success(`${allIds.length} leads eliminados`);
      setSelectedLeads(new Set());
      setPage(0);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
    setDeleting(false);
  };

  const handleVerifyAllLeads = async () => {
    setShowVerify(false);
    await startVerification(activeList);
    // Reload leads after verification completes
    load();
  };

  const filtered = leads.filter(l => {
    if (!search) return true;
    return l.email.toLowerCase().includes(search.toLowerCase()) || JSON.stringify(l.custom_fields).toLowerCase().includes(search.toLowerCase());
  });

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const toggleSelectAll = () => {
    if (selectedLeads.size === filtered.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(filtered.map(l => l.id)));
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">Leads</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Gestiona tus contactos y carpetas</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer">
            <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} className="hidden" />
            <Button variant="outline" size="sm" className="gap-2" asChild><span><Upload className="h-4 w-4" /> <span className="hidden sm:inline">Importar</span> CSV</span></Button>
          </label>
          <Dialog open={showList} onOpenChange={setShowList}>
            <DialogTrigger asChild><Button variant="outline" size="sm" className="gap-2"><FolderPlus className="h-4 w-4" /> <span className="hidden sm:inline">Nueva</span> Carpeta</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Crear carpeta</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1"><Label>Nombre</Label><Input value={listName} onChange={e => setListName(e.target.value)} placeholder="SaaS Founders" /></div>
                <Button onClick={handleCreateList} className="w-full" disabled={!listName.trim()}>Crear</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild><Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Añadir</span> Lead</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Añadir lead</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1"><Label>Email *</Label><Input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="lead@company.com" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Nombre</Label><Input value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} placeholder="Juan" /></div>
                  <div className="space-y-1"><Label>Apellido</Label><Input value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} placeholder="García" /></div>
                </div>
                <div className="space-y-1"><Label>Empresa</Label><Input value={form.company} onChange={e => setForm({...form, company: e.target.value})} placeholder="Acme Corp" /></div>
                {lists.length > 0 && (
                  <div className="space-y-1">
                    <Label>Carpeta</Label>
                    <Select value={form.list_id} onValueChange={v => setForm({...form, list_id: v})}>
                      <SelectTrigger><SelectValue placeholder="Sin carpeta" /></SelectTrigger>
                      <SelectContent>
                        {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={handleAddLead} className="w-full" disabled={!form.email.trim()}>Añadir</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
            disabled={totalCount === 0 || verifying}
            onClick={openVerifyDialog}
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            <span className="hidden sm:inline">Verificar</span>
          </Button>
        </div>
      </div>

      {/* Floating progress banners - fixed at bottom so user can keep navigating */}
      {csvParsing && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md bg-background border rounded-xl shadow-lg p-4 space-y-2">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">
              Procesando CSV… {parseProgress.total > 0
                ? `${parseProgress.current.toLocaleString()} / ${parseProgress.total.toLocaleString()} filas`
                : "leyendo archivo"}
            </span>
          </div>
          {parseProgress.total > 0 && (
            <Progress value={(parseProgress.current / parseProgress.total) * 100} className="h-2" />
          )}
        </div>
      )}

      {/* Folders */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeList === null ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => { setActiveList(null); setPage(0); setSelectedLeads(new Set()); }}
        >
          <Users className="h-3.5 w-3.5" /> Todos ({totalCount})
        </Button>
        {lists.map((list) => {
          const count = list.leads?.[0]?.count || 0;
          const isActive = activeList === list.id;
          return (
            <div key={list.id} className="flex items-center gap-0.5">
              <Button
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => { setActiveList(list.id); setPage(0); setSelectedLeads(new Set()); }}
              >
                {isActive ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
                {list.name} ({count})
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteList(list.id)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Search + Bulk actions */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar leads..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {selectedLeads.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">{selectedLeads.size} sel.</span>
            <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { setMoveTargetList(""); setShowMoveDialog(true); }}>
              <ArrowRight className="h-3.5 w-3.5" /> Mover
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs text-destructive" onClick={async () => { setDeleting(true); await handleBulkDelete(); setDeleting(false); }} disabled={deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {deleting ? "..." : "Eliminar"}
            </Button>
          </div>
        )}
        {totalCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5 h-8 text-xs sm:ml-auto"
            onClick={handleDeleteAll}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Eliminar todos
          </Button>
        )}
      </div>

      {/* Move Dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mover {selectedLeads.size} leads</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={moveTargetList} onValueChange={setMoveTargetList}>
              <SelectTrigger><SelectValue placeholder="Selecciona carpeta destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin carpeta</SelectItem>
                {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={handleBulkMove} className="w-full" disabled={!moveTargetList}>Mover</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Review Dialog */}
      <Dialog open={showCsvReview} onOpenChange={(o) => { setShowCsvReview(o); if (!o) { setCsvRows([]); setCsvHeaders([]); parsedRowsRef.current = []; } }}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Revisar CSV — {parsedRowsRef.current.length.toLocaleString()} leads encontrados</DialogTitle>
          </DialogHeader>
          {parsedRowsRef.current.length > 500 && (
            <p className="text-xs text-muted-foreground">Mostrando vista previa de los primeros 500 leads. Los {parsedRowsRef.current.length.toLocaleString()} leads se importarán completos.</p>
          )}
          <div className="flex items-center gap-3 text-sm">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCsvDeselected(new Set())}>
              Seleccionar todos
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCsvDeselected(new Set(parsedRowsRef.current.map((_, i) => i)))}>
              Deseleccionar todos
            </Button>
            <span className="text-muted-foreground ml-auto">{(parsedRowsRef.current.length - csvDeselected.size).toLocaleString()} / {parsedRowsRef.current.length.toLocaleString()} seleccionados</span>
          </div>
          <ScrollArea className="max-h-[50vh] rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 w-10"></th>
                  {csvHeaders.map(h => (
                    <th key={h} className="text-left p-2 font-medium text-xs capitalize whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvRows.slice(csvPage * CSV_PAGE_SIZE, (csvPage + 1) * CSV_PAGE_SIZE).map((row, idx) => {
                  const i = csvPage * CSV_PAGE_SIZE + idx;
                  return (
                    <tr key={i} className={`border-t hover:bg-muted/20 ${!csvDeselected.has(i) ? "" : "opacity-40"}`}>
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
                      {csvHeaders.map(h => (
                        <td key={h} className="p-2 text-muted-foreground truncate max-w-[180px]">{row[h] || "—"}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
          {csvRows.length > CSV_PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Button variant="outline" size="sm" className="h-6 text-xs" disabled={csvPage === 0} onClick={() => setCsvPage(p => p - 1)}>Ant.</Button>
              <span>{csvPage * CSV_PAGE_SIZE + 1}–{Math.min((csvPage + 1) * CSV_PAGE_SIZE, csvRows.length)} de {csvRows.length}</span>
              <Button variant="outline" size="sm" className="h-6 text-xs" disabled={(csvPage + 1) * CSV_PAGE_SIZE >= csvRows.length} onClick={() => setCsvPage(p => p + 1)}>Sig.</Button>
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={verifyAfterImport} onCheckedChange={(v) => setVerifyAfterImport(!!v)} />
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Verificar al importar (gratis)
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowCsvReview(false); setCsvRows([]); setCsvHeaders([]); parsedRowsRef.current = []; }}>
                Cancelar
              </Button>
              <Button onClick={confirmCsvImport} disabled={(parsedRowsRef.current.length - csvDeselected.size) === 0 || csvImporting} className="gap-2">
                {csvImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Importar {(parsedRowsRef.current.length - csvDeselected.size).toLocaleString()} leads
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Verify Dialog */}
      <Dialog open={showVerify} onOpenChange={setShowVerify}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" /> Verificar Leads</DialogTitle>
            <DialogDescription>
              Selecciona cuántos leads pendientes quieres verificar ahora.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {loadingUnverifiedCount ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : unverifiedTotalCount === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Todos los leads ya están verificados.</p>
            ) : (
                <>
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Leads pendientes en esta lista</span>
                      <span className="font-semibold tabular-nums">{unverifiedTotalCount}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Se verificarán</span>
                      <span className="font-semibold">Todos</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Coste</span>
                      <span className="font-semibold text-emerald-600">Gratis</span>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Se procesarán absolutamente todos los leads pendientes de la lista actual y los no contactables se eliminarán automáticamente.
                  </p>
                  <Button
                    className="w-full gap-2"
                    disabled={unverifiedTotalCount === 0}
                    onClick={handleVerifyAllLeads}
                  >
                    <ShieldCheck className="h-4 w-4" /> Verificar los {unverifiedTotalCount} leads pendientes
                  </Button>
                </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Progress - floating banner */}
      {importProgress.active && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[90vw] max-w-md bg-background border rounded-xl shadow-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Importando leads...</span>
            <span className="font-medium">{importProgress.current.toLocaleString()} / {importProgress.total.toLocaleString()}</span>
          </div>
          <Progress value={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0} className="h-2" />
        </div>
      )}

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

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display font-semibold mb-2">{search ? "Sin resultados" : "No tienes leads"}</h3>
            <p className="text-sm text-muted-foreground">{search ? "Prueba con otra búsqueda" : "Importa leads desde un CSV o añádelos manualmente."}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {(() => {
                // Extract all unique custom_field keys across visible leads
                const allKeys = new Set<string>();
                filtered.forEach(l => {
                  Object.keys(l.custom_fields || {}).forEach(k => allKeys.add(k));
                });
                const fieldCols = Array.from(allKeys);

                return (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 w-10">
                          <Checkbox
                            checked={selectedLeads.size === filtered.length && filtered.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground w-10">#</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</th>
                        {fieldCols.map(col => (
                          <th key={col} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                            {col.replace(/_/g, " ")}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Verificación</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Carpeta</th>
                        <th className="px-4 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((lead, idx) => (
                        <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <Checkbox
                              checked={selectedLeads.has(lead.id)}
                              onCheckedChange={(v) => {
                                setSelectedLeads(prev => {
                                  const next = new Set(prev);
                                  v ? next.add(lead.id) : next.delete(lead.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{page * PAGE_SIZE + idx + 1}</td>
                          <td className="px-4 py-3 text-sm font-medium">{lead.email}</td>
                          {fieldCols.map(col => (
                            <td key={col} className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[200px]">
                              {(lead.custom_fields || {})[col] || "—"}
                            </td>
                          ))}
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              lead.status === "replied" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                              lead.status === "contacted" ? "bg-primary/10 text-primary" :
                              lead.status === "bounced" ? "bg-destructive/10 text-destructive" :
                              "bg-muted text-muted-foreground"
                            }`}>{lead.status}</span>
                          </td>
                          <td className="px-4 py-3">
                            {lead.verification_status === "valid" ? (
                              <Badge variant="outline" className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-300">Verificado</Badge>
                            ) : lead.verification_status === "risky" ? (
                              <Badge variant="outline" className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-300">Arriesgado</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Sin verificar</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">{lead.lead_lists?.name || "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(lead.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount} leads
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage(p => p - 1); setSelectedLeads(new Set()); }}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => { setPage(p => p + 1); setSelectedLeads(new Set()); }}>
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}