#!/usr/bin/env bash
# Simulación de carga del motor de envío: el código REAL de process-campaign-queue corre,
# minuto a minuto, contra una base de datos en memoria y un servidor de correo falso.
# No envía nada ni toca ninguna base de datos. Ver prelude.ts y driver.ts.
#
#   bash scripts/engine-sim/run.sh                 # motor del repo (el que se desplegaría)
#   bash scripts/engine-sim/run.sh <ruta/index.ts> # otro index.ts (p. ej. la versión anterior)
#   SIM_BIG_ACCOUNTS=900 bash scripts/engine-sim/run.sh
#   SIM_DRIVER=driver-pause.ts bash scripts/engine-sim/run.sh   # pausar → quitar leads → poner → activar
#
# Needs: npx (Deno is fetched via `npx deno`) and python.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENGINE="${1:-supabase/functions/process-campaign-queue/index.ts}"
python - "$ENGINE" <<'PY'
import io, re, sys, os
src = io.open(sys.argv[1], encoding="utf-8").read()
shared = "file:///" + os.path.abspath("supabase/functions/_shared").replace("\\", "/")
# Fuera los bordes reales: serve de Deno y el cliente de Supabase (los pone prelude.ts).
src = "\n".join(l for l in src.split("\n") if not re.match(r'^import .*(deno\.land/std|supabase-js)', l))
src = src.replace('"../_shared/', '"' + shared + '/')
# La puerta del cron (cron-auth.ts) trae supabase-js: en la simulación el cron siempre está autorizado.
src = re.sub(r'^import \{[^}]*\} from "[^"]*cron-auth\.ts";\s*$', "", src, flags=re.M)
# El envío real queda aparcado; el motor llama al falso de prelude.ts.
assert src.count("async function sendSmtpEmail(") == 1
src = src.replace("async function sendSmtpEmail(", "async function __realSendSmtpEmail(")
# La pausa de 1,5 s entre dos envíos seguidos del mismo dominio es tiempo real: aquí no aporta.
src = src.replace("await new Promise(r => setTimeout(r, gapMs));", "/* sim: sin espera real */")
pre = io.open("scripts/engine-sim/prelude.ts", encoding="utf-8").read()
drv = io.open("scripts/engine-sim/" + os.environ.get("SIM_DRIVER", "driver.ts"), encoding="utf-8").read()
io.open("scripts/engine-sim/_engine_sim.ts", "w", encoding="utf-8", newline="").write(pre + "\n" + src + "\n" + drv)
PY
trap 'rm -f scripts/engine-sim/_engine_sim.ts' EXIT
SUPABASE_URL="http://sim.local" SUPABASE_SERVICE_ROLE_KEY="sim" UNSUB_SECRET="sim" \
SEND_CONCURRENCY="${SEND_CONCURRENCY:-3}" SMTP_HOST_CONCURRENCY="${SMTP_HOST_CONCURRENCY:-2}" \
  npx -y deno run --allow-env --allow-read --no-check scripts/engine-sim/_engine_sim.ts
