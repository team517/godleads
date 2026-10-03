import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import { publishUniboxUnread } from "@/lib/uniboxBadge";
import {
  buildConversations, conversationKey, IMPORTANT, isLeadStatus, labelsForStatus,
  type Conversation, type InboxRow, type LeadStatus,
} from "@/lib/mobile-inbox";

/* Datos de la app del móvil. Sólo las respuestas reales (enlazadas a un lead o a una campaña):
   lo demás que entra en los buzones es warm-up (cientos por hora) y no pinta nada aquí.
   Primero se pinta lo guardado de la última vez, luego llegan las 150 más nuevas y después el
   resto; con la app abierta se miran las nuevas cada 20 s y todo de nuevo al volver a ella. */

export const MOBILE_COLS =
  "id, account_id, lead_id, campaign_id, message_id, from_email, from_name, subject, body_text, received_at, is_read, is_archived, folder_id, labels, ref_chain, auto_signal, to_emails, cc_emails";
const FIRST_PAGE = 150;
const TOTAL = 900;
const POLL_MS = 20_000;
const CACHE_KEY = "mobile:rows";

export interface Folder { id: string; name: string; color: string | null }
export interface Campaign { id: string; name: string }

// El tipo generado de la BD está desfasado (faltan columnas como auto_signal o folder_id):
// las consultas van sin tipar y se convierten a InboxRow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

function linkedQuery(userId: string) {
  return db.from("inbox_messages")
    .select(MOBILE_COLS)
    .eq("user_id", userId)
    .eq("is_archived", false)
    .or("lead_id.not.is.null,campaign_id.not.is.null")
    .order("received_at", { ascending: false });
}

export function useMobileInbox(userId: string | undefined) {
  const [rows, setRows] = useState<InboxRow[]>(() => cacheGet<InboxRow[]>(CACHE_KEY) || []);
  const [loading, setLoading] = useState(() => !cacheGet<InboxRow[]>(CACHE_KEY));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Map<string, LeadStatus>>(new Map());
  const [accountEmails, setAccountEmails] = useState<Record<string, string>>(() => cacheGet<Record<string, string>>("mobile:accounts") || {});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const commit = useCallback((next: InboxRow[]) => {
    rowsRef.current = next;
    setRows(next);
    cacheSet(CACHE_KEY, next);
  }, []);

  /** Carga completa: primero la página corta (pinta ya) y luego el resto. */
  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!userId) return;
    if (!opts.quiet) setRefreshing(true);
    try {
      const first = await linkedQuery(userId).range(0, FIRST_PAGE - 1);
      if (first.error) throw new Error(first.error.message);
      const head = (first.data || []) as InboxRow[];
      // Mientras llega el resto se conserva lo que ya había más allá de la primera página.
      const headIds = new Set(head.map((r) => r.id));
      const oldest = head.length ? head[head.length - 1].received_at : null;
      const keep = rowsRef.current.filter((r) => !headIds.has(r.id) && oldest && r.received_at < oldest);
      commit([...head, ...keep]);
      setLoading(false);
      setError(null);
      if (head.length === FIRST_PAGE) {
        const rest = await linkedQuery(userId).range(FIRST_PAGE, TOTAL - 1);
        if (!rest.error) commit([...head, ...((rest.data || []) as InboxRow[])]);
      } else {
        commit(head);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setLoading(false);
    } finally {
      setRefreshing(false);
    }
  }, [userId, commit]);

  /** Sólo lo nuevo desde el último mensaje que tenemos (barato: cada 20 s). */
  const pollNew = useCallback(async () => {
    if (!userId) return;
    const newest = rowsRef.current[0]?.received_at;
    if (!newest) return;
    const { data, error: err } = await linkedQuery(userId).gt("received_at", newest).limit(50);
    if (err || !data?.length) return;
    const fresh = data as InboxRow[];
    const ids = new Set(fresh.map((r) => r.id));
    commit([...fresh, ...rowsRef.current.filter((r) => !ids.has(r.id))]);
  }, [userId, commit]);

  const loadManual = useCallback(async () => {
    if (!userId) return;
    const { data } = await db.from("unibox_lead_status").select("email, status").eq("user_id", userId);
    const map = new Map<string, LeadStatus>();
    for (const r of (data || []) as { email: string; status: string }[]) {
      if (isLeadStatus(r.status)) map.set(r.email, r.status);
    }
    setManual(map);
  }, [userId]);

  const loadSide = useCallback(async () => {
    if (!userId) return;
    const [camp, fold] = await Promise.all([
      db.from("campaigns").select("id, name").eq("user_id", userId).order("created_at", { ascending: false }),
      db.from("unibox_folders").select("id, name, color").eq("user_id", userId).order("created_at", { ascending: true }),
    ]);
    if (!camp.error) setCampaigns((camp.data || []) as Campaign[]);
    if (!fold.error) setFolders((fold.data || []) as Folder[]);
  }, [userId]);

  // Primera carga + lo de alrededor.
  useEffect(() => {
    if (!userId) return;
    void load({ quiet: rowsRef.current.length > 0 });
    void loadManual();
    void loadSide();
  }, [userId, load, loadManual, loadSide]);

  // Con la app delante: lo nuevo cada 20 s. Al volver a ella: todo otra vez (lo leído en el
  // ordenador, lo borrado, los estados cambiados en otro móvil…).
  useEffect(() => {
    if (!userId) return;
    const tick = () => { if (document.visibilityState === "visible") void pollNew(); };
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") { void load({ quiet: true }); void loadManual(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId, pollNew, load, loadManual]);

  const conversations = useMemo(() => buildConversations(rows), [rows]);

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
        const { data } = await db.from("email_accounts").select("id, email").in("id", missing.slice(i, i + 150));
        for (const a of (data || []) as { id: string; email: string }[]) found[a.id] = a.email;
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

  const patchRows = useCallback((ids: string[], patch: (r: InboxRow) => InboxRow) => {
    const set = new Set(ids);
    commit(rowsRef.current.map((r) => (set.has(r.id) ? patch(r) : r)));
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
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]));
    for (const id of c.messageIds) {
      const r = byId.get(id);
      const next = r ? labelsForStatus(r.labels, status) : null;
      if (!next) continue;
      patchRows([id], (x) => ({ ...x, labels: next }));
      await db.from("inbox_messages").update({ labels: next }).eq("id", id);
    }
  }, [userId, manual, patchRows]);

  const toggleImportant = useCallback(async (c: Conversation) => {
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]));
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
  }, [patchRows]);

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
    commit(rowsRef.current.filter((r) => !ids.has(r.id)));
  }, [commit]);

  /** Igual que "Bloquear remitente" en el escritorio: a la lista de bloqueo, fuera de sus
   *  campañas y sus mensajes ocultos. */
  const blockSender = useCallback(async (c: Conversation) => {
    if (!userId) return;
    const value = c.email;
    const { error: blockErr } = await db.from("blocklist")
      .upsert({ user_id: userId, entry_type: "email", value }, { onConflict: "user_id,entry_type,value" });
    if (blockErr) throw new Error(blockErr.message);
    const mine = rowsRef.current.filter((r) => String(r.from_email || "").toLowerCase() === value).map((r) => r.id);
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
    const gone = new Set(mine);
    commit(rowsRef.current.filter((r) => !gone.has(r.id)));
  }, [userId, commit]);

  /** Un mensaje concreto (lo que abre una notificación) aunque no esté en la lista cargada. */
  const ensureMessage = useCallback(async (id: string): Promise<string | null> => {
    const hit = rowsRef.current.find((r) => r.id === id);
    if (hit) return conversationKey(hit.account_id, hit.from_email);
    const { data } = await db.from("inbox_messages").select(MOBILE_COLS).eq("id", id).maybeSingle();
    const row = data as InboxRow | null;
    if (!row) return null;
    if (!row.is_archived) commit([row, ...rowsRef.current.filter((r) => r.id !== row.id)]
      .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime()));
    return conversationKey(row.account_id, row.from_email);
  }, [commit]);

  return {
    rows, conversations, loading, refreshing, error, manual, accountEmails, campaigns, folders,
    reload: load, markRead, markUnread, setStatus, toggleImportant, moveToFolder, removeConversation,
    blockSender, ensureMessage,
  };
}

export type MobileInbox = ReturnType<typeof useMobileInbox>;
