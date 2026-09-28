-- Preserve residents, houses, apartments, memberships, and domain history.
-- Platform identities are not transferable: old MAX IDs remain legacy data
-- and are never used to identify VK users.
ALTER TABLE residents ALTER COLUMN max_user_id DROP NOT NULL;
ALTER TABLE residents ADD COLUMN vk_user_id text UNIQUE;

-- Existing bearer sessions were issued after MAX initData verification.
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
