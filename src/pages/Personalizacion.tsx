import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, UploadCloud, Sparkles, Download, Send, Loader2, FileText, Wand2, Check, ServerCog, BookMarked, Trash2, Save, Play, Pencil, ListChecks, Square, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import PromptWizard from "@/components/personalizacion/PromptWizard";
import { crearTrabajo, leerResultados, leerTrabajo, reintentarFallidos } from "@/lib/personalization-store";
import { colorEtiqueta, columnasDe, csvPersonalizado, estadoTrabajo, etiquetasDe, hayActivas, limpiarEtiqueta, nombreDescarga, ordenarCola, pasaFiltroEtiqueta, puestoEnCola, type TrabajoCola } from "@/lib/personalization-queue";

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

/** Lo que necesita el diálogo "Enviar a campaña": los leads y mensajes de UNA lista concreta
 *  (la abierta en el editor o cualquiera de la cola), no el estado suelto de la página. */
type ContextoEnvio = { jobId: string | null; filename: string; columns: string[]; emailColumn: string; rows: Row[]; results: ResultsMap };

/** Descarga un texto como archivo (con BOM: Excel abre los acentos bien). */
function descargarTexto(nombre: string, texto: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff" + texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState("");
  // Etiqueta de la próxima lista ("Lucy"…). Se queda puesta para la siguiente, como el prompt.
  const [etiqueta, setEtiqueta] = useState("");
  // Filtro de la cola por etiqueta: null = todas.
  const [filtroEtiqueta, setFiltroEtiqueta] = useState<string | null>(null);
  // Fila de la cola cuya etiqueta se está editando, y lo escrito.
  const [editandoEtiqueta, setEditandoEtiqueta] = useState<{ id: string; valor: string } | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  /** Cola y registro: todas las listas de esta cuenta (en cola, generándose, terminadas), en vivo. */
  const [history, setHistory] = useState<TrabajoCola[]>([]);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [cargandoEnvio, setCargandoEnvio] = useState<string | null>(null);
  const [emailColumn, setEmailColumn] = useState<string>("");

  const [prompt, setPrompt] = useState(
    "Escribe la primera línea personalizada de un cold email para {first_name} de {company_name}. " +
    "Menciona algo concreto de su empresa. Máximo 2 frases, natural y directo. Solo la línea, sin saludo.",
  );
  const [provider, setProvider] = useState<"deepseek" | "claude">("deepseek");

  // Saved prompt library (stored in the browser).
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(() => loadSavedPrompts());
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string>("");

  // Server-side job — keeps running even if the tab/PC is closed.
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>(""); // pending | running | completed | error | cancelled
  const [prog, setProg] = useState({ done: 0, ok: 0, failed: 0, total: 0 });
  const [results, setResults] = useState<ResultsMap>({});
  const [starting, setStarting] = useState(false);
  // Subida de los leads al servidor, por tandas (un CSV grande no cabe en una sola petición).
  const [subida, setSubida] = useState<{ hechas: number; total: number } | null>(null);

  const running = jobStatus === "pending" || jobStatus === "running";
  const okCount = prog.ok || Object.values(results).filter((r) => r.message && !r.error).length;

  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string; leadCount: number }[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendCtx, setSendCtx] = useState<ContextoEnvio | null>(null);
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
    if (!sendCtx?.emailColumn) return 0;
    const seen = new Set<string>();
    for (const r of sendCtx.rows) {
      const e = (r[sendCtx.emailColumn] || "").toString().toLowerCase().trim();
      if (!e || !EMAIL_RE.test(e) || seen.has(e)) continue;
      const rr = sendCtx.results[String(r.__idx)];
      if (rr?.message && !rr.error) seen.add(e);
    }
    return seen.size;
  }, [sendCtx]);

  const authToken = async () => (await supabase.auth.getSession()).data.session?.access_token;

  const kickProcessor = async () => {
    const token = await authToken();
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-personalization`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}",
    }).catch(() => {});
  };

  // ── Al entrar: el último prompt usado, listo para la siguiente lista ──
  // Las listas (en marcha o terminadas) se ven en la cola de arriba, con su progreso y su
  // descarga; antes se abría la última en el editor, y con varias listas eso estorbaba para
  // subir la siguiente. Para ver una en el editor está el botón "Abrir" de la cola.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const { data: light } = await (supabase as any)
        .from("personalization_csv_jobs")
        .select("prompt, provider")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!light || !alive) return;
      const d = light as any;
      if (d.prompt) setPrompt(d.prompt);
      setProvider(d.provider === "claude" ? "claude" : "deepseek");
    })();
    return () => { alive = false; };
  }, [user]);

  // ── Cola de personalizaciones ───────────────────────────────────────────────────────
  // Cada "Generar todo" crea un trabajo en el servidor; aquí se ven TODOS (en cola, generándose,
  // terminados) con su progreso en vivo, y de cada uno se descarga su CSV o se manda a campaña.
  const loadHistory = useCallback(async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from("personalization_csv_jobs")
      .select("id, filename, status, total, done, ok, failed, created_at, updated_at, columns, email_column, label")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(40);
    setHistory(ordenarCola(Array.isArray(data) ? (data as TrabajoCola[]) : []));
  }, [user]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  // Cuando una generación cambia de estado, la cola se pone al día sola.
  useEffect(() => { if (jobStatus) void loadHistory(); }, [jobStatus, loadHistory]);

  const hayActivos = hayActivas(history);
  const activos = history.filter((h) => estadoTrabajo(h).activo);
  // Mientras haya listas en marcha: progreso en vivo y empujón al procesador (así no espera al
  // cron de cada minuto; el procesador lleva hasta 4 listas a la vez y el resto espera su turno).
  useEffect(() => {
    if (!hayActivos) return;
    let alive = true;
    const tick = async () => { kickProcessor(); if (alive) await loadHistory(); };
    kickProcessor();
    const timer = setInterval(() => { void tick(); }, 3500);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayActivos, loadHistory]);

  /** Vuelve a abrir una personalización del registro: su archivo, su prompt y sus mensajes. */
  const openHistoryJob = async (id: string) => {
    const { data: light } = await (supabase as any)
      .from("personalization_csv_jobs")
      .select("id, filename, prompt, provider, email_column, columns, status, total, done, ok, failed")
      .eq("id", id).maybeSingle();
    if (!light) { toast.error("Esa personalización ya no está"); return; }
    const d = light as any;
    setJobId(d.id);
    setFilename(d.filename || "");
    setPrompt(d.prompt || "");
    setProvider(d.provider === "claude" ? "claude" : "deepseek");
    setEmailColumn(d.email_column || "");
    setColumns(Array.isArray(d.columns) ? d.columns : []);
    setJobStatus(d.status || "");
    setProg({ done: d.done || 0, ok: d.ok || 0, failed: d.failed || 0, total: d.total || 0 });
    try {
      const heavy = await leerTrabajo(supabase, id);
      setRows(heavy.rows as Row[]);
      setResults(heavy.results);
    } catch (e: any) { toast.error(`No se pudieron cargar sus leads: ${e?.message || e}`); return; }
    toast.success(`Abierta: ${d.filename || "personalización"}`);
  };

  /** Guarda la etiqueta de una lista de la cola (vacía = la quita). */
  const guardarEtiqueta = async (id: string, valor: string) => {
    setEditandoEtiqueta(null);
    const label = limpiarEtiqueta(valor) || null;
    const antes = history.find((h) => h.id === id)?.label ?? null;
    if ((antes || null) === label) return;
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, label } : h)));
    const { error } = await (supabase as any).from("personalization_csv_jobs").update({ label }).eq("id", id);
    if (error) {
      setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, label: antes } : h)));
      toast.error(`No se pudo guardar la etiqueta: ${error.message}`);
      return;
    }
    toast.success(label ? `Etiqueta: ${label}` : "Etiqueta quitada");
  };

  const deleteHistoryJob = async (id: string) => {
    const ok = await confirm({
      title: "¿Borrar esta personalización del registro?",
      description: "Se borran sus mensajes generados. El CSV original lo tienes tú.",
      confirmText: "Borrar",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await (supabase as any).from("personalization_csv_jobs").delete().eq("id", id);
    // Sin comprobar el borrado se decía "Borrada" y la fila seguía ahí al recargar.
    if (error) { toast.error(`No se pudo borrar: ${error.message}`); return; }
    if (jobId === id) { setJobId(null); setResults({}); setProg({ done: 0, ok: 0, failed: 0, total: 0 }); setJobStatus(""); }
    void loadHistory();
    toast.success("Borrada del registro");
  };

  // ── Poll the running job for progress; nudge the processor so it doesn't wait for the cron ──
  useEffect(() => {
    if (!jobId) return;
    if (jobStatus === "completed" || jobStatus === "error" || jobStatus === "cancelled" || jobStatus === "uploading") return;
    let alive = true;
    let timer: any;
    let fails = 0;
    const tick = async () => {
      const { data, error } = await (supabase as any)
        .from("personalization_csv_jobs")
        .select("status, done, ok, failed, total")
        .eq("id", jobId).maybeSingle();
      if (!alive) return;
      // Un fallo suelto (red, token renovándose) dejaba la barra congelada para siempre: se
      // vuelve a intentar, y sólo se rinde tras 10 seguidos.
      if (error || !data) {
        fails++;
        if (fails >= 10) { toast.error("No se pudo seguir el progreso de la personalización"); return; }
        timer = setTimeout(tick, 3500);
        return;
      }
      fails = 0;
      const d = data as any;
      setJobStatus(d.status);
      setProg({ done: d.done || 0, ok: d.ok || 0, failed: d.failed || 0, total: d.total || 0 });
      if (d.status === "completed" || d.status === "error") {
        const full = await leerResultados(supabase, jobId).catch(() => null);
        if (full && alive) setResults(full);
        return;
      }
      if (alive) timer = setTimeout(tick, 3500);
    };
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
    // Fresh job every run (regenerate = new job). Los leads se suben por tandas: con miles de
    // filas, una sola petición de decenas de MB se cortaba ("Failed to fetch").
    try {
      await crearTrabajo(supabase,
        { user_id: user.id, filename, prompt, provider, email_column: emailColumn, columns, label: limpiarEtiqueta(etiqueta) || null },
        rows, (hechas, total) => setSubida({ hechas, total }));
    } catch (e: any) {
      setStarting(false); setSubida(null);
      toast.error(`No se pudo iniciar: ${e?.message || e}. Comprueba la conexión y vuelve a intentarlo.`);
      return;
    }
    setStarting(false); setSubida(null);
    // A la cola. La página vuelve al paso 1 (el prompt se queda) para poder subir la siguiente
    // lista; el progreso y la descarga de cada una están en la cola de arriba.
    const nombre = filename, leads = rows.length, habiaActivas = hayActivos;
    setRows([]); setColumns([]); setFilename(""); setEmailColumn(""); setPreview("");
    setResults({}); setProg({ done: 0, ok: 0, failed: 0, total: 0 }); setJobStatus(""); setJobId(null);
    if (fileRef.current) fileRef.current.value = "";
    await loadHistory();
    kickProcessor();
    toast.success(habiaActivas
      ? `En cola: ${nombre} (${leads.toLocaleString("es-ES")} leads). Seguirá cuando acabe la anterior; puedes subir otra lista.`
      : `Generando en el servidor: ${nombre} (${leads.toLocaleString("es-ES")} leads). Puedes cerrar el PC o subir otra lista.`);
  };

  /** Para una lista (la abierta o cualquiera de la cola). El servidor respeta "cancelled" y no
   *  vuelve a escribir "running", así que al recargar sigue parada. */
  const pararTrabajo = async (id: string) => {
    if (jobId === id) setJobStatus("cancelled"); // primero en local: el sondeo deja de empujar al instante
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, status: "cancelled" } : h)));
    await (supabase as any).from("personalization_csv_jobs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id);
    if (jobId === id) {
      const { data } = await (supabase as any).from("personalization_csv_jobs").select("done, ok, failed, total").eq("id", id).maybeSingle();
      if (data) {
        const d = data as any;
        setProg({ done: d.done || 0, ok: d.ok || 0, failed: d.failed || 0, total: d.total || 0 });
      }
      const parciales = await leerResultados(supabase, id).catch(() => null);
      if (parciales) setResults(parciales);
    }
    void loadHistory();
    toast.success("Parada. Puedes descargar o enviar lo generado hasta ahora, o reanudarla.");
  };
  const handleStop = () => jobId ? pararTrabajo(jobId) : undefined;

  // Reanudar una lista parada: vuelve a "pending" y el procesador CONTINÚA donde se quedó
  // (sólo genera los leads que faltan, no repite lo ya hecho).
  const reanudarTrabajo = async (id: string) => {
    if (jobId === id) setJobStatus("pending"); // reactiva el sondeo del trabajo abierto
    setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, status: "pending" } : h)));
    await (supabase as any).from("personalization_csv_jobs").update({ status: "pending", updated_at: new Date().toISOString() }).eq("id", id);
    kickProcessor();
    void loadHistory();
    toast.success("Reanudada: sigue donde se quedó.");
  };
  const resumeJob = () => jobId ? reanudarTrabajo(jobId) : undefined;

  // Los leads que quedaron en error (tras los reintentos automáticos) se vuelven a generar.
  const [retrying, setRetrying] = useState(false);
  const retryFailed = async () => {
    if (!jobId || retrying) return;
    setRetrying(true);
    try {
      const n = await reintentarFallidos(supabase, jobId);
      if (!n) { toast.info("No hay mensajes con error que reintentar."); return; }
      setProg((p) => ({ ...p, done: Math.max(0, p.done - n), failed: Math.max(0, p.failed - n) }));
      setResults({});
      setJobStatus("pending"); // reactiva el sondeo y el empuje al procesador
      kickProcessor();
      toast.success(`Reintentando ${n} mensaje(s) que habían fallado.`);
    } catch (e: any) { toast.error(`No se pudo reintentar: ${e?.message || e}`); }
    finally { setRetrying(false); }
  };

  const ensureResults = async (): Promise<ResultsMap> => {
    if (Object.keys(results).length) return results;
    if (!jobId) return {};
    const r = (await leerResultados(supabase, jobId)) as ResultsMap;
    setResults(r);
    return r;
  };

  const downloadCsv = async () => {
    if (!rows.length) return;
    const res = await ensureResults();
    descargarTexto(nombreDescarga(filename, history.find((h) => h.id === jobId)?.label), csvPersonalizado(columns, rows, res));
  };

  /** Los leads y mensajes de una lista de la cola: los de la página si es la abierta, si no los
   *  guardados en el servidor (cada lista queda guardada con su personalización). */
  const datosDe = async (h: TrabajoCola): Promise<{ rows: Row[]; results: ResultsMap }> => {
    if (h.id === jobId && rows.length) return { rows, results: await ensureResults() };
    const datos = await leerTrabajo(supabase, h.id);
    return { rows: datos.rows as Row[], results: datos.results as ResultsMap };
  };

  const descargarTrabajo = async (h: TrabajoCola) => {
    if (descargando) return;
    setDescargando(h.id);
    try {
      const datos = await datosDe(h);
      if (!datos.rows.length) { toast.error("Esta lista no tiene leads guardados."); return; }
      descargarTexto(nombreDescarga(h.filename, h.label),csvPersonalizado(columnasDe(h.columns, datos.rows), datos.rows, datos.results));
    } catch (e: any) { toast.error(`No se pudo descargar: ${e?.message || e}`); }
    finally { setDescargando(null); }
  };

  /** Abre el diálogo "Enviar a campaña" con los leads de UNA lista. */
  const abrirEnvio = async (ctx: ContextoEnvio) => {
    if (!user) return;
    const { data } = await supabase.from("campaigns").select("id, name, status").eq("user_id", user.id).order("created_at", { ascending: false });
    const list = (data || []) as { id: string; name: string; status: string }[];
    // Count the leads each campaign ALREADY has, so you see it before/after adding.
    const withCounts = await Promise.all(list.map(async (c) => {
      const { count } = await supabase.from("campaign_leads").select("lead_id", { count: "exact", head: true }).eq("campaign_id", c.id);
      return { ...c, leadCount: count || 0 };
    }));
    setSendCtx(ctx); setCampaigns(withCounts); setSelectedCampaignId(""); setSendOpen(true);
  };

  const openSend = async () => {
    if (okCount === 0) { toast.error("Genera los mensajes primero"); return; }
    if (!user) return;
    // Auto-detect the email column if it wasn't set/detected, so the user rarely hits an error.
    const col = emailColumn || detectEmailColumn(columns, rows);
    if (!col) { toast.error("No encuentro la columna de email. Elígela arriba (paso 1) en el desplegable."); return; }
    if (col !== emailColumn) setEmailColumn(col);
    const res = await ensureResults(); // así el recuento del diálogo es exacto
    await abrirEnvio({ jobId, filename, columns, emailColumn: col, rows, results: res });
  };

  const enviarTrabajo = async (h: TrabajoCola) => {
    if (cargandoEnvio) return;
    setCargandoEnvio(h.id);
    try {
      const datos = await datosDe(h);
      const cols = columnasDe(h.columns, datos.rows);
      const col = h.email_column || detectEmailColumn(cols, datos.rows);
      if (!col) { toast.error("No encuentro la columna de email de esta lista. Ábrela y elígela en el paso 1."); return; }
      await abrirEnvio({ jobId: h.id, filename: h.filename || "", columns: cols, emailColumn: col, rows: datos.rows, results: datos.results });
    } catch (e: any) { toast.error(`No se pudieron cargar sus leads: ${e?.message || e}`); }
    finally { setCargandoEnvio(null); }
  };

  const sendToCampaign = async () => {
    if (!user || !selectedCampaignId || !sendCtx) return;
    setSending(true);
    try {
      const { rows: filas, results: res, columns: cols, emailColumn: col } = sendCtx;
      // Dedupe by email so the same address isn't added as two leads (→ emailed twice).
      const seenEmails = new Set<string>();
      let skippedDupes = 0;
      const usable = filas.filter((r) => {
        const email = (r[col] || "").toLowerCase().trim();
        const rr = res[String(r.__idx)];
        if (!(email && EMAIL_RE.test(email) && rr?.message && !rr.error)) return false;
        if (seenEmails.has(email)) { skippedDupes++; return false; }
        seenEmails.add(email);
        return true;
      });
      if (!usable.length) {
        // Say EXACTLY what's missing so "falla lo del email" is never a mystery.
        const withEmail = filas.filter((r) => EMAIL_RE.test((r[col] || "").toLowerCase().trim())).length;
        const withMsg = filas.filter((r) => { const rr = res[String(r.__idx)]; return rr?.message && !rr.error; }).length;
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
          cols.forEach((c) => {
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

      {/* La cola: cada lista con su progreso en vivo; de cada una se descarga su CSV con la
          personalización (queda guardada en el servidor) o se manda a una campaña. */}
      {history.length > 0 && (
        <Card className={hayActivos ? "border-primary/30" : ""}>
          <CardContent className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <span className="soft-card-icon"><ListChecks className="h-5 w-5" /></span>
                <span>
                  <span className="block font-display text-[17px] font-semibold text-foreground">Cola de personalizaciones</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {hayActivos
                      ? `${activos.length} en marcha · se generan en el servidor aunque cierres el PC; las demás esperan su turno`
                      : "Tus listas, con su personalización guardada: descárgalas o mándalas a una campaña."}
                  </span>
                </span>
              </div>
              {hayActivos && (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> generando…
                </span>
              )}
            </div>

            {/* Filtro por etiqueta: sólo si alguna lista tiene una */}
            {etiquetasDe(history).length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por etiqueta">
                <button
                  type="button"
                  onClick={() => setFiltroEtiqueta(null)}
                  className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${filtroEtiqueta === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                >
                  Todas · {history.length}
                </button>
                {etiquetasDe(history).map((e) => {
                  const on = filtroEtiqueta !== null && filtroEtiqueta.toLowerCase() === e.label.toLowerCase();
                  const c = colorEtiqueta(e.label);
                  return (
                    <button
                      key={e.label}
                      type="button"
                      onClick={() => setFiltroEtiqueta(on ? null : e.label)}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors"
                      style={on ? { backgroundColor: c, borderColor: c, color: "#fff" } : { borderColor: c + "55", color: c, backgroundColor: c + "12" }}
                    >
                      <Tag className="h-3 w-3" /> {e.label} · {e.n}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead>
                  <tr className="soft-thead">
                    {["Lista", "Cuándo", "Estado", "Progreso", ""].map((h) => (
                      <th key={h} className="border-b border-border px-4 py-2.5 text-left text-[12px] font-semibold text-[#536188] dark:text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.filter((h) => pasaFiltroEtiqueta(h, filtroEtiqueta)).map((h) => {
                    const est = estadoTrabajo(h);
                    const puesto = est.enCola ? puestoEnCola(history, h.id) : null;
                    const total = h.total || 0, done = h.done || 0, ok = h.ok || 0, failed = h.failed || 0;
                    const pct = total ? Math.round((done / total) * 100) : 0;
                    const when = h.created_at ? new Date(h.created_at) : null;
                    const puedeReanudar = !est.activo && h.status !== "uploading" && total > 0 && done < total;
                    return (
                      <tr key={h.id} className={`soft-row border-b border-border/70 last:border-0 ${jobId === h.id ? "bg-accent/50" : ""}`}>
                        <td className="max-w-[300px] px-4 py-3">
                          <span className="block truncate font-medium text-foreground">{h.filename || "sin nombre"}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                            {total.toLocaleString("es-ES")} leads
                            {editandoEtiqueta?.id === h.id ? (
                              <input
                                autoFocus
                                list="personalizacion-etiquetas"
                                value={editandoEtiqueta.valor}
                                maxLength={40}
                                placeholder="Ej.: Lucy"
                                aria-label="Etiqueta de la lista"
                                onChange={(e) => setEditandoEtiqueta({ id: h.id, valor: e.target.value })}
                                onBlur={() => void guardarEtiqueta(h.id, editandoEtiqueta.valor)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); void guardarEtiqueta(h.id, editandoEtiqueta.valor); }
                                  if (e.key === "Escape") setEditandoEtiqueta(null);
                                }}
                                className="h-6 w-32 rounded-md border border-primary/50 bg-card px-2 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                              />
                            ) : h.label ? (
                              <button
                                type="button"
                                onClick={() => setEditandoEtiqueta({ id: h.id, valor: h.label || "" })}
                                title="Cambiar la etiqueta (déjala vacía para quitarla)"
                                className="inline-flex max-w-[160px] items-center gap-1 rounded-full border px-2 py-[1px] text-[11.5px] font-semibold"
                                style={{ borderColor: colorEtiqueta(h.label) + "55", color: colorEtiqueta(h.label), backgroundColor: colorEtiqueta(h.label) + "14" }}
                              >
                                <Tag className="h-3 w-3 flex-shrink-0" /> <span className="truncate">{h.label}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditandoEtiqueta({ id: h.id, valor: "" })}
                                title="Ponle un nombre o etiqueta (Lucy, Juan software…) para saber de quién es"
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-[1px] text-[11.5px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                              >
                                <Tag className="h-3 w-3" /> Etiqueta
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {when && !isNaN(when.getTime()) ? when.toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`soft-state ${est.cls}`}>
                            {est.txt === "Generando" && <Loader2 className="h-3 w-3 animate-spin" />}
                            {est.txt}{puesto ? ` · ${puesto}º` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="w-48 space-y-1">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div className={`h-full rounded-full transition-[width] duration-500 ${h.status === "completed" ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                            </div>
                            <div className="flex flex-wrap gap-x-2 text-[11.5px] tabular-nums text-muted-foreground">
                              <span>{done.toLocaleString("es-ES")}/{total.toLocaleString("es-ES")} · {pct}%</span>
                              <span className="text-success">✓ {ok.toLocaleString("es-ES")}</span>
                              {failed > 0 && <span className="text-destructive">✗ {failed.toLocaleString("es-ES")}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void descargarTrabajo(h)}
                              disabled={ok === 0 || descargando === h.id}
                              title={ok === 0 ? "Aún no hay mensajes generados" : "Descargar el CSV con la personalización"}
                              className="soft-control inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px] disabled:opacity-50"
                            >
                              {descargando === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Descargar
                            </button>
                            <button
                              type="button"
                              onClick={() => void enviarTrabajo(h)}
                              disabled={ok === 0 || cargandoEnvio === h.id}
                              title={ok === 0 ? "Aún no hay mensajes generados" : "Añadir estos leads a una campaña con su mensaje"}
                              className="soft-control inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px] disabled:opacity-50"
                            >
                              {cargandoEnvio === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar a campaña
                            </button>
                            {est.activo && (
                              <button type="button" onClick={() => void pararTrabajo(h.id)} title="Parar" aria-label="Parar" className="soft-action">
                                <Square className="h-[15px] w-[15px]" />
                              </button>
                            )}
                            {puedeReanudar && (
                              <button type="button" onClick={() => void reanudarTrabajo(h.id)} title="Reanudar donde se quedó" aria-label="Reanudar" className="soft-action">
                                <Play className="h-[17px] w-[17px]" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void openHistoryJob(h.id)}
                              disabled={jobId === h.id}
                              title={jobId === h.id ? "Abierta en el editor" : "Abrir en el editor (ver, reintentar fallidos, regenerar)"}
                              aria-label="Abrir en el editor"
                              className="soft-action disabled:opacity-40"
                            >
                              <Pencil className="h-[16px] w-[16px]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteHistoryJob(h.id)}
                              title="Borrar la lista y sus mensajes"
                              aria-label="Borrar"
                              className="soft-action soft-action-danger"
                            >
                              <Trash2 className="h-[17px] w-[17px]" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button type="button" onClick={() => setWizardOpen(true)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-gradient-to-r from-[#6a4cff] to-[#a24bf5] px-2.5 text-xs font-semibold text-white shadow-[0_4px_12px_rgba(106,76,255,.3)] transition hover:brightness-110">
                  <Sparkles className="h-3.5 w-3.5" /> Crear prompt con IA
                </button>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setPromptsOpen(true)}>
                  <BookMarked className="h-3.5 w-3.5" /> Prompts guardados{savedPrompts.length > 0 ? ` (${savedPrompts.length})` : ""}
                </Button>
              </div>
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
            <div className="flex items-center gap-2 text-sm font-semibold"><ServerCog className="h-4 w-4 text-primary" /> 3 · Generar en el servidor ({rows.length.toLocaleString("es-ES")} leads)</div>
            {!jobId && (
              <p className="text-[12.5px] text-muted-foreground">
                {hayActivos
                  ? `Hay ${activos.length} lista${activos.length === 1 ? "" : "s"} en marcha: esta se pondrá a la cola y seguirá cuando acabe. Puedes subir tantas como quieras.`
                  : "Se genera en el servidor (puedes cerrar el PC). Al pulsar, la lista pasa a la cola de arriba y puedes subir la siguiente."}
              </p>
            )}
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
            {!jobId && (
              <label className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <Tag className="h-3.5 w-3.5" /> Etiqueta de la lista <span className="text-[12px]">(opcional: Lucy, Juan software…)</span>
                <input
                  list="personalizacion-etiquetas"
                  value={etiqueta}
                  maxLength={40}
                  onChange={(e) => setEtiqueta(e.target.value)}
                  placeholder="Ej.: Lucy"
                  className="h-8 w-48 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}
            <datalist id="personalizacion-etiquetas">
              {etiquetasDe(history).map((e) => <option key={e.label} value={e.label} />)}
            </datalist>
            <div className="flex flex-wrap gap-2">
              {!running ? (
                <Button size="sm" className="gap-2" onClick={handleRun} disabled={!rows.length || starting}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{" "}
                  {subida ? `Subiendo leads… ${subida.hechas.toLocaleString("es-ES")} de ${subida.total.toLocaleString("es-ES")}` : prog.done > 0 ? "Regenerar todo" : hayActivos ? "Generar todo (a la cola)" : "Generar todo"}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-2" onClick={handleStop}><Loader2 className="h-4 w-4 animate-spin" /> Parar</Button>
              )}
              {!running && prog.failed > 0 && (
                <Button size="sm" variant="outline" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={retryFailed} disabled={retrying}>
                  {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Reintentar los {prog.failed} con error
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-2" onClick={downloadCsv} disabled={okCount === 0}><Download className="h-4 w-4" /> Descargar CSV</Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={openSend} disabled={okCount === 0}><Send className="h-4 w-4" /> Enviar a campaña</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Saved prompts dialog */}
      <PromptWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        columns={columns}
        onAccept={(nuevo) => { setPrompt(nuevo); setPreview(""); toast.success("Prompt escrito. Revísalo y pulsa la vista previa para ver un correo de ejemplo."); }}
      />

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
            {sendCtx?.filename && <p className="text-[13px] font-medium text-foreground">Lista: {sendCtx.filename}</p>}
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
