// Reglas puras del alta (sin red): validación, origen permitido y el correo de verificación.

export const SIGNUP_LINK_TTL_MS = 48 * 60 * 60 * 1000;
export const SIGNUP_MAX_SENDS_PER_HOUR = 5;
export const DEFAULT_APP_ORIGIN = "https://www.funnyleads.com";
const ALLOWED_ORIGINS = new Set([
  "https://www.funnyleads.com",
  "https://funnyleads.com",
  "https://backend-onepulso-platfomr.25kofp.easypanel.host",
]);

/** El botón del correo vuelve al mismo sitio donde se hizo el alta, sólo si es uno nuestro. */
export function pickAppOrigin(origin: string | null | undefined): string {
  const o = String(origin || "").replace(/\/+$/, "");
  if (ALLOWED_ORIGINS.has(o)) return o === "https://funnyleads.com" ? DEFAULT_APP_ORIGIN : o;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o; // desarrollo local
  return DEFAULT_APP_ORIGIN;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLANS = new Set(["starter", "growth", "scale"]);
const PERIODS = new Set(["month", "year"]);

export type SignupInput = { name: string; company: string; email: string; password: string; plan: string; period: string };

export function normalizeSignup(b: Record<string, unknown>): { ok: true; value: SignupInput } | { ok: false; error: string } {
  const name = String(b.name ?? "").trim().slice(0, 120);
  const company = String(b.company ?? "").trim().slice(0, 160);
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  // Plan a medida (11-11-2026): se guarda como "custom-N" (N = nivel 1–10) para volver al pago con él.
  const nivel = (() => {
    const m = String(b.plan ?? "").match(/^custom(?:-(\d{1,2}))?$/);
    if (!m) return null;
    const n = Number(m[1] ?? b.level);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
  })();
  const plan = nivel ? `custom-${nivel}` : PLANS.has(String(b.plan)) ? String(b.plan) : "starter";
  const period = PERIODS.has(String(b.period)) ? String(b.period) : "month";
  if (name.length < 2) return { ok: false, error: "Escribe tu nombre" };
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "Escribe un correo válido" };
  if (password.length < 8 || password.length > 72 || !/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    return { ok: false, error: "password: usa al menos 8 caracteres con letras y números" };
  }
  return { ok: true, value: { name, company, email, password, plan, period } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** El correo: marca Funnyleads, un botón violeta y el enlace en texto por si el botón no se ve. */
export function verificationEmailHtml(o: { name: string; link: string }): string {
  const first = esc((o.name || "").trim().split(/\s+/)[0] || "");
  const link = esc(o.link);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6F4FC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4FC;padding:32px 12px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E6E3F0;border-radius:16px;">
<tr><td style="padding:32px 32px 8px 32px;">
<p style="margin:0 0 20px 0;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#0F172B;">Funnyleads</p>
<h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.25;font-weight:700;color:#0F172B;">${first ? `Hola ${first}, ` : ""}confirma tu cuenta</h1>
<p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#45556C;">Pulsa el botón para verificar tu correo. Te llevamos directo al último paso para activar tus 14 días de prueba gratis.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#6E58F1;">
<a href="${link}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">Verificar mi cuenta</a>
</td></tr></table>
<p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:#65768D;">Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${link}" style="color:#5B40FB;word-break:break-all;">${link}</a></p>
</td></tr>
<tr><td style="padding:20px 32px 28px 32px;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#94A0B4;">El enlace caduca en 48 horas. Si no has creado una cuenta en Funnyleads, ignora este correo.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
