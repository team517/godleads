-- personalized_message con estructura, v4 (05-10-2026). Petición del dueño: TODAS las cuentas,
-- todos los mensajes, con párrafos y "si hay que tener negritas, con negritas".
--
-- 1) format_pm(p, p_company): la misma lógica que format_personalized_message v3 y, además, si el
--    mensaje NO lleva ninguna negrita, se la pone sin inventar nada (cada una como mucho una vez):
--      · el nombre de la empresa del lead, si aparece tal cual en el texto (p_company);
--      · la marca que firma: "En <b>ChipsFinder</b> nos especializamos…", "En <b>SEO Innova</b> ayudamos…";
--      · la demo: "demo de 10 minutos", "demo/demostración personalizada" o, si no, "10 minutos".
--    Antes sólo se resaltaban frases de OnePulso; los mensajes de otras cuentas en HTML sin
--    <strong> (hello@ 3.213, OnControl 342, SEO Innova 614) se quedaban sin ninguna.
-- 2) format_personalized_message(p) sigue existiendo (llama a format_pm sin empresa).
-- 3) El automático (trigger en leads) pasa a TODAS las cuentas y le pasa la empresa del lead.
create or replace function public.format_pm_bold(t text, p_company text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $fn$
declare
  r text := t;
  c text := btrim(coalesce(p_company, ''));
  pos int;
  antes text;
begin
  if r is null or r ~* '<(b|strong)[\s>]' then return r; end if;
  -- Empresa del lead, la primera vez que sale y nunca dentro de una etiqueta.
  if length(c) between 2 and 60 then
    pos := position(lower(c) in lower(r));
    if pos > 0 then
      antes := substr(r, 1, pos - 1);
      if length(antes) - length(replace(antes, '<', '')) = length(antes) - length(replace(antes, '>', '')) then
        r := antes || '<b>' || substr(r, pos, length(c)) || '</b>' || substr(r, pos + length(c));
      end if;
    end if;
  end if;
  -- La marca que firma: "En X ayudamos / nos especializamos / nos dedicamos…".
  r := regexp_replace(r, '\y(En) ([A-ZÁÉÍÓÚÑ][^\s,.;:<>]{1,24}(?: [A-ZÁÉÍÓÚÑ][^\s,.;:<>]{1,24})?) (ayudamos|nos especializamos|nos dedicamos|automatizamos|diseñamos|creamos|trabajamos|conseguimos|generamos)\y', '\1 <b>\2</b> \3');
  -- La demo.
  if r ~* 'demo de \d+ minutos' then
    r := regexp_replace(r, '(demo de \d+ minutos)', '<b>\1</b>', 'i');
  elsif r ~* 'demo(straci[oó]n)? personalizada' then
    r := regexp_replace(r, '(demo(?:straci[oó]n)? personalizada)', '<b>\1</b>', 'i');
  elsif r ~* '\y\d+ minutos\y' then
    r := regexp_replace(r, '\y(\d+ minutos)\y', '<b>\1</b>', 'i');
  end if;
  return r;
end;
$fn$;

create or replace function public.format_pm(p text, p_company text default null)
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
  b text;
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
    t := regexp_replace(t, '</?(html|body|head)[^>]*>', '', 'gi');
    t := btrim(t, E' \n\t');
    -- La despedida en el mismo bloque que la firma: "Best,\n\njohn\nChipsFinder" → "Best,\njohn\nChipsFinder".
    t := regexp_replace(t, '(^|\n\n)((?:un saludo|saludos cordiales|saludos|un abrazo|atentamente|gracias|best regards|best|regards|cheers)[,.]?)\n\n([^\n]{1,40}(?:\n[^\n]{1,40})?)$', '\1\2' || E'\n' || '\3', 'i');
    t := regexp_replace(t, '\*\*([^*\n]{1,80})\*\*', '<b>\1</b>', 'g');
    -- Sin negrita: se le pone (el texto sigue con sus entidades HTML, que ya van bien en HTML).
    b := public.format_pm_bold(t, p_company);
    if b ~* '<(b|strong|em|i|u|a|span)[\s>/]' then return b; end if;
    -- Sin ninguna etiqueta en línea el envío escapa & < > él solo: se devuelven a su carácter.
    return replace(replace(replace(replace(replace(replace(t, '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&');
  end if;

  -- ── Texto ya con saltos de línea, u otro HTML: se respeta (sólo se añade negrita si no tiene) ──
  if p ~ '[\r\n]' or p ~* '<(b|strong|em|i|u|a|span|div|table|ul|ol|li|h[1-6])[\s>/]' then
    if p ~* '<(div|table|ul|ol|li|h[1-6])[\s>/]' or p ~* '<(b|strong)[\s>]' then return p; end if;
    -- Texto con párrafos sin negrita: & < > a entidades antes de añadir <b> (va a ir en HTML).
    if p ~* '<(em|i|u|a|span)[\s>/]' then
      b := public.format_pm_bold(p, p_company);
    else
      esc := replace(replace(replace(p, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
      b := public.format_pm_bold(esc, replace(replace(replace(coalesce(p_company, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'));
      if b = esc then return p; end if;
    end if;
    return b;
  end if;

  -- ── Texto plano en UNA línea → saludo, párrafos, firma y negritas ──
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  if length(t) < 200 then return p; end if;

  t := btrim(regexp_replace(t, '\s*-{3,}\s*nota:.*$', '', 'i'));

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

  m := regexp_match(t, '^((?:hola|buenas tardes|buenos días|buenas)\s+[^,!?\n]{1,40},)\s*(.+)$', 'i');
  if m is not null then
    saludo := m[1];
    t := upper(left(m[2], 1)) || substr(m[2], 2);
  end if;

  if firma = '' and saludo <> '' and t ~* '\yonepulso\y' then
    m := regexp_match(t, '^soy ([[:alpha:]]+)', 'i');
    if m is not null then
      firma := 'Saludos,' || E'\n' || m[1] || E'\n' || 'OnePulso';
    end if;
  end if;

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

  esc := replace(replace(replace(todo, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  con_negrita := regexp_replace(esc, '\y(Vi a) ([^;:!?,]{2,50}?) (y me)\y', '\1 <b>\2</b> \3');
  con_negrita := regexp_replace(con_negrita, '(entre \d+ y \d+ oportunidades(?: comerciales)?(?: (?:al mes|mensuales|cada mes))?)', '<b>\1</b>', 'i');
  con_negrita := regexp_replace(con_negrita, '(demo(?:straci[oó]n)? personalizada)', '<b>\1</b>', 'i');
  if con_negrita = esc then
    con_negrita := public.format_pm_bold(esc, replace(replace(replace(coalesce(p_company, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'));
    if con_negrita = esc then return todo; end if;
  end if;
  return con_negrita;
end;
$fn$;

create or replace function public.format_personalized_message(p text)
returns text language sql immutable set search_path to 'public' as $fn$
  select public.format_pm(p, null)
$fn$;

-- Automático para TODAS las cuentas (antes sólo las de personalized_autoformat_users).
create or replace function public.leads_autoformat_personalized()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  v text;
  f text;
begin
  v := new.custom_fields->>'personalized_message';
  if v is null or v = '' then return new; end if;
  f := public.format_pm(v, coalesce(nullif(new.custom_fields->>'company_name', ''), new.custom_fields->>'organization_name'));
  if f is distinct from v then
    new.custom_fields := jsonb_set(new.custom_fields, '{personalized_message}', to_jsonb(f));
  end if;
  return new;
end;
$fn$;
