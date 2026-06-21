-- Decouple app users from Supabase Auth (Better Auth owns identity/sessions)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

COMMENT ON TABLE public.users IS 'App-domain profile; id matches Better Auth user.id';
COMMENT ON FUNCTION get_user_tenant_ids IS 'RLS backstop — requires auth.uid(); not used with Better Auth sessions until backstop mechanism is implemented';
