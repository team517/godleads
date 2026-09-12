# Sistema de diseño "Primary"

Extraído de `Primary Landing.html` (proyecto de Claude Design del propietario, 2026-09-12).
Es la ÚNICA fuente de verdad del aspecto de la plataforma. Sustituye al pase anterior
(DM Sans + morado #7a5af8 + radios de 14px).

## Tipografía

| Uso | Familia | Peso |
|---|---|---|
| Titulares y cifras | **Bricolage Grotesque** | 600 (500 en textos grandes sueltos) |
| Todo lo demás | **Inter** | 400 / 500 / 600 |

- El peso dominante de la interfaz es **600**: el diseño es denso y rotundo, no fino.
- Tracking: `-0.02em` normal, `-0.03em` en titulares grandes, `-0.035em` en los enormes.
- Escala real usada: 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 15.5, 16, 17, 19, 22, 24 px
  y `clamp(30px, 4vw, 50px)` para el h1. Interfaz de 13–16 px, no de 14 px uniforme.

## Paleta (modo claro)

| Papel | Color | Notas |
|---|---|---|
| Fondo de página | `#FBFBFB` | blanco cálido, no gris |
| Tarjeta / superficie | `#FFFFFF` | |
| Texto principal | `#0F172B` | azul tinta casi negro |
| Texto secundario | `#45556C` | |
| Texto apagado | `#65768D` | |
| Texto tenue | `#93A1B3` | |
| Borde | `#E8E5F1` | lavanda grisáceo, NO gris neutro |
| Borde marcado | `#D5D2DD` | |
| Acento primario | `#6E58F1` | violeta azulado |
| Acento hover | `#5B40FB` | |
| Superficie de acento | `#F1EEF8` | con texto `#6E58F1` |
| Campo de formulario | `#FBFAFF` | |
| Superficie fría | `#EEF1F5` | |
| Éxito | `#05A063` | tintes `#E8FBF2` / `#C9F2E1`, vivo `#05D17F` |
| Información | `#3B89E9` | claro `#7FB0F0` |
| Navy oscuro | `#1D293D` | |

## Geometría

- **Radio dominante: 6px.** También 4, 5, 8, 10px. Pastillas `999px`. Círculos `50%`.
  Nada de 12–14px: el diseño es de esquinas contenidas.
- Sombras muy suaves y tintadas de navy, nunca negras fuertes:
  - `0 2px 4px rgba(0,0,0,.05)` — reposo
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
