
CREATE TABLE IF NOT EXISTS user_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  media_url TEXT,
  background_color TEXT DEFAULT '#1E88E5',
  text_color TEXT DEFAULT '#FFFFFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE user_statuses ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can see statuses (they're meant to be public to contacts)
CREATE POLICY "select_statuses" ON user_statuses FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "insert_own_status" ON user_statuses FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_status" ON user_statuses FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "update_own_status" ON user_statuses FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Track who viewed a status
CREATE TABLE IF NOT EXISTS status_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES user_statuses(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(status_id, viewer_id)
);

ALTER TABLE status_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_status_views" ON status_views FOR SELECT
  TO authenticated USING (
    viewer_id = auth.uid() OR
    status_id IN (SELECT id FROM user_statuses WHERE user_id = auth.uid())
  );
CREATE POLICY "insert_views" ON status_views FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = viewer_id);
CREATE POLICY "delete_own_views" ON status_views FOR DELETE
  TO authenticated USING (auth.uid() = viewer_id);
CREATE POLICY "update_own_views" ON status_views FOR UPDATE
  TO authenticated USING (auth.uid() = viewer_id) WITH CHECK (auth.uid() = viewer_id);
