import { describe, expect, it } from 'vitest'
import { childrenByParent, effectiveFolderRoles, folderOptions, isInSubtree } from './folders'

const f = (id: string, parent_id: string | null = null) => ({ id, parent_id, name: id.toUpperCase() })
const tree = [f('a'), f('b', 'a'), f('c', 'b'), f('d')]

describe('effectiveFolderRoles', () => {
  it('vererbt die Rolle an alle Unterordner', () => {
    const roles = effectiveFolderRoles(tree, [{ folder_id: 'a', role: 'editor' }])
    expect(roles.get('c')).toBe('editor')
    expect(roles.has('d')).toBe(false)
  })

  it('nimmt die höchste Rolle der Kette', () => {
    const roles = effectiveFolderRoles(tree, [{ folder_id: 'a', role: 'owner' }, { folder_id: 'b', role: 'viewer' }])
    expect(roles.get('b')).toBe('owner')
  })

  it('gibt Rechte aus einem Unterordner nicht nach oben weiter', () => {
    const roles = effectiveFolderRoles(tree, [{ folder_id: 'b', role: 'owner' }])
    expect(roles.has('a')).toBe(false)
    expect(roles.get('c')).toBe('owner')
  })

  it('hängt bei einem Zyklus nicht', () => {
    expect(effectiveFolderRoles([f('x', 'y'), f('y', 'x')], [{ folder_id: 'x', role: 'viewer' }]).get('y')).toBe('viewer')
  })
})

describe('childrenByParent', () => {
  it('zeigt Ordner mit unsichtbarem Elternordner auf oberster Ebene', () => {
    const map = childrenByParent([f('b', 'a'), f('c', 'b')])
    expect(map.get(null)?.map((x) => x.id)).toEqual(['b'])
    expect(map.get('b')?.map((x) => x.id)).toEqual(['c'])
  })
})

describe('isInSubtree', () => {
  it('erkennt den Ordner selbst und alles darunter', () => {
    expect(isInSubtree(tree, 'a', 'a')).toBe(true)
    expect(isInSubtree(tree, 'a', 'c')).toBe(true)
    expect(isInSubtree(tree, 'c', 'a')).toBe(false)
    expect(isInSubtree(tree, 'a', 'd')).toBe(false)
  })
})

describe('folderOptions', () => {
  it('listet in Baum-Reihenfolge mit Pfad', () => {
    expect(folderOptions(tree).map((o) => o.label)).toEqual(['A', 'A / B', 'A / B / C', 'D'])
  })
})
