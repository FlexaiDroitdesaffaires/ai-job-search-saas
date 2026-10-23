import Link from "next/link"
import { redirect } from "next/navigation"
import { deleteOwnAccount } from "./actions"
import { requireUser } from "@/lib/supabase/server"
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await requireUser()
  if (!user) redirect("/login?next=/dashboard/account")
  const { error } = await searchParams
  return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12"><p className="eyebrow">Compte</p><h1 className="page-title mt-2">Données personnelles</h1><p className="mt-4 leading-7 text-slate-600">Consultez la <Link className="font-semibold text-indigo-600" href="/privacy">notice de confidentialité</Link>. La suppression retire les CV du stockage privé, les données applicatives associées et le compte d’authentification.</p><section className="surface mt-8 border-red-200 p-6"><h2 className="text-xl font-semibold text-slate-950">Supprimer définitivement mon compte</h2><p className="mt-2 text-sm leading-6 text-slate-600">Cette action est irréversible. Aucune candidature externe n’est envoyée.</p>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}<form action={deleteOwnAccount} className="mt-6 space-y-4"><label className="block space-y-2 text-sm font-medium"><span>Mot de passe actuel</span><input className="field" name="password" required type="password" /></label><label className="block space-y-2 text-sm font-medium"><span>Saisissez SUPPRIMER</span><input autoComplete="off" className="field" name="confirmation" pattern="SUPPRIMER" required /></label><button className="rounded-xl bg-red-700 px-5 py-3 text-sm font-semibold text-white hover:bg-red-800" type="submit">Supprimer mon compte</button></form></section></main>
}
