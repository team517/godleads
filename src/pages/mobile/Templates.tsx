import { useCallback, useEffect, useState } from "react";
import { ChevronUp, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { Sheet } from "./ui";

/* Plantillas de respuesta: las MISMAS que en la Unibox del ordenador (tabla reply_templates).
   Su texto es el "texto fuente" del cuadro de respuesta: líneas y enlaces <a href>. */

export interface ReplyTemplate { id: string; name: string; body: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };
const CACHE = "mobile:templates";

/** Lo que se lee de una plantilla en la lista: sin etiquetas y en una línea. */
export function templatePreview(body: string): string {
  return String(body || "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function useTemplates() {
  const [list, setList] = useState<ReplyTemplate[]>(() => cacheGet<ReplyTemplate[]>(CACHE) || []);
  const [loaded, setLoaded] = useState(() => !!cacheGet<ReplyTemplate[]>(CACHE));
  const set = useCallback((next: ReplyTemplate[]) => { setList(next); cacheSet(CACHE, next); }, []);

  const load = useCallback(async () => {
    const { data, error } = await db.from("reply_templates").select("id, name, body").order("created_at", { ascending: false });
    if (!error) set((data || []) as ReplyTemplate[]);
    setLoaded(true);
  }, [set]);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (name: string, body: string) => {
    const { data, error } = await db.from("reply_templates").insert({ name: name.trim(), body }).select("id, name, body").single();
    if (error || !data) throw new Error(error?.message || "No se pudo guardar la plantilla");
    set([data as ReplyTemplate, ...list]);
  }, [list, set]);

  const remove = useCallback(async (id: string) => {
    const { error } = await db.from("reply_templates").delete().eq("id", id);
    if (error) throw new Error(error.message);
    set(list.filter((t) => t.id !== id));
  }, [list, set]);

  return { list, loaded, reload: load, save, remove };
}

/** Fila encima de la barra de formato: el botón "Plantillas" y las plantillas a un toque. */
export function TemplatesBar({ templates, onOpen, onPick }: { templates: ReplyTemplate[]; onOpen: () => void; onPick: (t: ReplyTemplate) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={onOpen}
        className="m-press m-card flex h-[38px] shrink-0 items-center gap-1.5 rounded-[12px] pl-2.5 pr-2 text-[14.5px] font-semibold text-[#2E3A8C]">
        <FileText className="h-[17px] w-[17px] text-[#6E58F1]" strokeWidth={2} />
        Plantillas
        <ChevronUp className="h-[15px] w-[15px] text-[#6B7192]" strokeWidth={2.2} />
      </button>
      {templates.length > 0 && (
        <div className="m-scroll flex min-w-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden">
          {templates.slice(0, 12).map((t) => (
            <button key={t.id} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => onPick(t)}
              className="m-press h-[38px] max-w-[190px] shrink-0 truncate rounded-[12px] border border-[#DFE5F8] bg-[#EEF2FE] px-3 text-[14px] font-medium text-[#2E3A8C]">
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Todas las plantillas: tocar una la pone en la respuesta; también guardar la actual y borrar. */
export function TemplatesSheet({ open, onClose, templates, loaded, canSave, onPick, onSave, onRemove }: {
  open: boolean; onClose: () => void; templates: ReplyTemplate[]; loaded: boolean; canSave: boolean;
  onPick: (t: ReplyTemplate) => void; onSave: (name: string) => Promise<void>; onRemove: (id: string) => Promise<void>;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => { if (!open) { setNaming(false); setName(""); setConfirmId(null); } }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Plantillas de respuesta">
      <div className="px-1 pb-2">
        {canSave && !naming && (
          <button type="button" onClick={() => setNaming(true)}
            className="m-press mb-2 flex w-full items-center gap-3 rounded-[14px] border border-dashed border-[#C9D3F7] bg-[#F6F8FF] px-3.5 py-3 text-left">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white text-[#4D6CF3] shadow-[0_1px_3px_rgba(40,60,160,.12)]"><Plus className="h-[18px] w-[18px]" /></span>
            <span className="text-[15px] font-semibold text-[#2E3A8C]">Guardar esta respuesta como plantilla</span>
          </button>
        )}
        {naming && (
          <div className="mb-2 flex items-center gap-2 rounded-[14px] bg-[#F6F8FF] p-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la plantilla" autoFocus
              className="h-11 min-w-0 flex-1 rounded-[11px] border border-[#DCE2F4] bg-white px-3 text-[16px] outline-none focus:border-[#AFC0F8]" />
            <button type="button" disabled={!name.trim() || busy}
              onClick={async () => { setBusy(true); try { await onSave(name); setNaming(false); setName(""); } finally { setBusy(false); } }}
              className="m-press m-gradient h-11 shrink-0 rounded-[11px] px-4 text-[14.5px] font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="m-spin h-4 w-4" /> : "Guardar"}
            </button>
          </div>
        )}

        {!loaded ? (
          <div className="flex justify-center py-8"><Loader2 className="m-spin h-6 w-6 text-[#9AA0BA]" /></div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#EFEBFD] text-[#6E58F1]"><FileText className="h-6 w-6" /></span>
            <p className="mt-3 text-[15.5px] font-semibold text-[#0E1330]">Aún no tienes plantillas</p>
            <p className="mx-auto mt-1 max-w-[280px] text-[13.5px] leading-snug text-[#6E7491]">Escribe una respuesta y guárdala aquí. Son las mismas que en la Unibox del ordenador.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="m-card flex items-stretch overflow-hidden rounded-[14px]">
                {confirmId === t.id ? (
                  <div className="flex flex-1 items-center justify-between gap-2 px-3.5 py-3">
                    <span className="min-w-0 truncate text-[14.5px] text-[#1B2140]">¿Borrar «{t.name}»?</span>
                    <span className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setConfirmId(null)} className="m-press h-9 rounded-[10px] px-3 text-[14px] font-semibold text-[#3A4163]">Cancelar</button>
                      <button type="button" disabled={busy}
                        onClick={async () => { setBusy(true); try { await onRemove(t.id); } finally { setBusy(false); setConfirmId(null); } }}
                        className="m-press h-9 rounded-[10px] bg-[#EF3B5D] px-3 text-[14px] font-semibold text-white disabled:opacity-60">Borrar</button>
                    </span>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => onPick(t)} className="m-press min-w-0 flex-1 px-3.5 py-3 text-left active:bg-[#F7F8FD]">
                      <span className="block truncate text-[15.5px] font-semibold text-[#0E1330]">{t.name}</span>
                      <span className="mt-0.5 line-clamp-2 text-[13.5px] leading-[1.4] text-[#6E7491]">{templatePreview(t.body) || "(vacía)"}</span>
                    </button>
                    <button type="button" aria-label={`Borrar ${t.name}`} onClick={() => setConfirmId(t.id)}
                      className="m-press flex w-12 shrink-0 items-center justify-center border-l border-[#F0F2F7] text-[#A0A6BE] active:text-[#EF3B5D]">
                      <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
