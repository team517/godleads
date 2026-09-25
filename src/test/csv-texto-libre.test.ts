import { describe, expect, it } from "vitest";
import { cleanCsvField, parseCSVToObjects, TEXTO_LIBRE_MAX } from "@/lib/csv-parser";

// 25-09-2026: la limpieza del CSV VACIABA cualquier texto libre de más de 500 caracteres. En un
// export real de Apollo se perdía la descripción de 4.898 de 6.852 empresas y casi todas las
// keywords. Ahora se recorta en una palabra y el dato llega.
const LARGA = "Somos una empresa de logística especializada en almacenes. ".repeat(40); // ~2.400 caracteres

describe("texto libre largo en el CSV", () => {
  it("una descripción larga se recorta, no se vacía", () => {
    const v = cleanCsvField("company_short_description", LARGA);
    expect(v.length).toBeGreaterThan(500);
    expect(v.length).toBeLessThanOrEqual(TEXTO_LIBRE_MAX + 1);
    expect(v.endsWith("…")).toBe(true);
    expect(v).toContain("Somos una empresa de logística");
  });
  it("una columna libre cualquiera (keywords) también se recorta", () => {
    expect(cleanCsvField("keywords", "crm, ventas, ".repeat(200)).length).toBeGreaterThan(500);
  });
  it("las columnas con forma fija siguen rechazando lo que no encaja", () => {
    expect(cleanCsvField("first_name", "Esto es una frase entera que no es un nombre de pila con @ correo")).toBe("");
    expect(cleanCsvField("company_name", "ana@empresa.com")).toBe("");
  });
  it("un texto corto se queda tal cual", () => {
    expect(cleanCsvField("company_short_description", "Agencia digital")).toBe("Agencia digital");
  });
  it("de principio a fin: la descripción llega a la fila importada", () => {
    const csv = `Email,First Name,Company Name,Company Short Description\nana@acme.com,Ana,Acme,"${LARGA}"\n`;
    const r = parseCSVToObjects(csv) as { rows: Record<string, string>[] };
    expect(r.rows[0].company_short_description.length).toBeGreaterThan(500);
    expect(r.rows[0].first_name).toBe("Ana");
  });
});
