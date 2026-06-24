-- Better Auth tables are created in public by `pnpm --filter @communication-canoe/web auth:migrate`
-- and accessed only via DATABASE_URL (postgres role). Enable RLS with no permissive policies so
-- PostgREST / anon / authenticated API keys cannot read auth secrets (passwords, tokens, emails).

ALTER TABLE IF EXISTS "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "verification" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "user" FROM anon, authenticated;
REVOKE ALL ON TABLE "session" FROM anon, authenticated;
REVOKE ALL ON TABLE "account" FROM anon, authenticated;
REVOKE ALL ON TABLE "verification" FROM anon, authenticated;

-- Auto-enable RLS on future tables in public (e.g. Better Auth plugin tables from auth:migrate).
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS')
  LOOP
    IF cmd.schema_name = 'public' AND cmd.object_type IN ('table', 'partitioned table') THEN
      EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS ensure_rls_on_new_table;

CREATE EVENT TRIGGER ensure_rls_on_new_table
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS')
  EXECUTE FUNCTION public.rls_auto_enable();
