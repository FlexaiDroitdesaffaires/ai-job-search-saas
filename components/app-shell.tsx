import Link from "next/link"
import { BriefcaseBusiness, Compass, FileUser, LayoutDashboard, LogOut, UserRoundCog } from "lucide-react"

import { signOut } from "@/app/auth/actions"
import { Brand } from "@/components/brand"

const items = [
  { href: "/dashboard", label: "Vue d’ensemble", icon: LayoutDashboard },
  { href: "/dashboard/jobs", label: "Découvrir", icon: Compass },
  { href: "/dashboard#applications", label: "Candidatures", icon: BriefcaseBusiness },
  { href: "/onboarding", label: "Mon profil", icon: FileUser },
  { href: "/dashboard/account", label: "Mon compte", icon: UserRoundCog },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 lg:flex lg:flex-col">
        <div className="px-2"><Brand /></div>
        <nav aria-label="Navigation principale" className="mt-10 space-y-1">
          {items.map(({ href, label, icon: Icon }) => <Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-700" href={href} key={href}><Icon className="size-4.5" />{label}</Link>)}
        </nav>
        <div className="mt-auto rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold text-slate-900">Vous gardez le contrôle</p><p className="mt-1 text-xs leading-5 text-slate-500">Aucune candidature n’est marquée envoyée sans preuve ou déclaration explicite.</p></div>
        <form action={signOut} className="mt-4"><button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><LogOut className="size-4.5" />Déconnexion</button></form>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur lg:hidden"><Brand /><form action={signOut}><button aria-label="Se déconnecter" className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600"><LogOut className="size-4" /></button></form></header>
      <div className="pb-20 lg:ml-64 lg:pb-0">{children}</div>
      <nav aria-label="Navigation mobile" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur lg:hidden">{items.map(({ href, label, icon: Icon }) => <Link className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium text-slate-500 hover:bg-indigo-50 hover:text-indigo-700" href={href} key={href}><Icon className="size-4.5" /><span className="truncate">{label}</span></Link>)}</nav>
    </div>
  )
}
