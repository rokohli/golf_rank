export function scoreToPar(score: number | null | undefined, par: number | null | undefined) {
  if (score == null || par == null) return null
  const difference = score - par
  return difference === 0 ? 'E' : `${difference > 0 ? '+' : ''}${difference}`
}

export function scoreAccessibilityLabel(score: number | null | undefined, par: number | null | undefined, prefix = 'Score') {
  if (score == null) return 'No score recorded'
  const difference = scoreToPar(score, par)
  if (difference == null) return `${prefix} ${score}`
  if (difference === 'E') return `${prefix} ${score}, even par`
  return `${prefix} ${score}, ${Math.abs(score - par!)} ${score > par! ? 'over' : 'under'} par`
}
