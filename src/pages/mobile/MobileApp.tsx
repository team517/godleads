import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Ban, Copy as CopyIcon, Folder, FolderMinus, FolderPlus, Loader2, Mail, MailOpen, Star, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ensurePushSubscription, registerServiceWorker } from "@/lib/push-notifications";
import { startVersionWatcher } from "@/lib/version-check";
import {
  EMPTY_FILTERS, LEAD_STATUSES, effectiveStatus, filterConversations, statusCounts,
  type Conversation, type LeadStatus, type MobileFilters,
} from "@/lib/mobile-inbox";
import { useMobileInbox } from "./useMobileInbox";
import { ensureAiSentThread, loadLeadInfo, loadThread, type LeadInfo, type ThreadMessage } from "./mail-actions";
import { ConversationList } from "./ConversationList";
import { FilterDrawer } from "./FilterDrawer";
import { ThreadView } from "./ThreadView";
import { Composer } from "./Composer";
import { AccountView } from "./AccountView";
import { PushBanner } from "./PushBanner";
import { useIosStandaloneShim } from "./useIosStandaloneShim";
import { Bolt, ConfirmSheet, Sheet, SheetRow, useToast } from "./ui";
import "./mobile.css";

/* La app del móvil: sólo la Unibox (las respuestas) y la cuenta, con el diseño de Instantly.
   Cada pantalla que se abre (conversación, responder, filtros, hojas) entra en el historial,
   así el botón "atrás" del móvil la cierra en vez de salir de la app. */

type SheetKind = null | "status" | "move" | "more" | "info" | "delete" | "block";
type Layer = "drawer" | "thread" | "compose" | "sheet";

const TAB_KEY = "m-tab";

export default function MobileApp() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const inbox = useMobileInbox(user?.id);
  const toast = useToast();
  useIosStandaloneShim();

  const [nav, setNav] = useState<"unibox" | "account">("unibox");
  const [filters, setFilters] = useState<MobileFilters>(() => {
    let tab: "primary" | "others" = "primary";
    try { if (sessionStorage.getItem(TAB_KEY) === "others") tab = "others"; } catch { /* nada */ }
    return { ...EMPTY_FILTERS, tab };
  });

  // Capas abiertas (de abajo arriba). Cada una tiene su entrada en el historial.
  const [layers, setLayers] = useState<Layer[]>([]);
  const layersRef = useRef<Layer[]>([]);
  layersRef.current = layers;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  const [compose, setCompose] = useState<"reply" | "forward" | null>(null);
  const [leavingCompose, setLeavingCompose] = useState<"reply" | "forward" | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);

  const closeTop = useCallback((top: Layer | undefined) => {
    if (top === "sheet") setSheet(null);
    else if (top === "compose") {
      setCompose((c) => { if (c) { setLeavingCompose(c); window.setTimeout(() => setLeavingCompose(null), 240); } return null; });
    } else if (top === "thread") {
      setOpenKey((k) => { if (k) { setLeavingKey(k); window.setTimeout(() => setLeavingKey(null), 240); } return null; });
    }
    // "drawer" se cierra solo al salir de la lista de capas (ver render).
  }, []);

  useEffect(() => {
    // Con history.go(-2) llega UN solo popstate: se cierran todas las capas que sobran según la
    // profundidad guardada en la entrada a la que se ha vuelto.
    const onPop = (e: PopStateEvent) => {
      const st = (e.state || {}) as { mLayer?: number; usr?: { mLayer?: number } };
      const depth = Number(st.mLayer ?? st.usr?.mLayer ?? 0);
      const cur = layersRef.current;
      if (cur.length <= depth) return;
      const closing = cur.slice(depth).reverse();
      layersRef.current = cur.slice(0, depth);
      setLayers(cur.slice(0, depth));
      closing.forEach(closeTop);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [closeTop]);

  const push = useCallback((layer: Layer) => {
    const next = [...layersRef.current, layer];
    window.history.pushState({ ...(window.history.state || {}), mLayer: next.length }, "");
    layersRef.current = next;
    setLayers(next);
  }, []);
  /** Cerrar la capa de arriba (o varias) pasa siempre por el historial. */
  const back = useCallback((n = 1) => {
    const k = Math.min(n, layersRef.current.length);
    if (k > 0) window.history.go(-k);
  }, []);

  const drawerOpen = layers.includes("drawer");

  /* ── Arranque: avisos, actualizaciones y color de la barra del sistema ── */
  useEffect(() => {
    startVersionWatcher();
    void registerServiceWorker();
    if (user?.id) void ensurePushSubscription(user.id);
  }, [user?.id]);
  useEffect(() => {
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const prev = metas.map((m) => m.content);
    metas.forEach((m) => { m.content = "#FFFFFF"; });
    const html = document.documentElement;
    const hadDark = html.classList.contains("dark");
    html.classList.remove("dark");
    return () => {
      metas.forEach((m, i) => { m.content = prev[i]; });
      if (hadDark) html.classList.add("dark");
    };
  }, []);

  /* ── Datos derivados ── */
  const statusOf = useCallback((c: Conversation) => effectiveStatus(c, inbox.manual), [inbox.manual]);
  const visible = useMemo(() => filterConversations(inbox.conversations, filters, inbox.manual, inbox.othersFloor), [inbox.conversations, filters, inbox.manual, inbox.othersFloor]);
  const counts = useMemo(() => statusCounts(inbox.conversations, filters, inbox.manual, inbox.othersFloor), [inbox.conversations, filters, inbox.manual, inbox.othersFloor]);
  const activeFilterCount = (filters.status ? 1 : 0) + (filters.accountId ? 1 : 0) + (filters.campaignId ? 1 : 0)
    + (filters.unreadOnly ? 1 : 0) + (filters.importantOnly ? 1 : 0) + (filters.folderId ? 1 : 0);
  const unreadTotal = useMemo(() => inbox.conversations.filter((c) => c.unreadIds.length).length, [inbox.conversations]);

  const byKey = useMemo(() => new Map(inbox.conversations.map((c) => [c.key, c])), [inbox.conversations]);
  const conv = openKey ? byKey.get(openKey) || null : null;
  const shownConv = conv || (leavingKey ? byKey.get(leavingKey) || null : null);

  /* ── Hilo de la conversación abierta ── */
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const threadFor = useRef<string | null>(null);
  const refreshThread = useCallback(async (c: Conversation) => {
    if (!user) return;
    try {
      // En Others se enseña el hilo tal cual (warm-up y rebotes incluidos: es lo que se ve en la lista).
      const t = await loadThread(user.id, c.accountId, c.email, { all: c.tab === "others" });
      if (threadFor.current === c.key) { setThread(t); setThreadError(null); }
    } catch (e) {
      if (threadFor.current === c.key) setThreadError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (!openKey) return;
    const c = byKey.get(openKey);
    if (!c || threadFor.current === openKey) return;
    threadFor.current = openKey;
    setThread(null);
    setThreadError(null);
    void inbox.markRead(c);
    void refreshThread(c).then(async () => {
      // Si la IA respondió sola, que su respuesta aparezca en el hilo (luego se recarga).
      await ensureAiSentThread(c.accountId, c.email);
      if (threadFor.current === c.key) void refreshThread(c);
    });
  }, [openKey, byKey, inbox, refreshThread]);
  useEffect(() => { if (!openKey && !leavingKey) threadFor.current = null; }, [openKey, leavingKey]);

  const openConversation = useCallback((c: Conversation) => {
    setOpenKey(c.key);
    push("thread");
  }, [push]);

  /* ── Abrir desde una notificación: /m?c=<id del mensaje> ── */
  const deepLinkDone = useRef<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("c");
    if (!id || !user || deepLinkDone.current === id) return;
    deepLinkDone.current = id;
    (async () => {
      const key = await inbox.ensureMessage(id);
      navigate("/m", { replace: true, state: { mLayer: layersRef.current.length } });
      if (!key) { toast.show("Ese mensaje ya no está en la Unibox", "error"); return; }
      setNav("unibox");
      // Si ya hay una conversación abierta se sustituye (sin apilar otra entrada).
      if (layersRef.current.includes("thread")) {
        setCompose(null);
        setSheet(null);
        setOpenKey(key);
      } else {
        setOpenKey(key);
        push("thread");
      }
    })();
  }, [location.search, user, inbox, navigate, push, toast]);

  /* ── Acciones con aviso ── */
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.show(ok); }
    catch (e) { toast.show(e instanceof Error ? e.message : String(e), "error"); }
  }, [toast]);

  const openSheet = (s: Exclude<SheetKind, null>) => { setSheet(s); push("sheet"); };
  const swapSheet = (s: Exclude<SheetKind, null>) => setSheet(s); // de una hoja a otra sin apilar

  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<LeadInfo | null>(null);
  useEffect(() => {
    if (sheet !== "info" || !conv || !user) return;
    setInfo(null);
    const campaign = conv.campaignId ? inbox.campaigns.find((x) => x.id === conv.campaignId)?.name || null : null;
    void loadLeadInfo(user.id, conv.email, conv.leadId, campaign, inbox.accountEmails[conv.accountId] || null).then(setInfo).catch(() => setInfo(null));
  }, [sheet, conv, user, inbox.campaigns, inbox.accountEmails]);

  const [newFolder, setNewFolder] = useState("");
  const createFolderAndMove = async () => {
    if (!user || !conv || !newFolder.trim()) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as unknown as { from: (t: string) => any }).from("unibox_folders")
      .insert({ user_id: user.id, name: newFolder.trim(), color: "#6E58F1" }).select("id").single();
    setBusy(false);
    if (error || !data) { toast.show(error?.message || "No se pudo crear la carpeta", "error"); return; }
    setNewFolder("");
    back();
    await run(() => inbox.moveToFolder(conv, (data as { id: string }).id), "Movido a la carpeta");
    void inbox.reload({ quiet: true });
  };

  if (!user) return null;
  const accountEmail = shownConv ? inbox.accountEmails[shownConv.accountId] || "" : "";
  const composeMode = compose || leavingCompose;

  return (
    <div className="m-root">
      <div className="m-frame">
        {/* Pestañas principales */}
        <div className="absolute inset-0 flex flex-col">
          <div className="relative min-h-0 flex-1">
            {nav === "unibox" ? (
              <ConversationList
                items={visible}
                statusOf={statusOf}
                filters={filters}
                activeFilterCount={activeFilterCount}
                loading={inbox.loading}
                refreshing={inbox.refreshing}
                onSearch={(search) => setFilters((f) => ({ ...f, search }))}
                onTab={(tab) => { setFilters((f) => ({ ...f, tab })); try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* nada */ } }}
                onOpenFilters={() => push("drawer")}
                onOpen={openConversation}
                onRefresh={() => inbox.reload()}
                hasMore={filters.tab === "others" && inbox.othersHasMore}
                loadingMore={inbox.loadingMore}
                onLoadMore={() => { void inbox.loadMoreOthers(); }}
                banner={<PushBanner userId={user.id} notify={toast.show} />}
              />
            ) : (
              <AccountView
                email={user.email || ""}
                conversations={inbox.conversations.length}
                unread={unreadTotal}
                onSignOut={() => { void signOut().then(() => navigate("/auth", { replace: true })); }}
                notify={toast.show}
              />
            )}
            {inbox.error && inbox.conversations.length === 0 && nav === "unibox" && (
              <div className="absolute inset-x-4 top-[calc(150px+env(safe-area-inset-top))] rounded-[16px] border border-[#FAD3DB] bg-white p-4 text-center shadow-sm">
                <p className="text-[14.5px] text-[#B4233C]">No se pudo cargar la Unibox: {inbox.error}</p>
                <button type="button" onClick={() => inbox.reload()} className="m-press m-gradient mt-3 h-10 rounded-[11px] px-5 text-[14.5px] font-semibold text-white">Reintentar</button>
              </div>
            )}
          </div>

          {/* Barra inferior */}
          {/* Medidas del diseño: pastilla de 124×50 y su borde inferior a ~32 pt del final de la pantalla. */}
          <nav className="m-nav relative z-10 grid grid-cols-2 justify-items-center rounded-t-[22px] px-3 pt-[7px]"
            style={{ paddingBottom: "max(10px, calc(env(safe-area-inset-bottom) - 2px))" }}>
            <NavItem active={nav === "unibox"} label="Unibox" onClick={() => setNav("unibox")} icon={<UniboxIcon />} />
            <NavItem active={nav === "account"} label="Account" onClick={() => setNav("account")} icon={<User className="h-[24px] w-[24px]" strokeWidth={1.8} />} />
          </nav>
        </div>

        {/* Conversación */}
        {shownConv && (
          <div className={`m-screen z-20 ${conv ? "m-enter-right" : "m-leave-right"}`}>
            <ThreadView
              conv={shownConv}
              status={statusOf(shownConv)}
              thread={thread}
              threadError={threadError}
              accountEmail={accountEmail}
              onBack={() => back()}
              onMove={() => openSheet("move")}
              onDelete={() => openSheet("delete")}
              onMore={() => openSheet("more")}
              onInfo={() => openSheet("info")}
              onStatus={() => openSheet("status")}
              onReply={() => { setCompose("reply"); push("compose"); }}
              onForward={() => { setCompose("forward"); push("compose"); }}
              onCopied={(v) => toast.show(v ? "Copiado" : "No se pudo copiar", v ? "ok" : "error")}
            />
          </div>
        )}

        {/* Responder / reenviar */}
        {shownConv && composeMode && (
          <div className={`m-screen z-30 ${compose ? "m-enter-right" : "m-leave-right"}`}>
            <Composer
              key={`${shownConv.key}:${composeMode}`}
              mode={composeMode}
              userId={user.id}
              conv={shownConv}
              thread={thread}
              accountEmails={inbox.accountEmails}
              onClose={() => back()}
              onSent={(text) => {
                toast.show(text);
                back();
                const c = shownConv;
                window.setTimeout(() => { void refreshThread(c); }, 600);
              }}
              onError={(text) => toast.show(text, "error")}
              onNotice={(text) => toast.show(text)}
            />
          </div>
        )}
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={() => back()}
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        counts={counts}
        conversations={inbox.conversations}
        accountEmails={inbox.accountEmails}
        campaigns={inbox.campaigns}
        folders={inbox.folders}
      />

      {/* Estado del contacto */}
      <Sheet open={sheet === "status"} onClose={() => back()} title="Status">
        {conv && LEAD_STATUSES.map((s) => (
          <SheetRow key={s.id}
            icon={<span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: s.tile }}><Bolt color={s.color} filled size={18} /></span>}
            label={s.label}
            selected={statusOf(conv) === s.id}
            onClick={() => { back(); void run(() => inbox.setStatus(conv, s.id as LeadStatus), `Estado: ${s.label}`); }}
          />
        ))}
      </Sheet>

      {/* Mover */}
      <Sheet open={sheet === "move"} onClose={() => back()} title="Move lead">
        {conv && (
          <>
            {inbox.folders.map((f) => (
              <SheetRow key={f.id} icon={<Folder className="h-5 w-5" style={{ color: f.color || "#6E58F1" }} />} label={f.name}
                selected={conv.folderId === f.id}
                onClick={() => { back(); void run(() => inbox.moveToFolder(conv, f.id), `Movido a ${f.name}`); }} />
            ))}
            {conv.folderId && (
              <SheetRow icon={<FolderMinus className="h-5 w-5 text-[#6B7192]" />} label="Quitar de la carpeta"
                onClick={() => { back(); void run(() => inbox.moveToFolder(conv, null), "Quitado de la carpeta"); }} />
            )}
            <div className="mt-1 flex items-center gap-2 px-2 pb-2 pt-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center"><FolderPlus className="h-5 w-5 text-[#6E58F1]" /></span>
              <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Nueva carpeta…"
                className="h-11 min-w-0 flex-1 rounded-[12px] border border-[#E3E7F2] bg-[#F8F9FD] px-3 text-[16px] outline-none focus:border-[#AFC0F8]" />
              <button type="button" disabled={!newFolder.trim() || busy} onClick={createFolderAndMove}
                className="m-press m-gradient h-11 shrink-0 rounded-[12px] px-4 text-[14.5px] font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="m-spin h-4 w-4" /> : "Crear"}
              </button>
            </div>
          </>
        )}
      </Sheet>

      {/* Más opciones */}
      <Sheet open={sheet === "more"} onClose={() => back()}>
        {conv && (
          <>
            <SheetRow icon={conv.unreadIds.length ? <MailOpen className="h-5 w-5 text-[#3B6CF6]" /> : <Mail className="h-5 w-5 text-[#3B6CF6]" />}
              label={conv.unreadIds.length ? "Marcar como leído" : "Marcar como no leído"}
              onClick={() => {
                const c = conv;
                if (c.unreadIds.length) { back(); void run(() => inbox.markRead(c), "Marcado como leído"); }
                else { back(2); void run(() => inbox.markUnread(c), "Marcado como no leído"); }
              }} />
            <SheetRow icon={<Star className={`h-5 w-5 ${conv.important ? "fill-[#F5A524]" : ""} text-[#F5A524]`} />}
              label={conv.important ? "Quitar de importantes" : "Marcar como importante"}
              onClick={() => { back(); void run(() => inbox.toggleImportant(conv), conv.important ? "Quitado de importantes" : "Marcado como importante"); }} />
            <SheetRow icon={<CopyIcon className="h-5 w-5 text-[#6B7192]" />} label="Copiar email" hint={conv.email}
              onClick={() => { back(); void navigator.clipboard?.writeText(conv.email).then(() => toast.show("Email copiado"), () => toast.show("No se pudo copiar", "error")); }} />
            <SheetRow icon={<Ban className="h-5 w-5 text-[#E5354F]" />} label="Bloquear remitente" danger
              hint="No vuelve a recibir correos de ninguna campaña"
              onClick={() => swapSheet("block")} />
          </>
        )}
      </Sheet>

      {/* Ficha del contacto */}
      <Sheet open={sheet === "info"} onClose={() => back()} title={conv?.name && conv.name !== "Unknown" ? conv.name : "Contacto"}>
        {!info ? (
          <div className="flex justify-center py-8"><Loader2 className="m-spin h-6 w-6 text-[#9AA0BA]" /></div>
        ) : (
          <div className="space-y-1 px-2 pb-3">
            {([
              ["Nombre", info.name],
              ["Empresa", info.company],
              ["Email", info.email],
              ["Teléfono", info.phone],
              ["Web", info.website],
              ["Campaña", info.campaign],
              ["Buzón", info.mailbox],
              ["Primer contacto", info.firstContact ? new Date(info.firstContact).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null],
              ...info.fields,
            ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex items-start gap-3 rounded-[12px] bg-[#F6F7FB] px-3.5 py-2.5">
                <span className="w-[110px] shrink-0 text-[13.5px] capitalize text-[#7A809B]">{k}</span>
                {k === "Teléfono" ? <a href={`tel:${v}`} className="min-w-0 flex-1 break-words text-[14.5px] font-medium text-[#3B6CF6]">{v}</a>
                  : k === "Web" ? <a href={/^https?:/i.test(v!) ? v! : `https://${v}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all text-[14.5px] font-medium text-[#3B6CF6]">{v}</a>
                  : <span className="min-w-0 flex-1 break-words text-[14.5px] font-medium text-[#1B2140]">{v}</span>}
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <ConfirmSheet open={sheet === "delete"} title="¿Eliminar esta conversación?"
        text="Desaparece de la Unibox (en el móvil y en el ordenador). No se borra del buzón de correo."
        confirmLabel="Eliminar" danger busy={busy}
        onClose={() => back()}
        onConfirm={async () => {
          if (!conv) return;
          setBusy(true);
          try { await inbox.removeConversation(conv); toast.show("Conversación eliminada"); back(2); }
          catch (e) { toast.show(e instanceof Error ? e.message : String(e), "error"); }
          setBusy(false);
        }} />
      <ConfirmSheet open={sheet === "block"} title={`¿Bloquear ${conv?.email || ""}?`}
        text="Sale de todas las campañas, no se le vuelve a escribir y sus mensajes se ocultan."
        confirmLabel="Bloquear" danger busy={busy}
        onClose={() => back()}
        onConfirm={async () => {
          if (!conv) return;
          setBusy(true);
          try { await inbox.blockSender(conv); toast.show("Remitente bloqueado"); back(2); }
          catch (e) { toast.show(e instanceof Error ? e.message : String(e), "error"); }
          setBusy(false);
        }} />

      {toast.node}
    </div>
  );
}

function NavItem({ active, label, icon, onClick }: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={`m-press flex h-[50px] w-[124px] flex-col items-center justify-center gap-[3px] rounded-[14px] ${active ? "bg-[#EAF1FE] text-[#2F6BEA]" : "text-[#6B7192]"}`}>
      {icon}
      <span className="text-[13px] font-medium leading-none">{label}</span>
    </button>
  );
}

/** El icono de Unibox del diseño: dos cuadrados redondeados superpuestos. */
function UniboxIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <rect x="8" y="8" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.9" fill="none" />
    </svg>
  );
}
