import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { BarChart3, Send, MessageSquare, Download, Share2, Loader2, Check, Palette, X, RotateCcw, History } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirm";
import { fetchCampaignMetrics, formatResetAt } from "@/lib/campaign-metrics";
import { errorText, isMissingRpc } from "@/lib/widget-state";
import { toDayPoints, type DailyRpcRow, type DayPoint } from "@/lib/daily-rows";
import { buildStepRows, totalsFromRpcRow, type StepRow, type StepStatRow, type Totals } from "@/lib/campaign-analytics-rows";
import RetryNotice from "@/components/RetryNotice";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import html2canvas from "html2canvas";
// jsPDF (~350KB) is loaded on demand inside handleDownloadPDF — not at page load.

interface Props {
  campaignId: string;
  /** Fila CRUDA de campaign_metrics_v2 de ESTA campaña desde la página (una sola RPC para todas;
   *  respeta "Reiniciar analíticas"). `undefined` = aún no cargada. */
  metrics?: { sent?: unknown; contacted?: unknown; replied?: unknown } | null;
  /** Fallo de esa RPC en la página, para decirlo aquí con su Reintentar. */
  metricsError?: string | null;
  onRetryMetrics?: () => void;
  /** Filas de campaign_daily_sends (14 días) que la ficha pide UNA vez para las dos gráficas. */
  daily?: DailyRpcRow[];
  dailyLoading?: boolean;
  dailyError?: string | null;
  onDailyReload?: () => void;
  /** Tras "Reiniciar analíticas" la página tiene que volver a pedir las métricas. */
  onMetricsStale?: () => void;
}

const CHART_DAYS = 14;

/** Recuentos por paso de ANTES (dos consultas por paso): sólo si el RPC campaign_step_stats aún no existe. */
async function legacyStepCounts(campaignId: string, steps: { id: string }[], since: string | null): Promise<Record<string, { sent: number; replied: number }>> {
  const out: Record<string, { sent: number; replied: number }> = {};
  await Promise.all(steps.map(async (s) => {
    const base = () => supabase.from("sent_emails").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("campaign_step_id", s.id);
    const sentQ = base().or("sent_at.not.is.null,status.eq.sent");
    const repliedQ = base().not("replied_at", "is", null);
    const [a, b] = await Promise.all([since ? sentQ.gte("sent_at", since) : sentQ, since ? repliedQ.gte("replied_at", since) : repliedQ]);
    out[s.id] = { sent: a.count || 0, replied: b.count || 0 };
  }));
  return out;
}

// Loads any image (data: URL or remote https URL) and re-encodes it as a PNG
// data URL via canvas, so jsPDF can embed it reliably regardless of source
// format (png/jpeg/webp) or origin. Returns null if it can't be loaded.
async function imgToPngDataUrl(src: string): Promise<{ data: string; w: number; h: number } | null> {
  if (!src) return null;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load")); });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { data: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
  } catch {
    return null;
  }
}

export default function CampaignAnalytics({ campaignId, metrics, metricsError, onRetryMetrics, daily, dailyLoading, dailyError, onDailyReload, onMetricsStale }: Props) {
  const { user } = useAuth();
  const { profile } = useProfile();
  // Totales: la fila cruda de campaign_metrics_v2 que da la página (UNA RPC para todas las
  // campañas). Sólo si la página aún no la tiene se pide aquí una vez (misma RPC) — nunca contando
  // filas en el navegador, que PostgREST capa a 1000. Un fallo deja los totales en null ("—" +
  // Reintentar), jamás en ceros.
  const [fallbackTotals, setFallbackTotals] = useState<Totals | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const totals: Totals | null = totalsFromRpcRow(metrics) ?? fallbackTotals;
  const stats: Totals = totals ?? { contacted: 0, sent: 0, replied: 0 };
  const totalsPending = !totals;
  const totalsError = totals ? null : (metricsError || fallbackError);
  const dayPoints: DayPoint[] = toDayPoints(daily);
  const dailyPending = daily === undefined && !!dailyLoading;
  const dailyFailed = daily === undefined && !!dailyError;
  const [stepStats, setStepStats] = useState<StepRow[]>([]);
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const analyticsRef = useRef<HTMLDivElement>(null);

  // ── Report branding (logo + color + company) — saved in the browser ──
  const BRAND_KEY = "onepulso_report_branding";
  type Branding = { logo: string | null; color: string; company: string };
  const [branding, setBranding] = useState<Branding>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BRAND_KEY) || "null");
      if (saved && typeof saved === "object") return { logo: saved.logo ?? null, color: saved.color || "#7A5AF8", company: saved.company || "" };
    } catch { /* ignore */ }
    return { logo: null, color: "#7A5AF8", company: "" };
  });
  const [brandOpen, setBrandOpen] = useState(false);
  // "Reiniciar analíticas": desde cuándo cuentan los contadores (null = histórico completo).
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const confirm = useConfirm();
  // Once the user edits branding by hand, stop auto-overwriting it from the profile.
  const brandManualRef = useRef(false);
  const saveBranding = (b: Branding) => { brandManualRef.current = true; setBranding(b); try { localStorage.setItem(BRAND_KEY, JSON.stringify(b)); } catch { /* quota */ } };

  // Auto-apply the logged-in account's branding (logo / color / company) — set by
  // the admin in the Client Portal — so each client's report is pre-branded with
  // their own identity, without touching anything manually.
  useEffect(() => {
    if (brandManualRef.current) return;
    const pLogo = profile.logo_url;
    const pColor = profile.brand_color;
    const pCompany = profile.company_name;
    if (pLogo || pColor || pCompany) {
      setBranding(prev => ({
        logo: pLogo || prev.logo,
        color: pColor || prev.color,
        company: pCompany || prev.company,
      }));
    }
  }, [profile.logo_url, profile.brand_color, profile.company_name]);
  const onLogoFile = (file: File) => {
    if (file.size > 2_000_000) { toast.error("El logo es muy grande (máx 2 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => saveBranding({ ...branding, logo: String(reader.result) });
    reader.readAsDataURL(file);
  };
  const hexToRgb = (hex: string): [number, number, number] => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return [79, 70, 229];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Pasos + nombre son tablas diminutas; los recuentos por paso los hace el servidor en UNA
      // llamada (campaign_step_stats) en vez de dos consultas por paso.
      const [stepsRes, campaignRes, stepStatsRes] = await Promise.all([
        supabase.from("campaign_steps").select("id, step_order, subject").eq("campaign_id", campaignId).order("step_order"),
        (supabase as any).from("campaigns").select("name, analytics_reset_at").eq("id", campaignId).single(),
        (supabase as any).rpc("campaign_step_stats", { p_campaign_id: campaignId }),
      ]);
      if (!alive) return;
      const steps = (stepsRes.data || []) as { id: string; step_order: number; subject: string }[];
      setCampaignName(campaignRes.data?.name || "Campaña");
      const since: string | null = campaignRes.data?.analytics_reset_at || null;
      setResetAt(since);

      if (!stepStatsRes?.error && Array.isArray(stepStatsRes?.data)) {
        // Filas por paso + "Other (no step)" salen del propio RPC (envíos sin paso o de pasos
        // borrados), nunca de "total − suma": sin filas fantasma tras un reinicio.
        setStepsError(null);
        setStepStats(buildStepRows(steps, stepStatsRes.data as StepStatRow[]));
      } else if (isMissingRpc(stepStatsRes?.error)) {
        // Migración aún sin aplicar: los recuentos de siempre, para no dejar la sección vacía.
        const counts = await legacyStepCounts(campaignId, steps, since);
        if (!alive) return;
        setStepsError(null);
        setStepStats(steps.map((s) => ({ ...s, sent: counts[s.id]?.sent ?? 0, replied: counts[s.id]?.replied ?? 0 })));
      } else {
        setStepsError(errorText(stepStatsRes?.error));
      }
    };
    load();
    return () => { alive = false; };
  }, [campaignId, reloadKey]);

  // Totales de reserva (sólo si la página no los pasó): misma RPC, una vez. Un error NO se
  // convierte en ceros: se guarda y se enseña con Reintentar.
  const hasParentMetrics = !!metrics;
  useEffect(() => {
    if (hasParentMetrics || !user) return;
    let alive = true;
    fetchCampaignMetrics(supabase as any, user.id).then(({ data, error }) => {
      if (!alive) return;
      if (error || !Array.isArray(data)) { setFallbackError(errorText(error)); return; }
      const m = data.find((r: any) => r.campaign_id === campaignId);
      if (!m) { setFallbackError("La campaña no aparece en las métricas"); return; }
      setFallbackError(null);
      setFallbackTotals(totalsFromRpcRow(m));
    });
    return () => { alive = false; };
  }, [campaignId, user, hasParentMetrics, reloadKey]);
  const retryTotals = () => { if (onRetryMetrics) onRetryMetrics(); if (!hasParentMetrics) setReloadKey((k) => k + 1); };

  // Reiniciar = poner una marca de tiempo; NO se borra ningún correo ni respuesta (el motor los
  // necesita para no repetir pasos y el Unibox para sus hilos). Se puede deshacer cuando se quiera.
  const setAnalyticsReset = async (value: string | null) => {
    setResetting(true);
    const { error } = await (supabase as any).from("campaigns").update({ analytics_reset_at: value }).eq("id", campaignId);
    setResetting(false);
    if (error) { toast.error(`No se pudo ${value ? "reiniciar" : "restaurar"}: ${error.message}`); return; }
    setResetAt(value);
    setReloadKey((k) => k + 1);
    // La gráfica y las métricas las tiene la página: que las vuelva a pedir con el nuevo corte.
    onDailyReload?.();
    onMetricsStale?.();
    toast.success(value ? "Analíticas reiniciadas: los contadores empiezan de cero" : "Histórico completo restaurado");
  };
  const handleResetAnalytics = async () => {
    const ok = await confirm({
      title: "Reiniciar analíticas",
      description: "Los contadores de esta campaña (enviados, contactados, respuestas, gráfica y pasos) empezarán de cero desde ahora. No se borra ningún correo ni respuesta y el envío sigue exactamente igual. Podrás volver a ver el histórico completo cuando quieras.",
      confirmText: "Reiniciar",
    });
    if (ok) await setAnalyticsReset(new Date().toISOString());
  };

  const captureAnalytics = async (): Promise<string> => {
    if (!analyticsRef.current) throw new Error("No hay analítica que capturar");
    const canvas = await html2canvas(analyticsRef.current, {
      // Match the surface the cards are actually painted on. Hardcoding white made
      // the capture unreadable in dark mode (light text on a white canvas).
      backgroundColor:
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
          ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--background").trim()})`
          : "#ffffff",
      scale: 2,
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const imgData = await captureAnalytics();
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF("landscape", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const [br, bg, bb] = hexToRgb(branding.color);

      // Branded top accent bar
      pdf.setFillColor(br, bg, bb);
      pdf.rect(0, 0, pageWidth, 5, "F");

      // Logo (keeps aspect ratio, max 14mm tall). Works for both uploaded data
      // URLs and the client's profile logo URL (re-encoded to PNG for jsPDF).
      let headerY = 18;
      if (branding.logo) {
        const logo = await imgToPngDataUrl(branding.logo);
        if (logo) {
          const ratio = logo.w && logo.h ? logo.w / logo.h : 3;
          const h = 14;
          const w = Math.min(h * ratio, 60);
          pdf.addImage(logo.data, "PNG", 14, 9, w, h);
          headerY = 9 + h + 7;
        }
      }

      // Title in brand color + company / date
      pdf.setFontSize(18);
      pdf.setTextColor(br, bg, bb);
      pdf.text(`Analítica — ${campaignName}`, 14, headerY);
      pdf.setFontSize(10);
      pdf.setTextColor(120);
      const meta = `${branding.company ? branding.company + " · " : ""}Generado el ${new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      pdf.text(meta, 14, headerY + 7);

      // Image
      const topOffset = headerY + 13;
      const imgWidth = pageWidth - 28;
      const imgHeight = (imgWidth * analyticsRef.current!.offsetHeight) / analyticsRef.current!.offsetWidth;
      const finalHeight = Math.min(imgHeight, pageHeight - topOffset - 8);
      pdf.addImage(imgData, "PNG", 14, topOffset, imgWidth, finalHeight);

      pdf.save(`analytics-${campaignName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
      toast.success("PDF descargado");
    } catch (e: any) {
      toast.error(`Error al generar PDF: ${e.message}`);
    }
    setDownloading(false);
  };

  const handleShareEmail = async () => {
    if (!shareEmail.trim() || !user) return;
    setSharing(true);
    try {
      const imgData = await captureAnalytics();
      const { data: { session } } = await supabase.auth.getSession();

      // Get first available email account to send from
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "connected")
        .limit(1);

      if (!accounts || accounts.length === 0) {
        toast.error("No tienes cuentas de email conectadas para enviar");
        setSharing(false);
        return;
      }

      const replyRate = stats.contacted > 0 ? ((stats.replied / stats.contacted) * 100).toFixed(1) : "0";

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">📊 Analítica — ${campaignName}</h2>
          <p style="color: #666; font-size: 14px;">Informe generado el ${new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #7c3aed;">${stats.contacted}</div>
                <div style="font-size: 12px; color: #888;">Contactados</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #22c55e;">${stats.sent}</div>
                <div style="font-size: 12px; color: #888;">Emails enviados</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #3b82f6;">${stats.replied}</div>
                <div style="font-size: 12px; color: #888;">Respuestas (${replyRate}%)</div>
              </td>
            </tr>
          </table>

          ${stepStats.length > 0 ? `
            <h3 style="color: #1a1a1a; font-size: 14px;">Analítica por paso</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f5f5f5;">
                <th style="padding: 8px; text-align: left; font-size: 12px;">Paso</th>
                <th style="padding: 8px; text-align: left; font-size: 12px;">Asunto</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Enviados</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Respuestas</th>
              </tr>
              ${stepStats.map(s => `
                <tr>
                  <td style="padding: 8px; font-size: 13px; border-bottom: 1px solid #eee;">${s._other ? "Otros" : `Paso ${s.step_order}`}</td>
                  <td style="padding: 8px; font-size: 13px; border-bottom: 1px solid #eee; color: #666;">${s.subject}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #22c55e;">${s.sent}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #3b82f6;">${s.replied}</td>
                </tr>
              `).join("")}
            </table>
          ` : ""}

          <p style="margin-top: 24px; font-size: 12px; color: #aaa;">Enviado desde tu plataforma de cold email</p>
        </div>
      `;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          account_id: accounts[0].id,
          to_email: shareEmail.trim(),
          subject: `📊 Analítica — ${campaignName}`,
          body: htmlBody,
        }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Analítica enviada a ${shareEmail}`);
        setShareEmail("");
        setShareOpen(false);
      }
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
    setSharing(false);
  };

  const metricCards = [
    { label: "Contactados", value: stats.contacted, icon: BarChart3, color: "text-primary" },
    { label: "Emails enviados", value: stats.sent, icon: Send, color: "text-success" },
    { label: "Respuestas", value: stats.replied, icon: MessageSquare, color: "text-info" },
  ];

  // Reply rate over CONTACTED people (not emails sent) — the correct denominator.
  const replyRate = stats.contacted > 0 ? ((stats.replied / stats.contacted) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      {resetAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[rgba(126,139,198,.18)] bg-white/70 px-3 py-2 text-[13px] dark:border-border dark:bg-muted/40" role="status">
          <span className="flex items-center gap-2 text-muted-foreground">
            <History className="h-4 w-4 text-primary" />
            Analíticas reiniciadas: contando desde el <b className="text-foreground">{formatResetAt(resetAt)}</b>. No se ha borrado nada.
          </span>
          <button type="button" className="font-semibold text-primary hover:underline disabled:opacity-50" disabled={resetting} onClick={() => setAnalyticsReset(null)}>
            Ver histórico completo
          </button>
        </div>
      )}
      {/* Share / Download actions */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Reply rate: <span className="text-foreground text-base font-bold">{totalsPending ? "—" : `${replyRate}%`}</span>
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {totalsPending ? (totalsError ? "Métricas no disponibles" : "Cargando métricas…") : `${stats.replied} respuestas de ${stats.contacted} contactados`}
          </span>
          {totalsError && <RetryNotice what="las métricas" error={totalsError} onRetry={retryTotals} className="mt-1 text-[12px]" />}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleResetAnalytics}
            disabled={resetting}
            title="Poner los contadores de esta campaña a cero (no borra nada)"
          >
            {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Reiniciar
          </Button>
          <Popover open={brandOpen} onOpenChange={setBrandOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Palette className="h-3.5 w-3.5" style={{ color: branding.color }} />
                Branding
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3 p-3" align="end">
              <p className="text-xs font-medium">Marca del informe</p>
              {/* Logo */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Logo</label>
                <div className="flex items-center gap-2">
                  {branding.logo && (
                    <div className="flex items-center gap-1">
                      <img src={branding.logo} alt="logo" className="h-9 max-w-[90px] rounded border border-border/60 object-contain" />
                      <button onClick={() => saveBranding({ ...branding, logo: null })} className="text-muted-foreground hover:text-destructive" title="Quitar logo">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); }}
                    className="text-[11px] file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px]"
                  />
                </div>
              </div>
              {/* Color */}
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-muted-foreground">Color de marca</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={branding.color} onChange={(e) => saveBranding({ ...branding, color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-border/60 bg-transparent p-0" />
                  <span className="text-[11px] text-muted-foreground">{branding.color}</span>
                </div>
              </div>
              {/* Company name */}
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Nombre de empresa</label>
                <Input value={branding.company} onChange={(e) => saveBranding({ ...branding, company: e.target.value })} placeholder="Tu empresa" className="h-8 text-sm" />
              </div>
              <p className="text-[10px] text-muted-foreground">Se guarda automáticamente y se aplica al PDF descargado.</p>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleDownloadPDF}
            disabled={downloading || totalsPending}
            title={totalsPending ? "Espera a que carguen las métricas" : undefined}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Descargar PDF
          </Button>
          <Popover open={shareOpen} onOpenChange={setShareOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Share2 className="h-3.5 w-3.5" />
                Compartir
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <p className="text-xs font-medium mb-2">Enviar analítica por email</p>
              <div className="flex gap-2">
                <Input
                  placeholder="email@ejemplo.com"
                  className="h-8 text-sm"
                  value={shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleShareEmail()}
                />
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={handleShareEmail}
                  disabled={sharing || totalsPending || !shareEmail.trim()}
                  variant={!shareEmail.trim() ? "secondary" : "default"}
                >
                  {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Se enviará un informe HTML con todas las métricas de la campaña</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Analytics content - captured for PDF */}
      <div ref={analyticsRef}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {metricCards.map(m => (
            <Card key={m.label}>
              <CardContent className="p-4 text-center">
                <m.icon className={`h-5 w-5 mx-auto mb-2 ${m.color}`} />
                <p className="text-2xl font-bold">{totalsPending ? "—" : m.value}</p>
                <p className="text-xs text-muted-foreground">{m.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Envíos + respuestas por día — mismo gráfico que la página de Estadísticas */}
        <Card className="mt-6">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Envíos por día · últimos {CHART_DAYS} días</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(var(--brand-cyan))" }} /> {dayPoints.reduce((s, p) => s + p.envios, 0).toLocaleString("es")} envíos</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(var(--success))" }} /> {dayPoints.reduce((s, p) => s + p.respuestas, 0).toLocaleString("es")} respuestas</span>
              </div>
            </div>
            {dailyError && onDailyReload && (
              <RetryNotice what="la gráfica diaria" error={dailyError} onRetry={onDailyReload} stale={daily !== undefined} className="mb-2" />
            )}
            {dailyPending ? (
              <div className="h-[200px] animate-pulse rounded bg-muted/50" />
            ) : dailyFailed ? (
              <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">Gráfica no disponible ahora mismo.</div>
            ) : dayPoints.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">Aún no hay envíos en este periodo.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={dayPoints} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="caSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--brand-cyan))" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="caReply" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    cursor={{ stroke: "hsl(var(--border))" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as DayPoint;
                      return (
                        <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-raised">
                          <p className="mb-1 font-medium capitalize">{p.full}</p>
                          <p className="font-semibold" style={{ color: "hsl(var(--brand-cyan))" }}>{p.envios.toLocaleString("es")} {p.envios === 1 ? "envío" : "envíos"}</p>
                          {p.respuestas > 0 && <p style={{ color: "hsl(var(--success))" }}>{p.respuestas} {p.respuestas === 1 ? "respuesta" : "respuestas"}</p>}
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="envios" stroke="hsl(var(--brand-cyan))" strokeWidth={2} fill="url(#caSent)" />
                  <Area type="monotone" dataKey="respuestas" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#caReply)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {stepsError && (
          <RetryNotice what="la analítica por paso" error={stepsError} onRetry={() => setReloadKey((k) => k + 1)} className="mt-6" />
        )}
        {stepStats.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-3">Analítica por paso</h4>
            <div className="space-y-2">
              {stepStats.map((s: any) => (
                <div key={s.id} className={`flex items-center gap-4 rounded-md border p-3 text-sm ${s._other ? "bg-muted/40" : ""}`}>
                  <span className="font-medium text-primary whitespace-nowrap">
                    {s._other ? "Otros" : `Paso ${s.step_order}`}
                  </span>
                  <span className="flex-1 truncate text-muted-foreground">{s.subject}</span>
                  <span className="text-success whitespace-nowrap">{s.sent} enviados</span>
                  <span className="text-info whitespace-nowrap">{s.replied} respuestas</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
