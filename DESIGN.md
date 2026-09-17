# Sistema de diseño "Primary"

Extraído de `Primary Landing.dc.html` (proyecto de Claude Design del propietario; primera
extracción 2026-09-12, revisado con la versión del 2026-09-16: titulares en Schibsted Grotesk,
fondo #FBFAFE, y el panel pasa a tener ESTRUCTURA de programa — ver "Estructura del panel").
Es la ÚNICA fuente de verdad del aspecto de la plataforma. Sustituye al pase anterior
(DM Sans + morado #7a5af8 + radios de 14px).

## Tipografía

| Uso | Familia | Peso |
|---|---|---|
| Titulares y cifras | **Schibsted Grotesk** | 600 (500 en textos grandes sueltos) |
| Todo lo demás | **Inter** | 400 / 500 / 600 |

- El peso dominante de la interfaz es **600**: el diseño es denso y rotundo, no fino.
- Tracking: `-0.02em` normal, `-0.03em` en titulares grandes, `-0.035em` en los enormes.
- Escala real usada: 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 15.5, 16, 17, 19, 22, 24 px
  y `clamp(30px, 4vw, 50px)` para el h1. Interfaz de 13–16 px, no de 14 px uniforme.

## Paleta (modo claro)

| Papel | Color | Notas |
|---|---|---|
| Fondo de página | `#FBFAFE` | blanco lavanda, no gris |
| Tarjeta / superficie | `#FFFFFF` | |
| Texto principal | `#0F172B` | azul tinta casi negro |
| Texto secundario | `#45556C` | |
| Texto apagado | `#65768D` | |
| Texto tenue | `#93A1B3` | |
| Borde | `#EAE7F4` | lavanda grisáceo, NO gris neutro |
| Borde marcado | `#D5D2DD` | |
| Acento primario | `#6E58F1` | violeta azulado |
| Acento hover | `#5B40FB` | |
| Superficie de acento | `#F1EEF8` | con texto `#6E58F1` |
| Campo de formulario | `#FBFAFF` | |
| Superficie fría | `#EEF1F5` | |
| Éxito | `#05A063` | tintes `#E8FBF2` / `#C9F2E1`, vivo `#05D17F` |
| Información | `#3B89E9` | claro `#7FB0F0` |
| Navy oscuro | `#1D293D` | |
| Índigo de barra / hero | `#312A63` | con resplandor `radial-gradient(… rgba(160,138,255,.52) …)`; en oscuro `#1B173A` |
| Violeta claro | `#8B6BFF` | foco de campos, borde de selección `#C9BFFA` |
| Degradado de marca | `#2FC6EE → #8B6BFF → #FF6FC5` | sólo acentos pequeños (palabra del titular, raíl) |

## Geometría

- **Radio dominante: 6px.** También 4, 5, 8, 10px. Pastillas `999px`. Círculos `50%`.
  Nada de 12–14px: el diseño es de esquinas contenidas.
- Sombras muy suaves y tintadas de navy, nunca negras fuertes:
  - `0 2px 6px rgba(21,17,60,.04)` — reposo (tarjetas)
  - `0 6px 18px rgba(21,17,60,.05)` — elevada
  - `0 12px 32px rgba(21,17,60,.07)` — flotante
  - `0 18px 44px rgba(21,17,60,.10)` — modal
  - `0 2px 4px rgba(110,88,241,.24)` — botón primario (sombra del propio color)

## Componentes, tal cual aparecen en el diseño

```
Botón primario   font-size:15px; font-weight:600; color:#fff; background:#6E58F1;
                 padding:10px 18px; border-radius:6px;
                 box-shadow:0 2px 4px rgba(110,88,241,.24);  hover -> #5B40FB
Botón primario L font-size:16px; padding:14px 26px;  (llamada principal)
Botón secundario font-size:14px; font-weight:600; color:#45556C; background:#fff;
                 border:1px solid #E8E5F1; padding:9px 16px; border-radius:6px;
Pastilla         background:#fff; border:1px solid #E8E5F1; color:#6E58F1;
                 font-size:13px; font-weight:600; padding:7px 14px; border-radius:999px;
                 box-shadow:0 2px 4px rgba(0,0,0,.05);
Etiqueta mini    font-size:10.5px; font-weight:600; color:#6E58F1;
                 background:#F1EEF8; padding:3px 8px; border-radius:999px;
Barra superior   position:sticky; background:rgba(255,255,255,.88);
                 backdrop-filter:blur(8px); box-shadow:0 2px 4px rgba(0,0,0,.06);
Navegación       font-size:15px; font-weight:500; color:#1D293D; gap:4px;
```

## Estructura del panel (para que se lea como un programa, no como una web)

- **Barra superior** a todo el ancho, fija, 56px, índigo `#312A63` con su resplandor y un brillo
  que cruza cada ~11 s (`.topbar-surface` + `.topbar-sheen`). Izquierda: plegar menú · marca ·
  buscador translúcido (se vuelve blanco al enfocar). Derecha: prueba · "Pregunta a la IA"
  (pastilla blanca) · tema · monedas · avisos · cuenta con desplegable.
- **Menú lateral** debajo de la barra, blanco, 240px / 64px plegado. Secciones con título en
  minúscula y chevron que se pliegan y lo recuerdan (`localStorage.sidebarGroupsClosed`):
  principal · Equipo IA · Salud de envío · Clientes · Rendimiento · Admin. Entrada: icono de
  línea 18px + 14.5px/500 `#45556C`; activa = `.is-selected` (lavanda + brillo violeta desde
  abajo + borde `#C9BFFA`, el "navPill" del diseño) con texto `#5B40FB`/600.
  Pie: cuenta + fila de utilidades (ajustes · inicio · cerrar sesión) en una sola pieza.
- **Tablas**: cabecera lavanda (`accent/60`), 12.5px/600; filas con `hover` lavanda y cifras
  tabulares. Las tablas hechas a mano heredan lo mismo desde `index.css` (`main table …`).
- **Tarjetas**: radio 10px, borde lavanda, sombra de reposo. `.lift` para las que son un destino.
- **Nada de emojis como iconos.** Iconos de línea (lucide) siempre.

## Movimiento (todo en `src/index.css`, apagado con `prefers-reduced-motion`)

| Clase | Qué hace | Dónde |
|---|---|---|
| `.page-enter` | blurFadeIn .42s al cambiar de sección | AppLayout (clave = primer tramo de la ruta) |
| `.stagger` | hijos directos suben escalonados | cabecera + bloques de una página, rejillas de KPIs |
| `tbody.rows-in` / `main table tbody tr` | rowPop lateral de las primeras filas | tablas |
| `.lift` | sube 2px + sombra violeta al pasar | tarjetas-destino, KPIs |
| `.live-dot` | pulso verde "en directo" | avisos, campañas activas |
| `.chip-pop` | aparición de contadores | badge de no leídos |
| `.skeleton-shimmer` | barrido de carga | `Skeleton` |
| `.collapse-grid` | plegado por `grid-template-rows` | secciones del menú |
| `<CountUp>` | la cifra sube hasta su valor | KPIs del Dashboard |
| Botones | sombra mayor al pasar, `scale(.98)` al pulsar | `Button` |

## Modo oscuro

El diseño original no lo trae. Se deriva manteniendo los mismos tonos (azul tinta 223,
violeta 249, lavanda 255) y la regla del propietario: **nada negro sobre negro**.
Los valores viven en `.dark` en `src/index.css`; el contenido HTML ajeno (correo recibido,
vista previa de secuencias) sigue sobre "papel" claro en ambos temas.

## Reglas al aplicarlo

1. Coge SIEMPRE el color de un token (`hsl(var(--…))` o la clase de Tailwind), nunca el hex.
2. Peso 600 por defecto en titulares, etiquetas de tabla, cifras y botones.
3. Radio 6px salvo pastillas y avatares.
4. Bordes lavanda, no grises: el borde es parte de la identidad.
5. Sombras tintadas de navy; jamás una sombra negra dura.
