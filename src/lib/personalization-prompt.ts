// Personalización → "Crear prompt con IA": unas preguntas (empresa, quién firma, idioma, qué se
// vende, beneficios…) y sale el prompt de personalización ya escrito. La plantilla está CALCADA del
// prompt que mejor le funciona al propietario (PubliUp, 01-10-2026): mismas secciones, mismo orden
// y mismas reglas; sólo cambia lo que el usuario ha contestado.

export type IdiomaId = "es-ES" | "es-419" | "ca" | "en" | "fr" | "it" | "pt" | "de";

interface Idioma {
  id: IdiomaId; label: string; nombre: string;
  saludo: (n: string, f: string) => string; arranque: (o: string) => string; cierre: string;
  /** Las reglas de anglicismos sólo tienen sentido si se escribe en español o catalán. */
  anglicismos: boolean;
}

export const IDIOMAS: Idioma[] = [
  { id: "es-ES", label: "Español (España)", nombre: "español de España", saludo: (n, f) => `Hola ${n}, soy ${f}.`, arranque: (o) => `Vi a ${o} y me apasionó`, cierre: "Saludos,", anglicismos: true },
  { id: "es-419", label: "Español (Latinoamérica)", nombre: "español neutro de Latinoamérica", saludo: (n, f) => `Hola ${n}, soy ${f}.`, arranque: (o) => `Vi a ${o} y me encantó`, cierre: "Saludos,", anglicismos: true },
  { id: "ca", label: "Català", nombre: "catalán", saludo: (n, f) => `Hola ${n}, soc ${f}.`, arranque: (o) => `Vaig veure ${o} i em va apassionar`, cierre: "Salutacions,", anglicismos: true },
  { id: "en", label: "English", nombre: "inglés", saludo: (n, f) => `Hi ${n}, I'm ${f}.`, arranque: (o) => `I came across ${o} and I loved`, cierre: "Best regards,", anglicismos: false },
  { id: "fr", label: "Français", nombre: "francés", saludo: (n, f) => `Bonjour ${n}, je suis ${f}.`, arranque: (o) => `J'ai découvert ${o} et j'ai été passionné par`, cierre: "Cordialement,", anglicismos: false },
  { id: "it", label: "Italiano", nombre: "italiano", saludo: (n, f) => `Ciao ${n}, sono ${f}.`, arranque: (o) => `Ho visto ${o} e mi ha appassionato`, cierre: "Saluti,", anglicismos: false },
  { id: "pt", label: "Português", nombre: "portugués", saludo: (n, f) => `Olá ${n}, sou ${f}.`, arranque: (o) => `Vi a ${o} e fiquei apaixonado por`, cierre: "Cumprimentos,", anglicismos: false },
  { id: "de", label: "Deutsch", nombre: "alemán", saludo: (n, f) => `Hallo ${n}, ich bin ${f}.`, arranque: (o) => `Ich habe ${o} gesehen und war begeistert von`, cierre: "Viele Grüße,", anglicismos: false },
];

export interface RespuestasPrompt {
  empresa: string;            // "PubliUp"
  firmante: string;           // "Nacho"
  idioma: IdiomaId;
  /** Lo que conseguís para el cliente, en infinitivo: "conseguir nuevos clientes". */
  promesa: string;
  /** Las ideas que tienen que aparecer SIEMPRE (hasta 3): "oportunidades recurrentes"… */
  beneficios: string[];
  /** Cómo lo hacéis, una frase por línea. */
  comoLoHacemos: string[];
  /** Lo que ofrecéis enseñar: "una demostración personalizada". */
  oferta: string;
  minutos: number;
  palabrasMin: number;
  palabrasMax: number;
  colNombre: string;
  colEmpresa: string;
  /** Columna con la descripción de la empresa ("" si el CSV no la tiene). */
  colDescripcion: string;
}

export const RESPUESTAS_EJEMPLO: RespuestasPrompt = {
  empresa: "", firmante: "", idioma: "es-ES",
  promesa: "conseguir nuevos clientes",
  beneficios: ["oportunidades comerciales recurrentes", "mayor estabilidad comercial"],
  comoLoHacemos: [
    "Identificamos empresas que encajan con su cliente ideal.",
    "Contactamos con potenciales clientes adecuados.",
    "Generamos conversaciones y oportunidades comerciales.",
  ],
  oferta: "una demostración personalizada",
  minutos: 15, palabrasMin: 140, palabrasMax: 160,
  colNombre: "", colEmpresa: "", colDescripcion: "",
};

const limpio = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
const sinPunto = (s: string) => limpio(s).replace(/[.;,]+$/, "");
const frase = (s: string) => { const t = sinPunto(s); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : ""; };

/** Adivina qué columna del CSV es el nombre, la empresa y la descripción. */
export function detectarColumnas(columns: string[]): { colNombre: string; colEmpresa: string; colDescripcion: string } {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_.\-]/g, "");
  const busca = (...pats: RegExp[]) => { for (const p of pats) { const c = columns.find((x) => p.test(norm(x))); if (c) return c; } return ""; };
  return {
    colNombre: busca(/^firstname$/, /^nombre$/, /^name$/, /firstname|nombre/),
    colEmpresa: busca(/^organizationname$/, /^companyname$/, /^empresa$/, /^company$/, /organizationname|companyname|empresa|company/),
    colDescripcion: busca(/organizationlinkedindescription/, /organizationoverview/, /companydescription|descripcion|description|overview|about|summary/),
  };
}

export function validarRespuestas(r: RespuestasPrompt): string | null {
  if (!limpio(r.empresa)) return "Dime cómo se llama tu empresa";
  if (!limpio(r.firmante)) return "Dime quién firma el correo";
  if (!limpio(r.promesa)) return "Cuéntame qué conseguís para vuestros clientes";
  if (!r.beneficios.map(limpio).filter(Boolean).length) return "Pon al menos un beneficio";
  if (!r.colNombre) return "Elige la columna con el nombre de la persona";
  if (!r.colEmpresa) return "Elige la columna con el nombre de la empresa";
  if (!(r.palabrasMin > 0 && r.palabrasMax >= r.palabrasMin)) return "Revisa la longitud del correo";
  if (!(r.minutos > 0)) return "Indica cuántos minutos dura la llamada";
  return null;
}

/** El prompt completo, calcado de la plantilla del propietario. */
export function construirPrompt(r: RespuestasPrompt): string {
  const lang = IDIOMAS.find((i) => i.id === r.idioma) || IDIOMAS[0];
  const E = limpio(r.empresa), F = limpio(r.firmante);
  const N = `{${r.colNombre}}`, O = `{${r.colEmpresa}}`;
  const tieneDesc = !!r.colDescripcion;
  const D = tieneDesc ? `{${r.colDescripcion}}` : "la información disponible sobre la empresa";
  const promesa = sinPunto(r.promesa);
  const beneficios = r.beneficios.map(sinPunto).filter(Boolean).slice(0, 3);
  const como = r.comoLoHacemos.map(frase).filter(Boolean);
  const oferta = sinPunto(r.oferta) || "una demostración personalizada";
  const min = Math.round(r.minutos);
  const pMin = Math.round(r.palabrasMin), pMax = Math.round(r.palabrasMax), pObj = Math.round((pMin + pMax) / 2);
  const saludo = lang.saludo(N, F);
  const arranque = lang.arranque(O);
  const ideas = [promesa, ...beneficios];
  const IDEAS = ideas.map((x) => x.toUpperCase()).join(" + ");
  const beneficiosFrase = beneficios.length > 1 ? `${beneficios.slice(0, -1).join(", ")} y ${beneficios[beneficios.length - 1]}` : beneficios[0];
  const parrafos = (lineas: string[]) => lineas.join("\n\n");

  const s: string[] = [];
  s.push("Actúa como un copywriter experto en prospección comercial B2B y correos en frío altamente personalizados.");
  s.push("Tu tarea es generar UN único correo comercial altamente personalizado para cada prospecto utilizando:");
  s.push([N, O, ...(tieneDesc ? [D] : [])].join("\n"));

  s.push("IDIOMA OBLIGATORIO");
  s.push("ESTA REGLA TIENE PRIORIDAD ABSOLUTA.");
  s.push(`El 100% del correo debe estar escrito en ${lang.nombre}.`);
  s.push(`Aunque ${D} esté en otro idioma, debes comprenderla, traducir mentalmente la información y redactarla de forma natural en ${lang.nombre}.`);
  s.push("NUNCA copies literalmente una descripción escrita en otro idioma.");
  s.push("Las únicas excepciones son nombres propios, empresas, marcas, productos o términos técnicos que deban conservar su nombre original.");

  s.push("OBJETIVO PRINCIPAL");
  s.push(`El correo debe parecer escrito manualmente por ${F} después de investigar específicamente a ${O}.`);
  s.push("Primero habla de la empresa y demuestra que entiendes qué hace.");
  s.push(`Después conecta esa información con ${E}.`);
  s.push("En TODOS los correos debe quedar claro que:");
  s.push(`Nos especializamos en ayudar a empresas como ${O} a ${promesa}.`);
  s.push(`Lo que aportamos es: ${beneficiosFrase}.`);
  s.push("ESTOS CONCEPTOS SON OBLIGATORIOS EN TODOS LOS CORREOS.");
  s.push("Debes comunicar siempre la idea de:");
  s.push(`${IDEAS}.`);
  s.push("No es necesario utilizar exactamente estas palabras. Adapta la frase para que resulte natural según cada empresa.");
  s.push("No repitas esta idea constantemente. Debe aparecer de forma clara y convincente una vez, pudiendo reforzarse ligeramente después.");

  s.push("INICIO OBLIGATORIO");
  s.push("Todos los correos deben comenzar SIEMPRE:");
  s.push(saludo);
  s.push("El segundo párrafo debe empezar SIEMPRE:");
  s.push(`${arranque}...`);
  s.push(`Después utiliza ${D} para explicar qué te llamó la atención.`);
  if (tieneDesc) {
    s.push("NO escribas literalmente:");
    s.push(`"${arranque} ${D}"`);
  }
  s.push("Debes analizar la descripción y transformarla en una observación humana.");
  s.push("Por ejemplo, si la descripción explica que desarrollan soluciones tecnológicas para hoteles, habla de cómo te llamó la atención su forma de ayudar al sector hotelero mediante sus soluciones.");

  s.push("PERSONALIZACIÓN");
  s.push(`Analiza ${D} e identifica:`);
  s.push(parrafos(["Qué hace la empresa.", "Qué vende.", "A quién ayuda.", "Qué problema resuelve.", "Qué diferencia su propuesta.", "Qué tipo de potenciales clientes podrían tener sentido para ellos."]));
  s.push("Utiliza esta información para crear una introducción realmente personalizada.");
  s.push(`El destinatario debe sentir que ${F} ha investigado específicamente a ${O}.`);
  s.push(parrafos(["NO inventes información.", "NO inventes necesidades.", "NO inventes problemas.", "NO inventes clientes.", "NO inventes cifras.", "NO inventes resultados."]));

  s.push(`PRESENTACIÓN DE ${E.toUpperCase()}`);
  s.push(`Después de hablar sobre ${O}, conecta de manera natural con ${E}.`);
  s.push(`En TODOS los correos debes explicar que en ${E} nos especializamos en ayudar a empresas como ellos a ${promesa}.`);
  s.push(`OBLIGATORIAMENTE debes transmitir: ${beneficiosFrase}.`);
  s.push("Puedes utilizar estructuras como:");
  s.push(`"En ${E} nos especializamos en ayudar a empresas como la vuestra a ${promesa}, con ${beneficiosFrase}."`);
  s.push(`"Precisamente ayudamos a empresas similares a ${promesa}, y lo hacemos buscando ${beneficios[0]}."`);
  s.push("NO copies siempre estos ejemplos.");
  s.push(`Adapta el mensaje a ${O} para que cada correo sea diferente y natural.`);

  if (como.length) {
    s.push("CÓMO LO HACEMOS");
    s.push("Explica brevemente cómo podemos ayudarles.");
    s.push(parrafos(como));
  }
  s.push(`NO conviertas el correo en una explicación larga sobre ${E}.`);
  s.push("La distribución aproximada debe ser:");
  s.push(parrafos([
    `50% sobre ${O} y su actividad.`,
    `30% sobre cómo ${E} puede ayudarles a ${promesa}.`,
    "20% sobre la demostración y la llamada a la acción.",
  ]));

  s.push("BENEFICIO PERSONALIZADO");
  s.push(`Adapta siempre el beneficio a ${D}.`);
  s.push("Dependiendo de la empresa, puedes hablar de:");
  s.push(parrafos(ideas.map(frase)));
  s.push(`El beneficio debe estar relacionado SIEMPRE con ${promesa} y con ${beneficiosFrase}.`);

  s.push("EMPRESAS SIMILARES");
  s.push("Puedes mencionar que aplicamos este tipo de estrategia con empresas similares.");
  s.push("Nunca inventes nombres, resultados, cifras, porcentajes ni casos de éxito.");

  s.push("DEMOSTRACIÓN PERSONALIZADA OBLIGATORIA");
  s.push(`En TODOS los correos debes decir que hemos preparado ${oferta} para ${O}.`);
  s.push(`Debe presentarse como una forma de enseñarles cómo podríamos aplicarlo específicamente a su empresa para ${promesa}.`);

  s.push("LLAMADA A LA ACCIÓN OBLIGATORIA");
  s.push(`TODOS los correos deben proponer una conversación de ${min} minutos.`);
  s.push("La llamada a la acción debe incluir obligatoriamente:");
  s.push(parrafos([frase(oferta), `${O}.`, `${min} minutos.`]));
  s.push("Debe ser natural y de baja fricción.");
  s.push("Por ejemplo:");
  s.push(`"Hemos preparado ${oferta} para enseñarte cómo podríamos aplicarlo en ${O}. ¿Tendrías ${min} minutos para verla juntos?"`);
  s.push("No copies siempre este ejemplo.");

  s.push("ESTRUCTURA OBLIGATORIA");
  s.push("Párrafo 1:");
  s.push(saludo);
  s.push("Párrafo 2:");
  s.push("Empieza SIEMPRE:");
  s.push(`"${arranque}..."`);
  s.push(`Continúa con una observación concreta y personalizada basada en ${D}.`);
  s.push("Párrafo 3:");
  s.push("Relaciona lo que hace la empresa con una oportunidad comercial concreta.");
  s.push("Párrafo 4:");
  s.push(`Presenta ${E}.`);
  s.push(`Explica que nos especializamos en ayudar a empresas similares a ${promesa}.`);
  s.push(`Explica SIEMPRE: ${beneficiosFrase}.`);
  s.push("Párrafo 5:");
  s.push(`Menciona ${oferta} para ${O} y propón ${min} minutos para enseñársela.`);

  s.push("CIERRE OBLIGATORIO");
  s.push(`${lang.cierre}\n${F}\n${E}`);

  s.push("ESTILO OBLIGATORIO");
  s.push(parrafos([
    `${lang.nombre.charAt(0).toUpperCase()}${lang.nombre.slice(1)} al 100%.`,
    "Cercano.", "Profesional.", "Directo.", "Natural.", "Personalizado 1 a 1.", "Párrafos cortos.",
    "No utilices emojis.", "No utilices listas.", "No utilices guiones.", 'No utilices el símbolo "-".',
  ]));
  if (lang.anglicismos) {
    s.push("No utilices anglicismos innecesarios.");
    s.push('No utilices palabras como "lead", "leads", "cold email", "pipeline", "meeting", "call", "outbound", "growth" o "prospect".');
    s.push('Utiliza "potenciales clientes", "oportunidades comerciales", "captación", "reuniones", "prospección" o equivalentes.');
    s.push('No utilices "espero que estés bien".');
  }
  s.push("No utilices lenguaje excesivamente comercial.");
  s.push("No afirmes que la empresa tiene problemas.");
  s.push("No presupongas que lo que hacen ahora funciona mal.");
  s.push("Presenta nuestro servicio como una oportunidad.");

  s.push("LONGITUD OBLIGATORIA");
  s.push(`Entre ${pMin} y ${pMax} palabras.`);
  s.push(`NUNCA más de ${pMax} palabras.`);
  s.push(`Objetivo aproximado: ${pObj} palabras.`);

  s.push("COMPROBACIÓN FINAL OBLIGATORIA");
  s.push("Antes de responder, comprueba internamente:");
  s.push(parrafos([
    `El 100% está en ${lang.nombre}.`,
    `Empieza con "${saludo}"`,
    `El segundo párrafo empieza con "${arranque}".`,
    `Has interpretado ${D}.`,
    "No has copiado literalmente una descripción en otro idioma.",
    `Has hablado primero de ${O}.`,
    "Has demostrado entender su actividad.",
    `Has presentado ${E}.`,
    `Has dicho claramente que ayudamos a ${promesa}.`,
    ...beneficios.map((b) => `Has transmitido OBLIGATORIAMENTE la idea de ${b.toUpperCase()}.`),
    "Has personalizado el beneficio según la actividad de la empresa.",
    `Has mencionado ${oferta}.`,
    `Has mencionado ${O} en la llamada a la acción.`,
    `Has propuesto ${min} minutos.`,
    "No has utilizado guiones.",
    "No has inventado información.",
    `El correo tiene un máximo de ${pMax} palabras.`,
  ]));
  s.push("Termina exactamente:");
  s.push(`${lang.cierre}\n${F}\n${E}`);
  s.push("Si falta UNO SOLO de estos elementos, reescribe internamente el correo hasta cumplir TODAS las condiciones.");

  s.push("SALIDA FINAL");
  s.push("Devuelve ÚNICAMENTE el correo final.");
  s.push(parrafos(["No expliques nada.", "No muestres las instrucciones.", "No añadas asunto.", "No indiques el número de palabras.", "No añadas comentarios antes ni después del correo."]));

  return s.join("\n\n");
}
