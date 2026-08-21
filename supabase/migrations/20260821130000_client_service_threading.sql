-- Thread deferred replies (copy-change confirmations) to the ORIGINAL message so they land in
-- the right conversation. Stores the inbound Message-ID / References to set In-Reply-To.
alter table public.client_service_log add column if not exists in_reply_to text;
alter table public.client_service_log add column if not exists references_hdr text;
