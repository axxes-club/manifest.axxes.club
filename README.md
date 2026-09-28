# AXXES product app

One product in the AXXES suite. The codename, tagline, and modules are defined in [`src/product.config.ts`](src/product.config.ts).

## How it fits together

- **Accounts**: better-auth on the shared AXXES database, so any members.axxes.club account can sign in with the same email and password.
- **Workspaces**: every query is scoped to the signed-in user's primary tenant (`tenant_memberships`, see [`src/lib/context.ts`](src/lib/context.ts)).
- **Data**: uses the tables members.axxes.club already migrated. The schema in `src/lib/db/schema` is a copy of the portal's, and this app runs **no migrations**. Change tables in the portal first, then copy the schema here.
- **Resources**: each entry in `product.config.ts` gets list, create, edit, and delete screens generated from the table's columns ([`src/lib/resource.ts`](src/lib/resource.ts)). Foreign keys are checked against the tenant before any write.

## Develop

```bash
cp .env.example .env.local   # same DATABASE_URL and BETTER_AUTH_SECRET as members.axxes.club
npm install --legacy-peer-deps
npm run dev
```

## Deploy

Vercel **Personal** team (`--scope personal-e870166f`). The commit author must be `viscasillas@me.com`, or Vercel blocks the deploy.

```bash
vercel deploy --prod --scope personal-e870166f
```
