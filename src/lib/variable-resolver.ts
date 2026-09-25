/**
 * "Corregir variables" de la secuencia: decide a qué COLUMNA de los leads debe apuntar cada
 * {{variable}} escrita en el correo.
 *
 * Antes se decidía sólo por el parecido del nombre, sin mirar los datos: {{nombre}} acababa en
 * {{email}} por distancia de letras, {{name}} podía ir a una columna "Name" con el nombre
 * completo, y si había dos columnas de empresa se quedaba con la vacía. Ahora:
 *   1. Se reconoce QUÉ es la variable (nombre de pila, empresa, ciudad, sector, web, cargo…)
 *      en varios idiomas y formas de escribirla (firstName, first_name, Nombre, Company Name…).
 *   2. Entre las columnas que significan eso, se elige la que TIENE MÁS DATOS en los leads.
 *   3. Nunca se usa una columna de otro significado: {{name}} no va al nombre completo ni a la
 *      empresa, y {{company}} no va a la web ni al LinkedIn de la empresa.
 *   4. Las variables que rellena el motor (remitente, email) no se tocan.
 */

export const norm = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Lo que el motor rellena por su cuenta: nunca se "corrige" hacia un campo del lead. */
export const ENGINE_VARS = ["Email", "SenderFirstName", "SenderLastName", "SenderEmail"];

type Concepto = { id: string; escritas: Set<string>; columnas: Set<string>; preferidas: string[] };

const C = (id: string, escritas: string[], columnas: string[], preferidas: string[]): Concepto => ({
  id, escritas: new Set(escritas.map(norm)), columnas: new Set(columnas.map(norm)), preferidas: preferidas.map(norm),
});

/** Cada concepto: cómo lo escribe la gente en el correo y cómo se llaman sus columnas en un CSV.
 *  Las columnas de OTRO significado (Full Name, Company Website, Company LinkedIn…) no están en
 *  ninguna lista, así que nunca pueden elegirse para estos conceptos. */
export const CONCEPTOS: Concepto[] = [
  C("first_name",
    ["first_name", "firstname", "first", "name", "nombre", "nome", "prenom", "prénom", "given_name", "contact_first_name", "vorname"],
    ["first_name", "firstname", "first", "nombre", "nome", "prenom", "prénom", "given_name", "contact_first_name", "vorname"],
    ["first_name", "firstname", "nombre", "first"]),
  C("last_name",
    ["last_name", "lastname", "last", "surname", "apellido", "apellidos", "cognome", "nachname"],
    ["last_name", "lastname", "last", "surname", "apellido", "apellidos", "cognome", "nachname"],
    ["last_name", "lastname", "apellidos", "apellido"]),
  C("company_name",
    ["company_name", "companyname", "company", "empresa", "compania", "compañia", "organization", "organization_name", "organisation",
      "organisation_name", "org", "account", "account_name", "business", "business_name", "azienda", "entreprise", "societe", "société", "firma"],
    ["company_name", "company", "company_name_for_emails", "empresa", "compania", "organization", "organization_name", "organisation",
      "organisation_name", "account_name", "business_name", "azienda", "entreprise", "societe", "société", "firma"],
    ["company_name", "organization_name", "company", "company_name_for_emails", "empresa"]),
  C("city",
    ["city", "ciudad", "town", "localidad", "citta", "città", "ville", "location", "poblacion", "población"],
    ["city", "ciudad", "town", "localidad", "citta", "città", "ville", "company_city", "poblacion", "población"],
    ["city", "ciudad", "company_city"]),
  C("industry",
    ["industry", "sector", "industria", "industrie", "settore", "branche"],
    ["industry", "sector", "industria", "industrie", "settore", "branche"],
    ["industry", "sector"]),
  C("website",
    ["website", "web", "url", "site", "sitio_web", "sitioweb", "pagina_web", "domain", "company_website"],
    ["website", "company_website", "web", "url", "sitio_web", "pagina_web", "domain", "company_domain"],
    ["website", "company_website", "web"]),
  C("title",
    ["title", "job_title", "jobtitle", "position", "cargo", "puesto", "role", "rol"],
    ["title", "job_title", "position", "cargo", "puesto", "role"],
    ["title", "job_title", "cargo"]),
];

export type EstadisticaColumna = { key: string; llenos: number };

/** Cuántos leads tienen algo escrito en cada columna. */
export function contarColumnas(filas: Array<Record<string, unknown> | null | undefined>): EstadisticaColumna[] {
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    if (!f || typeof f !== "object") continue;
    for (const [k, v] of Object.entries(f)) {
      const lleno = v !== null && v !== undefined && String(v).trim() !== "";
      cuenta.set(k, (cuenta.get(k) || 0) + (lleno ? 1 : 0));
    }
  }
  return [...cuenta].map(([key, llenos]) => ({ key, llenos })).sort((a, b) => b.llenos - a.llenos);
}

export function conceptoDe(variable: string): Concepto | null {
  const n = norm(variable);
  return CONCEPTOS.find((c) => c.escritas.has(n)) || null;
}

/** La mejor columna para un concepto: la que más datos tiene; si empatan, la de nombre preferido. */
export function mejorColumna(c: Concepto, columnas: EstadisticaColumna[]): EstadisticaColumna | null {
  const candidatas = columnas.filter((x) => c.columnas.has(norm(x.key)) && x.llenos > 0);
  if (!candidatas.length) return null;
  const rango = (k: string) => { const i = c.preferidas.indexOf(norm(k)); return i === -1 ? 99 : i; };
  candidatas.sort((a, b) => (b.llenos - a.llenos) || (rango(a.key) - rango(b.key)) || a.key.localeCompare(b.key));
  return candidatas[0];
}

/** ¿A qué columna debe apuntar esta variable? null = dejarla como está. */
export function resolverVariable(variable: string, columnas: EstadisticaColumna[]): string | null {
  const v = variable.trim();
  if (ENGINE_VARS.some((e) => norm(e) === norm(v))) return null;
  const propia = columnas.find((x) => x.key === v);
  const concepto = conceptoDe(v);
  if (concepto) {
    const mejor = mejorColumna(concepto, columnas);
    if (!mejor) return null;                       // no hay datos de eso: se deja (el motor pone un respaldo)
    if (mejor.key === v) return null;
    // Si la variable ya apunta a una columna del mismo significado con casi tantos datos, se respeta.
    if (propia && concepto.columnas.has(norm(v)) && propia.llenos >= mejor.llenos * 0.9) return null;
    return mejor.key;
  }
  // Variable que no es de ningún concepto conocido (icebreaker, personalized_message…):
  if (propia) return null;
  // Sólo se corrige si hay UNA columna que se escribe igual salvo mayúsculas y separadores.
  const iguales = columnas.filter((x) => norm(x.key) === norm(v) && x.llenos > 0);
  return iguales.length ? iguales.sort((a, b) => b.llenos - a.llenos)[0].key : null;
}

/** Corrige todas las {{variables}} de un texto. Devuelve el texto nuevo y la lista de cambios. */
export function corregirVariablesEnTexto(texto: string, columnas: EstadisticaColumna[]): { text: string; changes: { from: string; to: string }[] } {
  const changes: { from: string; to: string }[] = [];
  const text = String(texto || "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (full, inner) => {
    const actual = String(inner).trim();
    const nueva = resolverVariable(actual, columnas);
    if (nueva && nueva !== actual) { changes.push({ from: actual, to: nueva }); return `{{${nueva}}}`; }
    return full;
  });
  return { text, changes };
}

/* ── Importar con PLANTILLA ─────────────────────────────────────────────────────────────────
   Un CSV general trae varias columnas para lo mismo ("Company", "Company Name", "Company Name
   for Emails"…). Antes, la última que se llamara parecido pisaba a las demás aunque estuviera
   vacía. Ahora, para cada columna de la plantilla se elige la del CSV que MÁS DATOS tiene entre
   las que significan eso. */

const CORREO = C("email",
  ["email", "e_mail", "email_address", "work_email", "correo", "correo_electronico", "mail", "business_email"],
  ["email", "e_mail", "email_address", "work_email", "correo", "correo_electronico", "mail", "business_email"],
  ["email", "work_email", "email_address"]);

const PLANTILLA_A_CONCEPTO: Record<string, Concepto> = {
  email: CORREO,
  first_name: CONCEPTOS.find((c) => c.id === "first_name")!,
  company_name: CONCEPTOS.find((c) => c.id === "company_name")!,
  organization_name: CONCEPTOS.find((c) => c.id === "company_name")!,
  city: CONCEPTOS.find((c) => c.id === "city")!,
  industry: CONCEPTOS.find((c) => c.id === "industry")!,
  website: CONCEPTOS.find((c) => c.id === "website")!,
};

/**
 * De qué columna del CSV sale cada columna de la plantilla.
 * @param otras  para las columnas de la plantilla SIN concepto (descripción, icebreaker…): el
 *               nombre de cabecera normalizado → columna de plantilla, como hacía la importación.
 */
export function elegirColumnasPlantilla(
  cabeceras: string[],
  filas: Record<string, string>[],
  columnasPlantilla: string[],
  otras: (cabecera: string) => string,
): Record<string, string | null> {
  const llenos = new Map<string, number>();
  for (const h of cabeceras) llenos.set(h, 0);
  for (const f of filas) for (const h of cabeceras) if (String(f[h] ?? "").trim()) llenos.set(h, (llenos.get(h) || 0) + 1);
  const stats: EstadisticaColumna[] = cabeceras.map((h) => ({ key: h, llenos: llenos.get(h) || 0 }));

  const salida: Record<string, string | null> = {};
  for (const col of ["email", ...columnasPlantilla]) {
    const concepto = PLANTILLA_A_CONCEPTO[col];
    if (concepto) {
      salida[col] = mejorColumna(concepto, stats)?.key ?? null;
      continue;
    }
    // Sin concepto: la cabecera que se llame así (o su alias) y tenga más datos.
    const candidatas = stats.filter((x) => otras(x.key) === col && x.llenos > 0).sort((a, b) => b.llenos - a.llenos);
    salida[col] = candidatas[0]?.key ?? null;
  }
  return salida;
}
