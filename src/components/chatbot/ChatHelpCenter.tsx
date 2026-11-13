import { useMemo, useState } from "react";
import { ChevronDown, Search, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/* Centro de ayuda del chat (pestaña "Ayuda"): buscador y preguntas frecuentes reales de la
   plataforma. Al final, el paso a "Habla con nuestro equipo". */

export const HELP_FAQ: { q: string; a: string }[] = [
  {
    q: "¿Cómo conecto mis buzones de correo?",
    a: "Ve a Cuentas de correo → Añadir cuenta. Puedes conectar Gmail, Outlook o cualquier buzón por IMAP/SMTP, uno a uno o muchos a la vez subiendo un CSV (en el mismo diálogo tienes «Descargar plantilla»).",
  },
  {
    q: "¿Qué son el warm-up y el slow ramp?",
    a: "El warm-up calienta cada buzón intercambiando correos con otros buzones reales para que tus envíos lleguen a la bandeja principal; es ilimitado e incluido en todos los planes. El slow ramp, en las opciones de la campaña, empieza con pocos envíos diarios por buzón y los sube solo día a día.",
  },
  {
    q: "¿Cuántos correos puedo enviar al día por buzón?",
    a: "No hay tope de plataforma: cada buzón envía hasta el límite diario que le pongas (15 por defecto). Si el buzón está en warm-up o la campaña tiene slow ramp, manda el valor más bajo de los dos.",
  },
  {
    q: "¿Qué pasa si un contacto está fuera de la oficina?",
    a: "Detectamos la respuesta automática y, si indica la fecha de vuelta, el siguiente correo de la secuencia espera hasta ese día. Puedes activarlo o desactivarlo por campaña en Opciones → «Fuera de oficina: esperar a que vuelva».",
  },
  {
    q: "¿Cómo importo mis leads?",
    a: "Dentro de la campaña, pestaña Leads → Importar CSV. Basta una columna con el email; el resto (nombre, empresa, ciudad…) se convierte en variables para personalizar los correos. Los duplicados y los bloqueados se descartan solos.",
  },
  {
    q: "¿Cómo funciona la prueba de 14 días?",
    a: "Al darte de alta eliges plan y añades una tarjeta, pero no se cobra nada durante 14 días. Si cancelas antes de que terminen, no pagas nada.",
  },
  {
    q: "¿Cuánto cuesta Funnyleads?",
    a: "Starter 21 €/mes, Growth 65 €/mes y Pack Agency 170 €/mes, con un 17 % de descuento si pagas al año. Enterprise, a medida.",
  },
  {
    q: "¿Cómo cancelo mi suscripción?",
    a: "Desde Ajustes → Plan → Cancelar plan. Sigues teniendo acceso hasta el final del periodo que ya has pagado.",
  },
];

const normaliza = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function ChatHelpCenter({ onTalkToTeam }: { onTalkToTeam: () => void }) {
  const [query, setQuery] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);
  const lista = useMemo(() => {
    const q = normaliza(query.trim());
    return HELP_FAQ.map((f, i) => ({ ...f, i })).filter((f) => !q || normaliza(f.q + " " + f.a).includes(q));
  }, [query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pb-3 pt-5">
        <h2 className="font-display text-[22px] font-semibold tracking-tight text-[#0E1330] dark:text-foreground">Centro de ayuda</h2>
        <label className="mt-3 flex h-12 items-center gap-2.5 rounded-2xl border border-[#E4E0F5] bg-white px-4 focus-within:border-[#6E58F1] dark:border-border dark:bg-card">
          <Search className="h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca tu pregunta…" aria-label="Buscar en el centro de ayuda"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#0E1330] outline-none placeholder:text-slate-400 dark:text-foreground" />
        </label>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-5">
        {lista.length === 0 && <p className="py-6 text-center text-sm text-slate-500 dark:text-muted-foreground">No hay resultados para «{query}».</p>}
        {lista.map((f) => {
          const on = abierta === f.i;
          return (
            <div key={f.i} className="overflow-hidden rounded-[18px] border border-[#EFEDF7] bg-white dark:border-border dark:bg-card">
              <button type="button" onClick={() => setAbierta(on ? null : f.i)} aria-expanded={on}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <span className="flex-1 text-[14.5px] font-semibold leading-snug text-[#0E1330] dark:text-foreground">{f.q}</span>
                <ChevronDown className={cn("h-[18px] w-[18px] shrink-0 text-[#6E58F1] transition-transform", on && "rotate-180")} aria-hidden="true" />
              </button>
              {on && <p className="px-4 pb-4 text-[14px] leading-relaxed text-slate-600 dark:text-muted-foreground">{f.a}</p>}
            </div>
          );
        })}
        <div className="mt-3 rounded-[18px] bg-[#F0EDFE] px-4 py-4 text-center dark:bg-primary/10">
          <p className="text-[14px] font-medium text-[#0E1330] dark:text-foreground">¿No encuentras lo que buscas?</p>
          <button type="button" onClick={onTalkToTeam}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#6E58F1] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[#5F49E6]">
            <MessageSquare className="h-4 w-4" aria-hidden="true" /> Habla con nuestro equipo
          </button>
        </div>
      </div>
    </div>
  );
}
