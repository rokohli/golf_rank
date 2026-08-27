import type { Router } from 'expo-router'

export function openUserProfile(router: Pick<Router, 'push'>, userId: number) {
  router.push(`/user/${userId}` as never)
}
