"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { Check, X, AlertTriangle } from "lucide-react"

type Toast = {
  id: number
  title: string
  description?: string
  tone?: "success" | "error"
  action?: { label: string; onClick: () => Promise<void> | void }
}

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {})

/** Show a toast. Posting commands pass an "Undo" action, which posts a reversal. */
export const useToast = () => useContext(ToastContext)

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current
    setToasts((ts) => [...ts.slice(-2), { ...t, id }])
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const ms = toast.action ? 8000 : 4000
    const t = setTimeout(onDone, ms)
    return () => clearTimeout(t)
  }, [toast, onDone])
  const error = toast.tone === "error"

  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel-2 p-3 pr-2 shadow-2xl shadow-black/60 motion-safe:animate-[toast-in_180ms_ease-out]">
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${error ? "bg-danger/15 text-danger" : "bg-accent text-accent-ink"}`}>
        {error ? <AlertTriangle className="size-3" strokeWidth={2} /> : <Check className="size-3" strokeWidth={2.5} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-muted">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-panel disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await toast.action!.onClick()
            onDone()
          }}
        >
          {busy ? "…" : toast.action.label}
        </button>
      )}
      <button className="rounded-md p-1 text-muted hover:text-text" onClick={onDone} aria-label="Dismiss">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
