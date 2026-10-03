import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bold, ChevronDown, ChevronLeft, Italic, Link2, Loader2, MoreVertical, Paperclip, Search, Send, Smile, Trash2, Underline, X } from "lucide-react";
import { cleanBodyText, decodeSubject } from "@/lib/unibox-text";
import { textFromHtml } from "@/lib/reply-text";
import { forwardSubject } from "@/lib/forward";
import { editorToSource, quoteHeader, replySubject, type Conversation } from "@/lib/mobile-inbox";
import { searchAccounts, sendForward, sendReply, type ThreadMessage } from "./mail-actions";
import { ConfirmSheet, Sheet, SheetRow, SquareButton } from "./ui";
import { sourceToHtml } from "@/components/unibox/RichReplyEditor";
import { TemplatesBar, TemplatesSheet, useTemplates, type ReplyTemplate } from "./Templates";

interface Props {
  mode: "reply" | "forward";
  userId: string;
  conv: Conversation;
  thread: ThreadMessage[] | null;
  accountEmails: Record<string, string>;
  onClose: () => void;
  onSent: (text: string) => void;
  onError: (text: string) => void;
  /** Un aviso que no cierra el redactor (p. ej. "plantilla guardada"). */
  onNotice: (text: string) => void;
}

const EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
const MAX_ATTACH = 18 * 1024 * 1024;
const EMOJIS = ["😀", "😊", "🙂", "😉", "😄", "😁", "🤝", "👍", "👏", "🙌", "🙏", "💪", "🎉", "🚀", "🔥", "✅", "📅", "📞", "📩", "📈", "💡", "⭐", "❤️", "😅", "🤔", "👀", "👌", "✌️", "☕", "📌", "⏰", "💬"];

/** Alto real visible (teclado incluido): la barra de formato se queda siempre encima del teclado. */
function useVisualViewport() {
  const [vv, setVv] = useState<{ h: number; top: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    // Con la app en "absolute" (iPhone, documento alargado) el arriba de lo visible se mide desde
    // el documento (pageTop); con la app "fixed", desde la ventana (offsetTop).
    const update = () => setVv({ h: v.height, top: document.documentElement.classList.contains("m-shim") ? v.pageTop : v.offsetTop });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => { v.removeEventListener("resize", update); v.removeEventListener("scroll", update); };
  }, []);
  return vv;
}

export function Composer(p: Props) {
  const vv = useVisualViewport();
  const editorRef = useRef<HTMLDivElement>(null);
  const draftKey = `m-draft:${p.mode}:${p.conv.key}`;

  // El mensaje al que se responde: el último que nos llegó con Message-ID.
  const source = useMemo(() => {
    const list = p.thread && p.thread.length ? p.thread : [{ ...p.conv.latest, _type: "received", _date: p.conv.latest.received_at } as ThreadMessage];
    const received = list.filter((m) => m._type === "received");
    return (received.filter((m) => m.message_id).pop() || received.pop() || list[list.length - 1]) as ThreadMessage;
  }, [p.thread, p.conv.latest]);

  const [to, setTo] = useState<string[]>(p.mode === "reply" ? [p.conv.email] : []);
  const [toInput, setToInput] = useState("");
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [fromId, setFromId] = useState(p.conv.accountId);
  const [subject, setSubject] = useState(() => p.mode === "reply" ? replySubject(source.subject) : forwardSubject(decodeSubject(source.subject ?? null)));
  const [empty, setEmpty] = useState(true);
  const [files, setFiles] = useState<{ filename: string; mime: string; base64: string; size: number }[]>([]);
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<null | "from" | "link" | "emoji" | "size" | "menu" | "discard" | "templates">(null);
  const templates = useTemplates();
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false });
  const savedRange = useRef<Range | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Borrador guardado de esta conversación (si se salió sin enviar).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) { el.innerHTML = saved; setEmpty(!el.textContent?.trim()); }
    } catch { /* sin almacenamiento */ }
    // Foco directo al abrir para escribir ya (el teclado sale con el toque que abrió esto).
    const t = window.setTimeout(() => { if (p.mode === "reply") focusEnd(el); }, 320);
    return () => window.clearTimeout(t);
  }, [draftKey, p.mode]);

  const saveDraft = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    try {
      if (el.textContent?.trim()) localStorage.setItem(draftKey, el.innerHTML);
      else localStorage.removeItem(draftKey);
    } catch { /* sin almacenamiento */ }
  }, [draftKey]);

  // Estado de B / I / U según dónde está el cursor.
  useEffect(() => {
    const onSel = () => {
      const el = editorRef.current;
      const sel = document.getSelection();
      if (!el || !sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
      savedRange.current = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      try {
        setFmt({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), underline: document.queryCommandState("underline") });
      } catch { /* navegador sin queryCommandState */ }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const restoreRange = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const sel = document.getSelection();
    if (savedRange.current && sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
    else focusEnd(el);
  };
  const exec = (cmd: string, value?: string) => {
    restoreRange();
    try { document.execCommand(cmd, false, value); } catch { /* sin execCommand */ }
    const el = editorRef.current;
    setEmpty(!el?.textContent?.trim());
    saveDraft();
  };

  /** Pone una plantilla donde estaba el cursor (o al final). Si el cuadro está vacío, lo llena. */
  const insertTemplate = (t: ReplyTemplate) => {
    const el = editorRef.current;
    if (!el) return;
    const html = sourceToHtml(t.body || "");
    if (!el.textContent?.trim()) {
      el.innerHTML = html;
      savedRange.current = null;
    } else {
      const tpl = document.createElement("template");
      tpl.innerHTML = (savedRange.current ? "" : "<br><br>") + html;
      const last = tpl.content.lastChild;
      let range = savedRange.current && el.contains(savedRange.current.startContainer) ? savedRange.current : null;
      if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
      range.deleteContents();
      range.insertNode(tpl.content);
      if (last) { const r = document.createRange(); r.setStartAfter(last); r.collapse(true); savedRange.current = r; }
    }
    // El cursor, justo detrás de lo puesto (o al final si el cuadro estaba vacío).
    const after = savedRange.current;
    if (after && el.contains(after.startContainer)) {
      el.focus({ preventScroll: true });
      const sel = document.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(after); }
    } else {
      focusEnd(el);
    }
    setEmpty(!el.textContent?.trim());
    saveDraft();
  };

  const addChip = (raw: string, list: string[], set: (v: string[]) => void): boolean => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    let ok = true;
    const next = [...list];
    for (const part of parts) {
      if (!EMAIL_RE.test(part)) { ok = false; continue; }
      if (!next.includes(part)) next.push(part);
    }
    set(next);
    return ok;
  };

  const pickFiles = async (fl: FileList | null) => {
    if (!fl) return;
    const total = files.reduce((n, f) => n + f.size, 0);
    const add: typeof files = [];
    let size = total;
    for (const file of Array.from(fl)) {
      if (size + file.size > MAX_ATTACH) { p.onError("Los adjuntos no pueden pasar de 18 MB en total."); break; }
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      add.push({ filename: file.name, mime: file.type || "application/octet-stream", base64, size: file.size });
      size += file.size;
    }
    setFiles((prev) => [...prev, ...add]);
  };

  const send = async () => {
    const el = editorRef.current;
    if (!el || sending) return;
    // Lo que quedó escrito sin convertir en burbuja también cuenta.
    const withTyped = (list: string[], raw: string) => {
      const out = [...list];
      for (const x of raw.split(/[\s,;]+/)) { const v = x.trim().toLowerCase(); if (EMAIL_RE.test(v) && !out.includes(v)) out.push(v); }
      return out;
    };
    const toAll = withTyped(to, toInput);
    const ccAll = withTyped(cc, ccInput);
    if (toAll.length === 0) { p.onError("Añade al menos un destinatario."); return; }
    const body = p.mode === "forward" ? (el.innerText || "").trim() : editorToSource(el);
    if (p.mode === "reply" && !body.trim() && files.length === 0) { p.onError("Escribe la respuesta antes de enviarla."); return; }
    setSending(true);
    try {
      const out = {
        accountId: fromId,
        to: toAll[0],
        cc: [...toAll.slice(1), ...ccAll].filter((x) => x !== toAll[0]),
        subject: subject.trim(),
        body,
        attachments: files.map(({ filename, mime, base64 }) => ({ filename, mime, base64 })),
      };
      const r = p.mode === "reply"
        ? await sendReply(p.userId, p.thread || [source], out)
        : await sendForward(source, p.accountEmails[p.conv.accountId] || "", out);
      try { localStorage.removeItem(draftKey); } catch { /* nada */ }
      p.onSent(p.mode === "reply" ? (out.cc.length ? `Respuesta enviada a ${out.cc.length + 1} personas` : "Respuesta enviada") : `Reenviado a ${out.to}`);
      // El servidor cambió un enlace que IONOS no entrega: decirlo (y corregir la plantilla).
      if (r.linkFixes.length > 0) {
        const txt = `Enlace cambiado para que llegue: ${r.linkFixes.map((f) => `${f.from} → ${f.to}`).join(", ")}`;
        window.setTimeout(() => p.onNotice(txt), 2600);
      }
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const discard = () => {
    try { localStorage.removeItem(draftKey); } catch { /* nada */ }
    p.onClose();
  };

  const quote = useMemo(() => {
    const text = source.body_html && source.body_html.trim().length > 20
      ? textFromHtml(source.body_html)
      : cleanBodyText(source.body_text ?? source.body ?? null);
    return { header: p.mode === "reply" ? quoteHeader(source) : "---------- Mensaje reenviado ----------", text: text.trim().slice(0, 4000) };
  }, [source, p.mode]);

  const fromEmail = p.accountEmails[fromId] || p.accountEmails[p.conv.accountId] || "";
  const canSend = !sending && (to.length > 0 || EMAIL_RE.test(toInput.trim())) && (p.mode === "forward" || !empty || files.length > 0);

  // Con el teclado fuera no hace falta el margen de la barra de inicio del iPhone.
  const kbOpen = !!vv && vv.h < window.innerHeight - 120;
  // Teclado fuera: toda la app (su altura ya corregida en iPhone). Teclado dentro: lo visible.
  const style = vv && kbOpen ? { height: vv.h, transform: `translate3d(0, ${vv.top}px, 0)` } : { height: "100%" };

  return (
    <div className="m-page absolute inset-x-0 top-0 flex flex-col" style={style}>
      {/* Cabecera */}
      <div className="flex items-center gap-3 px-4 pb-2 pt-[calc(14px+env(safe-area-inset-top))]">
        <SquareButton label="Volver" onClick={() => { saveDraft(); p.onClose(); }}><ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} /></SquareButton>
        <div className="min-w-0 flex-1 pl-1">
          <h2 className="text-[20px] font-bold leading-tight text-[#141A45]">{p.mode === "reply" ? "Responder" : "Reenviar"}</h2>
          <p className="truncate text-[14px] text-[#8C93B8]">{subject || "(sin asunto)"}</p>
        </div>
        <SquareButton label="Opciones" onClick={() => setSheet("menu")}><MoreVertical className="h-[20px] w-[20px]" strokeWidth={2.2} /></SquareButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pb-2 pt-1.5">
        {/* Para */}
        <div className="m-card shrink-0 rounded-[14px] px-3.5 py-2.5">
          <div className="flex items-start gap-3">
            <span className="w-[44px] shrink-0 pt-[7px] text-[15px] text-[#3A4163]">Para</span>
            <ChipInput values={to} onRemove={(v) => setTo(to.filter((x) => x !== v))} input={toInput} setInput={setToInput}
              onCommit={(raw) => addChip(raw, to, setTo)} placeholder={to.length ? "Añadir más destinatarios..." : "Email del destinatario"} />
            <button type="button" aria-label="Copia (Cc)" onClick={() => setCcOpen((v) => !v)} className="m-press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#5B6283]">
              <ChevronDown className={`h-[18px] w-[18px] transition-transform ${ccOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          {ccOpen && (
            <div className="mt-1.5 flex items-start gap-3 border-t border-[#F0F2F7] pt-2">
              <span className="w-[44px] shrink-0 pt-[7px] text-[15px] text-[#3A4163]">Cc</span>
              <ChipInput values={cc} onRemove={(v) => setCc(cc.filter((x) => x !== v))} input={ccInput} setInput={setCcInput}
                onCommit={(raw) => addChip(raw, cc, setCc)} placeholder="Añadir en copia..." />
            </div>
          )}
        </div>

        {/* De */}
        <div className="m-card flex h-[50px] shrink-0 items-center gap-3 rounded-[14px] pl-3.5 pr-2">
          <span className="w-[44px] shrink-0 text-[15px] text-[#3A4163]">De</span>
          <button type="button" onClick={() => setSheet("from")}
            className="m-press flex h-[36px] min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-[#E3E7F2] bg-white pl-2.5 pr-2 text-left">
            <span className="min-w-0 flex-1 truncate text-[15px] text-[#1B2140]">{fromEmail || "Elegir buzón"}</span>
            <ChevronDown className="h-[17px] w-[17px] shrink-0 text-[#5B6283]" />
          </button>
        </div>

        {/* Asunto */}
        <div className="m-card flex h-[48px] shrink-0 items-center rounded-[14px] pl-3.5 pr-3">
          <span className="w-[56px] shrink-0 text-[15px] text-[#3A4163]">Asunto</span>
          <span className="mx-2.5 h-6 w-px bg-[#E6E9F2]" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#1B2140] outline-none" />
        </div>

        {/* Cuerpo + cita */}
        <div className="m-card m-scroll min-h-[90px] flex-1 rounded-[16px] px-4 py-3.5" onClick={(e) => { if (e.target === e.currentTarget) focusEnd(editorRef.current); }}>
          <div
            ref={editorRef}
            className="m-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={p.mode === "reply" ? "Respuesta" : "Nota del reenvío"}
            data-placeholder={p.mode === "reply" ? "" : "Añade una nota (opcional)…"}
            onInput={(e) => { setEmpty(!(e.currentTarget.textContent || "").trim()); saveDraft(); }}
            onPaste={(e) => {
              // Se pega como texto (los estilos de otra web estropeaban el correo).
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              document.execCommand("insertText", false, text);
            }}
          />
          {(quote.header || quote.text) && (
            <div className="m-quote mt-6 select-text whitespace-pre-wrap">
              {quote.header && <div className="mb-0.5">{quote.header}</div>}
              {p.mode === "forward" && (
                <div className="mb-2">
                  De: {source.from_name ? `${source.from_name} ` : ""}&lt;{source.from_email}&gt;{"\n"}Asunto: {decodeSubject(source.subject ?? null)}
                </div>
              )}
              {quote.text}
            </div>
          )}
        </div>

        {files.length > 0 && (
          <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5">
            {files.map((f, i) => (
              <span key={i} className="flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[#E3E7F2] bg-white py-1.5 pl-2.5 pr-1.5 text-[13px] text-[#1B2140]">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#6E58F1]" />
                <span className="min-w-0 truncate">{f.filename}</span>
                <button type="button" aria-label={`Quitar ${f.filename}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="flex h-5 w-5 items-center justify-center rounded-full text-[#7A809B]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Plantillas: el botón con todas y las primeras a un toque */}
        <TemplatesBar templates={templates.list} onOpen={() => setSheet("templates")} onPick={insertTemplate} />

        {/* Barra de formato + papelera + enviar */}
        <div className="flex shrink-0 items-center gap-2.5" style={{ paddingBottom: kbOpen ? 6 : "calc(6px + env(safe-area-inset-bottom))" }}>
          <div className="m-card flex h-[48px] min-w-0 flex-1 items-center justify-between rounded-[14px] px-2">
            <ToolButton label="Tamaño del texto" onPress={() => setSheet("size")}><span className="text-[17px] font-medium tracking-[-0.02em]">Aa</span></ToolButton>
            <ToolButton label="Negrita" active={fmt.bold} onPress={() => exec("bold")}><Bold className="h-[19px] w-[19px]" strokeWidth={2.8} /></ToolButton>
            <ToolButton label="Cursiva" active={fmt.italic} onPress={() => exec("italic")}><Italic className="h-[19px] w-[19px]" strokeWidth={2.2} /></ToolButton>
            <ToolButton label="Subrayado" active={fmt.underline} onPress={() => exec("underline")}><Underline className="h-[19px] w-[19px]" strokeWidth={2.2} /></ToolButton>
            <ToolButton label="Enlace" onPress={() => setSheet("link")}><Link2 className="h-[19px] w-[19px]" strokeWidth={2.2} /></ToolButton>
            <ToolButton label="Adjuntar" onPress={() => fileInput.current?.click()}><Paperclip className="h-[19px] w-[19px]" strokeWidth={2.2} /></ToolButton>
            <ToolButton label="Emoji" onPress={() => setSheet("emoji")}><Smile className="h-[20px] w-[20px]" strokeWidth={2} /></ToolButton>
          </div>
          <span className="h-8 w-px shrink-0 bg-[#E0E4EE]" />
          <button type="button" aria-label="Descartar" onPointerDown={(e) => e.preventDefault()}
            onClick={() => (empty && files.length === 0 ? discard() : setSheet("discard"))}
            className="m-press m-card flex h-[48px] w-[46px] shrink-0 items-center justify-center rounded-[13px] text-[#EF4A62]">
            <Trash2 className="h-[19px] w-[19px]" strokeWidth={1.9} />
          </button>
          <button type="button" aria-label="Enviar" disabled={!canSend} onPointerDown={(e) => e.preventDefault()} onClick={send}
            className="m-press m-gradient flex h-[48px] w-[66px] shrink-0 items-center justify-center rounded-[13px] text-white disabled:opacity-50 disabled:shadow-none">
            {sending ? <Loader2 className="m-spin h-5 w-5" /> : <Send className="h-[21px] w-[21px]" strokeWidth={2} />}
          </button>
        </div>
      </div>

      <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { void pickFiles(e.target.files); e.target.value = ""; }} />

      {/* Hojas */}
      <FromSheet open={sheet === "from"} onClose={() => setSheet(null)} userId={p.userId} current={fromId}
        defaultId={p.conv.accountId} defaultEmail={p.accountEmails[p.conv.accountId] || ""}
        onPick={(id) => { setFromId(id); setSheet(null); }} />
      <LinkSheet open={sheet === "link"} onClose={() => setSheet(null)} selectedText={savedRange.current?.toString() || ""}
        onInsert={(url, text) => {
          setSheet(null);
          window.setTimeout(() => {
            restoreRange();
            const sel = document.getSelection();
            if (sel && sel.rangeCount && !sel.isCollapsed) document.execCommand("createLink", false, url);
            else document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${escapeHtml(text || url)}</a>&nbsp;`);
            setEmpty(false); saveDraft();
          }, 60);
        }} />
      <Sheet open={sheet === "emoji"} onClose={() => setSheet(null)} title="Emoji">
        <div className="grid grid-cols-8 gap-1 px-1 pb-2">
          {EMOJIS.map((em) => (
            <button key={em} type="button" className="m-press flex h-11 items-center justify-center rounded-[10px] text-[24px] active:bg-[#F3F5FB]"
              onClick={() => { setSheet(null); window.setTimeout(() => { restoreRange(); document.execCommand("insertText", false, em); setEmpty(false); saveDraft(); }, 60); }}>
              {em}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={sheet === "size"} onClose={() => setSheet(null)} title="Texto">
        <SheetRow label={<span className="text-[13px]">Pequeño</span>} onClick={() => { setSheet(null); window.setTimeout(() => exec("fontSize", "2"), 60); }} />
        <SheetRow label="Normal" onClick={() => { setSheet(null); window.setTimeout(() => exec("fontSize", "3"), 60); }} />
        <SheetRow label={<span className="text-[19px]">Grande</span>} onClick={() => { setSheet(null); window.setTimeout(() => exec("fontSize", "5"), 60); }} />
        <SheetRow label="Quitar formato" onClick={() => { setSheet(null); window.setTimeout(() => exec("removeFormat"), 60); }} />
      </Sheet>
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)}>
        <SheetRow label={ccOpen ? "Quitar copia (Cc)" : "Añadir copia (Cc)"} onClick={() => { setCcOpen((v) => !v); setSheet(null); }} />
        <SheetRow label="Adjuntar archivo" onClick={() => { setSheet(null); fileInput.current?.click(); }} />
        <SheetRow label="Descartar borrador" danger onClick={() => setSheet("discard")} />
      </Sheet>
      <TemplatesSheet open={sheet === "templates"} onClose={() => setSheet(null)}
        templates={templates.list} loaded={templates.loaded} canSave={!empty}
        onPick={(t) => { setSheet(null); insertTemplate(t); }}
        onSave={async (name) => {
          const el = editorRef.current;
          if (!el) return;
          try { await templates.save(name, editorToSource(el)); p.onNotice(`Plantilla «${name.trim()}» guardada`); }
          catch (e) { p.onError(e instanceof Error ? e.message : String(e)); }
        }}
        onRemove={async (id) => {
          try { await templates.remove(id); } catch (e) { p.onError(e instanceof Error ? e.message : String(e)); }
        }} />
      <ConfirmSheet open={sheet === "discard"} title="¿Descartar el borrador?" text="Se borra lo que has escrito en esta respuesta."
        confirmLabel="Descartar" danger onConfirm={discard} onClose={() => setSheet(null)} />
    </div>
  );
}

function ToolButton({ label, active, onPress, children }: { label: string; active?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active}
      // Sin perder el foco del cuadro de texto (si no, el teclado se cierra y se pierde la selección).
      onPointerDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`m-press flex h-9 w-9 items-center justify-center rounded-[9px] ${active ? "bg-[#E8EDFD] text-[#2F55E0]" : "text-[#25306A]"}`}>
      {children}
    </button>
  );
}

function ChipInput({ values, onRemove, input, setInput, onCommit, placeholder }: {
  values: string[]; onRemove: (v: string) => void; input: string; setInput: (v: string) => void; onCommit: (raw: string) => boolean; placeholder: string;
}) {
  const commit = () => { if (input.trim() && onCommit(input)) setInput(""); };
  return (
    <div className="min-w-0 flex-1">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="flex h-[34px] max-w-full items-center gap-2 rounded-[9px] bg-[#E9EEFC] pl-2.5 pr-1.5 text-[15px] text-[#1B2140]">
              <span className="min-w-0 truncate">{v}</span>
              <button type="button" aria-label={`Quitar ${v}`} onClick={() => onRemove(v)} className="flex h-6 w-6 items-center justify-center rounded-md text-[#4A5694]">
                <X className="h-[15px] w-[15px]" strokeWidth={2.2} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={input}
        onChange={(e) => { const v = e.target.value; if (/[\s,;]$/.test(v) && v.trim()) { if (onCommit(v)) { setInput(""); return; } } setInput(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Backspace" && !input && values.length) onRemove(values[values.length - 1]); }}
        onBlur={commit}
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        className={`bg-transparent text-[16px] text-[#1B2140] outline-none placeholder:text-[#A0A6C0] ${values.length ? "mt-1 h-8 w-[114.3%] origin-left scale-[.875]" : "h-[34px] w-full"}`}
      />
    </div>
  );
}

function FromSheet({ open, onClose, userId, current, defaultId, defaultEmail, onPick }: {
  open: boolean; onClose: () => void; userId: string; current: string; defaultId: string; defaultEmail: string; onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ id: string; email: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(async () => {
      const rows = await searchAccounts(userId, q).catch(() => []);
      if (alive) { setList(rows); setBusy(false); }
    }, q ? 220 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [open, q, userId]);
  const rows = [{ id: defaultId, email: defaultEmail }, ...list.filter((a) => a.id !== defaultId)].filter((a) => a.email);
  return (
    <Sheet open={open} onClose={onClose} title="Enviar desde">
      <label className="mx-2 mb-2 flex h-11 items-center gap-2 rounded-[12px] border border-[#E6E9F3] bg-[#F8F9FD] px-3">
        <Search className="h-4 w-4 text-[#7A809B]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar buzón…" autoCapitalize="none" autoCorrect="off"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#9AA0BA]" />
        {busy && <Loader2 className="m-spin h-4 w-4 text-[#9AA0BA]" />}
      </label>
      {rows.map((a) => (
        <SheetRow key={a.id} label={a.email} hint={a.id === defaultId ? "Buzón que recibió la respuesta (recomendado)" : undefined}
          selected={a.id === current} onClick={() => onPick(a.id)} />
      ))}
      {!busy && rows.length === 0 && <p className="px-3 py-4 text-center text-[14px] text-[#7A809B]">Sin resultados</p>}
    </Sheet>
  );
}

function LinkSheet({ open, onClose, selectedText, onInsert }: { open: boolean; onClose: () => void; selectedText: string; onInsert: (url: string, text: string) => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  useEffect(() => { if (open) { setUrl(""); setText(selectedText); } }, [open, selectedText]);
  const clean = (u: string) => { const t = u.trim(); if (!t) return ""; return /^(https?:|mailto:|tel:)/i.test(t) ? t : `https://${t}`; };
  return (
    <Sheet open={open} onClose={onClose} title="Insertar enlace">
      <div className="space-y-2.5 px-2 pb-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" autoCapitalize="none" autoCorrect="off" autoFocus
          className="h-12 w-full rounded-[12px] border border-[#E3E7F2] bg-[#F8F9FD] px-3.5 text-[16px] outline-none focus:border-[#AFC0F8]" />
        {!selectedText && (
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Texto que se verá (opcional)"
            className="h-12 w-full rounded-[12px] border border-[#E3E7F2] bg-[#F8F9FD] px-3.5 text-[16px] outline-none focus:border-[#AFC0F8]" />
        )}
        <button type="button" disabled={!clean(url)} onClick={() => onInsert(clean(url), text.trim())}
          className="m-press m-gradient h-12 w-full rounded-[13px] text-[16px] font-semibold text-white disabled:opacity-50">
          Insertar
        </button>
      </div>
    </Sheet>
  );
}

function focusEnd(el: HTMLElement | null) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const sel = document.getSelection();
  if (!sel) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
