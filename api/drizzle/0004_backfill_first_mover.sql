-- Matches created before "who goes first" existed: default to whoever posted their request first,
-- the same rule new matches use.
UPDATE "matches" m
SET "first_request_id" = (
  SELECT mm."request_id"
  FROM "match_members" mm
  JOIN "swap_requests" r ON r."id" = mm."request_id"
  WHERE mm."match_id" = m."id"
  ORDER BY r."created_at"
  LIMIT 1
)
WHERE m."first_request_id" IS NULL;
