export type BudgetTier = '$' | '$$' | '$$$' | '$$$$'

// max_green_fee is a single ceiling on the backend (services/api/app/plans.py
// filters with <=, and its budget score actively favors cheaper courses) — there's
// no persisted lower bound, so course discovery for any tier still surfaces cheaper
// courses too. Every tier below is the actual enforced ceiling, not a range.
export const budgetTierOptions: { tier: BudgetTier; label: string; desc: string; maxGreenFee: number }[] = [
  { tier: '$', label: 'Up to $50', desc: 'Budget-friendly & muni courses', maxGreenFee: 50 },
  { tier: '$$', label: 'Up to $100', desc: 'Quality public tracks & local favorites', maxGreenFee: 100 },
  { tier: '$$$', label: 'Up to $250', desc: 'Premium resort & championship layouts', maxGreenFee: 250 },
  { tier: '$$$$', label: '$250+', desc: 'Bucket-list destinations & world-class golf', maxGreenFee: 2000 },
]

export function maxGreenFeeForTier(tier: BudgetTier): number {
  return budgetTierOptions.find((option) => option.tier === tier)!.maxGreenFee
}

// Legacy accounts saved before onboarding_data.budget existed only have a raw
// max_green_fee — fall back to the tier whose ceiling matches it.
export function tierForMaxGreenFee(maxGreenFee: number | null | undefined): BudgetTier | null {
  if (typeof maxGreenFee !== 'number') return null
  const match = budgetTierOptions.find((option) => option.maxGreenFee === maxGreenFee)
  return match?.tier ?? null
}
