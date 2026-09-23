import { render, screen } from '@testing-library/react-native'

import {
  CourseCardSkeleton,
  CourseDetailSkeleton,
  CourseRowSkeleton,
  FeedActivitySkeleton,
  ProfileStatsSkeleton,
  RecentRoundSkeleton,
  SkeletonBox,
  SkeletonCircle,
  SkeletonLine,
  SkeletonPulse,
} from '../Skeleton'

describe('Skeleton components', () => {
  it('renders SkeletonBox with custom styles and accessibility label', () => {
    render(<SkeletonBox width={100} height={20} borderRadius={8} accessibilityLabel="Loading box" />)
    const element = screen.getByLabelText('Loading box')
    expect(element).toBeOnTheScreen()
  })

  it('renders SkeletonCircle and SkeletonLine', () => {
    render(
      <>
        <SkeletonCircle size={44} accessibilityLabel="Loading avatar" />
        <SkeletonLine width="80%" height={16} accessibilityLabel="Loading text line" />
      </>
    )
    expect(screen.getByLabelText('Loading avatar')).toBeOnTheScreen()
    expect(screen.getByLabelText('Loading text line')).toBeOnTheScreen()
  })

  it('renders SkeletonPulse with accessibility label', () => {
    render(
      <SkeletonPulse accessibilityLabel="Pulse container">
        <SkeletonBox width={50} height={50} />
      </SkeletonPulse>
    )
    expect(screen.getByLabelText('Pulse container')).toBeOnTheScreen()
  })

  it('renders CourseCardSkeleton in standard and compact variants', () => {
    const { rerender } = render(<CourseCardSkeleton />)
    expect(screen.toJSON()).toBeTruthy()

    rerender(<CourseCardSkeleton compact />)
    expect(screen.toJSON()).toBeTruthy()
  })

  it('renders CourseRowSkeleton with and without index', () => {
    const { rerender } = render(<CourseRowSkeleton />)
    expect(screen.toJSON()).toBeTruthy()

    rerender(<CourseRowSkeleton hasIndex />)
    expect(screen.toJSON()).toBeTruthy()
  })

  it('renders FeedActivitySkeleton with accessibility label', () => {
    render(<FeedActivitySkeleton />)
    expect(screen.getByLabelText('Loading friends activity')).toBeOnTheScreen()
  })

  it('renders ProfileStatsSkeleton and RecentRoundSkeleton', () => {
    render(
      <>
        <ProfileStatsSkeleton />
        <RecentRoundSkeleton />
      </>
    )
    expect(screen.toJSON()).toBeTruthy()
  })

  it('renders CourseDetailSkeleton with accessibility label and custom inset', () => {
    render(<CourseDetailSkeleton topInset={44} />)
    expect(screen.getByLabelText('Loading course')).toBeOnTheScreen()
  })

  it('renders SkeletonBox with explicit opacity without crashing or animating', () => {
    render(
      <SkeletonBox
        width={14}
        height={14}
        borderRadius={7}
        style={{ opacity: 0.3 }}
        accessibilityLabel="Trailing placeholder"
      />
    )
    const element = screen.getByLabelText('Trailing placeholder')
    expect(element).toBeOnTheScreen()
    expect(element.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ opacity: 0.3 }),
      ])
    )
  })

  it('renders nested SkeletonPulse and child SkeletonBox without issues', () => {
    render(
      <SkeletonPulse accessibilityLabel="Outer pulse">
        <SkeletonBox width={100} height={20} accessibilityLabel="Box in pulse" />
        <SkeletonPulse accessibilityLabel="Inner pulse">
          <SkeletonBox width={50} height={10} accessibilityLabel="Box in nested pulse" />
          <SkeletonBox width={14} height={14} style={{ opacity: 0.3 }} accessibilityLabel="Faded box in nested pulse" />
        </SkeletonPulse>
      </SkeletonPulse>
    )
    expect(screen.getByLabelText('Outer pulse')).toBeOnTheScreen()
    expect(screen.getByLabelText('Inner pulse')).toBeOnTheScreen()
    expect(screen.getByLabelText('Box in pulse')).toBeOnTheScreen()
    expect(screen.getByLabelText('Box in nested pulse')).toBeOnTheScreen()
    expect(screen.getByLabelText('Faded box in nested pulse')).toBeOnTheScreen()
  })
})
