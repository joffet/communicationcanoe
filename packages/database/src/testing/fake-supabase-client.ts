/**
 * Minimal in-memory stand-in for the subset of supabase-js's query builder
 * that DomainService actually uses (from/select/eq/neq/in/order/limit/
 * single/maybeSingle/upsert/update/delete/rpc) - not a PostgREST emulator.
 * Built for unit-testing DomainService methods without a live Postgres/
 * Docker instance (unavailable in this environment), trading full fidelity
 * (no RLS, no real constraint errors, no embedded-resource selects like
 * "tags(*)") for fast, dependency-free tests of the query/branching logic
 * that lives in TypeScript.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type RpcHandler = (args: Record<string, unknown>) => unknown;

type QueryResult<T> = { data: T; error: null };

class FakeQueryBuilder implements PromiseLike<QueryResult<unknown>> {
  private filters: Array<(row: Row) => boolean> = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private mode: "select" | "upsert" | "insert" | "update" | "delete" = "select";
  private writeRows: Row[] = [];
  private onConflictColumns: string[] = [];
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
  ) {}

  private rows(): Row[] {
    if (!this.tables[this.table]) this.tables[this.table] = [];
    return this.tables[this.table];
  }

  select(_columns?: string) {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderSpec = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  upsert(rows: Row | Row[], options?: { onConflict?: string }) {
    this.mode = "upsert";
    this.writeRows = Array.isArray(rows) ? rows : [rows];
    this.onConflictColumns = (options?.onConflict ?? "").split(",").filter(Boolean);
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.writeRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.writeRows = [patch];
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  private execute(): QueryResult<unknown> {
    const table = this.rows();

    if (this.mode === "upsert") {
      const results: Row[] = [];
      for (const row of this.writeRows) {
        const existingIndex = this.onConflictColumns.length
          ? table.findIndex((r) => this.onConflictColumns.every((c) => r[c] === row[c]))
          : -1;
        if (existingIndex >= 0) {
          table[existingIndex] = { ...table[existingIndex], ...row };
          results.push(table[existingIndex]);
        } else {
          const inserted = { ...row };
          table.push(inserted);
          results.push(inserted);
        }
      }
      return { data: this.singleMode ? (results[0] ?? null) : results, error: null };
    }

    if (this.mode === "insert") {
      const inserted = this.writeRows.map((row) => ({ ...row }));
      table.push(...inserted);
      return { data: this.singleMode ? (inserted[0] ?? null) : inserted, error: null };
    }

    if (this.mode === "update") {
      const patch = this.writeRows[0] ?? {};
      const matched = table.filter((row) => this.filters.every((f) => f(row)));
      for (const row of matched) Object.assign(row, patch);
      return { data: this.singleMode ? (matched[0] ?? null) : matched, error: null };
    }

    if (this.mode === "delete") {
      const remaining: Row[] = [];
      const removed: Row[] = [];
      for (const row of table) {
        if (this.filters.every((f) => f(row))) removed.push(row);
        else remaining.push(row);
      }
      this.tables[this.table] = remaining;
      return { data: removed, error: null };
    }

    let results = table.filter((row) => this.filters.every((f) => f(row)));
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      results = [...results].sort((a, b) => {
        const av = a[column] as string | number;
        const bv = b[column] as string | number;
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
    }
    if (this.limitCount != null) results = results.slice(0, this.limitCount);
    results = results.map((r) => ({ ...r }));

    if (this.singleMode) {
      return { data: results[0] ?? null, error: null };
    }
    return { data: results, error: null };
  }

  then<TResult1 = QueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabaseClient(seed: Tables = {}) {
  const tables: Tables = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const rpcHandlers: Record<string, RpcHandler> = {};

  return {
    from(table: string) {
      return new FakeQueryBuilder(tables, table);
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const handler = rpcHandlers[fn];
      const data = handler ? handler(args) : null;
      return Promise.resolve({ data, error: null });
    },
    __registerRpc(fn: string, handler: RpcHandler) {
      rpcHandlers[fn] = handler;
    },
    __table(name: string): Row[] {
      return tables[name] ?? [];
    },
  };
}

export type FakeSupabaseClient = ReturnType<typeof createFakeSupabaseClient>;
