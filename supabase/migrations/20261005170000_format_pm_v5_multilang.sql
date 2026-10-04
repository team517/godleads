-- format_pm v5 (05-10-2026), tras la auditoría independiente:
--   · saludo y despedida también en francés, inglés, italiano, portugués y alemán (ChipsFinder envía
--     en varios idiomas): "Bonjour Eric," / "Cordialement, Marie ChipsFinder" ya se separan;
--   · la marca de la firma va en su propia línea para cualquier cliente, no sólo OnePulso: si el
--     último nombre de la firma es la marca que el propio mensaje presenta ("En Dialogfy enseñamos…").
-- El resto, idéntico a la v4. Idempotente.
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
  marca text;
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

  m := regexp_match(t, '^(.*\S)\s+((?:saludos cordiales|un saludo|un abrazo|saludos|atentamente|cordialement|bien à vous|best regards|kind regards|warm regards|regards|best|cheers|cordiali saluti|saluti|cumprimentos|atenciosamente|mit freundlichen grüßen|viele grüße|beste grüße)[,.]?)\s+([^\s?!]+(?:\s+[^\s?!]+){0,2})$', 'i');
  if m is not null then
    t := m[1];
    palabras := regexp_split_to_array(m[3], '\s+');
    n := array_length(palabras, 1);
    -- Despedidas de dos palabras que el corte voraz parte en dos ("Best" | "regards", "Cordiali" | "saluti").
    if m[1] ~* '\s(best|kind|warm|cordiali)$' and m[2] ~* '^(regards|saluti)' then
      m[2] := substring(m[1] from '(\S+)$') || ' ' || m[2];
      m[1] := regexp_replace(m[1], '\s+\S+$', '');
      t := m[1];
      firma := '';
    end if;
    -- La marca en su propia línea: OnePulso, o la marca que el propio mensaje presenta ("En Dialogfy enseñamos…").
    marca := substring(m[1] from '\y(?:En|At|Chez|Da|Bei) ([A-Z0-9][^\s,.;:<>]{1,24}) (?:ayudamos|nos |enseñamos|diseñamos|automatizamos|creamos|trabajamos|formamos|conseguimos|generamos|we |nous |aiutiamo|ajudamos|helfen)');
    if n >= 2 and (palabras[n] ~* '^onepulso$' or (marca is not null and lower(palabras[n]) = lower(marca))) then
      firma := m[2] || E'\n' || array_to_string(palabras[1:n - 1], ' ') || E'\n' || palabras[n];
    else
      firma := m[2] || E'\n' || m[3];
    end if;
  end if;

  m := regexp_match(t, '^((?:hola|buenas tardes|buenos días|buenas|bonjour|bonsoir|hello|hi|dear|ciao|buongiorno|salve|olá|ola|bom dia|hallo|guten tag)\s+[^,!?\n]{1,40},)\s*(.+)$', 'i');
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

