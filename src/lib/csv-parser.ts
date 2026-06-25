/**
 * Robust CSV parser that handles:
 * - Quoted fields containing commas, newlines, and escaped quotes
 * - UTF-8 BOM
 * - Mixed line endings (\r\n, \n, \r)
 * - Fields with leading/trailing whitespace outside quotes
 */
export function parseCSV(text: string): string[][] {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // Auto-detect delimiter: check first line for semicolons vs commas
  const firstLineEnd = text.indexOf('\n');
  const firstLine = firstLineEnd > 0 ? text.slice(0, firstLineEnd) : text;
  // Count unquoted delimiters in the first line
  let commaCount = 0;
  let semicolonCount = 0;
  let inQ = false;
  for (let j = 0; j < firstLine.length; j++) {
    const c = firstLine[j];
    if (c === '"') { inQ = !inQ; continue; }
    if (!inQ) {
      if (c === ',') commaCount++;
      if (c === ';') semicolonCount++;
    }
  }
  const delimiter = semicolonCount > commaCount ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ""
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        row.push(field.trim());
        field = "";
        i++;
      } else if (char === '\n' || char === '\r') {
        row.push(field.trim());
        if (row.some(f => f !== "")) {
          rows.push(row);
        }
        row = [];
        field = "";
        // Skip \r\n
        if (char === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
      } else {
        field += char;
        i++;
      }
    }
  }

  // Last field/row
  row.push(field.trim());
  if (row.some(f => f !== "")) {
    rows.push(row);
  }

  return rows;
}

/**
 * Strict email validation regex.
 */
const STRICT_EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/**
 * Per-column content validators.
 * Returns true if the value looks appropriate for that column type.
 * Unknown columns pass automatically.
 */
function isValidForColumn(header: string, value: string): boolean {
  const v = value.trim();
  if (!v) return true; // empty is always ok

  switch (header) {
    case "email":
      return STRICT_EMAIL_REGEX.test(v.replace(/,/g, ""));

    case "first_name":
    case "last_name":
      // Names: max 80 chars, no @, no URLs, mostly letters/spaces/hyphens
      return v.length <= 80 && !v.includes("@") && !/https?:\/\//.test(v) && !/\d{5,}/.test(v);

    case "company_name":
    case "company":
      // Company names: max 150 chars, should not be an email or very long sentence
      return v.length <= 150 && !STRICT_EMAIL_REGEX.test(v) && v.split(" ").length <= 15;

    case "city":
    case "location":
      // Cities: max 100 chars, no @, no URLs
      return v.length <= 100 && !v.includes("@") && !/https?:\/\//.test(v) && v.split(" ").length <= 8;

    case "website":
    case "url":
      // Websites: should look like a domain or URL
      return v.length <= 300 && (/^https?:\/\//.test(v) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(v));

    case "industry":
      // Industry: max 120 chars, short phrase
      return v.length <= 120 && v.split(" ").length <= 10;

    case "company_short_description":
    case "description":
      // Descriptions: max 500 chars
      return v.length <= 500;

    case "phone":
    case "telephone":
      // Phones: digits, spaces, +, -, (), max 25 chars
      return v.length <= 25 && /^[0-9+\-() ]+$/.test(v);

    default:
      // Unknown columns: allow up to 500 chars
      return v.length <= 500;
  }
}

/**
 * Parse CSV text into header + row objects.
 * Validates email column + per-column content validation.
 * Cleans invalid field values to empty string instead of dropping the whole row.
 */
export function parseCSVToObjects(text: string): { headers: string[]; rows: Record<string, string>[] } | { error: string } {
  const parsed = parseCSV(text);
  if (parsed.length < 2) return { error: "CSV vacío o sin datos" };

  // Deduplicate headers: keep first occurrence, append _2, _3, etc. for duplicates
  const rawHeaders = parsed[0].map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const headerCount: Record<string, number> = {};
  const headers = rawHeaders.map(h => {
    if (!headerCount[h]) {
      headerCount[h] = 1;
      return h;
    }
    headerCount[h]++;
    return `${h}_${headerCount[h]}`;
  });
  const expectedCols = headers.length;
  const emailIdx = headers.indexOf("email");
  if (emailIdx === -1) return { error: "No se encontró columna 'email'" };

  const rows = parsed.slice(1)
    .filter(values => {
      // Discard rows that don't match header column count (malformed/shifted data)
      if (values.length !== expectedCols) return false;
      // Email MUST be valid — otherwise skip the entire row
      const email = (values[emailIdx] || "").trim().replace(/,/g, "");
      return STRICT_EMAIL_REGEX.test(email);
    })
    .map(values => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        let val = (values[i] || "").trim();
        // Strip ALL quote characters (straight, curly/smart, backticks) from every field
        val = val.replace(/[\u0022\u0027\u2018\u2019\u201C\u201D`\u00AB\u00BB]/g, "").trim();
        // Email: also strip commas and whitespace
        if (h === "email") val = val.replace(/[,\s]/g, "");
        obj[h] = isValidForColumn(h, val) ? val : "";
      });
      return obj;
    });

  if (!rows.length) return { error: "No se encontraron leads con email válido" };

  return { headers, rows };
}
