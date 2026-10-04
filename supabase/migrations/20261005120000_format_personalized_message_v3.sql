-- format_personalized_message, v3 (05-10-2026): mismo formato, dos mejoras pequeñas para que también
-- quede perfecto en los mensajes de clientes (nacho@publiup, ray@dialogfy, salles@3nitram):
--   1) el saludo admite nombres con punto ("Hola Fco.," / "Hola J.,") → el saludo va en su párrafo
--      igual que los demás (antes se quedaba pegado a la primera frase).
--   2) la negrita de "demo personalizada" cubre también "demostración personalizada" (PubliUp y
--      2MKapital lo escriben así).
-- Todo lo demás es idéntico a la v2. Sin cambiar el texto; idempotente.
create or replace function public.format_personalized_message(p text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $fn$
declare
  t text;
  m text[];
  saludo text := '';
  firma text := '';
  frases text[];
  parrafos text[] := '{}';
  actual text := '';
  n_actual int := 0;
  f text;
  palabras text[];
  n int;
  todo text;
  esc text;
  con_negrita text;
begin
  if p is null then return null; end if;
  if p ~* '^\s*\[error' then return p; end if;

  -- ── HTML de párrafos → párrafos con línea en blanco (el texto no cambia) ──
  if p ~* '<(p|br)[\s>/]' then
    if p ~* '<(div|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|blockquote|pre|hr)[\s>/]' then return p; end if;
    t := regexp_replace(p, '\s+', ' ', 'g');
    t := regexp_replace(t, '\s*<br\s*/?>\s*', E'\n', 'gi');
    t := regexp_replace(t, '\s*</p\s*>\s*', E'\n\n', 'gi');
    t := regexp_replace(t, '\s*<p(\s[^>]*)?>\s*', E'\n\n', 'gi');
    t := regexp_replace(t, '[ \t]*\n[ \t]*', E'\n', 'g');
    t := regexp_replace(t, '\n{3,}', E'\n\n', 'g');
    t := btrim(t, E' \n\t');
    t := regexp_replace(t, '\*\*([^*\n]{1,80})\*\*', '<b>\1</b>', 'g');
    if t !~* '<(b|strong|em|i|u|a|span)[\s>/]' then
      t := replace(replace(replace(replace(replace(replace(t, '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&');
    end if;
    return t;
  end if;

  -- ── Texto ya con saltos de línea, u otro HTML: se respeta ──
  if p ~ '[\r\n]' or p ~* '<(b|strong|em|i|u|a|span|div|table|ul|ol|li|h[1-6])[\s>/]' then
    return p;
  end if;

  -- ── Texto plano en UNA línea → saludo, párrafos, firma y negritas ──
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  if length(t) < 200 then return p; end if;

  t := btrim(regexp_replace(t, '\s*-{3,}\s*nota:.*$', '', 'i'));

  -- Firma: "Saludos, Juan OnePulso" → "Saludos," / "Juan" / "OnePulso".
  m := regexp_match(t, '^(.*\S)\s+((?:saludos cordiales|un saludo|un abrazo|saludos|atentamente)[,.]?)\s+([^\s?!]+(?:\s+[^\s?!]+){0,2})$', 'i');
  if m is not null then
    t := m[1];
    palabras := regexp_split_to_array(m[3], '\s+');
    n := array_length(palabras, 1);
    if n >= 2 and palabras[n] ~* '^onepulso$' then
      firma := m[2] || E'\n' || array_to_string(palabras[1:n - 1], ' ') || E'\n' || palabras[n];
    else
      firma := m[2] || E'\n' || m[3];
    end if;
  end if;

  -- Saludo en su párrafo. El nombre admite punto ("Hola Fco.," / "Hola J.,"): sólo se corta en la
  -- coma que cierra el saludo, nunca en un punto de una abreviatura.
  m := regexp_match(t, '^((?:hola|buenas tardes|buenos días|buenas)\s+[^,!?\n]{1,40},)\s*(.+)$', 'i');
  if m is not null then
    saludo := m[1];
    t := upper(left(m[2], 1)) || substr(m[2], 2);
  end if;

  -- Sin firma en un mensaje de OnePulso: la de los demás, con el nombre de "soy Juan".
  if firma = '' and saludo <> '' and t ~* '\yonepulso\y' then
    m := regexp_match(t, '^soy ([[:alpha:]]+)', 'i');
    if m is not null then
      firma := 'Saludos,' || E'\n' || m[1] || E'\n' || 'OnePulso';
    end if;
  end if;

  -- Frases → párrafos de 1-2 frases.
  frases := regexp_split_to_array(t, '(?<=[.!?…])\s+(?=[¿¡"«A-ZÁÉÍÓÚÑÜ0-9])');
  foreach f in array frases loop
    f := btrim(f);
    continue when f = '';
    if actual <> '' and (
         f ~* '^(precisamente|en onepulso|nosotros|hemos preparado|he preparado|por eso|te escribo|mi propuesta)'
         or (n_actual >= 2 and length(actual) >= 180)
         or length(actual) + length(f) > 360
       ) then
      parrafos := parrafos || actual;
      actual := '';
      n_actual := 0;
    end if;
    actual := case when actual = '' then f else actual || ' ' || f end;
    n_actual := n_actual + 1;
  end loop;
  if actual <> '' then parrafos := parrafos || actual; end if;

  todo := array_to_string(array_remove(array[nullif(saludo, ''), nullif(array_to_string(parrafos, E'\n\n'), ''), nullif(firma, '')], null), E'\n\n');

  -- Negritas (cada una como mucho una vez).
  esc := replace(replace(replace(todo, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  con_negrita := regexp_replace(esc, '\y(Vi a) ([^;:!?,]{2,50}?) (y me)\y', '\1 <b>\2</b> \3');
  con_negrita := regexp_replace(con_negrita, '(entre \d+ y \d+ oportunidades(?: comerciales)?(?: (?:al mes|mensuales|cada mes))?)', '<b>\1</b>', 'i');
  con_negrita := regexp_replace(con_negrita, '(demo(?:straci[oó]n)? personalizada)', '<b>\1</b>', 'i');
  if con_negrita = esc then return todo; end if;
  return con_negrita;
end;
$fn$;
