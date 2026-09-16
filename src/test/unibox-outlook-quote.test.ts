import { describe, expect, it } from "vitest";
import { cleanBodyHtml, renderableHtml } from "@/pages/Unibox";

// Outlook (web/new) wraps the NEW reply in <blockquote class="elementToProof"> and puts the
// quoted chain after <div id="appendonsend"> + <hr> + "De:/Enviado:". Cutting at the first
// <blockquote> emptied the card in the Unibox (real case, 2026-09-14).
const OUTLOOK = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style></head>
<body dir="ltr"><blockquote class="elementToProof" style="background-color: rgb(255, 255, 255);">
<div class="elementToProof" style="font-family: Aeonik, serif; font-size: 11pt;">Buenos días, Juan,&nbsp;</div>
<div class="elementToProof"><br></div>
<div class="elementToProof">Esta parte ya la tenemos cubierta y no estamos precisando un cambio.</div>
<div class="elementToProof">Saludos,&nbsp;</div>
</blockquote>
<div id="appendonsend"></div>
<hr style="display:inline-block;width:98%" tabindex="-1">
<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>De:</b> Juan &lt;juan@ejemplo.es&gt;<br>
<b>Enviado:</b> lunes, 14 de septiembre de 2026 9:58<br><b>Asunto:</b> Juan - Cellect Energy</font></div>
<div class="elementToProof">Hola Bertha, te escribo porque…</div>
</body></html>`;

const GMAIL = `<div dir="ltr">Sí, me interesa. ¿Hablamos el jueves?</div><br>
<div class="gmail_quote"><div dir="ltr" class="gmail_attr">El lun, 14 sept 2026 a las 9:58, Juan escribió:<br></div>
<blockquote class="gmail_quote">Hola, te escribo porque…</blockquote></div>`;

// Outlook MÓVIL: la respuesta va en el primer <div>, luego la firma, y el bloque citado
// (`mail-editor-reference-message-container`) lleva un <meta name="viewport"> seguido de
// un salto de línea. La regla de adjuntos borraba "cualquier línea con name=" → se llevaba
// la respuesta entera y sólo quedaba nuestro correo citado (real, 2026-09-14).
const OUTLOOK_MOBILE = `<html><body><div style="direction: ltr;">Te agradezco el ofrecimiento, la suma de reuniones asciende a cero.</div><div><br></div><div>Un saludo</div><div id="ms-outlook-mobile-signature" dir="ltr"><div>Obtener <a href="https://aka.ms/o0ukef">Outlook para iOS</a></div></div><div id="mail-editor-reference-message-container"><div class="ms-outlook-mobile-reference-message skipProofing"><meta name="viewport" content="width=device-width, initial-scale=1">

</div><div class="ms-outlook-mobile-reference-message"><div dir="ltr"><b>De:</b> Mario &lt;mario@ejemplo.info&gt;<br><b>Fecha:</b> lunes, 14 de septiembre de 2026 a las 13:55<br><b>Para:</b> maico@ejemplo.es<br><b>Asunto:</b> no te olvides de esto</div></div><div id="mail-editor-reference-message-body"><div>Buenas Maico, Quería hacerte seguimiento porque…</div></div></div></body></html>`;

// Thunderbird: EVERY paragraph of the new reply sits in <div class="moz-cite-prefix">, and so
// does the attribution line right before <blockquote type="cite">. Treating the class as a
// quote marker showed one line (or nothing). Real case: Auteide, 2026-09-16.
const THUNDERBIRD = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>
<div class="moz-cite-prefix">Hola Juanjo, soy Reynaldo, del Dep. de Marketing de Auteide.</div>
<div class="moz-cite-prefix"><br></div>
<div class="moz-cite-prefix">Te escribo para consultarte si podríamos fijar esa conversación para el próximo Lunes a las 12:00 hora Canaria.</div>
<div class="moz-cite-prefix"><br></div>
<div class="moz-cite-prefix">A espera de tu respuesta, recibe un cordial saludo.</div>
<div class="moz-cite-prefix"><br></div>
<div class="moz-cite-prefix">El 16/09/2026 a las 9:59, Bruno Tranche escribió:<br></div>
<blockquote type="cite" cite="mid:2af11eeb@auteide.com"><p>-------- Mensaje reenviado --------</p><p>Asunto: que la IA recomiende a Auteide</p><p>Hola Reynaldo, te escribo porque…</p></blockquote>
<div class="moz-signature">-- <br>Reynaldo Hernandez · Marketing</div>
</body></html>`;

const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

describe("Unibox — corte de la cita en HTML", () => {
  it("Outlook: conserva la respuesta nueva envuelta en blockquote y corta en la cita real", () => {
    const out = strip(cleanBodyHtml(OUTLOOK));
    expect(out).toContain("Buenos días, Juan");
    expect(out).toContain("ya la tenemos cubierta");
    expect(out).not.toContain("Enviado:");
    expect(out).not.toContain("te escribo porque");
  });

  it("Outlook móvil: la respuesta sobrevive al <meta name=…> de la cita y se corta en De:/Fecha:", () => {
    const out = strip(cleanBodyHtml(OUTLOOK_MOBILE));
    expect(out).toContain("Te agradezco el ofrecimiento");
    expect(out).toContain("Un saludo");
    expect(out).not.toContain("Fecha:");
    expect(out).not.toContain("Buenas Maico");
    // y con «Ver email completo» sigue estando todo
    expect(strip(cleanBodyHtml(OUTLOOK_MOBILE, true))).toContain("Buenas Maico");
  });

  it("Thunderbird: los párrafos nuevos en div.moz-cite-prefix se conservan y se corta en «El … escribió:»", () => {
    const out = strip(cleanBodyHtml(THUNDERBIRD));
    expect(out).toContain("Hola Juanjo, soy Reynaldo");
    expect(out).toContain("Lunes a las 12:00 hora Canaria");
    expect(out).toContain("recibe un cordial saludo");
    expect(out).not.toContain("escribió:");
    expect(out).not.toContain("Mensaje reenviado");
    expect(strip(cleanBodyHtml(THUNDERBIRD, true))).toContain("Mensaje reenviado");
  });

  it("Gmail: sigue cortando en el bloque gmail_quote", () => {
    const out = strip(cleanBodyHtml(GMAIL));
    expect(out).toContain("me interesa");
    expect(out).not.toContain("te escribo porque");
  });

  it("«Ver email completo» conserva la cita", () => {
    expect(strip(cleanBodyHtml(OUTLOOK, true))).toContain("te escribo porque");
  });

  it("renderableHtml devuelve algo pintable para el caso Outlook y '' para HTML sin contenido", () => {
    expect(renderableHtml(OUTLOOK)).not.toBe("");
    expect(renderableHtml("<html><head><style>p{}</style></head><body></body></html>")).toBe("");
  });
});
