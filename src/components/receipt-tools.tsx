"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { addLandedCostAction } from "@/lib/actions/purchasing"
import { undoAction } from "@/lib/actions/stock"
import { useToast } from "@/components/shell/toaster"

export function LandedCostForm({ receiptId, currency }: { receiptId: string; currency: string }) {
  const router = useRouter()
  const toast = useToast()
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<"value" | "quantity">("value")
  const [pending, start] = useTransition()

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await addLandedCostAction({ receiptId, description, amount, method })
          if (!r.ok) return toast({ title: "Couldn't add it", description: r.error, tone: "error" })
          toast({ title: `${description} added`, description: Number(r.data.expensed) ? `${r.data.expensed} fell on stock already gone.` : "Spread across the lines." })
          setDescription("")
          setAmount("")
          router.refresh()
        })
      }}
    >
      <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Freight, duty, customs broker…" required />
      <div className="flex gap-2">
        <input className="input tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ""))} placeholder={`Amount (${currency})`} required />
        <select className="input w-auto" value={method} onChange={(e) => setMethod(e.target.value as "value" | "quantity")} title="How to split it across lines">
          <option value="value">By value</option>
          <option value="quantity">By quantity</option>
        </select>
      </div>
      <p className="text-xs text-muted">Enter a negative amount for a refund or credit. Landed costs are final; correct one with another.</p>
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Spreading…" : "Add to receipt"}
      </button>
    </form>
  )
}

export function ReceiptUndo({ commandId }: { commandId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  return (
    <button
      className="btn-ghost"
      disabled={pending}
      onClick={() =>
        window.confirm("Undo this receipt? The stock comes back out of its bins and off the order.") &&
        start(async () => {
          const r = await undoAction(commandId)
          toast(r.ok ? { title: `Receipt undone as ${r.data.number}` } : { title: "Couldn't undo", description: r.error, tone: "error" })
          router.refresh()
        })
      }
    >
      Undo receipt
    </button>
  )
}
