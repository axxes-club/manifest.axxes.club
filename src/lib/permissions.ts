/**
 * One table decides what each role may do. The navigation, the buttons, the
 * server actions and the API all ask `can()`, so a permission question has
 * exactly one answer wherever it's asked.
 *
 * Roles are the shared AXXES workspace roles from tenant_memberships.
 */

export const ROLES = ["owner", "admin", "manager", "member", "viewer"] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  "stock.view",
  "stock.adjust",
  "stock.move",
  "stock.reverse",
  "catalog.view",
  "catalog.manage",
  "locations.manage",
  "import.run",
  "purchasing.view",
  "purchasing.manage",
  "purchasing.approve",
  "purchasing.receive",
  "audit.view",
  "settings.manage",
] as const
export type Permission = (typeof PERMISSIONS)[number]

const VIEWER: Permission[] = ["stock.view", "catalog.view", "purchasing.view"]
const MEMBER: Permission[] = [...VIEWER, "stock.adjust", "stock.move", "purchasing.receive"]
const MANAGER: Permission[] = [
  ...MEMBER,
  "stock.reverse",
  "catalog.manage",
  "locations.manage",
  "import.run",
  "audit.view",
  "purchasing.manage",
  "purchasing.approve",
]
const ADMIN: Permission[] = [...MANAGER, "settings.manage"]

const BY_ROLE: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ADMIN),
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  member: new Set(MEMBER),
  viewer: new Set(VIEWER),
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  return !!role && (BY_ROLE[role as Role]?.has(permission) ?? false)
}
