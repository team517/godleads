import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, UploadCloud, Sparkles, Download, Send, Loader2, FileText, Wand2, Check, ServerCog, BookMarked, Trash2, Save, Play, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Row = Record<string, string> & { __idx: number };
type Result = { message: string; error?: string };
type ResultsMap = Record<string, Result>;
type SavedPrompt = { id: string; name: string; prompt: string };

const PROMPTS_KEY = "op_personalization_prompts";
function loadSavedPrompts(): SavedPrompt[] {
  try { const v = JSON.parse(localStorage.getItem(PROMPTS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function persistPrompts(list: SavedPrompt[]) {
  try { localStorage.setItem(PROMPTS_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* quota */ }
}

/** Flatten an HTML/multiline message into one CSV-safe cell (no raw newlines that
 *  would break Instantly/Smartlead importers). */
function flattenCell(s: string): string {
  return (s || "").replace(/>\s+</g, "><").replace(/\r?\n+/g, " ").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Find the email column: first by header name (es/en/fr), else by SCANNING VALUES for
 *  @-addresses — so a CSV whose email header is named oddly still works automatically. */
function detectEmailColumn(cols: string[], rows: Array<Record<string, any>>): string {
  const byName = cols.find((c) => /e-?mail|correo|courriel|\bmail\b|adresse/i.test(c));
  if (byName) return byName;
  let best = "", bestHits = 0;
  const sample = rows.slice(0, 60);
  for (const c of cols) {
    let hits = 0;
    for (const r of sample) if (EMAIL_RE.test(String(r[c] ?? "").trim().toLowerCase())) hits++;
    if (hits > bestHits) { bestHits = hits; best = c; }
  }
  // Only trust content-detection if a good share of sampled rows look like emails.
  return bestHits >= Math.max(1, Math.floor(sample.length * 0.3)) ? best : "";
}

/* Ejemplo de archivo: lo que se ve en pantalla y lo que se descarga son LO MISMO. */
const SAMPLE_ROWS: string[][] = [
  ["Ana Gómez", "Acme", "CEO", "Tecnología", "ana@acme.com", "Madrid"],
  ["Carlos Ruiz", "Globex", "Director comercial", "SaaS", "carlos@globex.com", "Barcelona"],
  ["Lucía Fernández", "NovaTech", "Marketing", "Software", "lucia@novatech.com", "Valencia"],
];
const SAMPLE_HEADERS = ["nombre", "empresa", "cargo", "sector", "email", "ciudad"];

function downloadSampleCsv() {
  const csv = [SAMPLE_HEADERS.join(","), ...SAMPLE_ROWS.map((r) => r.join(","))].join("\n");
  // El BOM hace que Excel abra el archivo con los acentos bien.
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-onepulso.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Personalizacion() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [emailColumn, setEmailColumn] = useState<string>("");

  const [prompt, setPrompt] = useState(
    "Escribe la primera línea personalizada de un cold email para {first_name} de {company_name}. " +
    "Menciona algo concreto de su empresa. Máximo 2 frases, natural y directo. Solo la línea, sin saludo.",
  );
  const [provider, setProvider] = useState<"deepseek" | "claude">("deepseek");

  // Saved prompt library (stored in the browser).
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(() => loadSavedPrompts());
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string>("");

  // Server-side job — keeps running even if the tab/PC is closed.
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>(""); // pending | running | completed | error | cancelled
  const [prog, setProg] = useState({ done: 0, ok: 0, failed: 0, total: 0 });
  const [results, setResults] = useState<ResultsMap>({});
  const [starting, setStarting] = useState(false);

  const running = jobStatus === "pending" || jobStatus === "running";
  const okCount = prog.ok || Object.values(results).filter((r) => r.message && !r.error).length;

  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string; leadCount: number }[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [sending, setSending] = useState(false);

  const emailCandidates = useMemo(() => columns.filter((c) => /e-?mail|correo/i.test(c)), [columns]);
  const progressPct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  // Distinct valid emails in the uploaded CSV — the real "cuántos emails hay". Also
  // surfaces duplicates / rows sin email so nothing is silently double-imported/-sent.
  const emailStats = useMemo(() => {
    if (!emailColumn) return { valid: 0, dupes: 0, invalid: 0 };
    const seen = new Set<string>();
    let dupes = 0, invalid = 0;
    for (const r of rows) {
      const e = (r[emailColumn] || "").toString().toLowerCase().trim();
      if (!e || !EMAIL_RE.test(e)) { invalid++; continue; }
      if (seen.has(e)) { dupes++; continue; }
      seen.add(e);
    }
    return { valid: seen.size, dupes, invalid };
  }, [rows, emailColumn]);

  // Leads that will ACTUALLY be added to a campaign: distinct valid email + a message
  // generated OK (no error). This is the number shown/added — deduped, so no double-send.
  const sendableCount = useMemo(() => {
    if (!emailColumn) return 0;
    const seen = new Set<string>();
    for (const r of rows) {
      const e = (r[emailColumn] || "").toString().toLowerCase().trim();
      if (!e || !EMAIL_RE.test(e) || seen.has(e)) continue;
      const rr = results[String(r.__idx)];
      if (rr?.message && !rr.error) seen.add(e);
    }
    return seen.size;
  }, [rows, emailColumn, results]);

  const authToken = async () => (await supabase.auth.getSession()).data.session?.access_token;

  const kickProcessor = async () => {
    const token = await authToken();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-personalization`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}",
    }).catch(() => {});
  };

  // ── Restore the latest job on mount (so a job finished/running with the PC off is here) ──
  // Two-step so the progress shows INSTANTLY even with 10k rows: first a light query
  // (just the counters — no heavy rows/results JSON), then load rows/results after.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      // 1) Light: id + config + progress counters. Renders the progress banner at once.
      const { data: light } = await (supabase as any)
        .from("personalization_csv_jobs")
        .select("id, filename, prompt, provider, email_column, columns, status, total, done, ok, failed")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!light || !alive) return;
      const d = light as any;
      setJobId(d.id);
      setFilename(d.filename || "");
      setPrompt(d.prompt || "");
      setProvider(d.provider === "claude" ? "claude" : "deepseek");
      setEmailColumn(d.email_column || "");
      setColumns(Array.isArray(d.columns) ? d.columns : []);
      setJobStatus(d.status || "");
      setProg({ done: d.done || 0, ok: d.ok || 0, failed: d.failed || 0, total: d.total || 0 });
      // 2) Heavy: rows + results (for the download / send-to-campaign). Loaded after so the
      // multi-MB payload never blocks the progress from appearing.
      const { data: heavy } = await (supabase as any)
        .from("personalization_csv_jobs")
        .select("rows, results")
        .eq("id", d.id)
        .maybeSingle();
      if (!heavy || !alive) return;
      setRows(Array.isArray((heavy as any).rows) ? (heavy as any).rows : []);
      setResults((heavy as any).results || {});
    })();
    return () => { alive = false; };
  }, [user]);

  // ── Poll the running job for progress; nudge the processor so it doesn't wait for the cron ──
  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === "completed" || jobStatus === "error" || jobStatus === "cancelled") return;
    let alive = true;
    let timer: any;
    const tick = async () => {
      const { data } = await (supabase as any)
        .from("personalization_csv_jobs")
        .select("status, done, ok, failed, total")
        .eq("id", jobId).maybeSingle();
      if (!alive || !data) return;
      const d = data as any;
      setJobStatus(d.status);
      setProg({ done: d.done || 0, ok: d.ok || 0, failed: d.failed || 0, total: d.total || 0 });
      if (d.status === "completed" || d.status === "error") {
        const { data: full } = await (supabase as any).from("personalization_csv_jobs").select("results").eq("id", jobId).maybeSingle();
        if (full && alive) setResults((full as any).results || {});
        return;
      }
      kickProcessor();
      if (alive) timer = setTimeout(tick, 3500);
    };
    kickProcessor();
    timer = setTimeout(tick, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId, jobStatus]);

  const handleFile = (file: File) => {
    if (!file) return;
    setFilename(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim(),
      complete: (res) => {
        const cols = (res.meta.fields || []).filter(Boolean);
        const data = (res.data || []).map((r, i) => ({ ...r, __idx: i } as Row))
          .filter((r) => cols.some((c) => (r[c] || "").toString().trim()));
        const detected = detectEmailColumn(cols, data);
        setColumns(cols); setRows(data);
        setResults({}); setPreview(""); setJobId(null); setJobStatus(""); setProg({ done: 0, ok: 0, failed: 0, total: 0 });
        setEmailColumn(detected);
        // Count DISTINCT valid emails right away so the user sees the real number.
        let emails = 0, dupes = 0;
        if (detected) {
          const seen = new Set<string>();
          for (const r of data) {
            const e = (r[detected] || "").toString().toLowerCase().trim();
            if (!e || !EMAIL_RE.test(e)) continue;
            if (seen.has(e)) { dupes++; continue; }
            seen.add(e);
          }
          emails = seen.size;
        }
        toast.success(`${data.length} filas · ${emails} emails válidos${dupes ? ` · ${dupes} duplicados` : ""} · ${cols.length} columnas`);
      },
      error: (err) => toast.error(`No se pudo leer el CSV: ${err.message}`),
    });
  };

  const handlePreview = async () => {
    if (!rows.length) { toast.error("Sube un CSV primero"); return; }
    if (!prompt.trim()) { toast.error("Escribe un prompt"); return; }
    setPreviewing(true); setPreview("");
    try {
      const token = await authToken();
      const { __idx, ...data } = rows[0];
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/personalize-batch`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt, provider, rows: [{ index: __idx, data }] }),
      });
      if (resp.status === 404) throw new Error("La función 'personalize-batch' aún no está desplegada en el servidor.");
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
      const r = json.results?.[0];
      if (r?.error) toast.error(`Error de la IA: ${r.error}`);
      setPreview(r?.message || "");
    } catch (e: any) {
      const msg = /failed to fetch|networkerror|load failed/i.test(e?.message || "")
        ? "La función IA no está desplegada aún (personalize-batch). Despliégala para usar la personalización."
        : (e?.message || "Error en la preview");
      toast.error(msg);
    }
    setPreviewing(false);
  };

  const handleRun = async () => {
    if (!rows.length) { toast.error("Sube un CSV primero"); return; }
    if (!prompt.trim()) { toast.error("Escribe un prompt"); return; }
    if (!user) return;
    setStarting(true);
    // Fresh job every run (regenerate = new job).
    const { data, error } = await (supabase as any).from("personalization_csv_jobs").insert({
      user_id: user.id, filename, prompt, provider, email_column: emailColumn,
      columns, rows, results: {}, status: "pending", total: rows.length, done: 0, ok: 0, failed: 0,
    }).select("id").single();
    setStarting(false);
    if (error || !data) { toast.error(`No se pudo iniciar: ${error?.message}`); return; }
    setResults({});
    setProg({ done: 0, ok: 0, failed: 0, total: rows.length });
    setJobStatus("pending");
    setJobId((data as any).id);
    toast.success("Generando en el servidor — puedes cerrar la página, sigue solo.");
  };

  const handleStop = async () => {
    if (!jobId) return;
    // Flip local status FIRST so the poll effect stops kicking the processor immediately,
    // then persist "cancelled". The server now honours it (won't rewrite "running"), so a
    // refresh reads "cancelled" and does not resume.
    setJobStatus("cancelled");
    await (supabase as any).from("personalization_csv_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", jobId);
    const { data } = await (supabase as any).from("personalization_csv_jobs").select("results, done, ok, failed, total").eq("id", jobId).maybeSingle();
    if (data) {
      const d = data as any;
      setResults(d.results || {});
      setProg({ done: d.done || 0, ok: d.ok || 0, failed: d.failed || 0, total: d.total || 0 });
    }
    toast.success("Parado. Puedes descargar/enviar lo generado hasta ahora.");
  };

  // Descartar el banner: borra el trabajo de la BD (para que no vuelva al refrescar) y
  // limpia el estado del trabajo. Deja el CSV cargado por si quieres volver a generar.
  const dismissJob = async () => {
    const id = jobId;
    setJobId(null); setJobStatus(""); setResults({}); setProg({ done: 0, ok: 0, failed: 0, total: 0 });
    if (id) await (supabase as any).from("personalization_csv_jobs").delete().eq("id", id);
    toast.success("Generación descartada");
  };

  // Reanudar un trabajo parado: lo devuelve a "pending" para que el procesador lo retome
  // y CONTINÚE donde se quedó (solo genera las filas que faltan, no repite lo ya hecho).
  const resumeJob = async () => {
    if (!jobId) return;
    setJobStatus("pending"); // reactiva el sondeo + el kick al procesador
    await (supabase as any).from("personalization_csv_jobs").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", jobId);
    kickProcessor();
    toast.success("Reanudando generación en el servidor — sigue donde se quedó.");
  };

  const ensureResults = async (): Promise<ResultsMap> => {
    if (Object.keys(results).length) return results;
    if (!jobId) return {};
    const { data } = await (supabase as any).from("personalization_csv_jobs").select("results").eq("id", jobId).maybeSingle();
    const r = ((data as any)?.results || {}) as ResultsMap;
    setResults(r);
    return r;
  };

  const downloadCsv = async () => {
    if (!rows.length) return;
    const res = await ensureResults();
    const out = rows.map((r) => {
      const { __idx, ...orig } = r;
      const rr = res[String(__idx)];
      return { ...orig, personalized_message: rr?.error ? `[ERROR] ${rr.error}` : flattenCell(rr?.message || "") };
    });
    const csv = Papa.unparse(out);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (filename.replace(/\.csv$/i, "") || "leads") + "_personalizado.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const openSend = async () => {
    if (okCount === 0) { toast.error("Genera los mensajes primero"); return; }
    if (!user) return;
    // Auto-detect the email column if it wasn't set/detected, so the user rarely hits an error.
    const col = emailColumn || detectEmailColumn(columns, rows);
    if (!col) { toast.error("No encuentro la columna de email. Elígela arriba (paso 1) en el desplegable."); return; }
    if (col !== emailColumn) setEmailColumn(col);
    await ensureResults(); // load results into state so sendableCount is exact in the dialog
    const { data } = await supabase.from("campaigns").select("id, name, status").eq("user_id", user.id).order("created_at", { ascending: false });
    const list = (data || []) as { id: string; name: string; status: string }[];
    // Count the leads each campaign ALREADY has, so you see it before/after adding.
    const withCounts = await Promise.all(list.map(async (c) => {
      const { count } = await supabase.from("campaign_leads").select("lead_id", { count: "exact", head: true }).eq("campaign_id", c.id);
      return { ...c, leadCount: count || 0 };
    }));
    setCampaigns(withCounts); setSelectedCampaignId(""); setSendOpen(true);
  };

  const sendToCampaign = async () => {
    if (!user || !selectedCampaignId) return;
    setSending(true);
    try {
      const res = await ensureResults();
      const col = emailColumn || detectEmailColumn(columns, rows);
      if (!col) { toast.error("No encuentro la columna de email. Elígela en el paso 1."); setSending(false); return; }
      // Dedupe by email so the same address isn't added as two leads (→ emailed twice).
      const seenEmails = new Set<string>();
      let skippedDupes = 0;
      const usable = rows.filter((r) => {
        const email = (r[col] || "").toLowerCase().trim();
        const rr = res[String(r.__idx)];
        if (!(email && EMAIL_RE.test(email) && rr?.message && !rr.error)) return false;
        if (seenEmails.has(email)) { skippedDupes++; return false; }
        seenEmails.add(email);
        return true;
      });
      if (!usable.length) {
        // Say EXACTLY what's missing so "falla lo del email" is never a mystery.
        const withEmail = rows.filter((r) => EMAIL_RE.test((r[col] || "").toLowerCase().trim())).length;
        const withMsg = rows.filter((r) => { const rr = res[String(r.__idx)]; return rr?.message && !rr.error; }).length;
        toast.error(
          withEmail === 0 ? `Ninguna fila tiene un email válido en la columna "${col}". Elige la columna correcta en el paso 1.`
          : withMsg === 0 ? "Aún no hay mensajes generados. Pulsa 'Generar todo' primero."
          : "No hay filas que tengan email válido y mensaje a la vez.",
        );
        setSending(false); return;
      }
      let added = 0, lastError = "";
      const INSERT_BATCH = 300;
      for (let i = 0; i < usable.length; i += INSERT_BATCH) {
        const slice = usable.slice(i, i + INSERT_BATCH);
        const batch = slice.map((r) => {
          const custom_fields: Record<string, string> = {};
          columns.forEach((c) => {
            if (c === col) return;
            const v = (r[c] || "").toString().trim();
            if (v) custom_fields[c] = v;
          });
          custom_fields.personalized_message = res[String(r.__idx)].message;
          return { user_id: user.id, email: (r[col] || "").toLowerCase().trim(), custom_fields, is_campaign_only: true };
        });
        const { data, error } = await supabase.from("leads").insert(batch).select("id");
        let ids: string[] = [];
        if (error) {
          // Batch failed (one bad row rejects the whole batch) → retry row-by-row so the
          // good ones still get in, and remember the reason in case ALL fail.
          lastError = error.message;
          for (const row of batch) {
            const { data: one, error: e1 } = await supabase.from("leads").insert(row).select("id").maybeSingle();
            if (one) ids.push((one as any).id); else if (e1) lastError = e1.message;
          }
        } else ids = (data || []).map((d: any) => d.id);
        if (ids.length) {
          const { error: linkErr } = await supabase.from("campaign_leads").upsert(ids.map((id) => ({ campaign_id: selectedCampaignId, lead_id: id })), { onConflict: "campaign_id,lead_id", ignoreDuplicates: true });
          if (linkErr) lastError = linkErr.message; else added += ids.length;
        }
      }
      if (added === 0) { toast.error(`No se pudo añadir ningún lead${lastError ? `: ${lastError}` : "."}`); setSending(false); return; }
      toast.success(`${added} leads añadidos a la campaña con su mensaje personalizado${skippedDupes ? ` · ${skippedDupes} duplicados omitidos` : ""}`);
      setSendOpen(false);
    } catch (e: any) { toast.error(`Error: ${e.message}`); }
    setSending(false);
  };

  const insertPlaceholder = (col: string) => setPrompt((p) => `${p}{${col}}`);

  const saveCurrentPrompt = () => {
    const name = newPromptName.trim();
    if (!name) { toast.error("Ponle un nombre al prompt"); return; }
    if (!prompt.trim()) { toast.error("El prompt está vacío"); return; }
    const item: SavedPrompt = { id: `${Date.now()}`, name, prompt };
    const next = [item, ...savedPrompts.filter((p) => p.name.toLowerCase() !== name.toLowerCase())].slice(0, 50);
    setSavedPrompts(next); persistPrompts(next); setNewPromptName("");
    toast.success(`Prompt "${name}" guardado`);
  };
  const applyPrompt = (p: SavedPrompt) => { setPrompt(p.prompt); setPromptsOpen(false); toast.success(`Cargado "${p.name}"`); };
  const deletePrompt = (id: string) => { const next = savedPrompts.filter((p) => p.id !== id); setSavedPrompts(next); persistPrompts(next); };

  // En qué paso va: sirve para la barra de progreso de arriba.
  const currentStep = rows.length === 0 ? 1 : (running ? 3 : jobStatus === "completed" ? 4 : prog.total > 0 ? 3 : 2);
  const STEPS = [
    { n: 1, title: "Sube tu CSV", sub: "Importa tu lista de leads" },
    { n: 2, title: "Configura el prompt", sub: "Usa {columnas}" },
    { n: 3, title: "Genera con IA", sub: "Revisa y ajusta" },
    { n: 4, title: "Listo", sub: "Descarga o usa en campaña" },
  ];

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[clamp(27px,3vw,34px)] font-semibold leading-[1.1] tracking-[-1.2px] text-[#090b45] dark:text-foreground">Personalización con IA</h1>
        <p className="mt-2 max-w-[640px] text-[15px] leading-[1.5] text-[#6876ad] dark:text-muted-foreground">
          Sube un CSV, escribe un prompt con {"{columnas}"} y la IA genera un mensaje por lead.<br className="hidden sm:block" />
          Corre en el servidor: puedes cerrar el PC.
        </p>
      </div>

      {/* Los cuatro pasos, para saber siempre por dónde vas. */}
      <div className="soft-panel grid gap-4 px-6 py-4 sm:grid-cols-4">
        {STEPS.map((st, i) => (
          <div key={st.n} className="relative text-center">
            {i < STEPS.length - 1 && <span aria-hidden className="soft-step-line absolute left-[57%] top-[14px] hidden w-[86%] sm:block" />}
            <span className={`soft-step-num relative z-[2] mx-auto mb-2 ${currentStep === st.n ? "soft-step-on" : ""}`}>{st.n}</span>
            <span className="block text-[13px] font-semibold text-[#16215a] dark:text-foreground">{st.title}</span>
            <span className="block text-[12px] text-[#7682af] dark:text-muted-foreground">{st.sub}</span>
          </div>
        ))}
      </div>

      {/* Prominent progress banner — appears the moment you enter while a job is generating,
          so you always see how many messages llevan sin buscar nada. */}
      {(running || (jobId && prog.total > 0)) && (
        <Card className={`border-2 ${running ? "border-primary/40 bg-primary/5" : jobStatus === "completed" ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
          <CardContent className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {running ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : jobStatus === "completed" ? <Check className="h-4 w-4 text-success" /> : <ServerCog className="h-4 w-4 text-warning" />}
                {running ? "Generando mensajes en el servidor…" : jobStatus === "completed" ? "Generación completada" : jobStatus === "cancelled" ? "Generación parada" : "Generación"}
                {filename && <span className="font-normal text-muted-foreground">· {filename}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-bold tabular-nums">{prog.done}/{prog.total} · {progressPct}%</span>
                {!running && prog.total > 0 && prog.done < prog.total && (
                  <button
                    type="button"
                    onClick={resumeJob}
                    title="Reanudar donde se quedó"
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Play className="h-3.5 w-3.5" /> Reanudar
                  </button>
                )}
                {!running && (
                  <button
                    type="button"
                    onClick={dismissJob}
                    title="Descartar y borrar"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-semibold text-success">✓ {prog.ok} generados</span>
              {prog.failed > 0 && <span className="text-destructive font-medium">✗ {prog.failed} fallidos</span>}
              {running && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" /> puedes cerrar el PC, sigue solo</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Paso 1 — el archivo, y al lado cómo funciona todo esto */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_.95fr]">
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex items-center gap-3.5">
            <span className="soft-card-icon"><Upload className="h-5 w-5" /></span>
            <span>
              <span className="block font-display text-[17px] font-semibold text-foreground">1. Sube tu CSV de leads</span>
              <span className="block text-[12.5px] text-muted-foreground">El archivo debe contener las columnas que usarás en tu mensaje.</span>
            </span>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
            className={`soft-drop p-6 ${dragOver ? "soft-drop-over" : ""}`}
          >
            <span className="soft-drop-icon mb-3.5"><UploadCloud className="h-8 w-8" strokeWidth={1.7} /></span>
            <span className="block font-display text-[16px] font-semibold text-foreground">
              {filename || "Arrastra tu archivo aquí"}
            </span>
            <span className="mt-1 block text-[13px] text-muted-foreground">
              {filename
                ? `${rows.length} filas · ${emailStats.valid} emails válidos · ${columns.length} columnas`
                : "o haz clic para seleccionar"}
            </span>
            <span className="mt-3 block text-[12.5px] leading-[1.6] text-muted-foreground">
              Formato admitido: CSV<br />Tamaño máximo: 10 MB
            </span>
            <span className="soft-primary mt-4 inline-flex items-center gap-2 !h-11 !rounded-[9px] !px-7 !text-[14px]">
              <Upload className="h-4 w-4" /> {filename ? "Cambiar CSV" : "Elegir CSV"}
            </span>
          </div>

          {filename && (emailStats.dupes > 0 || emailStats.invalid > 0) && (
            <p className="text-[12.5px] text-muted-foreground">
              {emailStats.dupes > 0 ? <span className="text-warning">{emailStats.dupes} duplicados</span> : null}
              {emailStats.dupes > 0 && emailStats.invalid > 0 ? " · " : null}
              {emailStats.invalid > 0 ? <span className="text-destructive">{emailStats.invalid} sin email</span> : null}
            </p>
          )}

          {/* Columnas detectadas */}
          <div className="flex items-center gap-4 rounded-[11px] border border-border bg-[linear-gradient(90deg,#fafbff,#fdfcff)] p-4 dark:bg-muted/20">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e9f1ff] text-[#4977ff] dark:bg-primary/15 dark:text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-foreground">Columnas detectadas</span>
              {columns.length === 0
                ? <span className="block text-[12px] text-muted-foreground">Aquí aparecerán las columnas de tu archivo una vez lo subas.</span>
                : (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {columns.map((c) => (
                      <span key={c} className="rounded-[6px] bg-[#f1edff] px-2 py-1 text-[11px] font-medium text-[#6843f5] dark:bg-primary/15 dark:text-primary">{c}</span>
                    ))}
                  </span>
                )}
            </span>
          </div>
          {columns.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Columna de email (para enviar a campaña)</Label>
              <Select value={emailColumn} onValueChange={setEmailColumn}>
                <SelectTrigger className="h-9 w-full sm:w-72 text-sm"><SelectValue placeholder="Elige la columna de email" /></SelectTrigger>
                <SelectContent>{columns.map((c) => <SelectItem key={c} value={c}>{c}{emailCandidates.includes(c) ? "  ✉️" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cómo funciona */}
      <Card className="bg-[radial-gradient(circle_at_90%_0,rgba(87,203,255,.12),transparent_35%),radial-gradient(circle_at_20%_90%,rgba(179,64,255,.08),transparent_40%),rgba(255,255,255,.83)] dark:bg-card/80">
        <CardContent className="p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3.5">
            <span className="soft-card-icon"><Sparkles className="h-5 w-5" /></span>
            <span className="font-display text-[17px] font-semibold text-foreground">¿Cómo funciona?</span>
          </div>
          {[
            { Icon: Upload, t: "1. Sube tu lista", d: "Importa un archivo CSV con tus leads." },
            { Icon: Pencil, t: "2. Escribe un prompt", d: "Usa {columnas} para personalizar el mensaje." },
            { Icon: Sparkles, t: "3. La IA genera mensajes", d: "Se genera un mensaje único por cada lead." },
            { Icon: Download, t: "4. Descarga o usa en campaña", d: "Exporta el resultado o mándalo a una campaña." },
          ].map(({ Icon, t, d }) => (
            <div key={t} className="mb-4 flex gap-3.5">
              <span className="grid h-[43px] w-[43px] shrink-0 place-items-center rounded-[10px] bg-[linear-gradient(135deg,#f0ecff,#f6f4ff)] text-[#7444ff] dark:bg-primary/15 dark:text-primary">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <span>
                <span className="block text-[13px] font-semibold text-foreground">{t}</span>
                <span className="block text-[12.5px] leading-[1.5] text-muted-foreground">{d}</span>
              </span>
            </div>
          ))}
          <div className="soft-tip">
            <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[#fff4d9] text-[20px] dark:bg-amber-500/20">💡</span>
            <span>
              <span className="block text-[13px] font-semibold text-foreground">Consejo</span>
              <span className="block text-[12.5px] leading-[1.5] text-muted-foreground">
                Cuantas más columnas lleve el archivo (nombre, empresa, cargo, sector…), más personalizados salen los mensajes.
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Ejemplo de CSV */}
      {rows.length === 0 && (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <span className="soft-card-icon"><FileText className="h-5 w-5" /></span>
                <span>
                  <span className="block font-display text-[17px] font-semibold text-foreground">Ejemplo de CSV</span>
                  <span className="block text-[12.5px] text-muted-foreground">Tu archivo puede tener columnas como estas:</span>
                </span>
              </div>
              <button type="button" onClick={downloadSampleCsv} className="soft-control inline-flex h-10 items-center gap-2 px-4 text-[13px]">
                <Download className="h-4 w-4" /> Descargar plantilla
              </button>
            </div>
            <div className="overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full min-w-[720px] border-collapse text-[12px]">
                <thead>
                  <tr className="soft-thead">
                    {SAMPLE_HEADERS.map((h) => (
                      <th key={h} className="border-b border-border px-4 py-2.5 text-left font-medium text-[#4c5b8d] dark:text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-[#60709f] dark:text-muted-foreground">
                  {SAMPLE_ROWS.map((r) => (
                    <tr key={r[4]} className="soft-row">
                      {r.map((cell, i) => <td key={i} className="border-b border-border/70 px-4 py-2.5 last:border-r-0">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Prompt */}
      {columns.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="h-4 w-4 text-primary" /> 2 · Prompt de personalización</div>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setPromptsOpen(true)}>
                <BookMarked className="h-3.5 w-3.5" /> Prompts guardados{savedPrompts.length > 0 ? ` (${savedPrompts.length})` : ""}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <button key={c} type="button" onClick={() => insertPlaceholder(c)}
                  className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium hover:border-primary/50 hover:bg-primary/5">{`{${c}}`}</button>
              ))}
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[110px] text-sm leading-relaxed" placeholder="Escribe tu prompt con {columnas}…" />
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Motor IA</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as any)}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="deepseek">DeepSeek</SelectItem><SelectItem value="claude">Claude</SelectItem></SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={handlePreview} disabled={previewing}>
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Previsualizar 1 lead
              </Button>
            </div>
            {preview && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vista previa (lead 1)</p>
                <div className="text-sm text-foreground whitespace-pre-wrap break-words [&_p]:my-1" dangerouslySetInnerHTML={{ __html: preview }} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Generate (server-side) */}
      {columns.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><ServerCog className="h-4 w-4 text-primary" /> 3 · Generar en el servidor ({rows.length} leads)</div>
            {(running || prog.done > 0) && (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{prog.done}/{prog.total} ({progressPct}%)</span>
                  <span className="text-success">✓ {prog.ok}</span>
                  {prog.failed > 0 && <span className="text-destructive">✗ {prog.failed}</span>}
                  {running && <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="h-3 w-3 animate-spin" /> generando… (puedes cerrar el PC)</span>}
                  {jobStatus === "completed" && <span className="font-semibold text-success">✓ terminado</span>}
                  {jobStatus === "cancelled" && <span className="text-warning">parado</span>}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!running ? (
                <Button size="sm" className="gap-2" onClick={handleRun} disabled={!rows.length || starting}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {prog.done > 0 ? "Regenerar todo" : "Generar todo"}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-2" onClick={handleStop}><Loader2 className="h-4 w-4 animate-spin" /> Parar</Button>
              )}
              <Button size="sm" variant="outline" className="gap-2" onClick={downloadCsv} disabled={okCount === 0}><Download className="h-4 w-4" /> Descargar CSV</Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={openSend} disabled={okCount === 0}><Send className="h-4 w-4" /> Enviar a campaña</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Saved prompts dialog */}
      <Dialog open={promptsOpen} onOpenChange={setPromptsOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><BookMarked className="h-5 w-5 text-primary" /> Prompts guardados</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-2">
              <Label className="text-xs">Guardar el prompt actual</Label>
              <div className="flex gap-2">
                <Input value={newPromptName} onChange={(e) => setNewPromptName(e.target.value)} placeholder="Nombre (p.ej. Primera línea SaaS)" className="h-8 text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrentPrompt(); }} />
                <Button size="sm" className="h-8 gap-1.5 shrink-0" onClick={saveCurrentPrompt}><Save className="h-3.5 w-3.5" /> Guardar</Button>
              </div>
            </div>
            {savedPrompts.length === 0 ? (
              <p className="py-4 text-center text-[15px] text-muted-foreground">Aún no tienes prompts guardados.</p>
            ) : (
              <div className="space-y-2">
                {savedPrompts.map((p) => (
                  <div key={p.id} className="rounded-md border border-border/60 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[15px] font-medium truncate">{p.name}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => applyPrompt(p)}>Usar</Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive/70 hover:text-destructive" onClick={() => deletePrompt(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{p.prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send to campaign dialog */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Send className="h-5 w-5 text-primary" /> Enviar a una campaña</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-[15px] text-muted-foreground">Se crearán los leads con su <b>mensaje personalizado</b> como <code>personalized_message</code> y se añadirán a la campaña. Úsalo en el email con <code>{"{{personalized_message}}"}</code>.</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Campaña destino</Label>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige una campaña" /></SelectTrigger>
                <SelectContent>
                  {campaigns.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No tienes campañas. Crea una primero.</div>}
                  {campaigns.map((c) => <SelectItem key={c.id} value={c.id}><span className="flex items-center gap-2">{c.name} <Badge variant="secondary" className="text-[10px]">{c.leadCount} leads</Badge> <Badge variant="outline" className="text-[10px]">{c.status}</Badge></span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Se añadirán <b className="text-foreground">{sendableCount}</b> leads (email válido + mensaje, sin duplicados).
              {selectedCampaignId && (() => {
                const c = campaigns.find((x) => x.id === selectedCampaignId);
                return c ? <> Esta campaña tiene <b>{c.leadCount}</b> → quedará en <b className="text-foreground">{c.leadCount + sendableCount}</b>.</> : null;
              })()}
            </p>
            <Button className="w-full gap-2" onClick={sendToCampaign} disabled={sending || !selectedCampaignId}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Añadir a la campaña
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
