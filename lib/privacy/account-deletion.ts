import type { SupabaseClient } from "@supabase/supabase-js"

async function listResumeObjects(admin: SupabaseClient, userId: string) {
  const paths: string[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from("resumes").list(userId, { limit: 100, offset })
    if (error) throw new Error("Unable to enumerate account files")
    for (const item of data ?? []) if (item.id) paths.push(`${userId}/${item.name}`)
    if (!data || data.length < 100) break
  }
  return paths
}

export async function deleteAccountCompletely(admin: SupabaseClient, userId: string) {
  const files = await listResumeObjects(admin, userId)
  if (files.length) {
    const { error } = await admin.storage.from("resumes").remove(files)
    if (error) throw new Error("Unable to delete account files")
  }
  const { error: authError } = await admin.auth.admin.deleteUser(userId)
  if (authError) throw new Error("Unable to delete account")
  const [auth, profile, resumes, applications, remainingFiles] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("id", userId),
    admin.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("applications").select("id", { count: "exact", head: true }).eq("user_id", userId),
    listResumeObjects(admin, userId),
  ])
  if (!(auth.error && profile.count === 0 && resumes.count === 0 && applications.count === 0 && remainingFiles.length === 0)) throw new Error("Account deletion could not be verified")
  return { deletedFiles: files.length, verified: true as const }
}
