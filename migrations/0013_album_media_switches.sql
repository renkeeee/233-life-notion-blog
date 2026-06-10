ALTER TABLE posts
	ADD COLUMN album_media_enabled INTEGER NOT NULL DEFAULT 0 CHECK (album_media_enabled IN (0, 1));
