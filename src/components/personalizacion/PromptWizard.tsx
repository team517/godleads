import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  IDIOMAS, RESPUESTAS_EJEMPLO, construirPrompt, detectarColumnas, validarRespuestas,
  type IdiomaId, type RespuestasPrompt,
} from "@/lib/personalization-prompt";

/* "Crear prompt con IA": unas preguntas y el prompt de personalización sale escrito, con la
   plantilla que mejor funciona. Las respuestas se recuerdan para la próxima vez (las columnas no:
   dependen del CSV que haya cargado). */

const KEY = "pers:prompt-wizard";
const NINGUNA = "__none__";

function recordadas(): Partial<RespuestasPrompt> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  columns: string[];
  onAccept: (prompt: string) => void;
}

export default function PromptWizard({ open, onOpenChange, columns, onAccept }: Props) {
  const [r, setR] = useState<RespuestasPrompt>(RESPUESTAS_EJEMPLO);
  const [beneficios, setBeneficios] = useState("");
  const [como, setComo] = useState("");

  useEffect(() => {
    if (!open) return;
    const prev = recordadas();
    const base = { ...RESPUESTAS_EJEMPLO, ...prev, ...detectarColumnas(columns) };
    setR(base);
    setBeneficios((base.beneficios || []).join("\n"));
    setComo((base.comoLoHacemos || []).join("\n"));
  }, [open, columns]);

  const set = <K extends keyof RespuestasPrompt>(k: K, v: RespuestasPrompt[K]) => setR((p) => ({ ...p, [k]: v }));
  const lineas = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

  const aceptar = () => {
    const final: RespuestasPrompt = { ...r, beneficios: lineas(beneficios).slice(0, 3), comoLoHacemos: lineas(como) };
    const error = validarRespuestas(final);
    if (error) { toast.error(error); return; }
    try {
      const { colNombre: _a, colEmpresa: _b, colDescripcion: _c, ...guardar } = final;
      localStorage.setItem(KEY, JSON.stringify(guardar));
    } catch { /* sin almacenamiento */ }
    onAccept(construirPrompt(final));
    onOpenChange(false);
  };

  const ColSelect = ({ label, value, onChange, opcional }: { label: string; value: string; onChange: (v: string) => void; opcional?: boolean }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value || NINGUNA} onValueChange={(v) => onChange(v === NINGUNA ? "" : v)}>
        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NINGUNA}>{opcional ? "No la tengo" : "Elige una columna"}</SelectItem>
          {columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Crear prompt con IA</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-[13px] text-muted-foreground">
          Contesta estas preguntas y te escribo el prompt completo, con la estructura que mejor funciona: habla primero de la empresa del lead, luego de la tuya, y cierra con tu oferta.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">¿Cómo se llama tu empresa?</Label>
            <Input value={r.empresa} onChange={(e) => set("empresa", e.target.value)} placeholder="Ej: PubliUp" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">¿Quién firma el correo?</Label>
            <Input value={r.firmante} onChange={(e) => set("firmante", e.target.value)} placeholder="Ej: Nacho" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">¿En qué idioma se escribe?</Label>
            <Select value={r.idioma} onValueChange={(v) => set("idioma", v as IdiomaId)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{IDIOMAS.map((i) => <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">¿Qué ofreces enseñar?</Label>
            <Input value={r.oferta} onChange={(e) => set("oferta", e.target.value)} placeholder="una demostración personalizada" />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">¿Qué conseguís para vuestros clientes? <span className="font-normal text-muted-foreground">(termina la frase "ayudamos a empresas a…")</span></Label>
            <Input value={r.promesa} onChange={(e) => set("promesa", e.target.value)} placeholder="conseguir nuevos clientes" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Beneficios que deben salir SIEMPRE <span className="font-normal text-muted-foreground">(uno por línea, máx. 3)</span></Label>
            <Textarea value={beneficios} onChange={(e) => setBeneficios(e.target.value)} className="min-h-[92px] text-sm" placeholder={"oportunidades comerciales recurrentes\nmayor estabilidad comercial"} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">¿Cómo lo hacéis? <span className="font-normal text-muted-foreground">(una frase por línea)</span></Label>
            <Textarea value={como} onChange={(e) => setComo(e.target.value)} className="min-h-[92px] text-sm" placeholder={"Identificamos empresas que encajan con su cliente ideal.\nContactamos con potenciales clientes adecuados."} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Duración de la llamada (minutos)</Label>
            <Input type="number" min={5} max={60} value={r.minutos} onChange={(e) => set("minutos", Number(e.target.value || 0))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Longitud del correo (palabras)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min={30} max={400} value={r.palabrasMin} onChange={(e) => set("palabrasMin", Number(e.target.value || 0))} aria-label="Palabras mínimas" />
              <span className="text-sm text-muted-foreground">a</span>
              <Input type="number" min={30} max={400} value={r.palabrasMax} onChange={(e) => set("palabrasMax", Number(e.target.value || 0))} aria-label="Palabras máximas" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
          <p className="mb-2 text-[12.5px] font-semibold">Columnas de tu CSV que se usan en el correo</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <ColSelect label="Nombre de la persona" value={r.colNombre} onChange={(v) => set("colNombre", v)} />
            <ColSelect label="Nombre de su empresa" value={r.colEmpresa} onChange={(v) => set("colEmpresa", v)} />
            <ColSelect label="Descripción de su empresa" value={r.colDescripcion} onChange={(v) => set("colDescripcion", v)} opcional />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={aceptar} className="gap-1.5"><Sparkles className="h-4 w-4" /> Aceptar y escribir el prompt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
