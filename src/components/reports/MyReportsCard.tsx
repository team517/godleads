import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { FileBarChart, Loader2, Send, Save } from "lucide-react";

/** Lets the AGENCY OWNER enable the automated reports for THEIR OWN account/campaigns
 *  (the client cards below are for clients). Writes to the owner's own profile (RLS
 *  allows insert/update of your own profile), which the scheduler then picks up. */
export default function MyReportsCard() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [fromAccount, setFromAccount] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [threshold, setThreshold] = useState(200);
  const [accounts, setAccounts] = useState<{ id: string; email: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [pRes, aRes] = await Promise.all([
        supabase.from("profiles").select("report_enabled, report_from_account_id, report_to_email, report_low_contacts_threshold").eq("user_id", user.id).maybeSingle(),
        supabase.from("email_accounts").select("id, email, status").not("smtp_host", "is", null).order("email"),
      ]);
      const p: any = pRes.data;
      setEnabled(!!p?.report_enabled);
      setFromAccount(p?.report_from_account_id || "");
      setToEmail(p?.report_to_email || user.email || "");
      setThreshold(p?.report_low_contacts_threshold ?? 200);
      setAccounts((aRes.data as any) || []);
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    if (enabled && !fromAccount) { toast.error("Elige la cuenta desde la que se envía"); return; }
    if (enabled && !toEmail.trim()) { toast.error("Pon el email donde quieres recibirlos"); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      user_id: user.id,
      report_enabled: enabled,
      report_from_account_id: enabled ? (fromAccount || null) : null,
      report_to_email: enabled ? (toEmail.trim() || null) : null,
      report_low_contacts_threshold: threshold,
    }, { onConflict: "user_id" });
    if (error) toast.error(error.message);
    else toast.success(enabled ? "¡Informes activados para tu cuenta!" : "Guardado (informes desactivados)");
    setSaving(false);
  };

  const sendNow = async (kind: "48h" | "weekly") => {
    if (!user) return;
    if (!fromAccount || !toEmail.trim()) { toast.error("Elige la cuenta y el email primero"); return; }
    setSending(kind);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ mode: "manual", client_user_id: user.id, kind, test_to: toEmail.trim(), from_account_id: fromAccount }),
      });
      const j = await resp.json();
      if (j.ok) toast.success(`Informe enviado a ${toEmail}`);
      else toast.error(j.error || "No se pudo enviar");
    } catch (e: any) { toast.error(String(e?.message || e)); }
    setSending(null);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FileBarChart className="h-4 w-4 text-primary" /> Mis informes automáticos (mi cuenta)</CardTitle>
        <CardDescription>Recibe los informes de <b>tus propias campañas</b>: cada 48h a las 10:00 (lun–jue) + repaso los viernes. Solo entre semana. (Tu resumen diario de leads calientes a las 18:00 ya está activo.)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <span className="text-sm font-medium">Activar informes automáticos de mi cuenta</span>
              <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} />
            </label>
            {enabled && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Enviar desde la cuenta</Label>
                    {accounts.length === 0 ? (
                      <p className="text-[11px] text-amber-600">No tienes cuentas conectadas. Conéctala en "Cuentas Email".</p>
                    ) : (
                      <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                        <option value="">— Elige una cuenta —</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}{a.status !== "connected" ? ` (${a.status})` : ""}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Enviar a (tu email)</Label>
                    <Input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="tu@email.com" className="h-9 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Avisar cuando queden menos de … contactos</Label>
                  <Input type="number" min={0} value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 0)} className="w-32" />
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!fromAccount || !!sending} onClick={() => sendNow("48h")}>
                    {sending === "48h" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviarme uno ahora (48h)
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!fromAccount || !!sending} onClick={() => sendNow("weekly")}>
                    {sending === "weekly" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviarme el semanal
                  </Button>
                </div>
              </div>
            )}
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
