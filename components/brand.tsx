import Link from "next/link"
import { Sparkles } from "lucide-react"

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link aria-label="Aply — accueil" className="inline-flex items-center gap-2.5 font-semibold tracking-tight text-slate-950" href="/">
      <span className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm"><Sparkles className="size-4" /></span>
      {!compact && <span className="text-lg">Aply</span>}
    </Link>
  )
}
