#!/usr/bin/env bash
# Test de cable del MOTOR DE CAMPAÑAS: ejecuta el sendSmtpEmail() REAL de process-campaign-queue
# contra un SMTP falso en 127.0.0.1:465 y revisa los bytes que salen al cable (cabeceras, MIME,
# quoted-printable, baja en un clic, señales de spam y el orden del diálogo SMTP).
# No envía nada fuera de esta máquina.
#
#   bash scripts/wire-test/run-engine.sh
#
# Necesita: npx (Deno se baja con npx), openssl y python.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mktemp -d)"
if command -v cygpath >/dev/null 2>&1; then ROOT="$(cygpath -m "$ROOT")"; OUT="$(cygpath -m "$OUT")"; fi
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout "$OUT/wire_key.pem" -out "$OUT/wire_cert.pem" \
  -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -addext "basicConstraints=critical,CA:FALSE" >/dev/null 2>&1
python - "$ROOT" <<'PY'
import io, re, sys, os
root = sys.argv[1]
src = io.open(f"{root}/supabase/functions/process-campaign-queue/index.ts", encoding="utf-8").read()
head = src[: src.index("\nserve(async (req)")]
head = "\n".join(l for l in head.split("\n") if not re.match(r'^import .*(deno\.land/std|supabase-js)', l))
head = re.sub(r'^import \{[^}]*\} from "[^"]*cron-auth\.ts";\s*$', "", head, flags=re.M)
shared = "file:///" + os.path.abspath(f"{root}/supabase/functions/_shared").replace("\\", "/")
head = head.replace('"../_shared/', '"' + shared + '/')
stub = "const createClient = (..._a: unknown[]) => ({ from: () => ({ select: () => ({ data: null, error: null }) }), rpc: async () => ({ data: null, error: null }) });\n"
harness = io.open(f"{root}/scripts/wire-test/engine-harness.ts", encoding="utf-8").read()
io.open(f"{root}/supabase/functions/process-campaign-queue/_wire_engine.ts", "w", encoding="utf-8").write(stub + head + "\n" + harness)
PY
trap 'rm -f "$ROOT/supabase/functions/process-campaign-queue/_wire_engine.ts"' EXIT
cd "$ROOT/supabase/functions/process-campaign-queue"
SUPABASE_URL="http://sim.local" SUPABASE_SERVICE_ROLE_KEY="sim" UNSUB_SECRET="sim" \
  npx -y deno run --allow-all --no-check --unsafely-ignore-certificate-errors=localhost,127.0.0.1 _wire_engine.ts "$OUT"
echo "Mensajes capturados: $OUT/motor_*.eml"
