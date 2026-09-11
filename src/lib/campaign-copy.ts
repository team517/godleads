// The copy every generated campaign must be modelled on.
// =====================================================================
// KEEP IN SYNC (byte-identical) WITH:
//   - supabase/functions/_shared/campaign-copy.ts  (edge, Deno)
//   - src/lib/campaign-copy.ts                     (frontend, Vite/TS)
// Pure text, no imports, so both runtimes can use it and a test can diff them.
// =====================================================================
//
// These three emails are the ones that actually get replies ("EJEMPLOS QUE FUNCIONAN",
// 2026-09-11). The owner's rule: every campaign the platform writes for a client — the support
// bot's automatic ones and the "Crear campaña" generator — must be VERY similar to them,
// adapted only in what the client does. The tone, the paragraph order, the anchor sentences,
// the follow-up cadence and the CTA stay. This is not a style guide to interpret; it is a mould.

export const CAMPAIGN_EXAMPLES = `EJEMPLO — STEP 1 (email inicial)

Buenas {{first_name}}
Soy Mario, Investigando {{company_name}} en Linkedin, nos dimos cuenta que tenéis una buena imagen hacia el público, y esto es realmente asombroso,
no todas las empresas similares a {{company_name}} consiguen verse tan bien como vosotros, se que puede ser un poco raro que te diga esto alguien que no conoces, y no, esto no es una plantilla.
te escribo porque en TuNuevoLead ayudamos a empresas muy similares a {{company_name}} a conseguir reuniones de manera estable, es decir cada mes tener reuniones comerciales con posibles clientes.
Nosotros lo que hacemos es que integramos un equipo profesional en {{company_name}} para conseguir que conectes con tu cliente ideal de forma constante, y si {{first_name}}, estoy seguro que recibes muchos correos como este, pero nosotros actuamos como un partner comercial, ayudando a conseguir los objetivos comerciales que se propone tu equipo, por eso somos diferentes, porque equipamos y enseñamos tu equipo,
realmente me hace mucha ilusion poder trabajar con una empresa como {{company_name}}, ya que realmente estoy seguro que puedo ayudarte a conectar con mas clientes, en empresas similares conseguimos entre 15-20 reuniones mensuales extra
te he preparado una demo personalizada para que puedas ver que impacto tendria en {{company_name}}
¿te va bien verlo 10 minutos esta semana?
quedo atento
un saludo
Mario

EJEMPLO — STEP 2 (primer follow-up, 2-3 días después, mismo hilo)

Buenas {{first_name}},
Quería hacerte seguimiento porque creo que puede ser especialmente interesante para {{company_name}}.
Con empresas similares a vosotros estamos consiguiendo generar entre 15 y 20 reuniones comerciales adicionales al mes, gracias a un sistema que nos permite identificar y contactar de forma constante con empresas que encajan con su cliente ideal.
La idea es que vuestro equipo reciba oportunidades reales, sin tener que dedicar horas a buscar prospectos y hacer seguimientos.
Si quieres, te enseño en 10 minutos cómo lo estamos haciendo y qué podríamos conseguir en vuestro caso:
https://calendly.com/tunuevolead/30min
¿Te encaja esta semana?
Un saludo,
Mario

EJEMPLO — STEP 3 (segundo follow-up, 3-4 días después, mismo hilo)

Buenas {{first_name}},
Te hago un pequeño seguimiento porque quería compartirte un dato que creo que puede interesarte.
Con empresas similares a {{company_name}}, estamos consiguiendo entre 15 y 20 reuniones comerciales extra cada mes.
El objetivo es sencillo: identificar vuestro cliente ideal, contactar con él de forma personalizada y convertir esos contactos en reuniones comerciales para vuestro equipo.
He preparado una demo para enseñarte cómo podríamos plantearlo específicamente para {{company_name}}.
Puedes reservar directamente aquí:
https://calendly.com/tunuevolead/30min
¿Lo vemos?
Un saludo,
Mario`;

export const CAMPAIGN_COPY_RULES = `LOS EJEMPLOS SON EL MOLDE. Cada email que escribas tiene que ser MUY, MUY similar al ejemplo de su step: mismo número y orden de párrafos, misma longitud aproximada, mismo tono (cercano, humano, algo informal — incluso las minúsculas tras coma del ejemplo están bien), y las mismas frases-ancla. No "te inspires": calca la estructura y cambia SOLO lo que es del cliente.

LO QUE CAMBIAS (y nada más):
- El nombre de quien firma (el comercial del cliente) y la empresa que envía.
- "ayudamos a empresas muy similares a {{company_name}} a [lo que hace el CLIENTE]" → describe la oferta del cliente con esa misma forma de frase, según el briefing.
- "Nosotros lo que hacemos es que [cómo lo hace el cliente]" → su método, en una frase, con el mismo giro "y si {{first_name}}, estoy seguro que recibes muchos correos como este, pero nosotros...".
- El dato de resultado ("entre 15-20 reuniones mensuales extra") → el beneficio REAL y CONCRETO del cliente si el briefing lo da; si no lo da, una cifra típica y verosímil de su sector con la MISMA forma ("en empresas similares conseguimos entre X y Y ... al mes"). El mismo dato se repite en los dos follow-ups, como en el ejemplo.
- "te he preparado una demo personalizada para que puedas ver que impacto tendria en {{company_name}}" → demo, ejemplo, propuesta o muestra: lo que el cliente pueda enseñar de verdad.
- El enlace de reserva: SOLO si el briefing da uno (Calendly, etc.). Si no hay enlace, quita esa línea y deja la pregunta ("¿Te encaja esta semana?" / "¿Lo vemos?").

LO QUE NO CAMBIAS (frases-ancla, tal cual, con las variables):
- "Buenas {{first_name}}" (nunca "Estimado", nunca "Hola {{first_name}}, espero que estés bien").
- "Soy [Nombre], Investigando {{company_name}} en Linkedin, nos dimos cuenta que tenéis una buena imagen hacia el público, y esto es realmente asombroso, no todas las empresas similares a {{company_name}} consiguen verse tan bien como vosotros, se que puede ser un poco raro que te diga esto alguien que no conoces, y no, esto no es una plantilla."
- "y si {{first_name}}, estoy seguro que recibes muchos correos como este, pero nosotros ..."
- "realmente me hace mucha ilusion poder trabajar con una empresa como {{company_name}}, ya que realmente estoy seguro que puedo ayudarte a ..."
- "¿te va bien verlo 10 minutos esta semana?" + "quedo atento" + "un saludo" + Nombre.
- Follow-up 1: "Quería hacerte seguimiento porque creo que puede ser especialmente interesante para {{company_name}}." ... "La idea es que vuestro equipo [beneficio], sin tener que [dolor]." ... "Si quieres, te enseño en 10 minutos cómo lo estamos haciendo y qué podríamos conseguir en vuestro caso:" ... "¿Te encaja esta semana?"
- Follow-up 2: "Te hago un pequeño seguimiento porque quería compartirte un dato que creo que puede interesarte." ... "El objetivo es sencillo: [tres pasos del cliente]." ... "He preparado una demo para enseñarte cómo podríamos plantearlo específicamente para {{company_name}}." ... "¿Lo vemos?"

VARIABLES: usa {{first_name}} y {{company_name}} exactamente donde las usa el ejemplo. {{industry}} y {{city}} solo si encajan de forma natural, nunca forzadas.

LONGITUD: step 1 como el ejemplo (170-200 palabras). Follow-ups 70-110 palabras. Si te piden más de 3 steps, los follow-ups extra siguen el molde del step 3: cortos, un dato, la demo, la pregunta.

FORMATO: cada párrafo en su propio <p>...</p>. Sin emojis. Sin negritas. Sin asuntos en mayúsculas. Sin frases corporativas ("saludos cordiales", "quedo a su disposición").

VARIANTES: una variante cambia SOLO el ángulo de la frase de oferta y del dato (p. ej. de "más reuniones" a "más ventas" / "cliente ideal"); el molde, las frases-ancla y el CTA no cambian.

PROHIBIDO INVENTAR SOBRE EL PROSPECT: la única "investigación" que afirmas es la del ejemplo (la buena imagen hacia el público). Nada de detalles internos suyos que no sabes.`;

/** The full system block a generator prepends: the mould, then the rules. */
export const CAMPAIGN_COPY_SYSTEM = `${CAMPAIGN_EXAMPLES}\n\n${CAMPAIGN_COPY_RULES}`;
