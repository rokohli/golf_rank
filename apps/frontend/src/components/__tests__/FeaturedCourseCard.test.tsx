import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { FeaturedCourseCard } from '../FeaturedCourseCard'
import { FeaturedCourse } from '../../types'

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

jest.mock('../ProductUI', () => {
  const { View } = require('react-native')
  return {
    CourseVisual: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  }
})

const baseCourse: FeaturedCourse = {
  id: 1,
  recommendation_date: '2026-09-23',
  sequence: 1,
  headline: "Today's Course Spotlight",
  rationale: 'Pasatiempo is a classic Alister MacKenzie layout great for walking.',
  match_tags: ['~15 mi away', '$410 Fee', 'Challenging', 'Walking friendly'],
  is_regional_fallback: false,
  course: {
    id: 3,
    name: 'Pasatiempo Golf Club',
    region: 'Santa Cruz, CA',
    green_fee: 410,
    difficulty: 'challenging',
    is_public: true,
  },
  distance_miles: 15.2,
  is_saved: false,
  can_dismiss: true,
}

describe('FeaturedCourseCard', () => {
  it('renders spotlight header, course name, tags, and rationale', () => {
    render(
      <FeaturedCourseCard
        featured={baseCourse}
        onOpenCourse={jest.fn()}
        onPlanTrip={jest.fn()}
        onSave={jest.fn()}
      />
    )

    expect(screen.getByText("THIS WEEK'S SPOTLIGHT")).toBeOnTheScreen()
    expect(screen.getByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    expect(screen.getByText('Santa Cruz, CA')).toBeOnTheScreen()
    expect(screen.getByText('~15 mi')).toBeOnTheScreen()
    expect(screen.getByText('$410 Fee')).toBeOnTheScreen()
    expect(screen.getByText('Walking friendly')).toBeOnTheScreen()
    expect(screen.getByText('Pasatiempo is a classic Alister MacKenzie layout great for walking.')).toBeOnTheScreen()
  })

  it('renders regional spotlight badge when fallback is true', () => {
    render(
      <FeaturedCourseCard
        featured={{ ...baseCourse, is_regional_fallback: true }}
        onOpenCourse={jest.fn()}
        onPlanTrip={jest.fn()}
        onSave={jest.fn()}
      />
    )

    expect(screen.getByText('REGIONAL SPOTLIGHT')).toBeOnTheScreen()
  })

  it('fires callbacks on button clicks', async () => {
    const onOpen = jest.fn()
    const onPlan = jest.fn()
    const onSave = jest.fn()

    render(
      <FeaturedCourseCard
        featured={baseCourse}
        onOpenCourse={onOpen}
        onPlanTrip={onPlan}
        onSave={onSave}
      />
    )

    fireEvent.press(screen.getByRole('button', { name: 'View Pasatiempo Golf Club details' }))
    expect(onOpen).toHaveBeenCalledWith(3)

    fireEvent.press(screen.getByRole('button', { name: 'Explore Pasatiempo Golf Club' }))
    expect(onOpen).toHaveBeenCalledWith(3)

    fireEvent.press(screen.getByRole('button', { name: 'Plan a trip to Pasatiempo Golf Club' }))
    expect(onPlan).toHaveBeenCalledWith(3)

    await waitFor(() => {
      fireEvent.press(screen.getByRole('button', { name: 'Save Pasatiempo Golf Club' }))
      expect(onSave).toHaveBeenCalled()
    })
  })
})
