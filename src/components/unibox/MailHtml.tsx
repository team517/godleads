import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { inlineImageCids, inlineImageFor, replaceCidImages, type InlineImage } from "@/lib/unibox-text";

/* El cuerpo HTML de un correo con sus imágenes incrustadas (firmas con logo, 06-10-2026).
   El HTML ya viene limpio (renderableHtml). Si referencia imágenes "cid:" se buscan entre los
   adjuntos guardados (inline) y se cambian por un enlace firmado; si no están guardadas (correo
   sincronizado antes de este cambio) se piden UNA vez al buzón con inbox-attachments. Mientras
   tanto, y si no aparecen, la <img> se quita: nunca un icono roto. Lo usan el Unibox y el móvil. */

const urlCache = new Map<string, { url: string; at: number }>();
const asked = new Set<string>();
const URL_TTL_MS = 50 * 60 * 1000;

async function signedUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && Date.now() - hit.at < URL_TTL_MS) return hit.url;
  const { data } = await supabase.storage.from("inbox-attachments").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

export default function MailHtml({ html, attachments, messageId, className }: {
  html: string;
  attachments?: InlineImage[] | null;
  messageId?: string | null;
  className?: string;
}) {
  const cids = useMemo(() => inlineImageCids(html), [html]);
  const [atts, setAtts] = useState<InlineImage[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const effective = atts ?? attachments ?? [];

  // Sin imágenes guardadas para algún cid: se piden al buzón (una vez por mensaje y sesión).
  useEffect(() => {
    if (cids.length === 0 || !messageId) return;
    const missing = cids.some((c) => !inlineImageFor(c, effective));
    if (!missing || asked.has(messageId)) return;
    asked.add(messageId);
    let alive = true;
    supabase.functions.invoke("inbox-attachments", { body: { message_id: messageId } }).then(({ data }) => {
      if (!alive) return;
      const list = Array.isArray(data?.attachments) ? (data.attachments as InlineImage[]) : null;
      if (list && list.length) setAtts(list);
    }).catch(() => { /* se queda sin logo */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cids, messageId, effective.length]);

  // Enlaces firmados de las imágenes que sí están.
  useEffect(() => {
    if (cids.length === 0) return;
    let alive = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const c of cids) {
        const a = inlineImageFor(c, effective);
        if (!a?.path) continue;
        const u = await signedUrl(a.path);
        if (u) next[c] = u;
      }
      if (alive) setUrls(next);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cids, effective]);

  const painted = useMemo(() => (cids.length === 0 ? html : replaceCidImages(html, (c) => urls[c] || null)), [html, cids, urls]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: painted }} />;
}
