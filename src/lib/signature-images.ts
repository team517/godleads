// Las imágenes de una firma tienen que estar ALOJADAS, no incrustadas.
//
// Una firma pegada desde fuera suele traer el logo dentro del propio HTML
// (`src="data:image/png;base64,…"`). Eso funciona en las respuestas manuales —el emisor lo
// convierte en adjunto en línea— pero NO en los envíos de campaña, cuyo emisor manda el HTML tal
// cual: Gmail bloquea las imágenes incrustadas y el logo sale roto. Además engorda cada correo
// (la firma de chipsfinder pesaba 22 KB por este motivo, y 2,3 KB con el logo alojado).
//
// Al guardar una firma se suben esas imágenes y se deja el enlace en su sitio.

export interface DataImage { mime: string; base64: string; whole: string }

const DATA_IMG_RE = /src\s*=\s*"(data:image\/([a-z0-9.+-]+);base64,([^"]+))"/gi;

/** Las imágenes incrustadas que lleva un HTML de firma. */
export function findDataImages(html: string): DataImage[] {
  const out: DataImage[] = [];
  for (const m of String(html || "").matchAll(DATA_IMG_RE)) {
    out.push({ whole: m[1], mime: `image/${m[2].toLowerCase()}`, base64: m[3] });
  }
  return out;
}

/** Cambia cada imagen incrustada por su enlace ya subido. */
export function replaceDataImages(html: string, urlOf: (img: DataImage) => string | null): string {
  return String(html || "").replace(DATA_IMG_RE, (whole, uri: string, ext: string, b64: string) => {
    const url = urlOf({ whole: uri, mime: `image/${String(ext).toLowerCase()}`, base64: b64 });
    return url ? `src="${url}"` : whole;
  });
}

/** base64 → binario, para poder subirlo. Devuelve null si el base64 no es válido. */
export function decodeBase64Image(base64: string): Uint8Array | null {
  try {
    const clean = String(base64 || "").replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** ¿Merece la pena subirla? Un icono diminuto (una viñeta, un separador) no. */
export function isWorthHosting(bytes: number): boolean {
  return bytes >= 512;
}
