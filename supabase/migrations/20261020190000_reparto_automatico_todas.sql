-- Más primeros correos = más respuestas (20-10-2026). El primer correo trae 13,7 respuestas de
-- personas por mil envíos; el 2.º 8,5 y el 3.º 7,1. Las campañas activas con reparto "desactivado"
-- mandaban primero TODOS los seguimientos pendientes y los leads nuevos sólo con lo que sobraba (tras
-- los días 13-16, casi nada). Pasan a "automático": 35 % de nuevos en equilibrio, nunca menos del 25 %
-- (lead-mix.ts). Las campañas en "manual" (porcentaje elegido por el cliente) no se tocan.
create table if not exists public.backup_campaigns_mix_20261020 as
  select id, mix_mode from public.campaigns where status = 'active' and coalesce(mix_mode, 'off') = 'off';
update public.campaigns set mix_mode = 'auto'
 where status = 'active' and coalesce(mix_mode, 'off') = 'off';
