-- One row per DEVICE, not per endpoint.
--
-- A phone re-subscribes whenever its push token rotates (app update, service-worker change,
-- iOS housekeeping). The new endpoint was inserted and the old row stayed behind — and Apple
-- keeps answering 201 for a dead endpoint while delivering nothing, so the alert looked sent
-- and the phone never rang. With a stable device id the client can replace its own row instead
-- of leaving a zombie behind.
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS device_id text;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_device
  ON public.push_subscriptions (user_id, device_id);
