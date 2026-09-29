// Shared AXXES tables. These are copies of members.axxes.club's schema, which
// owns their migrations. Manifest reads them and never migrates them.
export * from "./tenants"
export * from "./users"
export * from "./tenant-modules"
export * from "./contacts"
export * from "./assets"
export * from "./integrations"

// Legacy inventory tables (members' Basic Stock). Manifest keeps products,
// variants and levels in sync as projections of its ledger, and imports the
// rest once.
export * from "./inventory"
export * from "./inventree"
export * from "./inventory-advanced"

// Manifest-owned tables (manifest_*). These are migrated from this repo.
export * from "./manifest"
