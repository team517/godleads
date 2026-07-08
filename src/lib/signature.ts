/** Turn a signature (typed as plain text with line breaks, OR authored HTML with
 *  <p>/<div>/<br>) into a COMPACT single-<br>-per-line block. Used both to build the
 *  outgoing reply body and to render the live preview, so "what you see = what is sent".
 *  Keeps inline tags (<a>, <strong>, <em>…); strips block wrappers whose default
 *  margins would blow the signature apart. */
export function signatureToBrLines(sigHtmlRaw: string): string {
  let s = (sigHtmlRaw || "").trim();
  if (!s) return "";
  s = s
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<\s*(p|div|h[1-6]|ul|ol|li|table|tbody|tr|td)[^>]*>/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return s.split("\n").map((l) => l.trim()).filter(Boolean).join("<br>");
}
