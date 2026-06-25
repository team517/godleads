
-- 1. Mark all 450/550 mailbox unavailable as definitive bounced (stop retries)
UPDATE sent_emails
SET status = 'bounced',
    bounced_at = NOW()
WHERE status = 'failed'
  AND (error_message LIKE '%mailbox unavailable%' 
       OR error_message LIKE '%550%' 
       OR error_message LIKE '%5.1.1%'
       OR error_message LIKE '%5.7.1%'
       OR error_message LIKE '%does not exist%'
       OR error_message LIKE '%user unknown%')
  AND created_at > NOW() - INTERVAL '7 days';

-- 2. Mark 421 (rate-limit auth failures) as bounced too — they keep failing
UPDATE sent_emails
SET status = 'bounced',
    bounced_at = NOW()
WHERE status = 'failed'
  AND error_message LIKE '%421%'
  AND created_at > NOW() - INTERVAL '7 days';

-- 3. Update campaign_leads status to 'bounced' for these emails so they stop being processed
UPDATE campaign_leads cl
SET status = 'bounced'
FROM sent_emails se
WHERE cl.lead_id = se.lead_id 
  AND cl.campaign_id = se.campaign_id
  AND se.status = 'bounced'
  AND se.bounced_at > NOW() - INTERVAL '1 hour'
  AND cl.status IN ('pending', 'in_progress');

-- 4. Auto-add high-bounce-rate domains to user blocklists
INSERT INTO blocklist (user_id, entry_type, value)
SELECT DISTINCT se.user_id, 'domain', LOWER(split_part(se.to_email, '@', 2))
FROM sent_emails se
WHERE se.status = 'bounced'
  AND se.bounced_at > NOW() - INTERVAL '1 hour'
  AND LOWER(split_part(se.to_email, '@', 2)) IN (
    'gentec.es', 'greenalia.es', 'avantmedic.com', 'dentaltix.com', 'galimplant.com',
    'patologiadual.com', 'byg.com', 'iatiseguros.com', 'airtren.com', 'ideas4all.com',
    'opground.com', 'heymondo.com', 'dynamicabutment.com', 'global-perspectives.com',
    'institutrocafort.com'
  )
ON CONFLICT DO NOTHING;
