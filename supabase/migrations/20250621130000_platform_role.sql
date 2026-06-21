CREATE TYPE platform_role AS ENUM ('user', 'super_admin');

ALTER TABLE users
  ADD COLUMN platform_role platform_role NOT NULL DEFAULT 'user';
