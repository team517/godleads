import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, FlaskConical, Download, RefreshCw, CalendarClock, CalendarDays } from "lucide-react";
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

/** "Hacer una prueba": generates the client report from the AGENCY OWNER's own
 *  campaigns and previews the exact PDF a client would receive. Sends nothing. */
export default function ReportTestDialog({ client, open, onClose }: {
  client: ReportTestClient; open: boolean; onClose: () => void;
}) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; status: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ReportKind>("48h");
  const [loadingCamps, setLoadingCamps] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState("informe.pdf");
  const lastBlob = useRef<Blob | null>(null);

  const brandColor = client.brand_color || "#6E58F1";
  const company = client.company_name || client.full_name || client.email || "Cliente";

  useEffect(() => {
    if (!open) return;
    setLoadingCamps(true);
    (async () => {
      const { data } = await supabase.from("campaigns").select("id, name, status").order("created_at", { ascending: false });
      const list = data || [];
      setCampaigns(list);
      // Preselect active campaigns (or all if none active) so a test is one click.
      const active = list.filter((c) => c.status === "active").map((c) => c.id);
      setSelected(new Set(active.length ? active : list.map((c) => c.id)));
      setLoadingCamps(false);
    })();
  }, [open]);

  // Revoke the object URL when it changes / on unmount.
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const generate = async () => {
    if (selected.size === 0) { toast.error("Selecciona al menos una campaña para la prueba"); return; }
    setGenerating(true);
    try {
      const data = await gatherReportData({
        kind,
        periodDays: kind === "weekly" ? 7 : 2,
        clientName: company,
        campaignIds: Array.from(selected),
      });
      const { blob, filename } = await renderReportPdfBlob(data, {
        company, brandColor, logoUrl: client.logo_url || undefined,
      });
      lastBlob.current = blob;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <FlaskConical className="h-4 w-4 text-primary" /> Prueba de informe · {company}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Genera el PDF <b>exactamente como lo recibiría el cliente</b>, usando tus propias campañas. No se envía nada — es solo una vista previa.
          </p>

          {/* Tipo de informe */}
          <div className="flex gap-2">
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
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campañas a incluir</p>
            {loadingCamps ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : campaigns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No tienes campañas todavía.</p>
            ) : (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
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

          <div className="flex items-center gap-2">
            <Button onClick={generate} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              {pdfUrl ? "Regenerar" : "Generar prueba"}
            </Button>
            {pdfUrl && (
              <Button variant="outline" onClick={download} className="gap-2">
                <Download className="h-4 w-4" /> Descargar PDF
              </Button>
            )}
            {generating && <span className="text-xs text-muted-foreground">Calculando métricas y redactando el análisis con IA…</span>}
          </div>

          {/* Preview */}
          {pdfUrl && (
            <div className="overflow-hidden rounded-lg border border-border/60">
              <iframe title="preview" src={pdfUrl} className="h-[520px] w-full bg-white" />
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
