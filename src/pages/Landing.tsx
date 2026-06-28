import { useEffect, useRef } from "react";
import "@/styles/onepulso-tokens.css";
import "@/styles/onepulso-landing.css";

/* Design replicated 1:1 from the OnePulso "Outbound IA" landing.
   CTAs are wired to the app's existing /auth routes — no new features added. */

const SIGNUP = "/auth?mode=signup";

type Lead = { name: string; email: string; time: string; tag: string; subject: string; intent: string };

const LEADS: Lead[] = [
  { name: "Jose Hernández Baena", email: "jose@ctomasgracia.com", time: "19 jun · 12:33", tag: "Prueba", subject: "Re: Una idea para vuestro outbound", intent: "Intención de compra · alta" },
  { name: "Joaquín Villalba", email: "joaquin@nextail.co", time: "19 jun · 09:42", tag: "Prueba", subject: "Re: ¿Hablamos esta semana?", intent: "Reunión solicitada" },
  { name: "Nil Busqué Rodríguez", email: "nil@vasava.es", time: "18 jun · 18:28", tag: "Prueba", subject: "Re: Propuesta de colaboración", intent: "En seguimiento" },
  { name: "Sergi Martínez Juanas", email: "sergi.martinez@agoragp.com", time: "18 jun · 13:39", tag: "Prueba", subject: "Re: Demo de la plataforma", intent: "Pidió más info" },
];

const BODY_SETS = [
  ["96%", "88%", "92%", "70%", "40%"],
  ["90%", "94%", "62%", "84%", "48%"],
  ["98%", "72%", "90%", "80%", "36%"],
  ["86%", "92%", "78%", "94%", "52%"],
];

const bodyLinesHTML = (i: number) =>
  BODY_SETS[i % BODY_SETS.length]
    .map((w, idx) => `<div style="height:9px;border-radius:999px;width:${w};background:${idx === 1 ? "var(--ac-soft2)" : "var(--op-line-1)"};"></div>`)
    .join("");

const rowHTML = (i: number, active: boolean) => {
  const l = LEADS[i];
  return `<button data-lead="${i}" style="width:100%;text-align:left;border:0;border-bottom:1px solid var(--ac-line);border-left:3px solid ${active ? "var(--ac)" : "transparent"};padding:13px 16px;background:${active ? "var(--ac-soft)" : "#fff"};cursor:pointer;display:block;transition:background .2s var(--op-ease);">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
      <span style="font-size:13.5px;font-weight:600;color:var(--op-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.name}</span>
      <span style="font-size:10.5px;color:var(--op-fg-3);white-space:nowrap;font-family:var(--op-font-mono);">${l.time}</span>
    </div>
    <div style="font-size:12px;color:var(--ac-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.email}</div>
    <div style="font-size:12px;color:var(--op-fg-3);margin-top:7px;">Respondió el lead</div>
    <span style="display:inline-flex;align-items:center;gap:5px;margin-top:9px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ac-2);background:var(--ac-soft);border:1px solid var(--ac-line);border-radius:999px;padding:3px 9px;"><span style="width:5px;height:5px;border-radius:999px;background:var(--ac);"></span>${l.tag}</span>
  </button>`;
};

const detailHTML = (i: number) => {
  const s = LEADS[i];
  return `<div style="padding:22px 26px;display:flex;flex-direction:column;height:100%;min-height:0;">
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--op-line-1);padding-bottom:16px;">
      <div><div style="font-family:var(--op-font-display);font-weight:600;font-size:18px;letter-spacing:-0.01em;">${s.name}</div><div style="font-size:12px;color:var(--ac-2);margin-top:2px;">${s.email}</div></div>
      <span style="font-size:11px;color:var(--op-fg-3);font-family:var(--op-font-mono);">${s.time}</span>
    </div>
    <div style="font-family:var(--op-font-display);font-weight:600;font-size:20px;letter-spacing:-0.015em;margin:18px 0 14px;">${s.subject}</div>
    <div style="display:flex;flex-direction:column;gap:9px;">${bodyLinesHTML(i)}</div>
    <div style="margin-top:auto;border-top:1px solid var(--op-line-1);padding-top:16px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:9px;font-size:12px;font-weight:600;color:var(--ac-2);background:var(--ac-soft);border-radius:999px;padding:6px 12px;"><span style="width:8px;height:8px;border-radius:999px;background:var(--ac);"></span>${s.intent}</div>
      <svg width="118" height="42" viewBox="0 0 118 42" fill="none"><polyline points="2,34 22,28 40,30 58,18 76,22 96,8 116,12" stroke="var(--ac)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="96" cy="8" r="3" fill="var(--ac)"/></svg>
    </div>
  </div>`;
};

const card = (n: string, icon: string, title: string, desc: string, tags: string[], d: number) =>
  `<article data-reveal data-reveal-d="${d}" style="padding:48px 40px 56px;border-right:1px solid var(--op-line-1);border-bottom:1px solid var(--op-line-1);background:#fff;display:flex;flex-direction:column;gap:18px;min-height:340px;transition:background .32s var(--op-ease);" style-hover="background:var(--ac-soft)">
    <span style="font-family:var(--op-font-mono);font-size:13px;color:var(--ac);letter-spacing:.08em;">— ${n}</span>
    <div style="color:var(--ac);">${icon}</div>
    <h3 style="font-family:var(--op-font-display);font-weight:600;font-size:30px;letter-spacing:-0.02em;line-height:1.1;margin:0;">${title}</h3>
    <p style="font-size:16px;line-height:1.55;color:var(--op-fg-2);margin:0;">${desc}</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:auto;padding-top:16px;">${tags.map((t) => `<span style="font-size:12px;padding:5px 10px;border:1px solid var(--ac-line);border-radius:999px;color:var(--ac-2);">${t}</span>`).join("")}</div>
  </article>`;

const procCard = (n: string, title: string, desc: string, tag: string, delay: string, d: number) =>
  `<article data-reveal data-reveal-d="${d}" style="position:relative;padding:36px 28px 32px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:20px;display:flex;flex-direction:column;gap:14px;min-height:268px;transition:background .32s var(--op-ease),transform .32s var(--op-ease),border-color .32s var(--op-ease);" style-hover="background:rgba(139,89,246,.14);transform:translateY(-4px);border-color:rgba(139,89,246,.5)">
    <div style="width:48px;height:48px;border-radius:999px;border:1px solid var(--ac-3);display:flex;align-items:center;justify-content:center;font-family:var(--op-font-mono);font-size:13px;letter-spacing:.08em;color:var(--ac-3);position:relative;">${n}<span style="position:absolute;inset:-6px;border:1px solid rgba(139,89,246,.4);border-radius:999px;animation:op-pulse 2.8s var(--op-ease-out) ${delay} infinite;"></span></div>
    <h4 style="font-family:var(--op-font-display);font-weight:600;font-size:22px;line-height:1.2;letter-spacing:-0.015em;margin:0;color:#fff;">${title}</h4>
    <p style="font-size:14px;line-height:1.55;color:rgba(255,255,255,.62);margin:0;">${desc}</p>
    <span style="margin-top:auto;font-family:var(--op-font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.42);padding-top:16px;border-top:1px solid rgba(255,255,255,.1);">— ${tag}</span>
  </article>`;

const caseRow = (n: string, name: string, meta: string, setup: string, metric: string, metricUnit: string, metricSub: string, d: number) =>
  `<a href="${SIGNUP}" data-reveal data-reveal-d="${d}" data-case style="display:grid;grid-template-columns:80px 2fr 1fr 1fr auto;gap:40px;align-items:center;padding:36px 24px;border-bottom:1px solid var(--op-line-1);position:relative;transition:background .3s var(--op-ease);" style-hover="background:var(--ac-soft)">
    <span style="font-family:var(--op-font-mono);font-size:13px;color:var(--ac);letter-spacing:.1em;">— ${n}</span>
    <div style="font-family:var(--op-font-display);font-weight:600;font-size:28px;letter-spacing:-0.02em;line-height:1.2;">${name}<span style="display:block;font-family:var(--op-font-sans);font-weight:400;font-size:14px;letter-spacing:0;color:var(--op-fg-2);margin-top:6px;">${meta}</span></div>
    <div data-case-meta style="font-size:14px;color:var(--op-fg-2);">${setup}</div>
    <div data-case-meta><div style="font-family:var(--op-font-display);font-weight:700;font-size:40px;letter-spacing:-0.03em;line-height:1;color:var(--ac);">${metric}<span style="font-family:var(--op-font-serif);font-style:italic;font-size:.5em;color:var(--op-fg-2);margin-left:4px;">${metricUnit}</span></div><div style="font-size:13px;color:var(--op-fg-2);margin-top:6px;">${metricSub}</div></div>
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="27" fill="#fff" stroke="var(--ac-line)"/><path d="M22 28h12M28 22l6 6-6 6" stroke="var(--ac)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </a>`;

const ICONS = {
  grid: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  sun: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>`,
  user: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>`,
  mail: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>`,
  settings: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6"/><path d="M12 17v6"/><path d="m4.22 4.22 4.24 4.24"/><path d="m15.54 15.54 4.24 4.24"/><path d="M1 12h6"/><path d="M17 12h6"/></svg>`,
  zap: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
};

const MARKUP = `
<!-- NAV -->
<nav style="position:fixed;top:0;left:0;right:0;z-index:50;display:flex;justify-content:center;padding:20px 24px;pointer-events:none;">
  <div data-nav-bar style="pointer-events:auto;display:flex;align-items:center;gap:40px;padding:11px 11px 11px 24px;background:rgba(255,255,255,.8);border:1px solid var(--ac-line);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:999px;box-shadow:0 6px 24px rgba(110,88,241,.1);transition:background .32s var(--op-ease),box-shadow .32s var(--op-ease);">
    <a href="#top" style="display:flex;align-items:center;gap:10px;"><img src="/onepulso-logo-transparent.png" alt="OnePulso" style="height:20px;"></a>
    <ul data-nav-links style="display:flex;gap:28px;list-style:none;padding:0;margin:0;font-size:14px;color:var(--op-fg-2);">
      <li><a href="#producto" style="transition:color .2s var(--op-ease);" style-hover="color:var(--ac)">Producto</a></li>
      <li><a href="#entregabilidad" style="transition:color .2s var(--op-ease);" style-hover="color:var(--ac)">Entregabilidad</a></li>
      <li><a href="#bandeja" style="transition:color .2s var(--op-ease);" style-hover="color:var(--ac)">Bandeja</a></li>
      <li><a href="#casos" style="transition:color .2s var(--op-ease);" style-hover="color:var(--ac)">Casos</a></li>
    </ul>
    <a href="${SIGNUP}" style="background:var(--ac);color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:500;display:inline-flex;align-items:center;gap:8px;transition:transform .2s var(--op-ease),background .2s var(--op-ease);" style-hover="transform:translateY(-1px);background:var(--ac-2)">Empezar gratis <span aria-hidden="true">&#8594;</span></a>
  </div>
</nav>

<!-- HERO -->
<header id="top" style="position:relative;min-height:100vh;padding:172px 0 80px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;background:radial-gradient(120% 86% at 50% 0%,#FFFFFF 0%,#E8E5FF 60%,#FAFAF7 100%);border-bottom:1px solid var(--ac-line);">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(110,88,241,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(110,88,241,.07) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(80% 60% at 50% 38%,#000 18%,transparent 80%);mask-image:radial-gradient(80% 60% at 50% 38%,#000 18%,transparent 80%);pointer-events:none;"></div>
  <div data-pad style="position:relative;z-index:1;max-width:1360px;margin:0 auto;padding:0 64px;width:100%;">
    <div data-grid-2 style="display:grid;grid-template-columns:1.32fr 1fr;gap:80px;align-items:end;">
      <div>
        <div data-reveal style="display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--ac-2);"><span style="width:6px;height:6px;border-radius:999px;background:var(--ac);"></span>Outbound con IA · desde 2021</div>
        <h1 data-reveal data-reveal-d="1" style="font-family:var(--op-font-display);font-weight:700;letter-spacing:-0.035em;line-height:.98;text-wrap:balance;margin:32px 0 0;font-size:clamp(64px,8.4vw,138px);">Todo el <span style="background:var(--ac-grad);-webkit-background-clip:text;background-clip:text;color:transparent;">outbound</span>.<br>Un solo <span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac);">flujo</span>.</h1>
        <p data-reveal data-reveal-d="2" style="font-size:21px;line-height:1.5;color:var(--op-fg-2);max-width:54ch;margin-top:34px;text-wrap:pretty;">Prospecta, calienta, envía y cierra desde una sola plataforma. Una infraestructura de entregabilidad construida para que tus correos lleguen a la bandeja principal — no al ruido.</p>
        <div data-reveal data-reveal-d="3" style="display:flex;gap:14px;margin-top:46px;align-items:center;flex-wrap:wrap;">
          <a href="${SIGNUP}" style="display:inline-flex;align-items:center;gap:10px;padding:18px 26px;background:var(--ac);color:#fff;border-radius:14px;font-size:16px;font-weight:500;box-shadow:0 10px 26px rgba(110,88,241,.28);transition:transform .2s var(--op-ease),box-shadow .2s var(--op-ease),background .2s var(--op-ease);" style-hover="transform:translateY(-2px);box-shadow:0 16px 34px rgba(110,88,241,.36);background:var(--ac-2)">Empezar gratis <span aria-hidden="true">&#8594;</span></a>
          <a href="#producto" style="display:inline-flex;align-items:center;gap:10px;padding:18px 22px;border:1px solid var(--ac-line);border-radius:14px;font-size:16px;font-weight:500;color:var(--ac-2);transition:background .2s var(--op-ease),border-color .2s var(--op-ease);" style-hover="background:#fff;border-color:var(--ac)">Ver cómo funciona</a>
        </div>
      </div>
      <aside data-hero-aside style="display:flex;flex-direction:column;gap:18px;padding-bottom:10px;">
        <div data-reveal data-reveal-d="2" style="padding:24px 28px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px);border:1px solid var(--ac-line);border-radius:18px;display:flex;flex-direction:column;gap:4px;">
          <div style="font-family:var(--op-font-display);font-weight:700;font-size:54px;letter-spacing:-0.035em;line-height:1;color:var(--ac-2);">Ilimitados</div>
          <div style="font-size:14px;color:var(--op-fg-2);">Buzones y almacenamiento</div>
        </div>
        <div data-reveal data-reveal-d="3" style="padding:24px 28px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px);border:1px solid var(--ac-line);border-radius:18px;display:flex;flex-direction:column;gap:4px;">
          <div class="op-count" data-count="99" style="font-family:var(--op-font-display);font-weight:700;font-size:64px;letter-spacing:-0.035em;line-height:1;color:var(--ac);">0<span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--op-fg-2);font-size:.6em;margin-left:2px;">%</span></div>
          <div style="font-size:14px;color:var(--op-fg-2);">Llegada a la bandeja principal</div>
        </div>
        <div data-reveal data-reveal-d="4" style="padding:24px 28px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px);border:1px solid var(--ac-line);border-radius:18px;display:flex;flex-direction:column;gap:4px;">
          <div class="op-count" data-count="100" style="font-family:var(--op-font-display);font-weight:700;font-size:64px;letter-spacing:-0.035em;line-height:1;color:var(--ac);">0<span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--op-fg-2);font-size:.5em;margin-left:2px;">k+</span></div>
          <div style="font-size:14px;color:var(--op-fg-2);">Equipos confían en OnePulso</div>
        </div>
      </aside>
    </div>
  </div>
  <div style="position:absolute;bottom:30px;left:50%;transform:translateX(-50%);font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--op-fg-3);display:flex;flex-direction:column;align-items:center;gap:8px;">Scroll<span style="width:1px;height:32px;background:var(--ac-line);position:relative;overflow:hidden;display:block;"><span style="position:absolute;top:-100%;left:0;right:0;height:100%;background:var(--ac);animation:op-scroll 2s var(--op-ease) infinite;"></span></span></div>
</header>

<!-- MARQUEE -->
<div style="border-bottom:1px solid var(--op-line-1);padding:22px 0;background:#fff;overflow:hidden;">
  <div style="text-align:center;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--op-fg-3);margin-bottom:18px;">Con la confianza de 100.000+ equipos de outbound</div>
  <div style="display:flex;gap:72px;width:max-content;animation:op-marquee 42s linear infinite;">
    ${["Calentamiento con IA::1", "Buzones ilimitados::0", "Entregabilidad dedicada::1", "Prospección verificada::0", "Bandeja maestra::1", "Secuencias inteligentes::0", "Calentamiento con IA::1", "Buzones ilimitados::0", "Entregabilidad dedicada::1", "Prospección verificada::0", "Bandeja maestra::1", "Secuencias inteligentes::0"]
      .map((x) => { const [t, ital] = x.split("::"); const inner = ital === "1" ? `<span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac);">${t}</span>` : t; return `<span style="display:inline-flex;align-items:center;gap:14px;font-family:var(--op-font-display);font-weight:600;font-size:22px;letter-spacing:-0.01em;color:var(--op-fg-2);white-space:nowrap;">${inner}<span style="width:6px;height:6px;border-radius:999px;background:var(--ac-line);"></span></span>`; }).join("")}
  </div>
</div>

<!-- PRODUCTO -->
<section id="producto" style="padding:140px 0;background:var(--op-bg-2);">
  <div data-pad style="max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-grid-2 style="display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:end;margin-bottom:72px;">
      <div>
        <div data-reveal style="display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--ac-2);"><span style="width:6px;height:6px;border-radius:999px;background:var(--ac);"></span>01 · Plataforma</div>
        <h2 data-reveal data-reveal-d="1" style="font-family:var(--op-font-display);font-weight:700;font-size:clamp(48px,6vw,88px);letter-spacing:-0.035em;line-height:1;margin:20px 0 0;text-wrap:balance;">Escala el outbound<br>sin <span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac);">límites</span>.</h2>
      </div>
      <p data-reveal data-reveal-d="2" style="font-size:20px;color:var(--op-fg-2);line-height:1.55;margin:0;">Añade buzones ilimitados, guarda todos tus leads sin tarifas de almacenamiento y paga solo por lo que envías. Todo lo que un equipo de outbound necesita — en una pantalla.</p>
    </div>
    <div data-grid-3 style="display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--op-line-1);border-left:1px solid var(--op-line-1);">
      ${card("01", ICONS.grid, "Cuentas y almacenamiento ilimitados", "Conecta tantos buzones como necesites y guarda leads sin coste extra. Pagas por el envío, no por el espacio.", ["Google", "Outlook", "SMTP"], 0)}
      ${card("02", ICONS.sun, "Setup y calentamiento integrados", "OnePulso resuelve DNS, SPF, DKIM, DMARC y la rotación de remitentes automáticamente. Listo para enviar desde el primer día.", ["DNS", "Warm-up", "Rotación"], 1)}
      ${card("03", ICONS.user, "Prospección verificada", "Por cada tres correos que envías, ganas un lead verificado. Cada contacto se valida en tres fuentes para mantener los rebotes al mínimo.", ["3x leads", "Triple verificación"], 2)}
      ${card("04", ICONS.mail, "Buzones para la bandeja principal", "IPs limpias e infraestructura de confianza mantienen tus correos fuera de spam. Reparte campañas entre proveedores sin cuellos de botella.", ["IPs limpias", "Multiproveedor"], 0)}
      ${card("05", ICONS.settings, "Secuencias con agentes IA", "Agentes que investigan al lead, escriben el correo, actualizan el CRM y ajustan los tiempos de envío. Tú solo entras cuando toca cerrar.", ["Sin código", "24/7"], 1)}
      ${card("06", ICONS.zap, "Bandeja maestra unificada", "Todas las respuestas de todas las campañas y clientes en un solo lugar. Categoriza por intención, programa seguimientos y sincroniza con tu CRM.", ["Multicliente", "CRM sync"], 2)}
    </div>
  </div>
</section>

<!-- ENTREGABILIDAD -->
<section id="entregabilidad" style="padding:140px 0;position:relative;overflow:hidden;background:linear-gradient(180deg,#241A4D 0%,#17122E 100%);color:#fff;">
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:72px 72px;-webkit-mask-image:radial-gradient(90% 70% at 50% 35%,#000 18%,transparent 90%);mask-image:radial-gradient(90% 70% at 50% 35%,#000 18%,transparent 90%);pointer-events:none;"></div>
  <div style="position:absolute;top:-120px;left:50%;transform:translateX(-50%);width:680px;height:680px;background:radial-gradient(circle,rgba(139,89,246,.35) 0%,transparent 60%);pointer-events:none;"></div>
  <div data-pad style="position:relative;z-index:1;max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-grid-2 style="display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:end;margin-bottom:64px;">
      <div>
        <div data-reveal style="display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.7);"><span style="width:6px;height:6px;border-radius:999px;background:var(--ac-3);"></span>02 · Entregabilidad</div>
        <h2 data-reveal data-reveal-d="1" style="font-family:var(--op-font-display);font-weight:700;font-size:clamp(48px,6vw,88px);letter-spacing:-0.035em;line-height:1;margin:20px 0 0;color:#fff;text-wrap:balance;">El motor que llega a la <span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac-3);">bandeja</span>.</h2>
      </div>
      <p data-reveal data-reveal-d="2" style="font-size:20px;color:rgba(255,255,255,.7);line-height:1.55;margin:0;">Infraestructura de inquilino dedicado e IPs propias ponen la entregabilidad bajo tu control — protegida de los errores de otros remitentes.</p>
    </div>
    <div data-grid-2 style="display:grid;grid-template-columns:1.1fr 1fr;gap:80px;align-items:center;margin:40px 0 96px;">
      <p data-reveal style="font-family:var(--op-font-display);font-weight:600;font-size:clamp(30px,3.4vw,44px);line-height:1.15;letter-spacing:-0.02em;color:#fff;text-wrap:balance;margin:0;">Calentamos, enviamos y monitorizamos por ti — para que tus secuencias lleguen a la <span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac-3);">bandeja principal</span> y eviten el spam.</p>
      <div style="display:flex;flex-direction:column;gap:16px;">
        ${[["Privado", "Pool de calentamiento exclusivo, basado en recompensas", 1], ["Humano", "Aperturas, lecturas y respuestas que parecen reales", 2], ["Limpio", "Credibilidad de dominio y rebotes bajo control", 3]]
          .map(([w, d, dl]) => `<div data-reveal data-reveal-d="${dl}" style="padding:24px 28px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:18px;display:flex;align-items:baseline;justify-content:space-between;gap:24px;transition:background .32s var(--op-ease),transform .32s var(--op-ease);" style-hover="background:rgba(139,89,246,.16);transform:translateY(-2px)"><div style="font-family:var(--op-font-display);font-weight:700;font-size:44px;letter-spacing:-0.03em;line-height:1;color:var(--ac-3);">${w}</div><div style="font-size:13px;color:rgba(255,255,255,.6);max-width:18ch;text-align:right;line-height:1.4;">${d}</div></div>`).join("")}
      </div>
    </div>
    <div data-grid-4 style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;position:relative;">
      ${procCard("01", "Calentamiento", "Una red privada construye reputación de remitente antes del primer envío real.", "Reputación", "0s", 0)}
      ${procCard("02", "Envío", "Patrones de envío humanos y autenticación SPF/DKIM/DMARC bien resuelta.", "Patrones", ".4s", 1)}
      ${procCard("03", "Monitorización", "Rebotes, marcas de spam y señales de reputación medidos en tiempo real.", "Tiempo real", ".8s", 2)}
      ${procCard("04", "Bandeja principal", "Entregas donde de verdad se leen los correos. Tú te enfocas en cerrar.", "Destino", "1.2s", 3)}
    </div>
  </div>
</section>

<!-- BANDEJA -->
<section id="bandeja" style="padding:140px 0;background:#fff;border-top:1px solid var(--op-line-1);">
  <div data-pad style="max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-grid-2 style="display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:end;margin-bottom:64px;">
      <div>
        <div data-reveal style="display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--ac-2);"><span style="width:6px;height:6px;border-radius:999px;background:var(--ac);"></span>03 · Bandeja maestra</div>
        <h2 data-reveal data-reveal-d="1" style="font-family:var(--op-font-display);font-weight:700;font-size:clamp(48px,6vw,88px);letter-spacing:-0.035em;line-height:1;margin:20px 0 0;text-wrap:balance;">Una bandeja para<br>todo el <span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac);">negocio</span>.</h2>
      </div>
      <p data-reveal data-reveal-d="2" style="font-size:20px;color:var(--op-fg-2);line-height:1.55;margin:0;">Gestiona las respuestas de todas las campañas y todos los clientes desde un mismo lugar. Sin saltar entre cuentas. Sin perder un solo hilo caliente.</p>
    </div>
    <div data-grid-2 style="display:grid;grid-template-columns:.78fr 1.22fr;gap:56px;align-items:center;">
      <div style="display:flex;flex-direction:column;gap:2px;background:var(--op-line-1);border:1px solid var(--op-line-1);border-radius:18px;overflow:hidden;">
        <div data-reveal style="background:#fff;padding:28px 30px;display:grid;grid-template-columns:36px 1fr;gap:20px;align-items:start;">
          <div style="color:var(--ac);padding-top:2px;"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
          <div><h4 style="font-family:var(--op-font-display);font-weight:600;font-size:21px;letter-spacing:-0.01em;line-height:1.2;margin:0 0 8px;">Centraliza cada respuesta</h4><p style="font-size:15px;line-height:1.55;color:var(--op-fg-2);margin:0;">Todas las contestaciones, de todas las campañas, en una sola bandeja compartida.</p></div>
        </div>
        <div data-reveal data-reveal-d="1" style="background:#fff;padding:28px 30px;display:grid;grid-template-columns:36px 1fr;gap:20px;align-items:start;">
          <div style="color:var(--ac);padding-top:2px;"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg></div>
          <div><h4 style="font-family:var(--op-font-display);font-weight:600;font-size:21px;letter-spacing:-0.01em;line-height:1.2;margin:0 0 8px;">Organizado y receptivo</h4><p style="font-size:15px;line-height:1.55;color:var(--op-fg-2);margin:0;">Categoriza por intención, deja notas, programa seguimientos y aplica acciones en bloque.</p></div>
        </div>
        <div data-reveal data-reveal-d="2" style="background:#fff;padding:28px 30px;display:grid;grid-template-columns:36px 1fr;gap:20px;align-items:start;">
          <div style="color:var(--ac);padding-top:2px;"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></div>
          <div><h4 style="font-family:var(--op-font-display);font-weight:600;font-size:21px;letter-spacing:-0.01em;line-height:1.2;margin:0 0 8px;">Mantén los tratos en movimiento</h4><p style="font-size:15px;line-height:1.55;color:var(--op-fg-2);margin:0;">Un gestor con IA prioriza los leads calientes y sincroniza todo con tu CRM.</p></div>
        </div>
      </div>
      <div data-reveal data-reveal-d="1" style="border:1px solid var(--ac-line);border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(110,88,241,.16);background:#fff;">
        <div style="display:grid;grid-template-columns:48px 226px 1fr;height:486px;">
          <div style="background:linear-gradient(180deg,#F4F1FE,#EDE9FB);border-right:1px solid var(--ac-line);display:flex;flex-direction:column;align-items:center;gap:22px;padding:16px 0;">
            <div style="width:26px;height:26px;border-radius:7px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></div>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A99AE6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A99AE6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/></svg>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A99AE6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></svg>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A99AE6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>
          </div>
          <div style="border-right:1px solid var(--ac-line);display:flex;flex-direction:column;min-height:0;">
            <div style="padding:14px 16px 10px;border-bottom:1px solid var(--ac-line);">
              <div style="font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--ac);margin-bottom:8px;">Para mí</div>
              <div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-family:var(--op-font-display);font-weight:600;font-size:18px;letter-spacing:-0.01em;">Bandeja</span><span style="font-size:11px;color:var(--op-fg-3);font-family:var(--op-font-mono);">04</span></div>
            </div>
            <div style="overflow-y:auto;flex:1;min-height:0;">
              ${LEADS.map((_, i) => rowHTML(i, i === 0)).join("")}
            </div>
          </div>
          <div style="background:var(--op-bg-2);display:flex;flex-direction:column;min-height:0;" id="op-inbox-detail">
            ${detailHTML(0)}
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- STATS -->
<section style="background:#fff;border-top:1px solid var(--op-line-1);border-bottom:1px solid var(--op-line-1);padding:64px 0;">
  <div data-pad style="max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-grid-4 style="display:grid;grid-template-columns:repeat(4,1fr);">
      <div data-reveal style="padding:24px 40px;">
        <div class="op-count" data-count="100" style="font-family:var(--op-font-display);font-weight:700;font-size:72px;letter-spacing:-0.04em;line-height:1;color:var(--ac);">0<span style="font-family:var(--op-font-serif);font-style:italic;font-size:.5em;color:var(--op-fg-2);margin-left:4px;vertical-align:top;">k+</span></div>
        <div style="font-size:14px;color:var(--op-fg-2);margin-top:12px;letter-spacing:.02em;">Equipos de outbound activos</div>
      </div>
      <div data-reveal data-reveal-d="1" style="padding:24px 40px;border-left:1px solid var(--op-line-1);">
        <div class="op-count" data-count="99" style="font-family:var(--op-font-display);font-weight:700;font-size:72px;letter-spacing:-0.04em;line-height:1;color:var(--ac);">0<span style="font-family:var(--op-font-serif);font-style:italic;font-size:.5em;color:var(--op-fg-2);margin-left:4px;vertical-align:top;">%</span></div>
        <div style="font-size:14px;color:var(--op-fg-2);margin-top:12px;letter-spacing:.02em;">Llegada a la bandeja principal</div>
      </div>
      <div data-reveal data-reveal-d="2" style="padding:24px 40px;border-left:1px solid var(--op-line-1);">
        <div style="font-family:var(--op-font-display);font-weight:700;font-size:48px;line-height:1.05;letter-spacing:-0.03em;color:var(--ac);">Buzones<br><span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;">ilimitados</span></div>
        <div style="font-size:14px;color:var(--op-fg-2);margin-top:12px;letter-spacing:.02em;">Sin tarifas de almacenamiento</div>
      </div>
      <div data-reveal data-reveal-d="3" style="padding:24px 40px;border-left:1px solid var(--op-line-1);">
        <div class="op-count" data-count="3" style="font-family:var(--op-font-display);font-weight:700;font-size:72px;letter-spacing:-0.04em;line-height:1;color:var(--ac);">0<span style="font-family:var(--op-font-serif);font-style:italic;font-size:.5em;color:var(--op-fg-2);margin-left:4px;vertical-align:top;">x</span></div>
        <div style="font-size:14px;color:var(--op-fg-2);margin-top:12px;letter-spacing:.02em;">Más leads verificados al mes</div>
      </div>
    </div>
  </div>
</section>

<!-- CASOS -->
<section id="casos" style="padding:140px 0;background:var(--op-bg-2);border-top:1px solid var(--op-line-1);">
  <div data-pad style="max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-grid-2 style="display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:end;margin-bottom:72px;">
      <div>
        <div data-reveal style="display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--ac-2);"><span style="width:6px;height:6px;border-radius:999px;background:var(--ac);"></span>04 · Casos de éxito</div>
        <h2 data-reveal data-reveal-d="1" style="font-family:var(--op-font-display);font-weight:700;font-size:clamp(48px,6vw,88px);letter-spacing:-0.035em;line-height:1;margin:20px 0 0;text-wrap:balance;">Equipos que ahora<br>cierran <span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac);">más rápido</span>.</h2>
      </div>
      <p data-reveal data-reveal-d="2" style="font-size:20px;color:var(--op-fg-2);line-height:1.55;margin:0;">Tres equipos, tres mercados, un mismo motor de outbound. Así se ve OnePulso en producción.</p>
    </div>
    <div style="display:flex;flex-direction:column;border-top:1px solid var(--op-line-1);">
      ${caseRow("01", "Danish Lead Co.", "Agencia de leads · Copenhague", "Buzones ilimitados + API · 9 meses", "10k", "reuniones", "de ventas generadas", 0)}
      ${caseRow("02", "Sponja", "B2B SaaS · Madrid", "Calentamiento + secuencias · 5 semanas", "50", "%", "tasa de respuesta positiva", 1)}
      ${caseRow("03", "LeadLead BangBang", "Outbound agency · Europa", "Infraestructura dedicada · 6 meses", "4.7", "x", "pipeline cualificado", 2)}
    </div>
  </div>
</section>

<!-- CTA -->
<section id="cta" style="background:linear-gradient(180deg,#241A4D 0%,#17122E 100%);color:#fff;text-align:center;padding:160px 0 140px;position:relative;overflow:hidden;">
  <div style="position:absolute;inset:0;background-image:radial-gradient(45% 55% at 50% 0%,rgba(139,89,246,.4),transparent 60%),radial-gradient(60% 40% at 50% 100%,rgba(110,88,241,.25),transparent 60%);pointer-events:none;"></div>
  <div data-pad style="position:relative;z-index:1;max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-reveal style="display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.6);"><span style="width:6px;height:6px;border-radius:999px;background:var(--ac-3);"></span>Siguiente paso</div>
    <h2 data-reveal data-reveal-d="1" style="font-family:var(--op-font-display);font-weight:700;font-size:clamp(56px,8vw,128px);letter-spacing:-0.04em;line-height:.95;margin:20px 0 0;color:#fff;">Empieza tu primer<br><span style="font-family:var(--op-font-serif);font-style:italic;font-weight:400;color:var(--ac-3);">flujo</span> hoy.</h2>
    <p data-reveal data-reveal-d="2" style="font-size:22px;color:rgba(255,255,255,.72);line-height:1.5;max-width:56ch;margin:36px auto 0;">Crea tu cuenta gratis, conecta un buzón y mira cómo OnePulso calienta, envía y llena tu bandeja de respuestas reales.</p>
    <a href="${SIGNUP}" data-reveal data-reveal-d="3" style="display:inline-flex;align-items:center;gap:10px;padding:20px 30px;background:#fff;color:var(--ac-2);border-radius:14px;font-size:17px;font-weight:600;margin-top:48px;transition:transform .2s var(--op-ease),box-shadow .2s var(--op-ease);" style-hover="transform:translateY(-3px);box-shadow:0 18px 40px rgba(0,0,0,.3)">Empezar gratis <span aria-hidden="true">&#8594;</span></a>
  </div>
</section>

<!-- FOOTER -->
<footer style="background:#0E0A20;color:#fff;padding:80px 0 40px;">
  <div data-pad style="max-width:1360px;margin:0 auto;padding:0 64px;">
    <div data-grid-4 style="display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;gap:48px;padding-bottom:56px;border-bottom:1px solid rgba(255,255,255,.1);">
      <div>
        <img src="/onepulso-logo-white-transparent.png" alt="OnePulso" style="height:24px;margin-bottom:20px;">
        <p style="font-size:14px;color:rgba(255,255,255,.55);line-height:1.55;max-width:32ch;margin:0;">Outbound con IA y entregabilidad propia. Prospecta, calienta, envía y cierra desde una sola plataforma.</p>
      </div>
      <div>
        <h5 style="font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.45);margin:0 0 20px;">Producto</h5>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;font-size:14px;color:rgba(255,255,255,.8);">
          <li><a href="#producto" style-hover="color:var(--ac-3)">Plataforma</a></li>
          <li><a href="#entregabilidad" style-hover="color:var(--ac-3)">Entregabilidad</a></li>
          <li><a href="#bandeja" style-hover="color:var(--ac-3)">Bandeja maestra</a></li>
          <li><a href="#cta" style-hover="color:var(--ac-3)">Precios</a></li>
        </ul>
      </div>
      <div>
        <h5 style="font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.45);margin:0 0 20px;">Empresa</h5>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;font-size:14px;color:rgba(255,255,255,.8);">
          <li><a href="#casos" style-hover="color:var(--ac-3)">Casos de éxito</a></li>
          <li><a href="#cta" style-hover="color:var(--ac-3)">Empezar</a></li>
        </ul>
      </div>
      <div>
        <h5 style="font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.45);margin:0 0 20px;">Contacto</h5>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;font-size:14px;color:rgba(255,255,255,.8);">
          <li><a href="mailto:team@onepulso.online" style-hover="color:var(--ac-3)">team@onepulso.online</a></li>
          <li>Barcelona · España</li>
        </ul>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:28px;font-size:13px;color:rgba(255,255,255,.45);flex-wrap:wrap;gap:12px;">
      <span>© 2026 OnePulso. Todos los derechos reservados.</span>
      <div style="display:flex;gap:24px;">
        <a href="/auth" style-hover="color:var(--ac-3)">Iniciar sesión</a>
        <a href="${SIGNUP}" style-hover="color:var(--ac-3)">Crear cuenta</a>
      </div>
    </div>
  </div>
</footer>
`;

export default function Landing() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];

    // Hover styles (replicates the design system's style-hover attribute)
    root.querySelectorAll<HTMLElement>("[style-hover]").forEach((el) => {
      const hov = el.getAttribute("style-hover");
      if (!hov) return;
      const decls = hov.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
        const i = s.indexOf(":");
        return [s.slice(0, i).trim(), s.slice(i + 1).trim()] as [string, string];
      });
      const orig: Record<string, string> = {};
      const enter = () => decls.forEach(([p, v]) => { orig[p] = el.style.getPropertyValue(p); el.style.setProperty(p, v); });
      const leave = () => decls.forEach(([p]) => el.style.setProperty(p, orig[p] || ""));
      el.addEventListener("mouseenter", enter);
      el.addEventListener("mouseleave", leave);
      cleanups.push(() => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); });
    });

    // Reveal on scroll
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    items.forEach((el) => {
      const d = parseInt(el.getAttribute("data-reveal-d") || "0", 10);
      el.style.opacity = "0";
      el.style.transform = "translateY(32px)";
      el.style.transition = `opacity .9s var(--op-ease-out) ${d * 0.08}s, transform .9s var(--op-ease-out) ${d * 0.08}s`;
    });
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { (e.target as HTMLElement).style.opacity = "1"; (e.target as HTMLElement).style.transform = "none"; io!.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
      items.forEach((el) => io!.observe(el));
    } else {
      items.forEach((el) => { el.style.opacity = "1"; el.style.transform = "none"; });
    }

    // Counters
    const animateCount = (el: HTMLElement) => {
      const target = parseFloat(el.getAttribute("data-count") || "0");
      const dur = 1600, start = performance.now();
      const isInt = Number.isInteger(target);
      let tn = el.firstChild;
      if (!tn || tn.nodeType !== 3) { tn = document.createTextNode("0"); el.insertBefore(tn, el.firstChild); }
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        const v = target * eased;
        tn!.nodeValue = isInt ? Math.round(v).toString() : v.toFixed(1);
        if (t < 1) requestAnimationFrame(frame);
        else tn!.nodeValue = isInt ? Math.round(target).toString() : target.toFixed(1);
      };
      requestAnimationFrame(frame);
    };
    let cio: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      cio = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { animateCount(e.target as HTMLElement); cio!.unobserve(e.target); } });
      }, { threshold: 0.5 });
      root.querySelectorAll<HTMLElement>(".op-count").forEach((el) => cio!.observe(el));
    }

    // Nav background on scroll
    const bar = root.querySelector<HTMLElement>("[data-nav-bar]");
    const onScroll = () => {
      if (!bar) return;
      if (window.scrollY > 40) { bar.style.background = "rgba(255,255,255,.94)"; bar.style.boxShadow = "0 8px 30px rgba(110,88,241,.16)"; }
      else { bar.style.background = "rgba(255,255,255,.8)"; bar.style.boxShadow = "0 6px 24px rgba(110,88,241,.1)"; }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener("scroll", onScroll));

    // Master-inbox selection
    const setActive = (i: number) => {
      root.querySelectorAll<HTMLElement>("[data-lead]").forEach((b) => {
        const on = Number(b.getAttribute("data-lead")) === i;
        b.style.setProperty("border-left-color", on ? "var(--ac)" : "transparent");
        b.style.setProperty("background", on ? "var(--ac-soft)" : "#fff");
      });
      const d = root.querySelector("#op-inbox-detail");
      if (d) d.innerHTML = detailHTML(i);
    };
    root.querySelectorAll<HTMLElement>("[data-lead]").forEach((b) => {
      const handler = () => setActive(Number(b.getAttribute("data-lead")));
      b.addEventListener("click", handler);
      cleanups.push(() => b.removeEventListener("click", handler));
    });

    return () => { io?.disconnect(); cio?.disconnect(); cleanups.forEach((c) => c()); };
  }, []);

  return <div ref={ref} className="op-landing" dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
