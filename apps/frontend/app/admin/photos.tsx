import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { Stack, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import {
  approveCoursePhoto,
  deleteCoursePhoto,
  getAdminCoursePhotos,
  rejectCoursePhoto,
  setCoursePhotoFeatured,
} from '../../src/api/client'
import { useAdminAccess } from '../../src/auth/useAdminAccess'
import { useAuthHeaders } from '../../src/auth/useAuthToken'
import { ProductScreen, ScreenHeader } from '../../src/components/ProductUI'
import { AdminCoursePhoto } from '../../src/types'
import { colors, radii } from '../../src/ui/theme'

const STATUSES = ['pending', 'approved', 'rejected'] as const
type Status = typeof STATUSES[number]

/**
 * The course-photo moderation queue.
 *
 * Moderation governs hero-image eligibility, not visibility: approving lets a
 * photo win the USER tier (and, since this catalog has few OFFICIAL photos,
 * usually become the course hero outright), while rejecting only makes it
 * permanently ineligible. Neither hides the photo from the course gallery --
 * only Delete removes it, along with its stored object.
 */
export default function AdminPhotos() {
  const router = useRouter()
  const { getAuthHeaders } = useAuthHeaders()
  const { isAdmin, loading: checkingAccess } = useAdminAccess()

  const [status, setStatus] = useState<Status>('pending')
  const [photos, setPhotos] = useState<AdminCoursePhoto[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [appendError, setAppendError] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const courseMutationGenRef = useRef<Map<number, number>>(new Map())
  const courseAppliedGenRef = useRef<Map<number, number>>(new Map())

  const load = useCallback(async (nextStatus: Status) => {
    const reqId = ++requestIdRef.current
    loadingMoreRef.current = false
    courseMutationGenRef.current.clear()
    courseAppliedGenRef.current.clear()
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setAppendError(null)
    setPhotos([])
    setCursor(null)
    try {
      const page = await getAdminCoursePhotos(nextStatus, null, await getAuthHeaders())
      if (reqId !== requestIdRef.current) return
      setPhotos(page.items)
      setCursor(page.next_cursor)
    } catch (reason) {
      if (reqId !== requestIdRef.current) return
      setError(reason instanceof Error ? reason.message : 'Unable to load the moderation queue.')
    } finally {
      if (reqId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [getAuthHeaders])

  useEffect(() => {
    if (isAdmin) void load(status)
  }, [isAdmin, load, status])

  const loadMore = useCallback(async () => {
    if (cursor === null || loading || loadingMoreRef.current) return
    const reqId = requestIdRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setAppendError(null)
    try {
      const page = await getAdminCoursePhotos(status, cursor, await getAuthHeaders())
      if (reqId !== requestIdRef.current) return
      setPhotos((current) => {
        const existingIds = new Set(current.map((photo) => photo.image.id))
        const newItems = page.items.filter((photo) => !existingIds.has(photo.image.id))
        return [...current, ...newItems]
      })
      setCursor(page.next_cursor)
    } catch (reason) {
      if (reqId !== requestIdRef.current) return
      setAppendError(reason instanceof Error ? reason.message : 'Unable to load more photos.')
    } finally {
      loadingMoreRef.current = false
      if (reqId === requestIdRef.current) {
        setLoadingMore(false)
      }
    }
  }, [cursor, getAuthHeaders, loading, status])

  // Every action returns the updated row, so apply it in place. A photo that no
  // longer matches the active filter drops out of the list. If featuring, clear
  // hero on any existing course photo in the list to mirror tier invariants.
  const applyResult = useCallback((updated: AdminCoursePhoto) => {
    setPhotos((current) => {
      if (updated.moderation_status !== status) {
        return current.filter((photo) => photo.image.id !== updated.image.id)
      }
      const hasNewerHero = updated.image.is_hero && current.some(
        (photo) =>
          photo.course_id === updated.course_id &&
          photo.image.id !== updated.image.id &&
          photo.image.is_hero &&
          photo.moderated_at &&
          updated.moderated_at &&
          new Date(photo.moderated_at).getTime() > new Date(updated.moderated_at).getTime()
      )
      if (hasNewerHero) {
        return current
      }
      return current.map((photo) => {
        if (photo.image.id === updated.image.id) {
          return updated
        }
        if (updated.image.is_hero && photo.course_id === updated.course_id && photo.image.is_hero) {
          return {
            ...photo,
            image: { ...photo.image, is_hero: false },
            moderation_action: 'unfeatured',
            moderated_by_username: updated.moderated_by_username,
            moderated_at: updated.moderated_at,
            moderation_reason: null,
          }
        }
        return photo
      })
    })
  }, [status])

  const run = useCallback(async (
    imageId: number,
    courseId: number,
    action: (headers: Awaited<ReturnType<typeof getAuthHeaders>>) => Promise<AdminCoursePhoto | void>,
  ) => {
    const reqId = requestIdRef.current
    const gen = (courseMutationGenRef.current.get(courseId) ?? 0) + 1
    courseMutationGenRef.current.set(courseId, gen)

    setBusyIds((prev) => new Set(prev).add(imageId))
    setError(null)
    try {
      const updated = await action(await getAuthHeaders())
      if (reqId !== requestIdRef.current) return
      const lastApplied = courseAppliedGenRef.current.get(courseId) ?? 0
      if (gen < lastApplied) {
        return
      }
      courseAppliedGenRef.current.set(courseId, gen)
      if (updated) applyResult(updated)
      else setPhotos((current) => current.filter((photo) => photo.image.id !== imageId))
    } catch (reason) {
      if (reqId !== requestIdRef.current) return
      setError(reason instanceof Error ? reason.message : 'That action did not go through.')
    } finally {
      setBusyIds((prev) => {
        if (!prev.has(imageId)) return prev
        const next = new Set(prev)
        next.delete(imageId)
        return next
      })
    }
  }, [applyResult, getAuthHeaders])

  const confirmReject = useCallback((photo: AdminCoursePhoto) => {
    Alert.alert(
      'Reject this photo?',
      'It will stay in the course gallery, but will never be chosen as the course hero.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => {
            void run(photo.image.id, photo.course_id, (headers) => rejectCoursePhoto(photo.image.id, null, headers))
          },
        },
      ],
    )
  }, [run])

  const confirmDelete = useCallback((photo: AdminCoursePhoto) => {
    Alert.alert(
      'Delete this photo permanently?',
      'It will be removed from the gallery and its stored file deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void run(photo.image.id, photo.course_id, (headers) => deleteCoursePhoto(photo.image.id, headers))
          },
        },
      ],
    )
  }, [run])

  if (checkingAccess) {
    return <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <ScreenHeader onBack={() => router.back()} title="Photo moderation" />
        <ActivityIndicator accessibilityLabel="Checking access" color={colors.pine} />
      </ProductScreen>
    </>
  }

  if (!isAdmin) {
    return <>
      <Stack.Screen options={{ headerShown: false }} />
      <ProductScreen>
        <ScreenHeader onBack={() => router.back()} title="Photo moderation" />
        <Text style={styles.empty}>This area isn&apos;t available.</Text>
      </ProductScreen>
    </>
  }

  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <ProductScreen scroll={false}>
      <ScreenHeader onBack={() => router.back()} title="Photo moderation" />

      <View style={styles.filters}>
        {STATUSES.map((value) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: status === value }}
            key={value}
            onPress={() => setStatus(value)}
            style={({ pressed }) => [styles.filter, status === value && styles.filterActive, pressed && styles.pressed]}
          >
            <Text style={[styles.filterText, status === value && styles.filterTextActive]}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator accessibilityLabel="Loading photos" color={colors.pine} /> : null}

      <FlatList
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No {status} photos.</Text> : null}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator accessibilityLabel="Loading more photos" color={colors.pine} style={styles.footerLoader} />
          ) : appendError ? (
            <View style={styles.appendErrorContainer}>
              <Text accessibilityRole="alert" style={styles.appendErrorText}>{appendError}</Text>
              <Pressable accessibilityRole="button" onPress={() => { void loadMore() }} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null
        }
        data={photos}
        keyExtractor={(photo) => String(photo.image.id)}
        onEndReached={() => { void loadMore() }}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <PhotoCard
            busy={busyIds.has(item.image.id)}
            onApprove={() => { void run(item.image.id, item.course_id, (headers) => approveCoursePhoto(item.image.id, headers)) }}
            onDelete={() => confirmDelete(item)}
            onFeature={() => {
              void run(item.image.id, item.course_id, (headers) => setCoursePhotoFeatured(item.image.id, !item.image.is_hero, headers))
            }}
            onOpenCourse={() => router.push(`/course/${item.course_id}` as never)}
            onReject={() => confirmReject(item)}
            photo={item}
          />
        )}
        style={styles.list}
      />
    </ProductScreen>
  </>
}

function getAuditActionText(photo: AdminCoursePhoto): string | null {
  const user = photo.moderated_by_username ? `@${photo.moderated_by_username}` : null
  switch (photo.moderation_action) {
    case 'featured':
      return user ? `Featured by ${user}` : 'Featured'
    case 'unfeatured':
      return user ? `Unfeatured by ${user}` : 'Unfeatured'
    case 'approved':
      return user ? `Approved by ${user}` : 'Approved'
    case 'rejected':
      return user ? `Rejected by ${user}` : 'Rejected'
    case 'auto_approved':
      return 'Approved automatically'
    default:
      if (user) return `Reviewed by ${user}`
      if (photo.moderated_at && photo.moderation_status !== 'pending') return 'Reviewed automatically'
      return null
  }
}

function PhotoCard({ busy, onApprove, onDelete, onFeature, onOpenCourse, onReject, photo }: {
  busy: boolean
  onApprove: () => void
  onDelete: () => void
  onFeature: () => void
  onOpenCourse: () => void
  onReject: () => void
  photo: AdminCoursePhoto
}) {
  const auditText = getAuditActionText(photo)

  return (
    <View style={styles.card}>
      {photo.image.url ? (
        <Image accessibilityLabel={photo.image.alt_text ?? 'Course photo'} contentFit="cover" source={{ uri: photo.image.url }} style={styles.photo} />
      ) : <View style={[styles.photo, styles.photoMissing]}><Text style={styles.meta}>No image URL</Text></View>}

      <Pressable accessibilityRole="button" onPress={onOpenCourse}>
        <Text style={styles.courseName}>{photo.course_name}</Text>
      </Pressable>

      <Text style={styles.meta}>
        {photo.image.uploaded_by_username ? `@${photo.image.uploaded_by_username}` : 'Unknown uploader'}
        {photo.image.created_at ? ` · ${new Date(photo.image.created_at).toLocaleDateString()}` : ''}
      </Text>

      <View style={styles.pills}>
        <Text style={styles.pill}>{photo.moderation_status}</Text>
        {photo.image.is_hero ? <Text style={[styles.pill, styles.pillFeatured]}>Featured</Text> : null}
      </View>

      <ScoreSummary photo={photo} />

      {auditText || photo.moderation_reason ? (
        <Text style={styles.meta}>
          {auditText && photo.moderation_reason
            ? `${auditText} · ${photo.moderation_reason}`
            : (auditText ?? photo.moderation_reason)}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {busy ? <ActivityIndicator accessibilityLabel="Applying" color={colors.pine} size="small" /> : <>
          <Action icon="check" label="Approve" onPress={onApprove} />
          <Action icon="x" label="Reject" onPress={onReject} />
          <Action icon="star" label={photo.image.is_hero ? 'Unfeature' : 'Feature'} onPress={onFeature} />
          <Action destructive icon="trash-2" label="Delete" onPress={onDelete} />
        </>}
      </View>
    </View>
  )
}

/**
 * Why a photo scored what it did -- the reason the audit columns exist. Also
 * distinguishes "not scored yet" from "deliberately not scored", so the
 * hero-locked skip doesn't read as a bug.
 */
function ScoreSummary({ photo }: { photo: AdminCoursePhoto }) {
  const score = photo.image.quality_score
  if (score === null || score === undefined) {
    if (photo.course_hero_locked) return <Text style={styles.meta}>Not scored — this course already has a featured hero.</Text>
    if (photo.is_scoring) return <Text style={styles.meta}>Scoring in progress...</Text>
    if (photo.scored_at || photo.scoring_exhausted) return <Text style={styles.meta}>Scoring failed after {photo.scoring_attempts ?? 0} attempt(s).</Text>
    return <Text style={styles.meta}>Not scored yet.</Text>
  }
  return (
    <View style={styles.score}>
      <Text style={styles.scoreValue}>{score.toFixed(0)}/10</Text>
      {(photo.quality_score_reasons ?? []).map((reason, index) => (
        <Text key={index} style={styles.reason}>• {reason}</Text>
      ))}
    </View>
  )
}

function Action({ destructive, icon, label, onPress }: {
  destructive?: boolean
  icon: keyof typeof Feather.glyphMap
  label: string
  onPress: () => void
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Feather color={destructive ? colors.error : colors.pine} name={icon} size={15} />
      <Text style={[styles.actionText, destructive && styles.actionTextDestructive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8 },
  filter: { borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  filterActive: { backgroundColor: colors.pine, borderColor: colors.pine },
  filterText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: colors.card },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, gap: 8, marginBottom: 12, padding: 12 },
  photo: { borderRadius: radii.small, height: 180, width: '100%' },
  photoMissing: { alignItems: 'center', backgroundColor: colors.line, justifyContent: 'center' },
  courseName: { color: colors.ink, fontFamily: 'Georgia', fontSize: 15 },
  meta: { color: colors.muted, fontSize: 11 },
  pills: { flexDirection: 'row', gap: 6 },
  pill: { backgroundColor: colors.line, borderRadius: radii.small, color: colors.ink, fontSize: 10, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3 },
  pillFeatured: { backgroundColor: colors.pine, color: colors.card },
  score: { gap: 2 },
  scoreValue: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  reason: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  actions: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 32 },
  action: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 32 },
  actionText: { color: colors.pine, fontSize: 12, fontWeight: '700' },
  actionTextDestructive: { color: colors.error },
  empty: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  error: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  pressed: { opacity: 0.65 },
  footerLoader: { marginVertical: 16 },
  appendErrorContainer: { alignItems: 'center', gap: 8, marginVertical: 16 },
  appendErrorText: { color: colors.error, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  retryButton: { borderColor: colors.line, borderRadius: radii.small, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  list: { flex: 1 },
})
