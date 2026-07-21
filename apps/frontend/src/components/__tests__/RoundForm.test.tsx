import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { RoundForm, parseDateInput } from '../RoundForm'

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

const course = {
  id: 7, name: 'Test Links', region: 'Monterey, CA', green_fee: 175,
  difficulty: 'challenging', is_public: true,
}

describe('RoundForm', () => {
  it('validates calendar dates rather than accepting normalized invalid dates', () => {
    expect(parseDateInput('02/29/2024')).toBe('2024-02-29')
    expect(parseDateInput('02/29/2025')).toBeNull()
  })

  it('submits a distinct visit with optional round details', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    render(<RoundForm
      friends={[
        { id: 1, display_name: 'Alex Rivera', username: 'alex' },
        { id: 2, display_name: 'Maya Patel', username: 'maya' },
        { id: 3, display_name: 'Chris Lee', username: 'chris' },
        { id: 4, display_name: 'Jordan Kim', username: 'jordan' },
        { id: 5, display_name: 'Sam Park', username: 'sam' },
      ]}
      initialCourse={course}
      onSubmit={onSubmit}
      searchCourses={jest.fn()}
      submitLabel="Log round"
    />)

    fireEvent.changeText(screen.getByLabelText('Played date'), '07/17/2026')
    fireEvent.changeText(screen.getByLabelText('Score'), '84')
    fireEvent.press(screen.getByRole('button', { name: 'Favorite hole & notes' }))
    fireEvent.changeText(screen.getByLabelText('Favorite hole'), '7')
    fireEvent.changeText(screen.getByLabelText('Round notes'), 'Fast greens')
    fireEvent.press(screen.getByRole('button', { name: 'Played with' }))
    fireEvent.changeText(screen.getByLabelText('Search friends'), 'Sam')
    fireEvent.press(screen.getByRole('button', { name: 'Add Sam Park' }))
    fireEvent(screen.getByLabelText('Favorite round'), 'valueChange', true)
    fireEvent.press(screen.getByRole('button', { name: 'Log round' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      course_id: 7,
      played_on: '2026-07-17',
      score: 84,
      favorite_hole: 7,
      note: 'Fast greens',
      friend_user_ids: [5],
      guest_names: [],
      is_favorite: true,
    })))
  })

  it('removes optional copy from edit fields and keeps the course fixed', () => {
    render(<RoundForm
      friends={[]}
      initialRound={{
        id: 42, course, played_on: '2026-07-17', score: null, note: null,
        favorite_hole: null, companions: [], visibility: 'friends', is_favorite: false,
        is_rating_round: false, created_at: '2026-07-17T12:00:00Z', updated_at: '2026-07-17T12:00:00Z',
      }}
      onSubmit={jest.fn()}
      searchCourses={jest.fn()}
      submitLabel="Save changes"
    />)

    expect(screen.getByText('Score')).toBeOnTheScreen()
    expect(screen.getByText('Favorite hole & notes')).toBeOnTheScreen()
    expect(screen.getByText('Played with')).toBeOnTheScreen()
    expect(screen.getByText('Visibility')).toBeOnTheScreen()
    expect(screen.queryByText(/optional/)).toBeNull()
    expect(screen.queryByLabelText('Search courses')).toBeNull()
    expect(screen.queryByLabelText('Guest names')).toBeNull()
  })

  it('uses the saved visibility default for a new round', () => {
    render(<RoundForm
      defaultVisibility="private"
      friends={[]}
      initialCourse={course}
      onSubmit={jest.fn()}
      searchCourses={jest.fn()}
      submitLabel="Log round"
    />)

    fireEvent.press(screen.getByRole('button', { name: 'Visibility' }))
    const selectedPrivate = screen.getAllByRole('button', { name: 'Private' }).find((button) => button.props.accessibilityState?.selected)
    expect(selectedPrivate?.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }))
  })
})
