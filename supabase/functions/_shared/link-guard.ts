// Enlaces que NO llegan aunque el SMTP diga que sí.
//
// IONOS enruta el correo que lleva ciertos enlaces por mout-xforward.kundenserver.de, que está en
// la lista negra de Spamhaus: el SMTP contesta "250 aceptado", el envío queda como "sent" y Gmail
// lo rechaza después (o lo tira). Se vio el 02-10-2026 en las campañas (48 % de rebotes con
// calendly.com/onepulso/30min) y el 03-10-2026 en las respuestas del Unibox con plantilla: dos
// pruebas del dueño con el enlace no llegaron y las dos sin él sí.
//
// Aquí se sustituye cada enlace problemático por la versión que sí entrega (la URL de perfil de
// Calendly: 187 envíos, 0 en lista negra) y se devuelve qué se cambió, para que el Unibox lo diga.
// Un enlace sin sustituto conocido se devuelve en `blocked` y el envío se rechaza con un error
// claro: mejor un error que un "enviado" falso.
export type LinkFix = { from: string; to: string };

// 05-10-2026: the owner asked to send https://calendly.com/onepulso/30min again, complete, and the
// rule was removed. 06-10-2026: the bounces came back at once (manual replies with the link: 6 of 8
// bounced; typed replies without it arrived; the owner's own tests to Gmail with the template never
// arrived) and the owner asked to fix it. The rule is back: the profile URL delivers (187 sends,
// 0 blacklist on 02-10) and the lead books the same 30 min from it.
const RULES: { re: RegExp; to: string | null; label: string }[] = [
  { re: /https?:\/\/(?:www\.)?calendly\.com\/onepulso\/30min\/?(?:\?[^\s"'<>]*)?/gi, to: "https://calendly.com/onepulso", label: "calendly.com/onepulso/30min" },
];

export function fixBlockedLinks(text: string): { text: string; fixes: LinkFix[]; blocked: string[] } {
  let out = String(text || "");
  const fixes: LinkFix[] = [];
  const blocked: string[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    if (!r.re.test(out)) continue;
    r.re.lastIndex = 0;
    if (r.to === null) { blocked.push(r.label); continue; }
    out = out.replace(r.re, r.to);
    fixes.push({ from: r.label, to: r.to.replace(/^https?:\/\//, "") });
  }
  return { text: out, fixes, blocked };
}
