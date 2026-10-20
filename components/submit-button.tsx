"use client"

import { useFormStatus } from "react-dom"

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
}: {
  children: React.ReactNode
  pendingLabel?: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
