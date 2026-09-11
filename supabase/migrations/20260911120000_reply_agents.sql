-- Reply Agents — the auto-reply rule grows into a configurable agent.
-- =====================================================================
-- DESIGN
--
-- One row of auto_reply_rules = ONE agent. We extend the existing table instead of creating a
-- new one because the rows already in it are live configurations with live auto_reply_log
-- history; a parallel table would have meant migrating that history and keeping two writers
-- against inbox_messages.auto_replied. Every column here is additive with a DEFAULT, so an
-- existing row keeps working the moment this lands and the old columns (prompt, company_info,
-- account_tags, account_ids, delay_minutes) stay exactly as they are.
--
-- What an agent now carries:
--   * a GOAL (what the reply is for), not just a free-text prompt;
--   * a SCOPE (which mailboxes/campaigns it watches);
--   * which CATEGORIES of reply it acts on — the platform's own label strings, the ones the
--     server writes in inbox_messages.labels next to the 'IA' marker;
--   * a MODE: draft or auto.
--
-- reply_mode DEFAULTS TO 'draft' on purpose. An agent that starts sending the moment somebody
-- saves it is a way to email a prospect something nobody read. Draft generates the reply, parks
-- it in auto_reply_log with status 'draft', and waits for a human to send or discard it. Sending
-- automatically is a deliberate choice, never the default.
--
-- max_replies_per_day is a blast radius, not a throughput setting: if the classifier or a lead
-- list misbehaves, the damage is bounded per agent and per day.
--
-- auto_reply_log becomes the queue as well as the journal:
--   status: 'draft'   → generated, waiting for a human (mode='draft')
--           'sent'    → delivered
--           'discarded' → a human rejected the draft
--           'failed'  → generation or SMTP failed (never retried: no retry storms)
--           'skipped' → the model answered __SKIP__ (robot / rejection / bounce)
--   mode: 'auto' | 'draft' — how the row was produced, so a mixed history stays readable.
-- =====================================================================

-- ── auto_reply_rules → agent configuration ───────────────────────────────────────────────────
ALTER TABLE public.auto_reply_rules
  -- Goal: book_meeting | share_info | qualify | custom
  ADD COLUMN IF NOT EXISTS primary_goal        text    NOT NULL DEFAULT 'book_meeting',
  ADD COLUMN IF NOT EXISTS custom_goal         text    NOT NULL DEFAULT '',
  -- Scope: account (every connected mailbox of the user) | campaign (campaign_ids) | tags (legacy)
  ADD COLUMN IF NOT EXISTS scope_type          text    NOT NULL DEFAULT 'account',
  ADD COLUMN IF NOT EXISTS campaign_ids        uuid[]  NOT NULL DEFAULT '{}',
  -- Which replies it acts on: all | specific. Values are the platform label strings
  -- ('Interesado','Pregunta','No interesado','No contactar','Derivado','Fuera / Auto').
  ADD COLUMN IF NOT EXISTS category_mode       text    NOT NULL DEFAULT 'specific',
  ADD COLUMN IF NOT EXISTS categories          text[]  NOT NULL DEFAULT '{Interesado,Pregunta}',
  -- draft = generate and wait for review (default). auto = send it.
  ADD COLUMN IF NOT EXISTS reply_mode          text    NOT NULL DEFAULT 'draft',
  -- Voice: professional | casual | friendly | direct
  ADD COLUMN IF NOT EXISTS tone                text    NOT NULL DEFAULT 'professional',
  -- short (30-50 words) | medium (80-120) | long (150-200)
  ADD COLUMN IF NOT EXISTS length              text    NOT NULL DEFAULT 'medium',
  -- "Personalized communication style"
  ADD COLUMN IF NOT EXISTS style_prompt        text    NOT NULL DEFAULT '',
  -- "Context & business logic" — the ONLY source of truth the agent may quote facts from
  ADD COLUMN IF NOT EXISTS business_context    text    NOT NULL DEFAULT '',
  -- "Objection handling reference"
  ADD COLUMN IF NOT EXISTS objection_handling  text    NOT NULL DEFAULT '',
  -- [{ "name": "Calendario", "url": "https://calendly.com/..." }]
  ADD COLUMN IF NOT EXISTS resources           jsonb   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS max_replies_per_day integer NOT NULL DEFAULT 50,
  -- Who signs. Empty = the mailbox's own first/last name.
  ADD COLUMN IF NOT EXISTS signature_name      text    NOT NULL DEFAULT '';

-- ── Data migration: carry the legacy configuration into the new fields ───────────────────────
-- Idempotent by construction (each branch only fires while the new field is still empty), so
-- re-running the migration never overwrites something the operator has since edited.
UPDATE public.auto_reply_rules
   SET style_prompt     = CASE WHEN style_prompt = ''     AND prompt       <> '' THEN prompt       ELSE style_prompt     END,
       business_context = CASE WHEN business_context = '' AND company_info <> '' THEN company_info ELSE business_context END,
       scope_type       = CASE WHEN account_tags <> '{}'::text[] OR account_ids <> '{}'::uuid[]    THEN 'tags'           ELSE scope_type       END
 WHERE (style_prompt = ''     AND prompt       <> '')
    OR (business_context = '' AND company_info <> '')
    OR (scope_type <> 'tags' AND (account_tags <> '{}'::text[] OR account_ids <> '{}'::uuid[]));

-- ── auto_reply_log → review queue ────────────────────────────────────────────────────────────
ALTER TABLE public.auto_reply_log
  -- When a human sent or discarded a draft.
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz,
  -- The subject the reply will go out with ("Re: ..."), so review does not have to rebuild it.
  ADD COLUMN IF NOT EXISTS draft_subject text NOT NULL DEFAULT '',
  -- auto | draft — how this row was produced.
  ADD COLUMN IF NOT EXISTS mode          text NOT NULL DEFAULT 'auto';

-- One lookup per candidate message ("did anything already answer this?") and one per review
-- screen ("my drafts"). Both are on the hot path of every cron tick.
CREATE INDEX IF NOT EXISTS auto_reply_log_inbox_message_idx ON public.auto_reply_log (inbox_message_id);
CREATE INDEX IF NOT EXISTS auto_reply_log_user_status_idx   ON public.auto_reply_log (user_id, status);

COMMENT ON COLUMN public.auto_reply_rules.reply_mode IS
  'draft = generar y esperar revisión humana (por defecto); auto = enviar automáticamente.';
COMMENT ON COLUMN public.auto_reply_rules.categories IS
  'Etiquetas de la plataforma sobre las que actúa el agente cuando category_mode = specific.';
COMMENT ON COLUMN public.auto_reply_log.status IS
  'draft | sent | discarded | failed | skipped';
