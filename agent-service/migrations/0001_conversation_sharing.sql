CREATE TABLE recording_preferences (
 user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision TEXT NOT NULL, updated_at INTEGER NOT NULL, consent_version TEXT NOT NULL
);
CREATE TABLE recording_devices (
 id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
 user_id TEXT, label TEXT NOT NULL, created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX recording_devices_user ON recording_devices(user_id);
CREATE TABLE recording_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
 client TEXT NOT NULL, source_session_id TEXT NOT NULL, consent_revision TEXT NOT NULL,
 task_id TEXT, reference_ids TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 last_seq INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'recording',
 coverage TEXT NOT NULL DEFAULT 'visible_text', deleted_at INTEGER,
 UNIQUE(device_id,source_session_id,consent_revision)
);
CREATE INDEX recording_sessions_user ON recording_sessions(user_id,created_at DESC);
CREATE TABLE recording_chunks (
 session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
 seq INTEGER NOT NULL, hash TEXT NOT NULL, object_key TEXT NOT NULL,
 message_count INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(session_id,seq)
);
PRAGMA foreign_keys=ON;
