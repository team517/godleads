// inbox-attachments — trae los archivos adjuntos de UN mensaje del Unibox, a petición.
//
// Por qué hace falta: la sincronización (fetch-inbox) sólo baja los primeros 256 KB de cada
// correo para ir rápida. Un PDF o un albarán suele ir DESPUÉS de esos bytes, así que el mensaje
// se guarda sin sus archivos y en el Unibox no se ve nada. Esta función va al buzón, busca ESE
// correo por su Message-ID, se lo baja entero, saca los adjuntos, los guarda en el cubo
// `inbox-attachments` y los deja anotados en la fila. A partir de ahí el Unibox los enseña solo.
//
// SÓLO LEE del buzón (EXAMINE + BODY.PEEK): no marca como leído, no mueve, no borra.
//
// Entrada:  { message_id: "<id de inbox_messages>" }  con la sesión del dueño,
//           o { message_id, secret } con el secreto de los crons para mantenimiento.
// Salida:   { ok, attachments: [{name, mime, size, path}], folder, bytes, reason? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { imapFetchRawByMessageId } from "../_shared/imap-raw.ts";
import { base64ToBytes, extractAttachments, looksInline } from "../_shared/mail-attachments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const messageRowId = String(body.message_id || "");
    if (!messageRowId) return json({ error: "falta message_id" }, 400);

    // Quién llama: el dueño con su sesión, o mantenimiento con el secreto de los crons.
    const cronSecret = Deno.env.get("REPORTS_CRON_SECRET") || "";
    const isMaintenance = !!cronSecret && body.secret === cronSecret;
    let callerId: string | null = null;
    if (!isMaintenance) {
      const authHeader = req.headers.get("Authorization") || "";
      const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: ud, error: aerr } = await userClient.auth.getUser();
      if (aerr || !ud?.user) return json({ error: "no autorizado" }, 401);
      callerId = ud.user.id;
    }

    const { data: msg } = await admin
      .from("inbox_messages")
      .select("id, user_id, account_id, message_id, subject, attachments")
      .eq("id", messageRowId)
      .maybeSingle();
    if (!msg) return json({ error: "mensaje no encontrado" }, 404);
    if (callerId && msg.user_id !== callerId) return json({ error: "no autorizado para este mensaje" }, 403);
    if (!msg.message_id) return json({ ok: false, reason: "sin_message_id", attachments: [] });

    const { data: acc } = await admin
      .from("email_accounts")
      .select("email, imap_host, imap_port, imap_username, imap_password, user_id")
      .eq("id", msg.account_id)
      .maybeSingle();
    if (!acc?.imap_host || !acc?.imap_password) return json({ ok: false, reason: "cuenta_sin_imap", attachments: [] });

    const hit = await imapFetchRawByMessageId(
      { host: acc.imap_host, port: acc.imap_port, user: acc.imap_username || acc.email, pass: acc.imap_password },
      msg.message_id,
      { searchAllFolders: true },
    );
    if (!hit.ok) return json({ ok: false, reason: hit.reason, detail: hit.detail, attachments: [] });

    // De todo lo adjunto nos quedamos con los ARCHIVOS: los logos de la firma (imágenes
    // pequeñas incrustadas) no son archivos que el remitente haya mandado.
    const found = extractAttachments(hit.raw).filter((a) => !looksInline(a));
    const stored: { name: string; mime: string; size: number; path: string; oversized?: boolean }[] = [];
    const msgKey = (msg.message_id || msg.id).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 90) || "msg";
    const used: Record<string, number> = {};

    for (const att of found) {
      try {
        if (att.oversized || !att.base64) {
          stored.push({ name: att.name, mime: att.mime, size: att.size || 0, path: "", oversized: true });
          continue;
        }
        const bytes = base64ToBytes(att.base64);
        let safeName = att.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "adjunto";
        if (used[safeName] != null) { used[safeName]++; safeName = `${used[safeName]}_${safeName}`; } else used[safeName] = 0;
        const path = `${msg.user_id}/${msgKey}/${safeName}`;
        const { error: upErr } = await admin.storage
          .from("inbox-attachments")
          .upload(path, bytes, { contentType: att.mime, upsert: true });
        if (upErr) continue;
        stored.push({ name: att.name, mime: att.mime, size: bytes.length, path });
      } catch (_e) { /* ese archivo se queda fuera, los demás siguen */ }
    }

    // Se anota en la fila para que el Unibox lo enseñe sin volver al buzón. Si no había ninguno,
    // se marca igualmente (lista vacía) para no repetir la búsqueda en cada visita.
    const previous = Array.isArray(msg.attachments) ? msg.attachments : [];
    const merged = stored.length > 0 ? stored : previous;
    if (stored.length > 0) {
      await admin.from("inbox_messages").update({ attachments: merged }).eq("id", msg.id);
    }

    return json({
      ok: true,
      attachments: merged,
      found: stored.length,
      folder: hit.folder,
      bytes: hit.bytes,
      truncated: hit.truncated,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
