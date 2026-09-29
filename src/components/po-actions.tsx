"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { transitionPoAction } from "@/lib/actions/purchasing"
import type { PoEvent } from "@/domain/purchasing/machine"
import { useToast } from "@/components/shell/toaster"

const LABELS: Partial<Record<PoEvent, { label: string; primary?: boolean; confirm?: string; done: string }>> = {
  place: { label: "Place order", primary: true, done: "Order placed" },
  approve: { label: "Approve", done: "Approved" },
  send: { label: "Mark as sent", primary: true, done: "Marked as sent" },
  close: { label: "Close", confirm: "Close this order? Anything not yet received is written off the order; received stock stays.", done: "Order closed" },
  cancel: { label: "Cancel order", confirm: "Cancel this order? Nothing has been received on it.", done: "Order cancelled" },
}

/** The order's next steps, exactly as its state machine allows. */
export function PoActions({ id, events }: { id: string; events: PoEvent[] }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const ordered = [...events].sort((a, b) => Number(!!LABELS[a]?.primary) - Number(!!LABELS[b]?.primary))
  return (
    <>
      {ordered.map((e) => {
        const l = LABELS[e]
        if (!l) return null
        return (
          <button
            key={e}
            className={l.primary ? "btn-primary" : e === "cancel" ? "btn-danger" : "btn-ghost"}
            disabled={pending}
            onClick={() =>
              (!l.confirm || window.confirm(l.confirm)) &&
              start(async () => {
                const r = await transitionPoAction(id, e)
                toast(r.ok ? { title: l.done } : { title: "Couldn't do that", description: r.error, tone: "error" })
                router.refresh()
              })
            }
          >
            {l.label}
          </button>
        )
      })}
    </>
  )
}
