ALTER TABLE public.inbox_messages
ADD COLUMN IF NOT EXISTS dedupe_hash text;

CREATE OR REPLACE FUNCTION public.compute_inbox_message_dedupe_hash(
  _message_id text,
  _account_id uuid,
  _from_email text,
  _subject text,
  _body_text text,
  _received_at timestamp with time zone
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN nullif(btrim(coalesce(_message_id, '')), '') IS NOT NULL THEN
      'mid:' || lower(btrim(_message_id))
    ELSE
      'fallback:' || md5(
        coalesce(_account_id::text, '') || '|' ||
        lower(coalesce(_from_email, '')) || '|' ||
        lower(coalesce(_subject, '')) || '|' ||
        md5(left(coalesce(_body_text, ''), 2000)) || '|' ||
        floor(extract(epoch from _received_at) / 60)::bigint::text
      )
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_inbox_message_dedupe_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.dedupe_hash := public.compute_inbox_message_dedupe_hash(
    NEW.message_id,
    NEW.account_id,
    NEW.from_email,
    NEW.subject,
    NEW.body_text,
    NEW.received_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_inbox_message_dedupe_hash_on_write ON public.inbox_messages;
CREATE TRIGGER set_inbox_message_dedupe_hash_on_write
BEFORE INSERT OR UPDATE OF message_id, account_id, from_email, subject, body_text, received_at
ON public.inbox_messages
FOR EACH ROW
EXECUTE FUNCTION public.set_inbox_message_dedupe_hash();

UPDATE public.inbox_messages
SET dedupe_hash = public.compute_inbox_message_dedupe_hash(
  message_id,
  account_id,
  from_email,
  subject,
  body_text,
  received_at
)
WHERE dedupe_hash IS DISTINCT FROM public.compute_inbox_message_dedupe_hash(
  message_id,
  account_id,
  from_email,
  subject,
  body_text,
  received_at
);

WITH ranked AS (
  SELECT
    id,
    user_id,
    dedupe_hash,
    row_number() OVER (
      PARTITION BY user_id, dedupe_hash
      ORDER BY
        auto_replied DESC,
        cardinality(coalesce(labels, '{}'::text[])) DESC,
        is_read DESC,
        is_archived DESC,
        received_at DESC,
        created_at DESC,
        id DESC
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY user_id, dedupe_hash
      ORDER BY
        auto_replied DESC,
        cardinality(coalesce(labels, '{}'::text[])) DESC,
        is_read DESC,
        is_archived DESC,
        received_at DESC,
        created_at DESC,
        id DESC
    ) AS keep_id
  FROM public.inbox_messages
  WHERE dedupe_hash IS NOT NULL
),
dupes AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.message_reminders mr
SET message_id = d.keep_id
FROM dupes d
WHERE mr.message_id = d.duplicate_id;

WITH ranked AS (
  SELECT
    id,
    user_id,
    dedupe_hash,
    row_number() OVER (
      PARTITION BY user_id, dedupe_hash
      ORDER BY
        auto_replied DESC,
        cardinality(coalesce(labels, '{}'::text[])) DESC,
        is_read DESC,
        is_archived DESC,
        received_at DESC,
        created_at DESC,
        id DESC
    ) AS rn,
    first_value(id) OVER (
      PARTITION BY user_id, dedupe_hash
      ORDER BY
        auto_replied DESC,
        cardinality(coalesce(labels, '{}'::text[])) DESC,
        is_read DESC,
        is_archived DESC,
        received_at DESC,
        created_at DESC,
        id DESC
    ) AS keep_id
  FROM public.inbox_messages
  WHERE dedupe_hash IS NOT NULL
),
dupes AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.auto_reply_log arl
SET inbox_message_id = d.keep_id
FROM dupes d
WHERE arl.inbox_message_id = d.duplicate_id;

WITH ranked AS (
  SELECT
    id,
    user_id,
    dedupe_hash,
    row_number() OVER (
      PARTITION BY user_id, dedupe_hash
      ORDER BY
        auto_replied DESC,
        cardinality(coalesce(labels, '{}'::text[])) DESC,
        is_read DESC,
        is_archived DESC,
        received_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM public.inbox_messages
  WHERE dedupe_hash IS NOT NULL
)
DELETE FROM public.inbox_messages im
USING ranked r
WHERE im.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_user_dedupe_hash_key
ON public.inbox_messages (user_id, dedupe_hash)
WHERE dedupe_hash IS NOT NULL;
