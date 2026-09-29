// Correo de arranque del flujo de Automatización: lo firma el asistente de OnePulso y lleva el
// formulario de la campaña, el acceso al onboarding, las credenciales de la plataforma y el correo
// del equipo que lleva la campaña.

export const EQUIPO_EMAIL = "equipo@onepulso.online";
export const ASUNTO_ARRANQUE = "Empezamos con tu campaña: formulario y accesos";

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface IntroEmail {
  name: string; company: string; formUrl: string; onboardingUrl: string; color: string;
  email?: string; password?: string; loginUrl?: string;
}

export function introEmailHtml(o: IntroEmail): string {
  const saludo = o.name ? `Muy buenas, ${esc(o.name)}:` : (o.company ? `Muy buenas, equipo de ${esc(o.company)}:` : "Muy buenas:");
  const c = o.color || "#6E58F1";
  const conCredenciales = !!(o.email && o.password);
  const boton = (href: string, texto: string, relleno: boolean) =>
    `<p style="margin:18px 0"><a href="${esc(href)}" style="${relleno ? `background:${c};color:#fff;` : `border:1px solid ${c};color:${c};`}text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${texto}</a></p>`;
  const credenciales = conCredenciales ? `<p style="margin:18px 0;padding:12px 14px;background:#f5f5fb;border-radius:10px;font-size:14px;line-height:1.7">
  <b>3. Tus credenciales para entrar en la plataforma</b><br/>
  Acceso: <a href="${esc(o.loginUrl || "")}" style="color:${c}">${esc(o.loginUrl || "")}</a><br/>
  Usuario: <b>${esc(o.email!)}</b><br/>
  Contraseña: <b>${esc(o.password!)}</b>
</p>` : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6">
  <p>${saludo}</p>
  <p>Soy el asistente de OnePulso. Te envío todo lo necesario para arrancar tu campaña:</p>
  <p style="margin:18px 0 4px"><b>1. El formulario de la campaña</b>, con las preguntas que necesitamos para prepararla:</p>
  ${boton(o.formUrl, "Responder el formulario", true)}
  <p style="margin:18px 0 4px"><b>2. Tu acceso al onboarding</b>, donde verás en directo cómo avanza tu proyecto:</p>
  ${boton(o.onboardingUrl, "Ver mi onboarding", false)}
  ${credenciales}
  <p>Para hablar con el asistente que lleva tu campaña, escribe a <a href="mailto:${EQUIPO_EMAIL}" style="color:${c}"><b>${EQUIPO_EMAIL}</b></a>.</p>
  <p>Quedamos atentos a tu respuesta del formulario para poder crear la campaña.</p>
  <p>Un saludo,<br/>Asistente de OnePulso</p>
</div>`;
}
