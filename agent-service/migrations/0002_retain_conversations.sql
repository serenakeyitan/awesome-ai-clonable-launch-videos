-- Preserve existing conversation text under the new indefinite-retention policy.
-- A future legacy timestamp also prevents an older deployment from treating
-- existing sessions as expired if code is rolled back.
UPDATE recording_sessions SET expires_at = 9007199254740991 WHERE deleted_at IS NULL;
