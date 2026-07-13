import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { CourseList } from '../CourseList'
import { OnboardingForm } from '../OnboardingForm'

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}))

describe('OnboardingForm', () => {
  it('guides users through the premium onboarding flow and submits mapped preferences', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const onComplete = jest.fn()

    render(<OnboardingForm submit={submit} onComplete={onComplete} />)

    expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()

    fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
    fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
    fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText("What's your home course?")).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Home course'), 'Pasatiempo')
    fireEvent.press(screen.getByRole('button', { name: 'Pasatiempo Golf Club Santa Cruz, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.press(screen.getByRole('button', { name: 'Pebble Beach Golf Links Monterey, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Spyglass Hill Golf Course Pebble Beach, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with 2 selected' }))

    fireEvent.press(screen.getByRole('button', { name: /Choose Pebble Beach Golf Links/ }))
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
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
    fireEvent.press(screen.getByRole('button', { name: 'Explore Home' }))

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
          home_course_id: 'pasatiempo',
          played_course_ids: ['pebble', 'spyglass'],
          favorite_wins: ['pebble'],
          preferences: ['Scenic views', 'Public courses'],
          group_size: 'Foursome',
          budget: '$$$',
          transportation: 'Cart',
          notifications: false,
        }),
      })
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
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
