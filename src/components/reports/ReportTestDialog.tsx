import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, FlaskConical, Download, RefreshCw, CalendarClock, CalendarDays, Send } from "lucide-react";
import { gatherReportData } from "@/lib/report/gatherReportData";
import { renderReportPdfBlob } from "@/lib/report/renderPdfBrowser";
import type { ReportKind } from "@/lib/report/types";

export interface ReportTestClient {
  company_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
}

/** "Hacer una prueba": previews the exact PDF a client would receive (from the AGENCY
 *  OWNER's own campaigns) and can send a test copy by email to verify delivery. */
export default function ReportTestDialog({ client, open, onClose }: {
  client: ReportTestClient; open: boolean; onClose: () => void;
}) {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ReportKind>("48h");
  const [loadingCamps, setLoadingCamps] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("informe.pdf");
  const lastBlob = useRef<Blob | null>(null);
  const lastData = useRef<any>(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Test send
  const [sendTo, setSendTo] = useState("hello@onepulso.blog");
  const [sending, setSending] = useState(false);
  const [ownerAccount, setOwnerAccount] = useState<string | null>(null);

  const brandColor = client.brand_color || "#6E58F1";
  const company = client.company_name || client.full_name || client.email || "Cliente";

  useEffect(() => {
    if (!open) return;
    setLoadingCamps(true);
    (async () => {
      const [campRes, acctRes] = await Promise.all([
        supabase.from("campaigns").select("id, name, status").order("created_at", { ascending: false }),
        supabase.from("email_accounts").select("id").eq("status", "connected").not("smtp_host", "is", null).order("email").limit(1),
      ]);
      const list = campRes.data || [];
      setCampaigns(list);
      const active = list.filter((c) => c.status === "active").map((c) => c.id);
      setSelected(new Set(active.length ? active : list.map((c) => c.id)));
      setOwnerAccount(acctRes.data?.[0]?.id || null);
      setLoadingCamps(false);
    })();
  }, [open]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const generate = async () => {
    if (selected.size === 0) { toast.error("Selecciona al menos una campaña para la prueba"); return; }
    setGenerating(true);
    try {
      const data = await gatherReportData({
        kind, periodDays: kind === "weekly" ? 7 : 2, clientName: company, campaignIds: Array.from(selected),
      });
      const { blob, filename } = await renderReportPdfBlob(data, { company, brandColor, logoUrl: client.logo_url || undefined });
      if (!aliveRef.current) return;
      lastBlob.current = blob;
      lastData.current = data;
      setFilename(filename);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(blob));
      toast.success("Informe de prueba generado");
    } catch (e: any) {
      toast.error(`Error al generar la prueba: ${e?.message || e}`);
    }
    setGenerating(false);
  };

  const download = () => {
    if (!lastBlob.current) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(lastBlob.current);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const blobToB64 = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
    return btoa(bin);
  };

  // Email the EXACT PDF you're previewing (same branding + data), as a plain written
  // email with the PDF attached — so the test matches what you see.
  const sendTest = async () => {
    if (!sendTo.trim()) { toast.error("Escribe un email"); return; }
    if (!ownerAccount) { toast.error("No tienes ninguna cuenta de email conectada para enviar"); return; }
    if (!lastBlob.current || !lastData.current) { toast.error("Genera primero la prueba — así te llega exactamente lo que ves"); return; }
    setSending(true);
    try {
      const pdf_base64 = await blobToB64(lastBlob.current);
      const d = lastData.current;
      const periodTxt = kind === "weekly" ? "de esta semana" : "de las últimas 48 horas";
      const summary = (d.narrative?.summary || "").trim();
      const body_text = [
        "Hola,", "",
        `Te paso el análisis ${periodTxt} de tu campaña.`, "",
        summary || `Llevamos una tasa de respuesta del ${d.replyRate.toFixed(1)}% (${d.totals.replied} respuestas de ${d.totals.contacted} contactados).`, "",
        "Adjunto el PDF con el detalle completo por campaña y las mejoras que vamos a aplicar.", "",
        "Un saludo,", company,
      ].join("\n");
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          mode: "email_pdf", to: sendTo.trim(), from_account_id: ownerAccount,
          pdf_base64, filename, company, body_text,
          subject: kind === "weekly" ? "Análisis semanal de tu campaña" : "Análisis de tu campaña",
        }),
      });
      const j = await resp.json();
      if (j.ok) toast.success(`Prueba enviada a ${sendTo} con el PDF adjunto. Revísalo.`);
      else toast.error(j.error || "No se pudo enviar la prueba");
    } catch (e: any) { toast.error(String(e?.message || e)); }
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[93vh] w-[95vw] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <FlaskConical className="h-4 w-4 text-primary" /> Prueba de informe · {company}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {/* Tipo de informe */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setKind("48h")}
              className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${kind === "48h" ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <CalendarClock className="h-4 w-4 text-primary" /> Informe cada 48h
            </button>
            <button
              onClick={() => setKind("weekly")}
              className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${kind === "weekly" ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40"}`}
            >
              <CalendarDays className="h-4 w-4 text-primary" /> Repaso semanal (viernes) + sugerencias
            </button>
          </div>

          {/* Campañas */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campañas a incluir</p>
            {loadingCamps ? (
              <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : campaigns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tienes campañas todavía.</p>
            ) : (
              <div className="max-h-24 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
                {campaigns.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40">
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className={`text-[10px] uppercase ${c.status === "active" ? "text-emerald-600" : "text-muted-foreground"}`}>{c.status}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              {pdfUrl ? "Regenerar" : "Generar prueba"}
            </Button>
            {pdfUrl && (
              <Button variant="outline" onClick={download} className="gap-2">
                <Download className="h-4 w-4" /> Descargar PDF
              </Button>
            )}
            {generating && <span className="text-xs text-muted-foreground">Calculando métricas y redactando con IA…</span>}
          </div>

          {/* Test send */}
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <div className="flex-1 space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Enviar una prueba (con el PDF adjunto) a</label>
              <Input type="email" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="hello@onepulso.blog" className="h-9 text-sm" />
            </div>
            <Button onClick={sendTest} disabled={sending || !ownerAccount || !pdfUrl} className="h-9 shrink-0 gap-2" title={!pdfUrl ? "Genera la prueba primero" : ""}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar prueba
            </Button>
            {!ownerAccount && !loadingCamps && <p className="w-full text-[10px] text-amber-600">No tienes ninguna cuenta de email conectada para enviar.</p>}
            {ownerAccount && !pdfUrl && <p className="w-full text-[10px] text-muted-foreground">Pulsa "Generar prueba" primero — se envía exactamente ese PDF.</p>}
          </div>

          {/* Preview */}
          {pdfUrl && (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <iframe title="preview" src={`${pdfUrl}#zoom=page-width`} className="h-[65vh] min-h-[420px] w-full bg-white" />
            </div>
          )}
          {!pdfUrl && !generating && (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4" /> Pulsa "Generar prueba" para ver el PDF aquí
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
