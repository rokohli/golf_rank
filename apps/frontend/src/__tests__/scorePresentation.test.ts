import { scoreAccessibilityLabel, scoreToPar } from '../scorePresentation'

describe('score presentation', () => {
  it.each([
    [80, 70, '+10'],
    [70, 72, '-2'],
    [72, 72, 'E'],
  ])('formats %s against par %s as %s', (score, par, expected) => {
    expect(scoreToPar(score, par)).toBe(expected)
  })

  it('does not infer a comparison when either value is unavailable', () => {
    expect(scoreToPar(80, null)).toBeNull()
    expect(scoreAccessibilityLabel(80, null)).toBe('Score 80')
  })
})
