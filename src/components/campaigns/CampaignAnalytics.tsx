import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { BarChart3, Send, Mail, MessageSquare, Download, Share2, Loader2, Check, Palette, X } from "lucide-react";
import { toast } from "sonner";
import html2canvas from "html2canvas";
// jsPDF (~350KB) is loaded on demand inside handleDownloadPDF — not at page load.

interface Props { campaignId: string; }

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

export default function CampaignAnalytics({ campaignId }: Props) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [stats, setStats] = useState({ started: 0, sent: 0, replied: 0, failed: 0 });
  const [stepStats, setStepStats] = useState<any[]>([]);
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
      if (saved && typeof saved === "object") return { logo: saved.logo ?? null, color: saved.color || "#4F46E5", company: saved.company || "" };
    } catch { /* ignore */ }
    return { logo: null, color: "#4F46E5", company: "" };
  });
  const [brandOpen, setBrandOpen] = useState(false);
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
    const load = async () => {
      const [leadsRes, sentRes, stepsRes, campaignRes] = await Promise.all([
        supabase.from("campaign_leads").select("id, status").eq("campaign_id", campaignId),
        supabase.from("sent_emails").select("id, status, campaign_step_id, replied_at").eq("campaign_id", campaignId),
        supabase.from("campaign_steps").select("id, step_order, subject").eq("campaign_id", campaignId).order("step_order"),
        supabase.from("campaigns").select("name").eq("id", campaignId).single(),
      ]);
      const leads = leadsRes.data || [];
      const emails = sentRes.data || [];
      const steps = stepsRes.data || [];
      setCampaignName(campaignRes.data?.name || "Campaña");

      setStats({
        started: leads.length,
        sent: emails.filter(e => e.status === "sent").length,
        replied: emails.filter(e => e.replied_at).length,
        failed: emails.filter(e => e.status === "failed").length,
      });

      setStepStats(steps.map(s => {
        const stepEmails = emails.filter(e => e.campaign_step_id === s.id);
        return {
          ...s,
          sent: stepEmails.filter(e => e.status === "sent").length,
          replied: stepEmails.filter(e => e.replied_at).length,
          failed: stepEmails.filter(e => e.status === "failed").length,
        };
      }));
    };
    load();
  }, [campaignId]);

  const captureAnalytics = async (): Promise<string> => {
    if (!analyticsRef.current) throw new Error("No analytics to capture");
    const canvas = await html2canvas(analyticsRef.current, {
      backgroundColor: "#ffffff",
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
      pdf.text(`Analytics — ${campaignName}`, 14, headerY);
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

      const replyRate = stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : "0";

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">📊 Analytics — ${campaignName}</h2>
          <p style="color: #666; font-size: 14px;">Informe generado el ${new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #7c3aed;">${stats.started}</div>
                <div style="font-size: 12px; color: #888;">Sequences started</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #22c55e;">${stats.sent}</div>
                <div style="font-size: 12px; color: #888;">Emails sent</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #3b82f6;">${stats.replied}</div>
                <div style="font-size: 12px; color: #888;">Replies (${replyRate}%)</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #ef4444;">${stats.failed}</div>
                <div style="font-size: 12px; color: #888;">Failed</div>
              </td>
            </tr>
          </table>

          ${stepStats.length > 0 ? `
            <h3 style="color: #1a1a1a; font-size: 14px;">Step Analytics</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f5f5f5;">
                <th style="padding: 8px; text-align: left; font-size: 12px;">Step</th>
                <th style="padding: 8px; text-align: left; font-size: 12px;">Subject</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Sent</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Replies</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Failed</th>
              </tr>
              ${stepStats.map(s => `
                <tr>
                  <td style="padding: 8px; font-size: 13px; border-bottom: 1px solid #eee;">Step ${s.step_order}</td>
                  <td style="padding: 8px; font-size: 13px; border-bottom: 1px solid #eee; color: #666;">${s.subject}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #22c55e;">${s.sent}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #3b82f6;">${s.replied}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #ef4444;">${s.failed}</td>
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
          subject: `📊 Analytics — ${campaignName}`,
          body: htmlBody,
        }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Analytics enviadas a ${shareEmail}`);
        setShareEmail("");
        setShareOpen(false);
      }
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
    setSharing(false);
  };

  const metricCards = [
    { label: "Sequences started", value: stats.started, icon: BarChart3, color: "text-primary" },
    { label: "Emails sent", value: stats.sent, icon: Send, color: "text-success" },
    { label: "Replies", value: stats.replied, icon: MessageSquare, color: "text-info" },
    { label: "Failed", value: stats.failed, icon: Mail, color: "text-destructive" },
  ];

  const replyRate = stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      {/* Share / Download actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Reply rate: <span className="text-foreground text-base font-bold">{replyRate}%</span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
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
            disabled={downloading}
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
              <p className="text-xs font-medium mb-2">Enviar analytics por email</p>
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
                  disabled={sharing || !shareEmail.trim()}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metricCards.map(m => (
            <Card key={m.label}>
              <CardContent className="p-4 text-center">
                <m.icon className={`h-5 w-5 mx-auto mb-2 ${m.color}`} />
                <p className="text-2xl font-bold">{m.value}</p>
                <p className="text-xs text-muted-foreground">{m.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {stepStats.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-3">Step Analytics</h4>
            <div className="space-y-2">
              {stepStats.map(s => (
                <div key={s.id} className="flex items-center gap-4 rounded-lg border p-3 text-sm">
                  <span className="font-medium text-primary">Step {s.step_order}</span>
                  <span className="flex-1 truncate text-muted-foreground">{s.subject}</span>
                  <span className="text-success">{s.sent} sent</span>
                  <span className="text-info">{s.replied} replies</span>
                  <span className="text-destructive">{s.failed} failed</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
