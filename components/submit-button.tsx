"use client"

import { useFormStatus } from "react-dom"

export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  disabled = false,
}: {
  children: React.ReactNode
  pendingLabel?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <button
      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      disabled={pending || disabled}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
