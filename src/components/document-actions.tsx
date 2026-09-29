"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { cancelAdjustmentAction, postAdjustmentAction, undoAction } from "@/lib/actions/stock"
import { useToast } from "@/components/shell/toaster"

const LABELS: Record<string, { label: string; primary?: boolean; confirm?: string }> = {
  post: { label: "Post", primary: true },
  cancel: { label: "Cancel draft", confirm: "Cancel this draft? It won't change any stock." },
}

/** Buttons for exactly the transitions the document's state machine allows, plus Undo for posted ones. */
export function DocumentActions({ id, events, commandId }: { id: string; events: string[]; commandId: string | null }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  const run = (event: string) =>
    start(async () => {
      if (LABELS[event]?.confirm && !window.confirm(LABELS[event].confirm)) return
      const r = event === "post" ? await postAdjustmentAction(id, crypto.randomUUID()) : await cancelAdjustmentAction(id)
      toast(r.ok ? { title: event === "post" ? "Posted. Stock updated." : "Draft cancelled." } : { title: "Couldn't do that", description: r.error, tone: "error" })
      router.refresh()
    })

  const undo = () =>
    start(async () => {
      if (!window.confirm("Undo this adjustment? Manifest posts reversing moves; the original stays in the history.")) return
      const r = await undoAction(commandId!)
      toast(r.ok ? { title: `Undone as ${r.data.number}` } : { title: "Couldn't undo", description: r.error, tone: "error" })
      router.refresh()
    })

  return (
    <div className="flex gap-2">
      {commandId && (
        <button className="btn-ghost" disabled={pending} onClick={undo}>
          Undo
        </button>
      )}
      {events
        .slice()
        .reverse()
        .map((e) => (
          <button key={e} className={LABELS[e]?.primary ? "btn-primary" : "btn-ghost"} disabled={pending} onClick={() => run(e)}>
            {LABELS[e]?.label ?? e}
          </button>
        ))}
    </div>
  )
}
