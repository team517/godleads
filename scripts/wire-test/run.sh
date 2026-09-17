#!/usr/bin/env bash
# Wire test for supabase/functions/send-email — runs the REAL sendSmtpEmail() against a local
# fake SMTP server (implicit TLS on 127.0.0.1:465) and validates the exact bytes it sends:
# CRLF-only, line lengths, required headers once, Message-ID domain, In-Reply-To/References,
# RFC date, MIME parts, quoted-printable. Run it after ANY change to the sender:
#
#   bash scripts/wire-test/run.sh
#
# Needs: npx (Deno is fetched via `npx deno`), openssl, python. Nothing leaves the machine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mktemp -d)"
# Git Bash on Windows: native openssl/python/deno need C:/… paths, not /c/… or /tmp/…
if command -v cygpath >/dev/null 2>&1; then ROOT="$(cygpath -m "$ROOT")"; OUT="$(cygpath -m "$OUT")"; fi
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout "$OUT/wire_key.pem" -out "$OUT/wire_cert.pem" \
  -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
python - "$ROOT" <<'PY'
import io, re, sys
root = sys.argv[1]
src = io.open(f"{root}/supabase/functions/send-email/index.ts", encoding="utf-8").read()
head = src[: src.index("\nserve(async (req) =>")]
head = "\n".join(l for l in head.split("\n") if not re.match(r'^import .*(deno\.land/std|esm\.sh)', l))
harness = io.open(f"{root}/scripts/wire-test/harness.ts", encoding="utf-8").read()
io.open(f"{root}/supabase/functions/send-email/_wire_test.ts", "w", encoding="utf-8").write(head + "\n" + harness)
PY
trap 'rm -f "$ROOT/supabase/functions/send-email/_wire_test.ts"' EXIT
cd "$ROOT/supabase/functions/send-email"
npx -y deno run --allow-all --no-check --unsafely-ignore-certificate-errors=localhost _wire_test.ts "$OUT"
echo "Captured messages: $OUT/wire_*.eml"
