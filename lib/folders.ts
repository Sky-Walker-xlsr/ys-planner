import { ROLE_RANK, type Role } from '@/lib/types'

type FolderNode = { id: string; parent_id: string | null; name: string }

/** Ordner und alle Elternordner, soweit sichtbar */
function chain<F extends FolderNode>(folder: F, byId: Map<string, F>): F[] {
  const out: F[] = []
  const seen = new Set<string>()
  for (let f: F | undefined = folder; f && !seen.has(f.id); f = f.parent_id ? byId.get(f.parent_id) : undefined) {
    seen.add(f.id)
    out.push(f)
  }
  return out
}

/** Effektive Rolle wie folder_role(): höchste aus dem Ordner und allen Elternordnern */
export function effectiveFolderRoles(folders: FolderNode[], memberships: { folder_id: string; role: Role }[]) {
  const direct = new Map(memberships.map((m) => [m.folder_id, m.role]))
  const byId = new Map(folders.map((f) => [f.id, f]))
  const roles = new Map<string, Role>()
  for (const f of folders) {
    const best = chain(f, byId)
      .map((c) => direct.get(c.id))
      .filter((r): r is Role => !!r)
      .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0]
    if (best) roles.set(f.id, best)
  }
  return roles
}

/** Kinder pro Ordner; null = oberste Ebene (auch Ordner, deren Elternordner nicht sichtbar ist) */
export function childrenByParent<F extends FolderNode>(folders: F[]) {
  const ids = new Set(folders.map((f) => f.id))
  const map = new Map<string | null, F[]>()
  for (const f of folders) {
    const key = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null
    map.set(key, [...(map.get(key) ?? []), f])
  }
  return map
}

/** true, wenn id der Ordner root selbst ist oder darunter liegt */
export function isInSubtree(folders: FolderNode[], root: string, id: string) {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const start = byId.get(id)
  return !!start && chain(start, byId).some((f) => f.id === root)
}

/** Auswahlliste in Baum-Reihenfolge mit Pfad als Beschriftung, z. B. «Kunden / Muster AG» */
export function folderOptions(folders: FolderNode[]) {
  const tree = childrenByParent(folders)
  const out: { id: string; label: string }[] = []
  const walk = (parent: string | null, prefix: string) => {
    for (const f of tree.get(parent) ?? []) {
      const label = prefix + f.name
      out.push({ id: f.id, label })
      walk(f.id, `${label} / `)
    }
  }
  walk(null, '')
  return out
}
