# OnePulso

Plataforma de cold email para equipos de ventas B2B: cuentas de envío, campañas
con secuencias multi-paso, leads, Unibox unificado, estadísticas y automatizaciones.

Frontend: React + TypeScript + Vite + Tailwind + shadcn/ui.
Backend: Supabase (Postgres + Edge Functions).

## Desarrollo

```sh
npm install      # instalar dependencias
npm run dev      # servidor de desarrollo (http://localhost:8080)
npm run build    # build de producción en dist/
npm test         # tests con Vitest
npm run lint     # ESLint
```

## Edge Functions (Supabase)

Se despliegan directamente, sin pasar por git:

```sh
npx supabase functions deploy <fn> --project-ref iqhhybmhlkmulwhizpzi --no-verify-jwt
```

## Despliegue del frontend

El frontend lo construye **EasyPanel desde la rama `main` de GitHub**. Los cambios
de frontend NO salen en producción hasta hacer commit + push a `origin/main` y
pulsar **"Implementar"** en EasyPanel.
