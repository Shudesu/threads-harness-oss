-- Existing queued/processing jobs stay with the original tenant DO.
ALTER TABLE threads_posts ADD COLUMN scheduler_key TEXT NOT NULL DEFAULT 'tenant';
CREATE INDEX threads_posts_scheduler ON threads_posts(scheduler_key, status, scheduled_at);
