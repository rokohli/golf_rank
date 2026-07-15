import { getCourseRating, getFriends } from '../api/client'
import { ApiHeaders } from '../auth/useAuthToken'

const inFlightLoads = new Map<string, ReturnType<typeof createLoad>>()

export function loadRatingBootstrap(courseId: number, headers: ApiHeaders) {
  const key = [
    courseId,
    headers.Authorization ?? '',
    headers['X-Development-Subject'] ?? '',
  ].join(':')
  const existingLoad = inFlightLoads.get(key)
  if (existingLoad) return existingLoad

  const load = createLoad(courseId, headers)
  inFlightLoads.set(key, load)
  void load.then(
    () => deleteIfCurrent(key, load),
    () => deleteIfCurrent(key, load),
  )
  return load
}

function createLoad(courseId: number, headers: ApiHeaders) {
  return Promise.all([
    getCourseRating(courseId, headers),
    getFriends(headers),
  ])
}

function deleteIfCurrent(key: string, load: ReturnType<typeof createLoad>) {
  if (inFlightLoads.get(key) === load) inFlightLoads.delete(key)
}
