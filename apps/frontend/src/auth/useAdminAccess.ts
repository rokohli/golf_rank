import { useEffect, useState } from 'react'

import { getAdminAccess } from '../api/client'
import { useAuthHeaders } from './useAuthToken'

/**
 * Whether the signed-in user may reach the moderation surface.
 *
 * This is discovery only, never enforcement. Expo Router derives routes from
 * the filesystem, so /admin/photos is deep-linkable by anyone and the bundle
 * ships to every device; the real gate is server-side, where each admin route
 * answers 404 for a non-admin. This hook only decides whether to *show* the
 * entry point, so a failed check resolves to false rather than throwing.
 */
export function useAdminAccess(): { isAdmin: boolean; loading: boolean } {
  const { getAuthHeaders } = useAuthHeaders()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const allowed = await getAdminAccess(await getAuthHeaders())
        if (active) setIsAdmin(allowed)
      } catch {
        if (active) setIsAdmin(false)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [getAuthHeaders])

  return { isAdmin, loading }
}
