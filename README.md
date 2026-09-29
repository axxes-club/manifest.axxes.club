# Manifest · AXXES

Inventory operations on one honest ledger: every stock number explains itself. Manifest is the AXXES suite's inventory engine: pro operations for product businesses, and the inventory provider behind the AXXES portal's basic Stock module.

## How it fits together

- **Accounts**: better-auth on the shared AXXES database. With `HANDSHAKE_URL` set, sign-in goes through handshake.axxes.club and one session covers every `*.axxes.club` app.
- **Workspaces**: every query is scoped to the active workspace (`tenant_memberships`; switch in the sidebar). Roles come from the membership, and `src/lib/permissions.ts` is the one place that decides what each role can do.
- **Catalog**: items live in the shared `products` / `product_variants` tables, so the storefront, members and Pulse see the same catalog.
- **Ledger**: Manifest owns its `manifest_*` tables and migrates them from this repo (`drizzle/`). It never touches another app's tables (`drizzle.config.ts` is scoped to `manifest_*`).
  - `manifest_stock_moves` is the source of truth: immutable, double-entry moves between locations. Mistakes are fixed with reversal moves (Undo), never edits.
  - `manifest_quants` (stock per item, location, lot and status), `manifest_cost_layers` and `manifest_item_costs` (FIFO or average) are projections updated in the same transaction.
  - After each posting, stock is mirrored into the shared `products.quantity` / `inventory_levels`, so members, Pulse and the public storefront feed stay correct.
- **Domain layer** (`src/domain`): the only code that writes. Each command runs in one transaction with a permission check, state-machine guard, per-item lock, audit row and outbox event (`runCommand` in `src/domain/command.ts`).
- **Purchasing**: purchase orders (draft → approved → sent → received → closed, with an optional approval threshold), goods receipts that post supplier → bin moves at the order cost converted to base currency, and landed costs spread by value or quantity. Only the share on stock still on hand is capitalized; the rest is recorded as a variance. Undoing a receipt rolls back the stock, the valuation and the order.
- **Master data** (suppliers, price lists) still uses the generic resource screens from `src/product.config.ts`.
- **Raw SQL**: inside correlated subqueries, reference outer columns with `outer()` from `src/lib/db/sql.ts`. Drizzle leaves columns unqualified in single-table selects, and an unqualified `"id"` binds to the subquery's own table.

## Develop

```bash
npm install --legacy-peer-deps
npm run db:local            # disposable Postgres on :5499 with a seeded demo workspace
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5499/postgres npm run dev
# sign in as demo@manifest.local / manifest-demo
```

`npm run db:local -- --reset` wipes and re-seeds it.

```bash
npm test                    # ledger, costing, import and verb tests on in-process Postgres
npm run typecheck
```

## Schema changes

1. Edit `src/lib/db/schema/manifest/*`.
2. `npm run db:generate -- --name <change>`
3. Review the SQL in `drizzle/`. It must only touch `manifest_*` objects.
4. `npm run db:migrate` applies it to the database in `DATABASE_URL`.

Shared tables (`tenants`, `products`, …) are still owned by members.axxes.club: change them there first, then copy the schema here.

## Deploy

Vercel **Personal** team (`--scope personal-e870166f`). The commit author must be `viscasillas@me.com`, or Vercel blocks the deploy. Run `npm run db:migrate` against production before deploying a build that needs new tables.

```bash
vercel deploy --prod --scope personal-e870166f
```
