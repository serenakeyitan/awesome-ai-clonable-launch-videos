CREATE TABLE IF NOT EXISTS community_posts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT,
 title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', product_url TEXT NOT NULL DEFAULT '',
 creator_name TEXT NOT NULL DEFAULT 'Creator', kind TEXT NOT NULL DEFAULT 'launch' CHECK(kind IN ('launch','ad')),
 reference_ids TEXT NOT NULL DEFAULT '[]', active_upload_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','deleted')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS community_task ON community_posts(user_id,task_id) WHERE task_id IS NOT NULL AND status!='deleted';
CREATE INDEX IF NOT EXISTS community_feed ON community_posts(status,published_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS community_owner ON community_posts(user_id,status);
CREATE TABLE IF NOT EXISTS community_uploads (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
 video_bytes INTEGER NOT NULL, cover_bytes INTEGER NOT NULL DEFAULT 0,
 cover_type TEXT NOT NULL DEFAULT 'image/jpeg', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','replaced')),
 FOREIGN KEY(post_id) REFERENCES community_posts(id)
);
CREATE INDEX IF NOT EXISTS community_upload_owner ON community_uploads(user_id,created_at);
