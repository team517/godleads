import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { publishUniboxUnread } from "@/lib/uniboxBadge";
import {
  blockedChecker, buildConversations, conversationKey, feedLane, IMPORTANT, isLeadStatus, labelsForStatus,
  mergeWindow, newestCreated, PRIMARY_FEED, sortRows, upsertRows,
  type Conversation, type InboxRow, type LeadStatus,
} from "@/lib/mobile-inbox";

/* Datos de la app del móvil, de dos fuentes del servidor:
   - Primary = mobile_inbox_feed: lo enlazado a leads/campañas y lo demás que no es warm-up, cada
     mensaje marcado "de campaña" o no (la MISMA ventana y la misma regla que la pestaña Campañas
     del escritorio).
   - Others = mobile_inbox_others: TODO lo que entra (warm-up, rebotes y avisos incluidos), lo más
     nuevo primero y paginado hacia atrás al bajar. Es lo que enseña "Todos" en el escritorio.
   La pestaña la decide buildConversations (isPrimaryRow). Primero se pinta lo guardado de la
   última vez; luego llega lo nuevo. Al día: tiempo real (INSERT → pedir lo nuevo; UPDATE →
   leído/etiquetas/archivado/carpeta), lo nuevo por fecha de GUARDADO cada 20 s (lo que la
   sincronización guarda tarde también llega) y un repaso cada 2 min con la app delante. */

export const MOBILE_COLS =
  "id, account_id, lead_id, campaign_id, message_id, from_email, from_name, subject, body_text, received_at, is_read, is_archived, folder_id, labels, ref_chain, auto_signal, to_emails, cc_emails, created_at, is_warmup";
// Primary: primera pintada corta y luego la ventana entera.
const FIRST = { linked: 150, other: 60 };
const FULL = PRIMARY_FEED;
// Others: una página (unas horas de support@, que recibe ~5.000 correos al día).
const OTHERS_PAGE = 200;
const POLL_MS = 20_000;
const SAFETY_MS = 120_000;
const REALTIME_DEBOUNCE_MS = 3_000;
// Lo que se guarda en una transacción larga puede llevar una fecha de guardado algo anterior a lo
// ya visto: se vuelve a pedir un margen (lo repetido se junta por id).
const SINCE_OVERLAP_MS = 120_000;
const CACHE_KEY = "mobile:rows2";
const CACHE_WRITE_MS = 1_000;
// Memoria: Others hasta 3.000 filas (lo más nuevo; al pasarse, el final de lo cargado sube) y
// Primary su ventana más un margen para lo que llega mientras la app está abierta.
const OTHERS_CAP = 3_000;
const FEED_CAP = PRIMARY_FEED.linked + PRIMARY_FEED.other + 500;

export interface Folder { id: string; name: string; color: string | null }
export interface Campaign { id: string; name: string }

interface Rows { feed: InboxRow[]; others: InboxRow[] }

// El tipo generado de la BD está desfasado (faltan columnas como auto_signal o folder_id):
// las consultas van sin tipar y se convierten a InboxRow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any; channel: (name: string) => any; removeChannel: (c: any) => any };

async function feed(size: { linked: number; other: number }, sinceCreated: string | null = null): Promise<InboxRow[]> {
  // p_since_created sólo cuando hace falta: así la carga normal sigue funcionando con la función de
  // antes (si la web se publica antes que la migración 20261005160000).
  const args: Record<string, unknown> = { p_linked: size.linked, p_other: size.other, p_since: null };
  if (sinceCreated) args.p_since_created = sinceCreated;
  const { data, error } = await db.rpc("mobile_inbox_feed", args);
  if (error) throw new Error(error.message);
  return (data || []) as InboxRow[];
}

async function others(opts: { limit: number; before?: InboxRow | null; sinceCreated?: string | null }): Promise<InboxRow[]> {
  const { data, error } = await db.rpc("mobile_inbox_others", {
    p_limit: opts.limit,
    p_before: opts.before?.received_at ?? null,
    p_before_id: opts.before?.id ?? null,
    p_since_created: opts.sinceCreated ?? null,
  });
  if (error) throw new Error(error.message);
  return (data || []) as InboxRow[];
}

const sinceWithOverlap = (iso: string | null) => (iso ? new Date(Date.parse(iso) - SINCE_OVERLAP_MS).toISOString() : null);

function readCache(): Rows {
  const c = cacheGet<Rows>(CACHE_KEY);
  return { feed: Array.isArray(c?.feed) ? c!.feed : [], others: Array.isArray(c?.others) ? c!.others : [] };
}

export function useMobileInbox(userId: string | undefined) {
  const [data, setData] = useState<Rows>(readCache);
  const [loading, setLoading] = useState(() => { const c = readCache(); return c.feed.length + c.others.length === 0; });
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Map<string, LeadStatus>>(new Map());
  const [accountEmails, setAccountEmails] = useState<Record<string, string>>(() => cacheGet<Record<string, string>>("mobile:accounts") || {});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [blocked, setBlocked] = useState<{ entry_type: string; value: string }[]>([]);
  // Others paginado: hasta dónde se ha cargado (la fila más vieja de la última página) y si queda más.
  const [othersCursor, setOthersCursor] = useState<InboxRow | null>(() => { const o = readCache().others; return o.length ? o[o.length - 1] : null; });
  const [othersHasMore, setOthersHasMore] = useState(true);
  const [othersError, setOthersError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const cursorRef = useRef(othersCursor);
  cursorRef.current = othersCursor;
  const hasMoreRef = useRef(othersHasMore);
  hasMoreRef.current = othersHasMore;
  const cacheTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  // Con el tiempo real conectado no hace falta preguntar cada 20 s (queda de reserva si se cae).
  const realtimeOn = useRef(false);
  // Fecha de guardado más nueva vista: desde ahí se pide lo nuevo.
  const sinceRef = useRef<string | null>(newestCreated([...data.feed, ...data.others]));
  const busyRef = useRef({ load: false, poll: false, more: false });

  const commit = useCallback((input: Rows) => {
    let next = input;
    if (next.feed.length > FEED_CAP) next = { ...next, feed: next.feed.slice(0, FEED_CAP) };
    if (next.others.length > OTHERS_CAP) {
      const kept = next.others.slice(0, OTHERS_CAP);
      next = { ...next, others: kept };
      // Lo de abajo se ha soltado: si queda más por bajar, se vuelve a pedir desde aquí.
      if (hasMoreRef.current) { cursorRef.current = kept[kept.length - 1]; setOthersCursor(kept[kept.length - 1]); }
    }
    dataRef.current = next;
    setData(next);
    sinceRef.current = newestCreated([...next.feed, ...next.others], sinceRef.current);
    // Al disco como mucho una vez por segundo (el tiempo real puede traer muchos cambios seguidos).
    if (cacheTimer.current) window.clearTimeout(cacheTimer.current);
    cacheTimer.current = window.setTimeout(() => { cacheTimer.current = null; cacheSet(CACHE_KEY, dataRef.current); }, CACHE_WRITE_MS);
  }, []);

  // Al salir: lo pendiente al disco y fuera los temporizadores. La caché de antes ("mobile:rows",
  // con Primary y Others mezclados) ya no se usa.
  useEffect(() => {
    try { localStorage.removeItem("op_cache:mobile:rows"); } catch { /* sin almacenamiento */ }
    return () => {
      if (cacheTimer.current) { window.clearTimeout(cacheTimer.current); cacheSet(CACHE_KEY, dataRef.current); }
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    };
  }, []);

  /**
   * Carga: lo más nuevo de Primary (página corta, pinta ya) y la primera página de Others; luego
   * la ventana entera de Primary. `light` (el repaso de cada 2 min) se queda en lo primero.
   */
  const load = useCallback(async (opts: { quiet?: boolean; light?: boolean } = {}) => {
    if (!userId || busyRef.current.load) return;
    busyRef.current.load = true;
    if (!opts.quiet) setRefreshing(true);
    try {
      // Si Others falla, Primary se pinta igual (y Others enseña el error).
      let othersErr: string | null = null;
      const [head, page] = await Promise.all([
        feed(FIRST),
        others({ limit: OTHERS_PAGE }).catch((e) => { othersErr = e instanceof Error ? e.message : String(e); return null; }),
      ]);
      const cur = dataRef.current;
      // Others vuelve a su primera página (lo de más abajo se vuelve a pedir al bajar).
      const othersNext = !page ? cur.others : opts.light ? mergeWindow(cur.others, page) : sortRows(page);
      commit({ feed: mergeWindow(cur.feed, head, feedLane), others: othersNext });
      if (page && (!opts.light || !cursorRef.current)) {
        setOthersCursor(page.length ? page[page.length - 1] : null);
        setOthersHasMore(page.length >= OTHERS_PAGE);
      }
      // Sin Others (falló o falta la función): no se pide "más" a ciegas.
      if (!page && !opts.light) setOthersHasMore(false);
      setOthersError(othersErr);
      if (othersErr) console.warn("mobile_inbox_others falló:", othersErr);
      setLoading(false);
      setError(null);
      if (opts.light) return;
      try {
        const all = await feed(FULL);
        commit({ feed: mergeWindow(dataRef.current.feed, all, feedLane), others: dataRef.current.others });
      } catch (e) {
        // Se queda lo que hay (la página corta), pero se dice: antes se tragaba el error y Primary
        // se quedaba a medias sin que nadie lo supiera. Se reintenta en 15 s.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("mobile_inbox_feed (ventana entera) falló:", msg);
        setError(msg);
        if (retryTimer.current) window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => { retryTimer.current = null; void load({ quiet: true }); }, 15_000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setLoading(false);
    } finally {
      busyRef.current.load = false;
      setRefreshing(false);
    }
  }, [userId, commit]);

  /** Lo guardado desde la última vez, en las dos fuentes (por fecha de GUARDADO, no del correo). */
  const pollNew = useCallback(async () => {
    if (!userId || busyRef.current.poll) return;
    const since = sinceWithOverlap(sinceRef.current);
    if (!since) return;
    busyRef.current.poll = true;
    try {
      const [f, o] = await Promise.all([feed({ linked: 500, other: 500 }, since), others({ limit: 1000, sinceCreated: since })]);
      if (f.length >= 1000 || o.length >= 1000) { busyRef.current.poll = false; await load({ quiet: true }); return; }
      if (!f.length && !o.length) return;
      const cur = dataRef.current;
      commit({ feed: upsertRows(cur.feed, f), others: upsertRows(cur.others, o) });
    } catch (e) {
      console.warn("mobile inbox: no se pudo pedir lo nuevo:", e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current.poll = false;
    }
  }, [userId, commit, load]);

  /** Others: la página siguiente hacia atrás (al llegar al final de la lista). */
  const loadMoreOthers = useCallback(async () => {
    const before = cursorRef.current;
    if (!userId || !before || !othersHasMore || busyRef.current.more) return;
    // Tope de memoria: hasta aquí se puede bajar en una sesión.
    if (dataRef.current.others.length >= OTHERS_CAP) { setOthersHasMore(false); return; }
    busyRef.current.more = true;
    setLoadingMore(true);
    try {
      const page = await others({ limit: OTHERS_PAGE, before });
      const cur = dataRef.current;
      commit({ feed: cur.feed, others: upsertRows(cur.others, page) });
      setOthersCursor(page.length ? page[page.length - 1] : before);
      setOthersHasMore(page.length >= OTHERS_PAGE);
      setOthersError(null);
    } catch (e) {
      setOthersError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current.more = false;
      setLoadingMore(false);
    }
  }, [userId, othersHasMore, commit]);

  const loadManual = useCallback(async () => {
    if (!userId) return;
    const { data: rows } = await db.from("unibox_lead_status").select("email, status").eq("user_id", userId);
    const map = new Map<string, LeadStatus>();
    for (const r of (rows || []) as { email: string; status: string }[]) {
      if (isLeadStatus(r.status)) map.set(r.email, r.status);
    }
    setManual(map);
  }, [userId]);

  const loadSide = useCallback(async () => {
    if (!userId) return;
    // La lista de bloqueo como en "Todos" del escritorio: todos los dominios (pocos y críticos) y
    // los emails más recientes (los mensajes de un email bloqueado ya se archivan al bloquear).
    const [camp, fold, dom, mail] = await Promise.all([
      db.from("campaigns").select("id, name").eq("user_id", userId).order("created_at", { ascending: false }),
      db.from("unibox_folders").select("id, name, color").eq("user_id", userId).order("created_at", { ascending: true }),
      db.from("blocklist").select("entry_type, value").eq("user_id", userId).eq("entry_type", "domain"),
      db.from("blocklist").select("entry_type, value").eq("user_id", userId).eq("entry_type", "email").order("created_at", { ascending: false }),
    ]);
    if (!camp.error) setCampaigns((camp.data || []) as Campaign[]);
    if (!fold.error) setFolders((fold.data || []) as Folder[]);
    setBlocked([...((dom.data || []) as { entry_type: string; value: string }[]), ...((mail.data || []) as { entry_type: string; value: string }[])]);
  }, [userId]);

  // Primera carga + lo de alrededor.
  useEffect(() => {
    if (!userId) return;
    const c = dataRef.current;
    void load({ quiet: c.feed.length + c.others.length > 0 });
    void loadManual();
    void loadSide();
  }, [userId, load, loadManual, loadSide]);

  // Con la app delante: lo nuevo cada 20 s y un repaso cada 2 min (lo leído en el ordenador, lo
  // archivado…). Al volver a ella: todo otra vez.
  useEffect(() => {
    if (!userId) return;
    const visible = () => document.visibilityState === "visible";
    const poll = window.setInterval(() => { if (visible() && !realtimeOn.current) void pollNew(); }, POLL_MS);
    const safety = window.setInterval(() => { if (visible()) void load({ quiet: true, light: true }); }, SAFETY_MS);
    const onVisible = () => {
      if (visible()) { void load({ quiet: true }); void loadManual(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(safety);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId, pollNew, load, loadManual]);

  // Tiempo real (como la Unibox del escritorio): un correo nuevo → pedir lo nuevo; un cambio
  // (leído, etiquetas, archivado, carpeta) → se aplica a la fila. Las dos cosas se agrupan ~3 s: la
  // sincronización y las acciones en bloque del escritorio mandan decenas de eventos seguidos, y
  // cada uno repintaba la lista entera. (DELETE no se escucha: con el filtro por user_id no llega,
  // la fila borrada no trae más que el id; lo borrado lo quita el repaso de cada 2 min.)
  useEffect(() => {
    if (!userId || typeof db.channel !== "function") return;
    let insertTimer: number | null = null;
    let updateTimer: number | null = null;
    const pending = new Map<string, Partial<InboxRow>>();
    const onInsert = () => {
      if (insertTimer) window.clearTimeout(insertTimer);
      insertTimer = window.setTimeout(() => { insertTimer = null; void pollNew(); }, REALTIME_DEBOUNCE_MS);
    };
    const flushUpdates = () => {
      updateTimer = null;
      if (pending.size === 0) return;
      const patches = new Map(pending);
      pending.clear();
      const cur = dataRef.current;
      let touched = false;
      const apply = (rows: InboxRow[]) => rows.map((r) => {
        const p = patches.get(r.id);
        if (!p) return r;
        touched = true;
        return { ...r, ...p };
      }).filter((r) => !r.is_archived);
      const next = { feed: apply(cur.feed), others: apply(cur.others) };
      if (touched) commit(next);
    };
    const onUpdate = (payload: { new?: Partial<InboxRow> & { id?: string } }) => {
      const n = payload?.new;
      if (!n?.id) return;
      const patch: Partial<InboxRow> = { ...(pending.get(n.id) || {}) };
      if (n.is_read !== undefined) patch.is_read = n.is_read;
      if (n.labels !== undefined) patch.labels = n.labels;
      if (n.is_archived !== undefined) patch.is_archived = n.is_archived;
      if (n.folder_id !== undefined) patch.folder_id = n.folder_id;
      pending.set(n.id, patch);
      if (updateTimer) window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(flushUpdates, REALTIME_DEBOUNCE_MS);
    };
    const filter = `user_id=eq.${userId}`;
    const channel = db.channel(`mobile-inbox-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "inbox_messages", filter }, onInsert)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "inbox_messages", filter }, onUpdate)
      .subscribe((status: string) => { realtimeOn.current = status === "SUBSCRIBED"; });
    return () => {
      realtimeOn.current = false;
      if (insertTimer) window.clearTimeout(insertTimer);
      if (updateTimer) window.clearTimeout(updateTimer);
      db.removeChannel(channel);
    };
  }, [userId, pollNew, commit]);

  const rows = useMemo(() => {
    const ids = new Set(data.feed.map((r) => r.id));
    return sortRows([...data.feed, ...data.others.filter((r) => !ids.has(r.id))]);
  }, [data]);
  const isBlocked = useMemo(() => blockedChecker(blocked), [blocked]);
  const conversations = useMemo(() => buildConversations(rows, { isBlocked }), [rows, isBlocked]);
  // Mientras quede Others por bajar, la lista llega hasta lo cargado (sin huecos).
  const othersFloor = othersHasMore && othersCursor ? othersCursor.received_at : null;

  // Correo de cada buzón que aparece (para "To:", "De" y el filtro de buzones). Sólo los que
  // hacen falta: support@ tiene miles de buzones.
  useEffect(() => {
    if (!userId) return;
    const missing = Array.from(new Set(conversations.map((c) => c.accountId))).filter((id) => !accountEmails[id]);
    if (missing.length === 0) return;
    let alive = true;
    (async () => {
      const found: Record<string, string> = {};
      for (let i = 0; i < missing.length; i += 150) {
        const { data: accs } = await db.from("email_accounts").select("id, email").in("id", missing.slice(i, i + 150));
        for (const a of (accs || []) as { id: string; email: string }[]) found[a.id] = a.email;
      }
      if (!alive || Object.keys(found).length === 0) return;
      setAccountEmails((prev) => {
        const next = { ...prev, ...found };
        cacheSet("mobile:accounts", next);
        return next;
      });
    })();
    return () => { alive = false; };
  }, [userId, conversations, accountEmails]);

  // El número del icono de la app: conversaciones de PERSONAS sin leer (Primary). Las
  // respuestas automáticas sin leer son cientos y no piden nada.
  const unreadConversations = useMemo(() => conversations.filter((c) => c.tab === "primary" && c.unreadIds.length > 0).length, [conversations]);
  useEffect(() => {
    if (loading) return;
    publishUniboxUnread(unreadConversations);
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (unreadConversations > 0) void nav.setAppBadge?.(unreadConversations)?.catch?.(() => {});
      else void nav.clearAppBadge?.()?.catch?.(() => {});
    } catch { /* sin insignia en este navegador */ }
  }, [unreadConversations, loading]);

  /* ── Acciones ── */

  const allRows = useCallback(() => [...dataRef.current.feed, ...dataRef.current.others], []);

  const patchRows = useCallback((ids: string[], patch: (r: InboxRow) => InboxRow) => {
    const set = new Set(ids);
    const cur = dataRef.current;
    const apply = (list: InboxRow[]) => list.map((r) => (set.has(r.id) ? patch(r) : r));
    commit({ feed: apply(cur.feed), others: apply(cur.others) });
  }, [commit]);

  const dropRows = useCallback((ids: Set<string>) => {
    const cur = dataRef.current;
    commit({ feed: cur.feed.filter((r) => !ids.has(r.id)), others: cur.others.filter((r) => !ids.has(r.id)) });
  }, [commit]);

  const markRead = useCallback(async (c: Conversation) => {
    if (c.unreadIds.length === 0) return;
    const ids = [...c.unreadIds];
    patchRows(ids, (r) => ({ ...r, is_read: true }));
    const { error: err } = await db.from("inbox_messages").update({ is_read: true }).in("id", ids);
    if (err) patchRows(ids, (r) => ({ ...r, is_read: false }));
  }, [patchRows]);

  const markUnread = useCallback(async (c: Conversation) => {
    const id = c.latest.id;
    patchRows([id], (r) => ({ ...r, is_read: false }));
    const { error: err } = await db.from("inbox_messages").update({ is_read: false }).eq("id", id);
    if (err) { patchRows([id], (r) => ({ ...r, is_read: true })); throw new Error(err.message); }
  }, [patchRows]);

  const setStatus = useCallback(async (c: Conversation, status: LeadStatus) => {
    if (!userId) return;
    const prev = manual.get(c.email);
    setManual((m) => new Map(m).set(c.email, status));
    const { error: err } = await db.from("unibox_lead_status")
      .upsert({ user_id: userId, email: c.email, status, updated_at: new Date().toISOString() }, { onConflict: "user_id,email" });
    if (err) {
      setManual((m) => { const n = new Map(m); if (prev) n.set(c.email, prev); else n.delete(c.email); return n; });
      throw new Error(err.message);
    }
    // La Unibox del ordenador lee las etiquetas de cada mensaje: se ponen las equivalentes.
    const byId = new Map(allRows().map((r) => [r.id, r]));
    for (const id of c.messageIds) {
      const r = byId.get(id);
      const next = r ? labelsForStatus(r.labels, status) : null;
      if (!next) continue;
      patchRows([id], (x) => ({ ...x, labels: next }));
      await db.from("inbox_messages").update({ labels: next }).eq("id", id);
    }
  }, [userId, manual, patchRows, allRows]);

  const toggleImportant = useCallback(async (c: Conversation) => {
    const byId = new Map(allRows().map((r) => [r.id, r]));
    if (c.important) {
      for (const id of c.messageIds) {
        const r = byId.get(id);
        if (!r || !(r.labels || []).includes(IMPORTANT)) continue;
        const next = (r.labels || []).filter((l) => l !== IMPORTANT);
        patchRows([id], (x) => ({ ...x, labels: next }));
        const { error: err } = await db.from("inbox_messages").update({ labels: next }).eq("id", id);
        if (err) throw new Error(err.message);
      }
    } else {
      const next = [...(c.latest.labels || []), IMPORTANT];
      patchRows([c.latest.id], (x) => ({ ...x, labels: next }));
      const { error: err } = await db.from("inbox_messages").update({ labels: next }).eq("id", c.latest.id);
      if (err) { patchRows([c.latest.id], (x) => ({ ...x, labels: c.latest.labels || [] })); throw new Error(err.message); }
    }
  }, [patchRows, allRows]);

  const moveToFolder = useCallback(async (c: Conversation, folderId: string | null) => {
    const ids = [...c.messageIds];
    const { error: err } = await db.from("inbox_messages").update({ folder_id: folderId }).in("id", ids);
    if (err) throw new Error(err.message);
    patchRows(ids, (r) => ({ ...r, folder_id: folderId }));
  }, [patchRows]);

  /** Igual que "Eliminar" en el escritorio: se archiva (si se borrara, la próxima sincronización
   *  lo volvería a bajar). */
  const removeConversation = useCallback(async (c: Conversation) => {
    const ids = new Set(c.messageIds);
    const { error: err } = await db.from("inbox_messages").update({ is_archived: true }).in("id", [...ids]);
    if (err) throw new Error(err.message);
    dropRows(ids);
  }, [dropRows]);

  /** Igual que "Bloquear remitente" en el escritorio: a la lista de bloqueo, fuera de sus
   *  campañas y sus mensajes ocultos. */
  const blockSender = useCallback(async (c: Conversation) => {
    if (!userId) return;
    const value = c.email;
    const { error: blockErr } = await db.from("blocklist")
      .upsert({ user_id: userId, entry_type: "email", value }, { onConflict: "user_id,entry_type,value" });
    if (blockErr) throw new Error(blockErr.message);
    setBlocked((b) => [...b, { entry_type: "email", value }]);
    const mine = allRows().filter((r) => String(r.from_email || "").toLowerCase() === value).map((r) => r.id);
    for (let i = 0; i < mine.length; i += 100) {
      const { error: err } = await db.from("inbox_messages").update({ is_archived: true }).in("id", mine.slice(i, i + 100));
      if (err) throw new Error(err.message);
    }
    const { data: leads, error: leadsErr } = await db.from("leads").select("id").eq("user_id", userId).eq("email", value);
    if (leadsErr) throw new Error(leadsErr.message);
    const leadIds = ((leads || []) as { id: string }[]).map((l) => l.id);
    if (leadIds.length) {
      const { error: clErr } = await db.from("campaign_leads").delete().in("lead_id", leadIds);
      if (clErr) throw new Error(clErr.message);
    }
    dropRows(new Set(mine));
  }, [userId, dropRows, allRows]);

  /** Un mensaje concreto (lo que abre una notificación) aunque no esté en la lista cargada, con
   *  la regla de campaña del servidor (si no, sin la marca, podía caer en la pestaña equivocada). */
  const ensureMessage = useCallback(async (id: string): Promise<string | null> => {
    const hit = allRows().find((r) => r.id === id);
    if (hit) return conversationKey(hit.account_id, hit.from_email);
    const { data: found } = await db.from("inbox_messages").select(MOBILE_COLS).eq("id", id).maybeSingle();
    let row = found as InboxRow | null;
    if (!row) return null;
    const { data: match } = await db.rpc("inbox_campaign_match_mine", { p_ids: [id] });
    const m = ((match || []) as { id: string; in_campaign: boolean; campaign_hint: string | null; why: string | null }[])[0];
    if (m) row = { ...row, in_campaign: m.in_campaign, campaign_hint: m.campaign_hint, match_why: m.why };
    if (!row.is_archived) {
      const cur = dataRef.current;
      commit({ feed: upsertRows(cur.feed, [row]), others: cur.others });
    }
    return conversationKey(row.account_id, row.from_email);
  }, [commit, allRows]);

  return {
    rows, conversations, loading, refreshing, error, manual, accountEmails, campaigns, folders,
    othersFloor, othersHasMore, othersError, loadingMore, loadMoreOthers,
    reload: load, markRead, markUnread, setStatus, toggleImportant, moveToFolder, removeConversation,
    blockSender, ensureMessage,
  };
}

export type MobileInbox = ReturnType<typeof useMobileInbox>;
