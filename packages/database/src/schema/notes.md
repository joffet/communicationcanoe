# Schema port notes

Companion to [`index.ts`](./index.ts), which is the collapsed final state of
the Supabase-era migration history — every `CREATE`/`ALTER`/`DROP` in
`supabase/migrations/*.sql` replayed in filename order, ending at
`20250701002400_tenant_reside_app_url.sql`.

`index.ts` deliberately shows only the end state. Anything renamed, altered, or
dropped along the way has no trace there, and a reader who needs the history —
"was this column always NOT NULL?", "what happened to `call_transfers`?", "what
did RLS actually enforce?" — will not find it in the schema file. That is what
this document is for.

Three kinds of thing are recorded here:

1. **[What was collapsed away](#1-what-was-collapsed-away)** — objects that
   existed in migration history but not in the final schema.
2. **[Discrepancies](#2-discrepancies)** — places where the migrations and
   `types.ts` disagree. Numbered, because `index.ts` cites them by number.
3. **[The RLS policy inventory](#3-rls-policy-inventory)** — every policy that
   existed at cutover, written down because the cutover dropped them and
   application code plus tests are what replace them.

Sections 4–6 cover the naming/casing convention, the SQL that could not be
expressed in Drizzle, and the Supabase-specific objects that did not come
across.

---

## 1. What was collapsed away

### 1.1 Renames

`index.ts` carries only the final name in each case. Nothing in the schema
records the original, so a `git log -S` on the old name finds only migrations.

| Original | Final | Migration |
|---|---|---|
| `call_transfers` (table) | `live_transfers` | `20250621140000` |
| `call_transfer_outcome` (enum type) | `live_transfer_outcome` | `20250621140000` |

Both renames landed when web chat arrived and transfers stopped being
voice-only. The type was renamed in place (`ALTER TYPE ... RENAME TO`), so the
Postgres type carries only the final name and `liveTransferOutcomeEnum` in
`index.ts` is a faithful representation of it.

### 1.2 Enum values added after creation

Every one of these is an `ALTER TYPE ... ADD VALUE`, so the enum in `index.ts`
lists the final union with no indication of when each arrived.

| Enum | Original values | Added later |
|---|---|---|
| `message_channel` | `voice, sms, email` | `web_chat` (`20250621140000`) |
| `sender_type` | `external, internal_user, ai_agent` | `system` (`20250625090000`) |
| `live_transfer_outcome` | `answered, no_answer, declined` | `pending` (`20250621140000`) |
| `message_delivery_status` | `queued, sent, delivered, failed, undelivered` | `sending`, `canceled` (`20250701000800`) |
| `conversation_status` | `open, pending, resolved` | `merged` (`20250701001200`) |

### 1.3 Constraints dropped and recreated

The final `CHECK` is all `index.ts` shows. In each case the earlier form was
narrower:

| Constraint | Was | Became | Migration |
|---|---|---|---|
| `identities_contact_required` | `phone IS NOT NULL OR email IS NOT NULL` | `... OR is_anonymous = true` | `20250621140000` |
| `outbound_batch_recipients_status_check` | `pending, sent, failed` | `pending, sending, sent, failed` | `20250701002200` |
| `messages_transcription_status_check` | `pending, ready, failed` | `pending, transcribing, ready, failed` | `20250701002300` |

The last two both added a claim state so a worker could take a row atomically
before doing expensive, non-idempotent work — the multi-replica fix. The
`transcription_status` constraint was also recreated with `= ANY (ARRAY[...])`
rather than `IN (...)`; `index.ts` reproduces that syntax deliberately so
drizzle-kit does not see a diff against a live database, and the surrounding
comment says so.

`tenants_provisioning_source_check` is also written as a drop-then-add
(`20250625090000`), but that is an idempotency guard in a migration that
created the constraint for the first time, not a real widening.

### 1.4 Nullability changes

Two columns were added nullable, backfilled, then made `NOT NULL` in the same
migration. `index.ts` shows only `.notNull()`, which is correct for the end
state but hides that **none of them has a database-level `DEFAULT`** — the
backfill was a one-time `UPDATE`, not a default that keeps applying. See
[discrepancy #1](#discrepancy-1--tenantschat_widget_key-is-optional-on-insert).

| Column | Backfilled with | Migration |
|---|---|---|
| `tenants.chat_widget_key` | `gen_random_uuid()::text` | `20250621140000` |
| `tenants.reside_client_uid` | `id::text` | `20250701002000` |

Going the other way, `live_transfers.attempted_user_id` **lost** its `NOT NULL`
in `20250621140000`: a web-chat transfer has no specific user being dialed, so
the column had to become optional.

### 1.5 Dropped outright

- **`users.id → auth.users(id)` foreign key** (`20250621120000`). Dropped when
  Better Auth took over identity. `users.id` still holds the Better Auth user
  id; it is simply no longer enforced by a constraint, and `index.ts` shows it
  as a bare `uuid("id").primaryKey()` with no reference.
- **`handle_new_user()` + the `on_auth_user_created` trigger on `auth.users`**
  (`20250621120000`). Supabase Auth's signup hook that auto-created the
  `public.users` profile row. With Better Auth, profile creation happens in
  application code on first sign-in.
- **`conversations_one_open_per_identity`** (`20250701001300`). A partial
  unique index enforcing one open conversation per identity per tenant. Dropped
  outright rather than narrowed, because conversation splitting made
  multiple-open an intentional supported state. Phase 9 (`20250701001400`) then
  added `conversations_tenant_identity_open_idx` over the same columns and
  predicate **without** the uniqueness, restoring the query-serving role the
  dropped index also played. Those two indexes look near-identical in
  `index.ts`; they are a constraint and its non-constraining replacement, one
  migration apart.

### 1.6 Redundant indexes carried over verbatim

`tenants` carries three explicit `CREATE INDEX`es on columns that already have a
`UNIQUE` constraint, and therefore already have a btree index backing that
constraint:

| Unique constraint | Redundant index | Migration |
|---|---|---|
| `tenants_twilio_number_unique` | `tenants_twilio_number_idx` | `20250620160000` |
| `tenants_inbound_email_unique` | `tenants_inbound_email_idx` | `20250620160000` |
| `tenants_reside_client_uid_unique` | `tenants_reside_client_uid_idx` | `20250701002000` |

Same table, same single column, same btree — the second index in each pair can
never be chosen over the first for anything. This is in the original migrations
verbatim, not an artifact of the port, which is why `index.ts` reproduces it: a
schema that omitted them would make drizzle-kit propose dropping three indexes
on the first `db:generate`, turning a cosmetic inheritance into a migration.

Dropping them is safe and would be a small win on write throughput for
`tenants`, but it is a schema change and belongs in its own migration.

`teams_tenant_idx` on `teams (tenant_id)` is a weaker instance of the same
thing: `teams_tenant_name_unique UNIQUE (tenant_id, name)` already serves
`tenant_id`-only lookups as a leading-column prefix. Left alone for the same
reason.

### 1.7 Comments

`20250621120000` attached two `COMMENT ON` statements that no longer exist
anywhere:

- On `public.users`: *"App-domain profile; id matches Better Auth user.id"*
- On `get_user_tenant_ids`: *"RLS backstop — requires auth.uid(); not used with
  Better Auth sessions until backstop mechanism is implemented"*

The second is worth reading as a dated artifact: at that point RLS was still
understood as deferred rather than abandoned. It was never implemented, and the
cutover settled the question the other way. See section 3.

---

## 2. Discrepancies

Between the migrations and `types.ts`. `index.ts` cites these by number, so the
numbering is stable — append, do not renumber.

### Discrepancy #1 — `tenants.chat_widget_key` is optional on insert

`TenantInsert` in [`../types.ts`](../types.ts) declares:

```ts
chat_widget_key?: string;
```

The column is `NOT NULL` with **no database default**. It was added nullable,
backfilled with `gen_random_uuid()::text` as a one-time `UPDATE`, and then set
`NOT NULL` (`20250621140000`) — the `gen_random_uuid()` never became a
`DEFAULT`. An insert that omits it is rejected by Postgres, and the type says it
is fine.

This originated in supabase-generated types, which mark a column optional on
insert whenever it is nullable *or* has a default, and it survived into the
hand-written `types.ts` unchanged. It is latent rather than live: every tenant
creation path supplies a widget key today. Fixing it means making the field
required in `TenantInsert`, or attaching a real `DEFAULT gen_random_uuid()::text`
to the column — the second is a schema change and needs a migration, so it is
not a drive-by.

`tenants.reside_client_uid` has the identical shape (added nullable, backfilled
from `id::text`, set `NOT NULL`, no default) but `TenantInsert` marks it
**required**, which is correct. The two columns disagreeing is what makes #1
look like an oversight rather than a decision.

### Discrepancy #2 — `DocumentChunkInsert` is derived, every other Insert is hand-written

`types.ts` spells out each `*Insert` as a literal object type, except:

```ts
export type DocumentChunkInsert = typeof documentChunks.$inferInsert;
```

Not a bug — `$inferInsert` is strictly more accurate, since it cannot drift from
the schema at all. It is recorded because it means the file is two things at
once, and a reader who assumes "all of these are hand-written literals" (or the
reverse) will be wrong about one of them. The consistent fix in either direction
is mechanical; the `$inferInsert` direction would also make discrepancy #1
impossible by construction.

### Non-discrepancies

Checked and found consistent, recorded so nobody re-derives them:

- Every other `?` field in every `*Insert` type corresponds to a column that is
  genuinely nullable or genuinely carries a database `DEFAULT`.
- All five enum unions in `types.ts` that shadow Postgres enums
  (`conversation_status`, `message_delivery_status`, `conversation_priority`,
  and the two role enums) match the final post-`ADD VALUE` value lists.
- All six `CHECK`-backed string unions (`ai_review_status`,
  `topic_check_status`, `transcription_status`, `documents.status`, and the two
  outbound-batch statuses) match their final constraints, including the two
  widened in `20250701002200`/`20250701002300`.

---

## 3. RLS policy inventory

**None of this is in force.** It is written down because
`packages/database/src/services/tenant-isolation.test.ts` is what replaced it,
and a test suite is only a faithful replacement if you can see what it is
replacing.

### 3.1 Why the policies were not ported

Three independent reasons, any one of which is sufficient:

1. **Every policy reads `auth.uid()`**, directly or through
   `get_user_tenant_ids()`. That function is supplied by Supabase Auth's GUC
   plumbing. This app moved to Better Auth in `20250621120000` and stopped
   supplying it, at which point every policy below evaluated against a NULL
   user and matched nothing — for any caller that RLS actually applied to.
2. **RLS did not apply to the caller that mattered.** `DomainService` connects
   with the service role, which bypasses RLS entirely. The policies governed
   PostgREST/anon/authenticated API access, which is not how this application
   reads its data. On PlanetScale the migration role carries `BYPASSRLS` for the
   same practical result.
3. **The policies were `SELECT`-heavy and did not cover writes.** Of the 27
   policies below, 22 are `SELECT`, 4 are `UPDATE`, and exactly one
   (`messages_insert_member`) covers `INSERT`. No table had a `DELETE` policy,
   and only `messages` had an `INSERT` one. A cross-tenant *write* was already
   unprotected before the cutover.

Point 3 is the one worth remembering. The mental model "we used to have RLS and
then we gave it up" overstates what was there.

### 3.2 The helper function

```sql
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM user_tenant_memberships WHERE user_id = auth.uid();
$$;
```

Referenced by 24 of the 27 policies — all except the two on `users` and
`tenant_settings_update_admin`, which inline `auth.uid()` directly.
`SECURITY DEFINER` so it could read
`user_tenant_memberships` while that table was itself under RLS. Not ported: it
has no application code path, and its only input is `auth.uid()`.

### 3.3 The auto-enable event trigger

`20250624150000` installed an event trigger so that any future `CREATE TABLE` in
`public` got RLS turned on automatically:

```sql
CREATE EVENT TRIGGER ensure_rls_on_new_table
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS')
  EXECUTE FUNCTION public.rls_auto_enable();
```

Its purpose was Better Auth plugin tables: `auth:migrate` can create tables
out-of-band, and without this they would land in the exposed `public` schema
with RLS off and secrets in them. Not ported — nothing on PlanetScale exposes
`public` over HTTP, which was the threat it addressed.

It has one visible consequence in the inventory below. `conversation_splits`
(`20250701001300`) is the only table that never got an explicit `ALTER TABLE ...
ENABLE ROW LEVEL SECURITY`, because by then the event trigger did it. It
therefore had RLS **enabled with zero policies** — deny-all for anon and
authenticated, reachable only by the service role. Whether that was intended or
simply unnoticed is not recoverable from the migrations.

### 3.4 The policies

27 tables had RLS enabled: the 23 application tables in `index.ts` plus Better
Auth's four. 27 policies across 22 of them; `conversation_splits` and the four
Better Auth tables had none.

Every policy was `TO authenticated`. `tenant_scoped` below is shorthand for
`tenant_id IN (SELECT get_user_tenant_ids())`, and `via_conversation` for
`conversation_id IN (SELECT id FROM conversations WHERE tenant_id IN (SELECT
get_user_tenant_ids()))`.

| Table | Policy | Cmd | Predicate |
|---|---|---|---|
| `users` | `users_select_own` | SELECT | `id = auth.uid()` |
| `users` | `users_update_own` | UPDATE | `id = auth.uid()` (USING + WITH CHECK) |
| `tenants` | `tenants_select_member` | SELECT | `id IN (SELECT get_user_tenant_ids())` |
| `tenant_settings` | `tenant_settings_select_member` | SELECT | `tenant_scoped` |
| `tenant_settings` | `tenant_settings_update_admin` | UPDATE | membership row with `role = 'admin'` |
| `user_tenant_memberships` | `user_tenant_memberships_select` | SELECT | `tenant_scoped` |
| `teams` | `teams_select_member` | SELECT | `tenant_scoped` |
| `team_memberships` | `team_memberships_select` | SELECT | team belongs to a member tenant |
| `identities` | `identities_select_member` | SELECT | `tenant_scoped` |
| `identities` | `identities_update_member` | UPDATE | `tenant_scoped` (USING only) |
| `identity_merge_logs` | `identity_merge_logs_select` | SELECT | `tenant_scoped` |
| `identity_conversion_logs` | `identity_conversion_logs_select` | SELECT | `tenant_scoped` |
| `conversations` | `conversations_select_member` | SELECT | `tenant_scoped` |
| `conversations` | `conversations_update_member` | UPDATE | `tenant_scoped` (USING only) |
| `messages` | `messages_select_member` | SELECT | `tenant_scoped` |
| `messages` | `messages_insert_member` | INSERT | `tenant_scoped` (WITH CHECK) |
| `live_transfers` | `live_transfers_select_member` | SELECT | `tenant_scoped` |
| `outbound_batches` | `outbound_batches_select_member` | SELECT | `tenant_scoped` |
| `outbound_batch_recipients` | `outbound_batch_recipients_select_member` | SELECT | `tenant_scoped` |
| `tags` | `tags_select_member` | SELECT | `tenant_scoped` |
| `conversation_tags` | `conversation_tags_select_member` | SELECT | `via_conversation` |
| `conversation_assignees` | `conversation_assignees_select_member` | SELECT | `via_conversation` |
| `conversation_participants` | `conversation_participants_select_member` | SELECT | `via_conversation` |
| `conversation_read_states` | `conversation_read_states_select_member` | SELECT | `via_conversation` |
| `conversation_personal_tags` | `conversation_personal_tags_select_member` | SELECT | `via_conversation` |
| `documents` | `documents_select_member` | SELECT | `tenant_scoped` |
| `document_chunks` | `document_chunks_select_member` | SELECT | `tenant_scoped` |
| `conversation_splits` | *(none)* | — | RLS on via event trigger, deny-all |
| `user`, `session`, `account`, `verification` | *(none)* | — | RLS on + `REVOKE ALL FROM anon, authenticated` |

One policy was dropped by name during the rename:
`call_transfers_select_member` → `live_transfers_select_member`
(`20250621140000`), same predicate.

The `via_conversation` group is the interesting one for reimplementation. Those
five tables have **no `tenant_id` column of their own** — they reach tenancy
only through `conversations`. Any service method touching them has to join or
sub-select to scope by tenant; it cannot filter on a local column, and the
`WHERE tenant_id = $1` habit does not apply. That is where a missing check is
easiest to write and hardest to notice.

### 3.5 What replaced it

Nothing at the database level for tenant-to-tenant isolation. Two things at
other levels:

- **Between products:** `packages/database/sql/00-bootstrap-database-and-role.sql`
  puts comm-canoe and reside in separate logical databases on one cluster, with
  `CONNECT` revoked from `PUBLIC` and granted only to each product's own role.
  Stronger than the RLS it replaces, and non-bypassable — but it protects the
  product boundary, not the tenant boundary.
- **Between tenants:** `src/services/tenant-isolation.test.ts`. Builds two
  complete parallel tenants and asserts that tenant A's service call cannot
  reach tenant B's row. New service methods need a case there; a method that
  forgets its predicate passes every other test in this package, because every
  other test seeds a single tenant.

---

## 4. Naming convention / casing gap

Every column in `index.ts` is given an **explicit** snake_case database name:

```ts
chatWidgetKey: text("chat_widget_key").notNull(),
```

rather than relying on Drizzle's `casing: "snake_case"` option to derive it.
That is not redundancy for its own sake. The option is set in two places and
they do not agree:

| Consumer | Sets `casing: "snake_case"`? |
|---|---|
| `src/db.ts` — the runtime `drizzle()` client | **yes** |
| `drizzle.config.ts` — drizzle-kit | **yes** (added with the config; see its comment) |

The hazard the explicit names guard against is the two ever drifting apart.
drizzle-kit writes column names into the generated migration SQL, and the
runtime client generates queries using its own naming. If one derives
`chat_widget_key` and the other derives `chatWidgetKey`, the DDL and the ORM
silently describe different columns — no error, just a query against a column
that does not exist, or worse, a migration creating one nobody reads.

With every name written out, both consumers read the same literal and the
`casing` option becomes a safety net rather than the only thing holding it
together. `drizzle.config.ts`'s own comment makes the same point from the other
side. Keep writing them explicitly.

---

## 5. Companion SQL

Two things could not go into `index.ts`, because Drizzle's schema builder
expresses tables and not procedural code. Both live in
[`packages/database/sql/`](../../sql/), which has its own README covering run
order.

**`00-bootstrap-database-and-role.sql`** — `CREATE DATABASE`, the
`comm_canoe_app` role, `REVOKE CONNECT ... FROM PUBLIC`, the grants and default
privileges, and `CREATE EXTENSION vector`. Runs once per cluster, before any
drizzle-kit migration, because it creates the database those migrations run
*inside*. `CREATE DATABASE` also cannot run in a transaction block, which rules
out drizzle-kit applying it regardless.

**`99-functions-and-triggers.sql`** — everything carried over from the Supabase
schema that is a function or a trigger. Runs after the tables exist, since every
statement references a table by name.

| Object | Kind | From |
|---|---|---|
| `resolve_identity_id` | RPC, called from `services/index.ts` | `20250620160000` |
| `identity_merge_chain_ids` | RPC | `20250701000900` |
| `resolve_conversation_id` | RPC | `20250701001200` |
| `conversation_merge_chain_ids` | RPC | `20250701001200` |
| `match_document_chunks` | RPC | `20250701001600` |
| `update_conversation_last_message_at` | `AFTER INSERT` trigger on `messages` | `20250620160000` |
| `update_conversation_response_due_at` | `AFTER INSERT` trigger on `messages` | `20250701001000` |
| `assert_chunk_tenant_matches_document` | `BEFORE INSERT` trigger on `document_chunks` | `20250701001500` |

The last one is the only tenant guard in this codebase that application code
cannot skip — it fires regardless of which path inserted the row, which is
exactly why `document_chunks.tenant_id` can be safely denormalized from its
parent document. `index.ts`'s `documentChunks` comment leans on it.

`match_document_chunks` deliberately has no HNSW/IVFFlat index behind it. An
approximate index can find the global top-k across all tenants and post-filter,
silently under-returning results for a small tenant once a larger one has loaded
many chunks. Do not add a vector index without a cross-tenant completeness test
alongside it.

---

## 6. Supabase-specific objects not ported

- **`ALTER PUBLICATION supabase_realtime ADD TABLE conversations, messages`**
  (`20250620160100`). Supabase's Postgres-changes CDC feed. Already vestigial
  before the cutover: `apps/web/src/lib/supabase/realtime.ts` and
  `apps/realtime-bridge/src/realtime/broadcast.ts` use `channel().send()`
  broadcast and presence, never `postgres_changes`. The Realtime dependency that
  remains is pub/sub against the hosted Supabase project and does not read the
  database at all.
- **`auth.users`** — the whole schema. See §1.5 for the FK and trigger that
  referenced it.
- **`rls_auto_enable()` and `ensure_rls_on_new_table`** — see §3.3.
- **`get_user_tenant_ids()`** — see §3.2.
- **The `anon` and `authenticated` roles**, and every `GRANT`/`REVOKE` naming
  them. PlanetScale's equivalents are `postgres` (migrations, DDL) and
  `comm_canoe_app` (runtime, no DDL), set up by the bootstrap SQL.
