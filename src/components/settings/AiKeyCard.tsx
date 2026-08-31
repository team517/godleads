import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Check, Sparkles, Trash2 } from "lucide-react";

type Status = { platform_eligible: boolean; connected: boolean; provider: string | null; hint: string | null };

/** BYOK — an external user connects their own OpenAI/DeepSeek key so their AI usage bills their
 *  credits. Hidden for agency/agency-created clients (they use the platform AI). */
export function AiKeyCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke("ai-key", { body: { action: "status" } });
      setStatus((data as Status) || null);
      if ((data as Status)?.provider) setProvider((data as Status).provider!);
    } catch { setStatus(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // While loading, or for agency/agency-created clients, render nothing (they use the platform AI).
  if (!status || status.platform_eligible) return null;

  const save = async () => {
    if (apiKey.trim().length < 15) { toast.error("La clave no parece válida"); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-key", { body: { action: "save", provider, api_key: apiKey.trim() } });
      if (error || (data as any)?.error) { toast.error((data as any)?.error || "No se pudo guardar"); }
      else { toast.success("Clave de IA conectada"); setApiKey(""); load(); }
    } catch { toast.error("No se pudo guardar"); }
    setSaving(false);
  };
  const disconnect = async () => {
    setSaving(true);
    try { await supabase.functions.invoke("ai-key", { body: { action: "delete" } }); toast.success("Clave desconectada"); load(); }
    catch { toast.error("No se pudo desconectar"); }
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-base"><Sparkles className="h-4 w-4 text-primary" /> Inteligencia Artificial (tu clave)</CardTitle>
        <CardDescription>Para usar las funciones de IA (generar campañas, asuntos, personalizar, traducir…) conecta tu propia clave de <b>OpenAI</b> o <b>DeepSeek</b>. El consumo se cobra a <b>tus créditos</b>. La guardamos cifrada y nunca se muestra.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.connected && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-2 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/5">
            <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4" /> Conectado · <b>{status.provider === "deepseek" ? "DeepSeek" : "OpenAI"}</b> <span className="text-muted-foreground">{status.hint}</span></span>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive hover:text-destructive" disabled={saving} onClick={disconnect}><Trash2 className="h-3.5 w-3.5" /> Desconectar</Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <div>
            <Label className="text-xs">Proveedor</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">API key {status.connected ? "(nueva, para reemplazar)" : ""}</Label>
            <Input className="mt-1" type="password" placeholder={provider === "deepseek" ? "sk-..." : "sk-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          </div>
          <Button className="gap-1.5" disabled={saving || !apiKey.trim()} onClick={save}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {status.connected ? "Actualizar" : "Conectar"}</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">La consigues en {provider === "deepseek" ? "platform.deepseek.com → API keys" : "platform.openai.com → API keys"}. Empieza por <code>sk-</code>.</p>
      </CardContent>
    </Card>
  );
}
