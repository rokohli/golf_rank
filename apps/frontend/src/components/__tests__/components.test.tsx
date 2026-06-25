import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { CourseList } from '../CourseList'
import { OnboardingForm } from '../OnboardingForm'

describe('OnboardingForm', () => {
  it('submits the user-selected onboarding preferences', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const onComplete = jest.fn()

    render(<OnboardingForm submit={submit} onComplete={onComplete} />)

    const saveButton = screen.getByRole('button', { name: 'Save preferences' })
    expect(saveButton).toBeDisabled()

    fireEvent.changeText(screen.getByLabelText('Home region'), 'Monterey, CA')
    fireEvent.changeText(screen.getByLabelText('Maximum green fee'), '450')
    fireEvent.press(screen.getByRole('button', { name: 'Challenging' }))
    fireEvent.press(screen.getByRole('button', { name: 'Public' }))
    fireEvent.press(saveButton)

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith({
        home_region: 'Monterey, CA',
        max_green_fee: 450,
        difficulty: 'challenging',
        access: 'public',
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
            id: 'course_1',
            name: 'Pebble Beach Golf Links',
            region: 'Monterey, CA',
            green_fee: 675,
            difficulty: 'championship',
            access: 'resort',
          },
        ]}
      />,
    )

    expect(screen.getByText('Pebble Beach Golf Links')).toBeOnTheScreen()
    expect(screen.getByText('Monterey, CA · $675')).toBeOnTheScreen()
  })
})
