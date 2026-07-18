import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BookMarked, Save, Trash2, Check } from "lucide-react";

type SavedSig = { id: string; name: string; html: string };
const KEY = "op_saved_signatures";

function loadSaved(): SavedSig[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function persist(list: SavedSig[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); } catch { /* quota */ }
}

/** Saved-signatures library (stored in the browser). Save the current HTML with a name,
 *  re-activate a saved one into the editor, or delete it. Shared by the signature managers
 *  in Unibox and Email Accounts. */
export function SavedSignatures({ currentHtml, onLoad }: { currentHtml: string; onLoad: (html: string) => void }) {
  const [list, setList] = useState<SavedSig[]>(() => loadSaved());
  const [name, setName] = useState("");

  const save = () => {
    const n = name.trim();
    if (!n) { toast.error("Ponle un nombre a la firma"); return; }
    if (!currentHtml.trim()) { toast.error("La firma está vacía — escribe/pega el HTML primero"); return; }
    const item: SavedSig = { id: `${Date.now()}`, name: n, html: currentHtml };
    const next = [item, ...list.filter((s) => s.name.toLowerCase() !== n.toLowerCase())].slice(0, 50);
    setList(next); persist(next); setName("");
    toast.success(`Firma "${n}" guardada`);
  };
  const activate = (s: SavedSig) => { onLoad(s.html); toast.success(`"${s.name}" cargada — pulsa Aplicar para activarla`); };
  const remove = (id: string) => { const next = list.filter((s) => s.id !== id); setList(next); persist(next); };

  return (
    <div className="space-y-2 rounded-md border border-border/60 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BookMarked className="h-3.5 w-3.5" /> Firmas guardadas
      </p>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre (p.ej. Firma CHF)"
          className="h-8 text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
        <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={save}><Save className="h-3.5 w-3.5" /> Guardar la actual</Button>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Aún no tienes firmas guardadas. Escribe una arriba y guárdala.</p>
      ) : (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {list.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded border border-border/50 px-2 py-1">
              <span className="truncate text-xs font-medium">{s.name}</span>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="secondary" className="h-6 gap-1 px-2 text-[11px]" onClick={() => activate(s)}><Check className="h-3 w-3" /> Activar</Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive/70 hover:text-destructive" onClick={() => remove(s.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
