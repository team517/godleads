import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Cuadro de respuesta del Unibox que PINTA los enlaces (azul, clicables) en vez de
 * enseñar el código `<a href="…">…</a>`.
 *
 * Escribir es NÍTIDO: el editor es "no controlado" — el texto vive en su propio DOM y NO se sube
 * a React en cada tecla. Antes cada pulsación guardaba el texto en el estado del Unibox y volvía a
 * dibujar TODA la pantalla (la bandeja de la izquierda, el hilo abierto…), y por eso se notaba
 * lento. Ahora el Unibox sólo se entera de si el cuadro está vacío o no (para el botón de enviar),
 * y lee el texto de verdad cuando hace falta (al enviar o traducir).
 *
 * Por debajo el valor sigue siendo el mismo "texto fuente" de siempre: texto plano con saltos de
 * línea y, como único marcado, etiquetas `<a href="…">texto</a>`. Así todo lo que ya trabaja con
 * ese texto (IA, plantillas, traducción, firma y el envío) sigue igual.
 */
export type RichReplyHandle = {
  focus(): void;
  /** Inserta un enlace donde estaba el cursor (o al final). */
  insertLink(url: string, text?: string): void;
  /** Inserta texto fuente (puede llevar <a>) donde estaba el cursor (o al final). */
  insertText(source: string): void;
  /** Reemplaza TODO el contenido (IA, plantilla, traducción, limpiar). */
  setSource(source: string): void;
  /** El texto fuente actual, leído del DOM (para enviar / traducir). */
  getSource(): string;
  /** ¿Está vacío? */
  isEmpty(): boolean;
};

interface Props {
  /** Contenido inicial (sólo se aplica al montar). Los cambios en vivo van por setSource(). */
  defaultValue?: string;
  /** Avisa SÓLO cuando cambia el estar-vacío (no en cada tecla): para el botón de enviar. */
  onEmptyChange?: (empty: boolean) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

const ANCHOR_RE = /(<a\s+[^>]*href=["'][^"']*["'][^>]*>[\s\S]*?<\/a>)/gi;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto fuente → HTML para pintar: los <a> se vuelven enlaces reales, el resto se escapa
 *  (una etiqueta escrita a mano sigue viéndose tal cual) y cada salto de línea es un <br>. */
export function sourceToHtml(src: string): string {
  return (src || "")
    .split(ANCHOR_RE)
    .map((part, i) => {
      if (i % 2 === 1) {
        const href = /href=["']([^"']*)["']/i.exec(part)?.[1] || "";
        const text = part.replace(/^<a[^>]*>/i, "").replace(/<\/a>$/i, "").replace(/<[^>]+>/g, "");
        return `<a href="${esc(href)}" title="${esc(href)}">${esc(text || href)}</a>`;
      }
      return esc(part).replace(/\r?\n/g, "<br>");
    })
    .join("");
}

/** DOM del editor → texto fuente. Los <div>/<p> que crea el navegador al pulsar Intro son
 *  saltos de línea; un <a> vuelve a ser `<a href="…">texto</a>`; el resto, su texto. */
export function domToSource(root: Node): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.nodeValue || ""; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "BR") { out += "\n"; return; }
    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      const text = el.textContent || href;
      out += `<a href="${href}">${text}</a>`;
      return;
    }
    const block = /^(DIV|P|LI|TR|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag);
    if (block && out.length > 0 && !out.endsWith("\n")) out += "\n";
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

const RichReplyEditor = forwardRef<RichReplyHandle, Props>(function RichReplyEditor(
  { defaultValue, onEmptyChange, placeholder, className, id },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const wasEmpty = useRef<boolean>(true);

  // Guarda dónde estaba el cursor: al pulsar el botón de enlace el foco se va al popover
  // y el editor pierde la selección; con esto insertamos en el sitio correcto.
  const saveRange = useCallback(() => {
    const sel = window.getSelection();
    const el = elRef.current;
    if (!sel || !el || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (el.contains(r.commonAncestorContainer)) lastRange.current = r.cloneRange();
  }, []);

  /** Sólo avisa a React cuando cambia el estar-vacío (nunca en cada tecla). */
  const notifyEmpty = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    // Un editor "vacío" en Chrome se queda con un <br> suelto: lo limpiamos para que el
    // placeholder (:empty) vuelva a salir.
    if (el.innerHTML === "<br>" || el.innerHTML === "<div><br></div>") el.innerHTML = "";
    const empty = domToSource(el).trim() === "";
    if (empty !== wasEmpty.current) { wasEmpty.current = empty; onEmptyChange?.(empty); }
  }, [onEmptyChange]);

  // Contenido inicial: se pone UNA vez al montar. Los cambios posteriores van por setSource().
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (defaultValue) { el.innerHTML = sourceToHtml(defaultValue); wasEmpty.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertNodes = useCallback((nodes: Node[]) => {
    const el = elRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let range = lastRange.current && el.contains(lastRange.current.commonAncestorContainer) ? lastRange.current : null;
    if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
    range.deleteContents();
    let last: Node | null = null;
    for (const n of nodes) { range.insertNode(n); range.setStartAfter(n); range.collapse(true); last = n; }
    if (sel && last) { sel.removeAllRanges(); sel.addRange(range); }
    lastRange.current = range.cloneRange();
    notifyEmpty();
  }, [notifyEmpty]);

  useImperativeHandle(ref, () => ({
    focus: () => elRef.current?.focus(),
    insertLink: (url, text) => {
      const a = document.createElement("a");
      a.href = url;
      a.title = url;
      a.textContent = (text || "").trim() || url;
      insertNodes([a, document.createTextNode(" ")]);
    },
    insertText: (source) => {
      const tpl = document.createElement("template");
      tpl.innerHTML = sourceToHtml(source);
      insertNodes(Array.from(tpl.content.childNodes));
    },
    setSource: (source) => {
      const el = elRef.current;
      if (!el) return;
      el.innerHTML = sourceToHtml(source || "");
      if (document.activeElement === el) placeCaretAtEnd(el);
      notifyEmpty();
    },
    getSource: () => {
      const el = elRef.current;
      return el ? domToSource(el) : "";
    },
    isEmpty: () => {
      const el = elRef.current;
      return el ? domToSource(el).trim() === "" : true;
    },
  }), [insertNodes, notifyEmpty]);

  // Pegar: sólo texto plano (nada de HTML ajeno). Si lo pegado trae un <a href> escrito,
  // se repinta como enlace.
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = sourceToHtml(text);
    saveRange();
    insertNodes(Array.from(tpl.content.childNodes));
  };

  // Clic en un enlace → se abre en otra pestaña (en un contentEditable el navegador no
  // navega solo).
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a && a.getAttribute("href")) {
      e.preventDefault();
      window.open(a.getAttribute("href")!, "_blank", "noopener,noreferrer");
    }
  };

  useEffect(() => {
    document.addEventListener("selectionchange", saveRange);
    return () => document.removeEventListener("selectionchange", saveRange);
  }, [saveRange]);

  return (
    <div
      ref={elRef}
      id={id}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={notifyEmpty}
      onPaste={onPaste}
      onClick={onClick}
      onKeyUp={saveRange}
      onMouseUp={saveRange}
      onBlur={saveRange}
      className={cn(
        "whitespace-pre-wrap break-words outline-none",
        "empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        "[&_a]:cursor-pointer [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        className,
      )}
    />
  );
});

function placeCaretAtEnd(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export default RichReplyEditor;
