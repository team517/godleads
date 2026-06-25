UPDATE inbox_messages im
SET campaign_id = sub.campaign_id, lead_id = COALESCE(im.lead_id, sub.lead_id)
FROM (
  SELECT DISTINCT ON (im2.id) im2.id, cl.campaign_id, l.id AS lead_id
  FROM inbox_messages im2
  JOIN leads l ON l.user_id = im2.user_id AND lower(l.email) = lower(im2.from_email)
  JOIN campaign_leads cl ON cl.lead_id = l.id
  WHERE im2.campaign_id IS NULL
  ORDER BY im2.id, cl.campaign_id
) sub
WHERE im.id = sub.id;
