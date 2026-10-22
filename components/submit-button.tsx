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
      className="btn-primary"
      disabled={pending || disabled}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  )
}
