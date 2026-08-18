import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileInput, Database, Sparkles, CheckCircle2, Rocket, MessageSquare, ArrowRight, Workflow } from "lucide-react";

// Owner-only automation module — a visual "flow" (N8N-style) of the auto-onboarding +
// customer-service pipeline. This is a SEPARATE module: it never touches the sending
// engine or live campaigns. Runs on DeepSeek. We wire each node up step by step.

const STAGES = [
  { icon: FileInput, label: "Formulario", desc: "El cliente rellena el onboarding" },
  { icon: Database, label: "Info recogida", desc: "Se guarda todo lo que necesita la campaña" },
  { icon: Sparkles, label: "Campaña generada", desc: "La IA (DeepSeek) crea la secuencia" },
  { icon: CheckCircle2, label: "Tu aprobación", desc: "Revisas y das el visto bueno" },
  { icon: Rocket, label: "Campaña activa", desc: "Empieza a enviar (motor de siempre)" },
  { icon: MessageSquare, label: "Atención al cliente", desc: "La IA responde y propone cambios" },
];

export default function AutomationFlow() {
  const { user } = useAuth();
  if (!user) return null;
  // Strictly owner-only (hello@onepulso.blog) — not managers, not support@.
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Workflow className="h-5 w-5" /></span>
          <div>
            <h1 className="font-display text-2xl font-bold">Automatización</h1>
            <p className="text-sm text-muted-foreground">Flujo automático de onboarding y atención al cliente.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> IA: DeepSeek
        </span>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">El flujo</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto pb-2">
            <div className="flex w-max items-stretch gap-1">
              {STAGES.map((s, i) => (
                <div key={s.label} className="flex items-stretch gap-1">
                  <div className="flex w-44 flex-col rounded-xl border border-border bg-muted/30 p-3 transition-colors hover:border-primary/40">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="h-4 w-4" /></span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Paso {i + 1}</span>
                    </div>
                    <p className="text-sm font-semibold">{s.label}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.desc}</p>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className="flex items-center px-0.5 text-muted-foreground/30"><ArrowRight className="h-4 w-4" /></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Clientes en el flujo</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Aquí verás cada cliente y en qué paso del flujo está, en tiempo real.
            <br />
            Vamos definiendo paso a paso qué hace cada nodo (tú me lo vas explicando).
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Módulo independiente: <b className="text-foreground">no toca el motor de envío ni las campañas en marcha</b>. Solo lee, propone borradores y espera tu aprobación.
      </p>
    </div>
  );
}
