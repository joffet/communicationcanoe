/**
 * Nominal types for the two tenant identifiers, so the compiler can tell them
 * apart. They are both `string` at runtime and both routinely in scope in the
 * same function, which is precisely why passing one where the other belongs
 * kept happening.
 *
 * - `TenantId` is comm-canoe's own `tenants.id` — a uuid, and the target of
 *   every `tenant_id` FK in the schema.
 * - `ResideClientUid` is reside's own client identifier — free text, and in
 *   production the slug "cardiff". It lives in `tenants.reside_client_uid`,
 *   which migration 20250701002000 added for exactly this reason: a slug does
 *   not fit a uuid primary key, so the two ids had to be decoupled.
 *
 * Reside sends its uid on every inbound request, under a field it calls
 * `tenantId`. That name collision is the trap. Before these brands, handing
 * that value straight to a service taking a `tenantId: string` compiled
 * cleanly and failed at the database — a uuid cast error for a slug uid, or an
 * FK violation for a uuid-shaped one. It shipped twice: once in the outbound
 * batch status endpoint, once in the reside SSO token exchange, where it broke
 * every sign-in for the one client whose uid is a slug.
 *
 * The brand is erased at compile time and costs nothing at runtime. Values
 * read out of the database carry it automatically via Drizzle's `$type<>()` on
 * the column definitions, so the constructors below are only needed where a
 * raw string arrives from outside — a request body, a query parameter, an env
 * var — which is exactly where someone should have to state which id it is.
 */

/**
 * The marker is a plain readonly property rather than a `unique symbol`. A
 * symbol is the tidier encoding, but it cannot be named from outside the module
 * declaring it, so every exported Zod schema whose inferred type mentions a
 * brand fails to compile with TS4023 ("cannot be named"). These types cross
 * three package boundaries, so nameable wins.
 *
 * `__brand` never exists at runtime; nothing should ever read it.
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

/** comm-canoe's internal tenant uuid: `tenants.id`, and every `tenant_id` FK. */
export type TenantId = Brand<string, "TenantId">;

/** reside's own client identifier: `tenants.reside_client_uid`. May be a slug. */
export type ResideClientUid = Brand<string, "ResideClientUid">;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type guard, so a shape check narrows: `if (!isTenantId(id)) notFound();` */
export function isTenantId(value: string): value is TenantId {
  return UUID_RE.test(value);
}

/**
 * Asserts a raw string is one of comm-canoe's tenant uuids.
 *
 * Throws rather than casting blindly: the whole failure mode this guards is a
 * reside client uid arriving where a tenant uuid belongs, and that value is a
 * slug, so the shape check catches it. A caller holding a uid should resolve it
 * through `getTenantByResideClientUid` instead — never reach for this to quiet
 * the compiler.
 */
export function asTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new Error(
      `Not a tenant uuid: ${JSON.stringify(value)}. If this is reside's client uid, ` +
        `resolve it with getTenantByResideClientUid first.`,
    );
  }
  return value as TenantId;
}

/**
 * Tags a raw string as reside's client uid.
 *
 * Deliberately unvalidated — the uid is whatever reside says it is, uuid or
 * slug, and this codebase is in no position to second-guess the format. The
 * value still has to resolve to a row in `tenants` before it means anything.
 */
export function asResideClientUid(value: string): ResideClientUid {
  return value as ResideClientUid;
}
