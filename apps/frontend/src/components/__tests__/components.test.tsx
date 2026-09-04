import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'

import { CourseList } from '../CourseList'
import { OnboardingForm } from '../OnboardingForm'
import { CourseCard } from '../ProductUI'
import { Course } from '../../types'

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}))

const pasatiempo: Course = {
  id: 11,
  name: 'Pasatiempo Golf Club',
  region: 'Santa Cruz, CA',
  green_fee: 410,
  difficulty: 'challenging',
  is_public: true,
  city: 'Santa Cruz',
  admin1_code: 'CA',
}

const pebble: Course = {
  id: 12,
  name: 'Pebble Beach Golf Links',
  region: 'Monterey, CA',
  green_fee: 675,
  difficulty: 'challenging',
  is_public: true,
  city: 'Monterey',
  admin1_code: 'CA',
}

const spyglass: Course = {
  id: 13,
  name: 'Spyglass Hill Golf Course',
  region: 'Pebble Beach, CA',
  green_fee: 495,
  difficulty: 'challenging',
  is_public: true,
  city: 'Pebble Beach',
  admin1_code: 'CA',
}

describe('OnboardingForm', () => {
  it('guides users through catalog-backed onboarding and submits mapped preferences', async () => {
    jest.useFakeTimers()
    const submit = jest.fn().mockResolvedValue(undefined)
    const onComplete = jest.fn()
    const searchCourses = jest.fn(async (query: string) => {
      const normalized = query.toLowerCase()
      return [pasatiempo, pebble, spyglass].filter((course) => course.name.toLowerCase().includes(normalized))
    })

    render(<OnboardingForm searchCourses={searchCourses} submit={submit} onComplete={onComplete} />)

    expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()

    fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
    fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
    fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('golfrank_onboarding_draft', expect.any(String))
    })

    expect(await screen.findByText("What's your home course?")).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Home course'), 'Pas')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    await waitFor(() => expect(searchCourses).toHaveBeenCalledWith('Pas'))
    fireEvent.press(await screen.findByRole('button', { name: 'Pasatiempo Golf Club Santa Cruz, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.changeText(screen.getByLabelText('Search'), 'Peb')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    await waitFor(() => expect(searchCourses).toHaveBeenCalledWith('Peb'))
    fireEvent.press(await screen.findByRole('button', { name: 'Pebble Beach Golf Links Monterey, CA' }))

    fireEvent.changeText(screen.getByLabelText('Search'), 'Spy')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    await waitFor(() => expect(searchCourses).toHaveBeenCalledWith('Spy'))
    fireEvent.press(await screen.findByRole('button', { name: 'Spyglass Hill Golf Course Pebble Beach, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with 2 selected' }))

    fireEvent.press(screen.getByRole('button', { name: /Choose Pebble Beach Golf Links/ }))
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))

    fireEvent.press(screen.getByRole('button', { name: 'Scenic views' }))
    fireEvent.press(screen.getByRole('button', { name: 'Public courses' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.press(screen.getByRole('button', { name: 'Foursome' }))
    fireEvent.press(screen.getByRole('button', { name: '$$$' }))
    fireEvent.press(screen.getByRole('button', { name: 'Cart' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.press(screen.getByRole('button', { name: 'Go to My Profile' }))

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith({
        home_region: 'Santa Cruz, CA',
        max_green_fee: 350,
        difficulty: 'any',
        access: 'public',
        onboarding_data: expect.objectContaining({
          first_name: 'Rohan',
          last_name: 'Kohli',
          username: 'rohank',
          home_course_id: '11',
          played_course_ids: ['12', '13'],
          favorite_wins: ['12'],
          preferences: ['Scenic views', 'Public courses'],
          group_size: 'Foursome',
          budget: '$$$',
          transportation: 'Cart',
          notifications: false,
        }),
      })
      expect(onComplete).toHaveBeenCalledWith('profile')
    })

    jest.useRealTimers()
  })
})

describe('CourseList', () => {
  it('renders an empty state when no courses are available', () => {
    render(<CourseList courses={[]} />)

    expect(screen.getByText('No courses match your preferences yet.')).toBeOnTheScreen()
  })

  it('renders available courses', () => {
    render(
      <CourseList
        courses={[
          {
            id: 1,
            name: 'Pebble Beach Golf Links',
            region: 'Monterey, CA',
            green_fee: 675,
            difficulty: 'championship',
            is_public: true,
          },
        ]}
      />,
    )

    expect(screen.getByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    expect(screen.getByText('Monterey, CA · $675')).toBeOnTheScreen()
  })
})

describe('course rating presentation', () => {
  it('renders community ratings on a 10-point scale without stars', () => {
    render(<CourseCard course={{
      id: '1',
      name: 'Pebble Beach Golf Links',
      location: 'Pebble Beach, CA',
      rating: 9.7,
      reviews: '2,341',
      distance: '',
      price: '$$$$',
    }} />)

    expect(screen.getByLabelText('Community rating 9.7 out of 10')).toBeOnTheScreen()
    expect(screen.getByText('9.7/10')).toBeOnTheScreen()
    expect(screen.getByLabelText('Pebble Beach Golf Links course header')).toBeOnTheScreen()
    expect(screen.queryByText(/★/)).toBeNull()
  })
})
