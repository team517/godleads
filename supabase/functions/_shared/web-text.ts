// Leer el texto de una web pública (para que la IA entienda a qué se dedica un cliente).
// Sólo webs públicas: nada de IPs, localhost ni hosts internos (SSRF). Las redirecciones se siguen
// a mano (máximo 3) comprobando cada destino, así http→https o dominio→www funcionan.

export function isPublicWebsite(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost") || h === "localhost") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return false; // IPv4 / IPv6 literales
  if (u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return false;
  return true;
}

/** HTML → texto legible: título, descripción y el cuerpo sin scripts ni estilos. */
export function htmlToSiteText(html: string, max = 6000): string {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "").trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const head = [title && `Título: ${title}`, desc && `Descripción: ${desc}`].filter(Boolean).join("\n");
  return `${head}\n${text}`.trim().slice(0, max);
}

export async function fetchWebsiteText(rawUrl: string, max = 6000): Promise<string> {
  let url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  for (let salto = 0; salto < 4; salto++) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return ""; }
    if (!isPublicWebsite(parsed)) return "";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(parsed.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OnePulsoBot/1.0)", "Accept": "text/html" },
        signal: ctrl.signal,
        redirect: "manual",
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) return "";
        url = new URL(loc, parsed).toString();
        continue;
      }
      if (!r.ok) return "";
      return htmlToSiteText(await r.text(), max);
    } catch {
      return "";
    } finally {
      clearTimeout(t);
    }
  }
  return "";
}
