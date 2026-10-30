import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Globe, Loader2, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { canUseZapmail } from "@/lib/zapmail";

/* Zapmail (30-10-2026): pegar dominios de IONOS → nameservers de Zapmail en IONOS → Zapmail los
   conecta. Sólo hello@ y support@. Todo pasa por la función zapmail-domains. */

type CheckRow = {
  domain: string; inIonos: boolean; nameservers: string[]; alreadyZapNs: boolean;
  mailboxes: number; mailboxesConnected: number; zapmail: string | null;
  tracked: { step: string; zapmail_status: string | null } | null;
};
type TrackedRow = {
  domain: string; step: string; zapmail_status: string | null; error: string | null;
  ns_before: { names?: string[] } | null; updated_at: string; connected_at: string | null; requested_by: string | null;
};

const STEP: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-muted text-muted-foreground" },
  ns_cambiados: { label: "Nameservers cambiados", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  conectando: { label: "Conectando en Zapmail", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  connected: { label: "Connected", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  error: { label: "Error", cls: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
};

async function call(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("zapmail-domains", { body: { action, ...extra } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

export default function Zapmail() {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tracked, setTracked] = useState<TrackedRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadTracked = useCallback(async () => {
    try { setTracked(((await call("list")).rows || []) as TrackedRow[]); } catch { /* se reintenta */ }
  }, []);
  useEffect(() => { void loadTracked(); }, [loadTracked]);
  // Mientras haya dominios a medio conectar, se mira cada minuto (el servidor también lo hace cada 10).
  const pending = tracked.some((t) => t.step === "ns_cambiados" || t.step === "conectando");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => { if (!document.hidden) void loadTracked(); }, 60_000);
    return () => clearInterval(t);
  }, [pending, loadTracked]);

  const connectable = useMemo(() => (rows || []).filter((r) => r.inIonos && r.tracked?.step !== "connected" && r.zapmail === null), [rows]);
  const withMailboxes = connectable.filter((r) => r.mailboxes > 0);

  if (!user) return null;
  if (!canUseZapmail(user.email)) return <Navigate to="/dashboard" replace />;

  const doCheck = async () => {
    if (!text.trim()) { toast.error("Pega al menos un dominio"); return; }
    setChecking(true); setRows(null);
    try {
      const r = await call("check", { domains: text });
      setRows(r.rows || []); setInvalid(r.invalid || []);
    } catch (e) { toast.error(`No se pudo comprobar: ${(e as Error).message}`); }
    finally { setChecking(false); }
  };

  const doConnect = async () => {
    setConfirmOpen(false); setConnecting(true);
    try {
      const r = await call("connect", { domains: connectable.map((x) => x.domain) });
      const res = (r.results || []) as { ok: boolean }[];
      const ok = res.filter((x) => x.ok).length;
      const bad = res.length - ok;
      if (ok) toast.success(`${ok} dominio${ok === 1 ? "" : "s"} enviados a Zapmail. Tardan unos minutos (a veces horas) en salir como "Connected".`);
      if (bad) toast.error(`${bad} dominio${bad === 1 ? "" : "s"} con error: mira la tabla de abajo.`);
      setRows(null); setText("");
      await loadTracked();
    } catch (e) { toast.error(`No se pudo conectar: ${(e as Error).message}`); }
    finally { setConnecting(false); }
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try { await call("refresh"); await loadTracked(); toast.success("Estado actualizado"); }
    catch (e) { toast.error(`No se pudo actualizar: ${(e as Error).message}`); }
    finally { setRefreshing(false); }
  };

  const counts = tracked.reduce<Record<string, number>>((a, t) => { a[t.step] = (a[t.step] || 0) + 1; return a; }, {});

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-light tracking-tight"><Globe className="h-6 w-6 text-primary" /> Zapmail</h1>
        <p className="text-sm text-muted-foreground">
          Pega dominios de IONOS: se les ponen los nameservers de Zapmail en IONOS y Zapmail los conecta (DNS de Google/Microsoft configuradas por Zapmail).
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
            placeholder={"dominio1.com\ndominio2.es\nhttps://www.dominio3.com"} className="font-mono text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={doCheck} disabled={checking || connecting} className="gap-1.5">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Comprobar
            </Button>
            <span className="text-xs text-muted-foreground">Primero se comprueba (no cambia nada). Después decides si conectar.</span>
          </div>
        </CardContent>
      </Card>

      {rows && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {invalid.length > 0 && (
              <p className="text-xs text-muted-foreground">Ignorado (no es un dominio): {invalid.join(", ")}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-3">Dominio</th><th className="py-2 pr-3">IONOS</th><th className="py-2 pr-3">Nameservers ahora</th><th className="py-2 pr-3">Buzones en la plataforma</th><th className="py-2">Zapmail</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.domain} className="border-t align-top">
                      <td className="py-2 pr-3 font-medium">{r.domain}</td>
                      <td className="py-2 pr-3">{r.inIonos ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="flex items-center gap-1 text-red-600"><XCircle className="h-4 w-4" /> No está</span>}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{r.alreadyZapNs ? "Ya son los de Zapmail" : (r.nameservers.join(", ") || "—")}</td>
                      <td className="py-2 pr-3">
                        {r.mailboxes > 0
                          ? <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> {r.mailboxes} ({r.mailboxesConnected} conectados)</span>
                          : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="py-2">{r.zapmail ? <Badge className={STEP.connected.cls}>Ya en Zapmail</Badge> : r.tracked ? <Badge className={(STEP[r.tracked.step] || STEP.pendiente).cls}>{(STEP[r.tracked.step] || STEP.pendiente).label}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {withMailboxes.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {withMailboxes.length} dominio{withMailboxes.length === 1 ? " tiene" : "s tienen"} buzones de IONOS en la plataforma. Al pasar a Zapmail esos buzones dejan de recibir y de enviar bien (el correo del dominio pasa a Zapmail).
              </p>
            )}
            <Button onClick={() => setConfirmOpen(true)} disabled={!connectable.length || connecting} className="gap-1.5">
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              Conectar {connectable.length} dominio{connectable.length === 1 ? "" : "s"} a Zapmail
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <b>Dominios en Zapmail</b>
              {Object.entries(counts).map(([k, n]) => <Badge key={k} className={(STEP[k] || STEP.pendiente).cls}>{(STEP[k] || STEP.pendiente).label}: {n}</Badge>)}
            </div>
            <Button variant="outline" size="sm" onClick={doRefresh} disabled={refreshing} className="gap-1.5">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar estado
            </Button>
          </div>
          {tracked.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha conectado ningún dominio.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-3">Dominio</th><th className="py-2 pr-3">Estado</th><th className="py-2 pr-3">Detalle</th><th className="py-2">Actualizado</th></tr>
                </thead>
                <tbody>
                  {tracked.map((t) => {
                    const s = STEP[t.step] || STEP.pendiente;
                    return (
                      <tr key={t.domain} className="border-t align-top">
                        <td className="py-2 pr-3 font-medium">{t.domain}</td>
                        <td className="py-2 pr-3"><Badge className={s.cls}>{s.label}</Badge></td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{t.error || t.zapmail_status || "—"}</td>
                        <td className="py-2 text-xs text-muted-foreground">{new Date(t.updated_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Pasar {connectable.length} dominio{connectable.length === 1 ? "" : "s"} a Zapmail?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>En IONOS se cambian sus nameservers por los de Zapmail y Zapmail pasa a gestionar su DNS. La web y el correo de IONOS de esos dominios dejan de funcionar.</p>
                {withMailboxes.length > 0 && (
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Atención: {withMailboxes.map((r) => `${r.domain} (${r.mailboxes} buzón${r.mailboxes === 1 ? "" : "es"})`).join(", ")} tienen buzones de IONOS en la plataforma.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Los nameservers anteriores quedan guardados por si hubiera que volver atrás.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doConnect}>Sí, conectar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
