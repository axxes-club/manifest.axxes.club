"use client"

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
      Print or save PDF
    </button>
  )
}
