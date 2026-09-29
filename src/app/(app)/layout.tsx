import { cookies } from "next/headers"
import { requireContext } from "@/lib/context"
import { db } from "@/lib/db"
import { ensureWorkspace } from "@/domain/workspace"
import { can } from "@/lib/permissions"
import { Sidebar } from "@/components/shell/sidebar"
import { CommandPalette } from "@/components/shell/command-palette"
import { Shortcuts } from "@/components/shell/shortcuts"
import { Toaster } from "@/components/shell/toaster"
import { TopBar } from "@/components/shell/top-bar"
import { Logo, Mark } from "@/components/logo"
import { product } from "@/product.config"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext()
  await ensureWorkspace(db, ctx.tenant.id)
  const collapsed = (await cookies()).get("manifest_sidebar")?.value === "collapsed"
  const sections = product.nav
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || can(ctx.role, i.permission)) }))
    .filter((s) => s.items.length)
  const nav = sections.flatMap((s) => s.items)

  return (
    <Toaster>
      <CommandPalette nav={nav}>
        <div className="lg:flex">
          <Sidebar
            sections={sections}
            logo={<Logo />}
            mark={<Mark />}
            collapsed={collapsed}
            workspace={{ id: ctx.tenant.id, name: ctx.tenant.name, role: ctx.role }}
            workspaces={ctx.workspaces}
            user={ctx.user}
          />
          <div className="min-w-0 flex-1">
            <TopBar userName={ctx.user.name} />
            <main className="px-4 py-8 sm:px-8 lg:py-10">
              <div className="mx-auto max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
        <Shortcuts nav={nav} />
      </CommandPalette>
    </Toaster>
  )
}
