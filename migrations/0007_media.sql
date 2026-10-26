-- Existing text posts keep their IDs, containers, scheduler and history.
ALTER TABLE threads_posts ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE threads_posts ADD COLUMN media_children_json TEXT NOT NULL DEFAULT '[]';
