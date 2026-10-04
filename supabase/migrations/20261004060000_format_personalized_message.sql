-- Mensajes personalizados con estructura (04-10-2026).
--
-- Los {{personalized_message}} de support@ llegaban como UN bloque de texto: el CSV de
-- Personalización junta cada mensaje en una sola línea al descargarlo (flattenCell), y al subirlo
-- a Leads el correo salía sin párrafos, sin saludo separado y con la firma pegada
-- ("…verla juntos? Saludos, Juan OnePulso").
--
-- format_personalized_message() rehace la estructura SIN cambiar ni una palabra:
--   · "Hola Astrid," en su propio párrafo;
--   · el cuerpo en párrafos de 1-2 frases, empezando uno nuevo en "En OnePulso…",
--     "Precisamente…", "Hemos preparado una demo…" (la llamada a la acción va junta);
--   · la firma en sus líneas: "Saludos," / "Juan" / "OnePulso" (y si falta y el mensaje es de
--     OnePulso, se añade con el nombre de "soy Juan");
--   · negrita en la empresa ("Vi a <b>Eraneos</b> y me…"), en "entre 15 y 20 oportunidades…" y
--     en "demo personalizada" (como mucho una vez cada una);
--   · fuera el resto de la IA "--- Nota: este texto no es una plantilla…".
-- Párrafos con línea en blanco y negrita con <b>: al enviarse, textToHtmlBody (motor y
-- send-email) hace <p> de cada párrafo y <br> de cada línea de la firma, y como lleva <b> sale en
-- HTML aunque la campaña esté en "sólo texto". Si un mensaje ya trae saltos de línea o HTML, o es
-- un error de la IA, se devuelve tal cual. Aplicarla dos veces no cambia nada.
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
  if p ~ '[\r\n]'
     or p ~* '<(p|div|br|b|strong|em|i|u|a|span|table|ul|ol|li|h[1-6])[\s>/]'
     or p ~* '^\s*\[error' then
    return p;
  end if;
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  if length(t) < 200 then return p; end if;

  -- Restos de la IA al final: no son para el lead.
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

  -- Saludo en su párrafo: "Hola Astrid," y el cuerpo empieza en mayúscula ("Soy Juan. Vi a…").
  m := regexp_match(t, '^((?:hola|buenas tardes|buenos días|buenas)\s+[^,.!?]{1,40},)\s*(.+)$', 'i');
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

  -- Negritas (cada una como mucho una vez). Con alguna <b> el correo va en HTML, así que & < >
  -- se escriben como entidades; si no se pone ninguna, el texto queda tal cual y el envío los
  -- escapa él solo.
  esc := replace(replace(replace(todo, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  -- La empresa sólo si parece un nombre (corto y sin comas), no una descripción larga.
  con_negrita := regexp_replace(esc, '\y(Vi a) ([^;:!?,]{2,50}?) (y me)\y', '\1 <b>\2</b> \3');
  con_negrita := regexp_replace(con_negrita, '(entre \d+ y \d+ oportunidades(?: comerciales)?(?: (?:al mes|mensuales|cada mes))?)', '<b>\1</b>', 'i');
  con_negrita := regexp_replace(con_negrita, '(demo personalizada)', '<b>\1</b>', 'i');
  if con_negrita = esc then return todo; end if;
  return con_negrita;
end;
$fn$;

-- Quién lo tiene en AUTOMÁTICO: al crear o cambiar un lead suyo, su personalized_message se
-- ordena solo. De momento support@ (petición del dueño); otra cuenta = otra fila aquí.
create table if not exists public.personalized_autoformat_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.personalized_autoformat_users enable row level security;

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
  if not exists (select 1 from public.personalized_autoformat_users u where u.user_id = new.user_id) then return new; end if;
  f := public.format_personalized_message(v);
  if f is distinct from v then
    new.custom_fields := jsonb_set(new.custom_fields, '{personalized_message}', to_jsonb(f));
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_leads_autoformat_personalized on public.leads;
create trigger trg_leads_autoformat_personalized
  before insert or update of custom_fields on public.leads
  for each row execute function public.leads_autoformat_personalized();

insert into public.personalized_autoformat_users (user_id)
select id from auth.users where email = 'support@onepulso.online'
on conflict (user_id) do nothing;
