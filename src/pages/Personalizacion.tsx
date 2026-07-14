import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, Sparkles, Download, Send, Loader2, FileText, Wand2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Row = Record<string, string> & { __idx: number };
type Result = { message: string; error?: string };

const CLIENT_BATCH = 12; // rows sent to the edge fn per request (it fans out internally)

/** Flatten an HTML/multiline message into one CSV-safe cell (no raw newlines that
 *  would break Instantly/Smartlead importers). */
function flattenCell(s: string): string {
  return (s || "").replace(/>\s+</g, "><").replace(/\r?\n+/g, " ").trim();
}

export default function Personalizacion() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [filename, setFilename] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [emailColumn, setEmailColumn] = useState<string>("");

  const [prompt, setPrompt] = useState(
    "Escribe la primera línea personalizada de un cold email para {first_name} de {company_name}. " +
    "Menciona algo concreto de su empresa. Máximo 2 frases, natural y directo. Solo la línea, sin saludo.",
  );
  const [provider, setProvider] = useState<"deepseek" | "claude">("deepseek");

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string>("");

  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const [results, setResults] = useState<Record<number, Result>>({});
  const doneCount = Object.keys(results).length;
  const okCount = Object.values(results).filter((r) => r.message && !r.error).length;
  const failCount = Object.values(results).filter((r) => r.error).length;

  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [sending, setSending] = useState(false);

  const emailCandidates = useMemo(
    () => columns.filter((c) => /e-?mail|correo/i.test(c)),
    [columns],
  );

  const handleFile = (file: File) => {
    if (!file) return;
    setFilename(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const cols = (res.meta.fields || []).filter(Boolean);
        const data = (res.data || [])
          .map((r, i) => ({ ...r, __idx: i } as Row))
          .filter((r) => cols.some((c) => (r[c] || "").toString().trim()));
        setColumns(cols);
        setRows(data);
        setResults({});
        setPreview("");
        const auto = cols.find((c) => /e-?mail|correo/i.test(c)) || "";
        setEmailColumn(auto);
        toast.success(`${data.length} filas · ${cols.length} columnas`);
      },
      error: (err) => toast.error(`No se pudo leer el CSV: ${err.message}`),
    });
  };

  const authToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  };

  const callBatch = async (batch: Row[]) => {
    const token = await authToken();
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/personalize-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt,
        provider,
        rows: batch.map((r) => {
          const { __idx, ...data } = r;
          return { index: __idx, data };
        }),
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    return json.results as { index: number; message: string; error?: string }[];
  };

  const handlePreview = async () => {
    if (!rows.length) { toast.error("Sube un CSV primero"); return; }
    if (!prompt.trim()) { toast.error("Escribe un prompt"); return; }
    setPreviewing(true);
    setPreview("");
    try {
      const out = await callBatch([rows[0]]);
      const r = out[0];
      if (r?.error) toast.error(`Error: ${r.error}`);
      setPreview(r?.message || "");
    } catch (e: any) {
      toast.error(e.message || "Error en la preview");
    }
    setPreviewing(false);
  };

  const handleRun = async () => {
    if (!rows.length) { toast.error("Sube un CSV primero"); return; }
    if (!prompt.trim()) { toast.error("Escribe un prompt"); return; }
    setRunning(true);
    cancelRef.current = false;
    const acc: Record<number, Result> = {};
    setResults({});
    try {
      for (let i = 0; i < rows.length; i += CLIENT_BATCH) {
        if (cancelRef.current) break;
        const batch = rows.slice(i, i + CLIENT_BATCH);
        try {
          const out = await callBatch(batch);
          for (const r of out) acc[r.index] = { message: r.message, error: r.error };
        } catch (e: any) {
          for (const r of batch) acc[r.__idx] = { message: "", error: e.message || "fallo de red" };
        }
        setResults({ ...acc });
      }
      const ok = Object.values(acc).filter((r) => r.message && !r.error).length;
      toast.success(cancelRef.current ? `Parado — ${ok} generados` : `Listo — ${ok} mensajes generados`);
    } finally {
      setRunning(false);
    }
  };

  const downloadCsv = () => {
    if (!rows.length) return;
    const out = rows.map((r) => {
      const { __idx, ...orig } = r;
      const res = results[__idx];
      return { ...orig, personalized_message: res?.error ? `[ERROR] ${res.error}` : flattenCell(res?.message || "") };
    });
    const csv = Papa.unparse(out);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (filename.replace(/\.csv$/i, "") || "leads") + "_personalizado.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openSend = async () => {
    if (!emailColumn) { toast.error("Elige la columna de email primero"); return; }
    if (okCount === 0) { toast.error("Genera los mensajes primero"); return; }
    if (!user) return;
    const { data } = await supabase.from("campaigns").select("id, name, status").eq("user_id", user.id).order("created_at", { ascending: false });
    setCampaigns(data || []);
    setSelectedCampaignId("");
    setSendOpen(true);
  };

  const sendToCampaign = async () => {
    if (!user || !selectedCampaignId) return;
    setSending(true);
    try {
      const usable = rows.filter((r) => {
        const email = (r[emailColumn] || "").toLowerCase().trim();
        const msg = results[r.__idx]?.message;
        return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && msg && !results[r.__idx]?.error;
      });
      if (!usable.length) { toast.error("No hay filas con email válido + mensaje generado"); setSending(false); return; }

      let added = 0;
      const INSERT_BATCH = 300;
      for (let i = 0; i < usable.length; i += INSERT_BATCH) {
        const slice = usable.slice(i, i + INSERT_BATCH);
        const batch = slice.map((r) => {
          const custom_fields: Record<string, string> = {};
          columns.forEach((c) => {
            if (c === emailColumn) return;
            const v = (r[c] || "").toString().trim();
            if (v) custom_fields[c] = v;
          });
          custom_fields.personalized_message = results[r.__idx].message;
          return { user_id: user.id, email: (r[emailColumn] || "").toLowerCase().trim(), custom_fields, is_campaign_only: true };
        });
        const { data, error } = await supabase.from("leads").insert(batch).select("id");
        let ids: string[] = [];
        if (error) {
          for (const row of batch) {
            const { data: one } = await supabase.from("leads").insert(row).select("id").maybeSingle();
            if (one) ids.push(one.id);
          }
        } else {
          ids = (data || []).map((d: any) => d.id);
        }
        if (ids.length) {
          await supabase.from("campaign_leads").upsert(
            ids.map((id) => ({ campaign_id: selectedCampaignId, lead_id: id })),
            { onConflict: "campaign_id,lead_id", ignoreDuplicates: true },
          );
          added += ids.length;
        }
      }
      toast.success(`${added} leads enviados a la campaña con su mensaje personalizado`);
      setSendOpen(false);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
    setSending(false);
  };

  const insertPlaceholder = (col: string) => setPrompt((p) => `${p}{${col}}`);
  const progressPct = rows.length ? Math.round((doneCount / rows.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold">Personalización con IA</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Sube un CSV, escribe un prompt con {"{columnas}"} y la IA genera un mensaje por lead. Luego descárgalo o envíalo a una campaña.
        </p>
      </div>

      {/* Step 1 — CSV */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Upload className="h-4 w-4 text-primary" /> 1 · Sube tu CSV de leads</div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => fileRef.current?.click()}>
              <FileText className="h-4 w-4" /> {filename ? "Cambiar CSV" : "Elegir CSV"}
            </Button>
            {filename && <span className="text-xs text-muted-foreground">{filename} · <b>{rows.length}</b> filas · {columns.length} columnas</span>}
          </div>
          {columns.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Columna de email (para enviar a campaña)</Label>
              <Select value={emailColumn} onValueChange={setEmailColumn}>
                <SelectTrigger className="h-9 w-full sm:w-72 text-sm"><SelectValue placeholder="Elige la columna de email" /></SelectTrigger>
                <SelectContent>
                  {columns.map((c) => <SelectItem key={c} value={c}>{c}{emailCandidates.includes(c) ? "  ✉️" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2 — Prompt */}
      {columns.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="h-4 w-4 text-primary" /> 2 · Prompt de personalización</div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <button key={c} type="button" onClick={() => insertPlaceholder(c)}
                  className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium hover:border-primary/50 hover:bg-primary/5">
                  {`{${c}}`}
                </button>
              ))}
            </div>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-[110px] text-sm leading-relaxed" placeholder="Escribe tu prompt con {columnas}…" />
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Motor IA</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as any)}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deepseek">DeepSeek</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={handlePreview} disabled={previewing || running}>
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

      {/* Step 3 — Generate */}
      {columns.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> 3 · Generar mensajes ({rows.length} leads)</div>
            {(running || doneCount > 0) && (
              <div className="space-y-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{doneCount}/{rows.length} ({progressPct}%)</span>
                  <span className="text-emerald-600">✓ {okCount}</span>
                  {failCount > 0 && <span className="text-destructive">✗ {failCount}</span>}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!running ? (
                <Button size="sm" className="gap-2" onClick={handleRun} disabled={!rows.length}>
                  <Sparkles className="h-4 w-4" /> {doneCount > 0 ? "Regenerar todo" : "Generar todo"}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => { cancelRef.current = true; }}>
                  <Loader2 className="h-4 w-4 animate-spin" /> Parar
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-2" onClick={downloadCsv} disabled={okCount === 0}>
                <Download className="h-4 w-4" /> Descargar CSV
              </Button>
              <Button size="sm" variant="secondary" className="gap-2" onClick={openSend} disabled={okCount === 0}>
                <Send className="h-4 w-4" /> Enviar a campaña
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send to campaign dialog */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><Send className="h-5 w-5 text-primary" /> Enviar a una campaña</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Se crearán los leads con su <b>mensaje personalizado</b> guardado como <code>personalized_message</code> y se añadirán a la campaña. Úsalo en el email con <code>{"{{personalized_message}}"}</code>.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Campaña destino</Label>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Elige una campaña" /></SelectTrigger>
                <SelectContent>
                  {campaigns.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No tienes campañas. Crea una primero.</div>}
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">{c.name} <Badge variant="secondary" className="text-[10px]">{c.status}</Badge></span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">Se enviarán <b>{okCount}</b> leads con email válido + mensaje.</p>
            <Button className="w-full gap-2" onClick={sendToCampaign} disabled={sending || !selectedCampaignId}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Añadir a la campaña
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
