import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { RatingFlow, RatingFlowProps } from '../RatingFlow'
import { CourseRatingState } from '../../types'

jest.mock('expo-contacts', () => ({
  presentContactPickerAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}))
jest.mock('expo-sms', () => ({
  isAvailableAsync: jest.fn(),
  sendSMSAsync: jest.fn(),
}))

const course = {
  id: 1,
  name: 'Pebble Beach Golf Links',
  region: 'Monterey, CA',
  green_fee: 675,
  difficulty: 'championship',
  is_public: true,
}

const emptyRating: CourseRatingState = {
  course,
  personal_rating: null,
  tier: null,
  confidence: null,
  community_rating: null,
  rating_count: 0,
  round: null,
  companions: [],
}

const existingRating: CourseRatingState = {
  ...emptyRating,
  personal_rating: 9.2,
  tier: 'green',
  confidence: 0.7,
  round: {
    id: 4,
    played_on: '2026-07-10',
    score: 81,
    note: 'Fast greens',
    favorite_hole: 7,
    visibility: 'private',
  },
  companions: [{ friend_user_id: 22, guest_name: null }],
}

function props(overrides: Partial<RatingFlowProps> = {}): RatingFlowProps {
  return {
    course,
    initialRating: emptyRating,
    friends: [{ id: 22, display_name: 'Morgan Golfer', username: 'morgan' }],
    getCandidate: jest.fn().mockResolvedValue({ ...course, id: 2, name: 'Spyglass Hill' }),
    saveRating: jest.fn().mockResolvedValue({ ...existingRating, personal_rating: 9.1 }),
    saveDetails: jest.fn().mockResolvedValue(existingRating),
    onClose: jest.fn(),
    today: '2026-07-14',
    ...overrides,
  }
}

async function chooseTierAndOpenRound(tier = 'Green 8.5–10') {
  fireEvent.press(screen.getByRole('button', { name: tier }))
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('About the round')
}

async function openExistingRound() {
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('About the round')
}

describe('RatingFlow', () => {
  it('uses the approved tier and round layout and captures optional round inputs', async () => {
    const inputProps = props({ getCandidate: jest.fn().mockResolvedValue(null) })
    render(<RatingFlow {...inputProps} />)

    expect(screen.getByText('Where does it sit?')).toBeOnTheScreen()
    expect(screen.queryByText(/step\s+\d/i)).not.toBeOnTheScreen()
    await chooseTierAndOpenRound()
    expect(screen.getByText('Jul 14, 2026')).toBeOnTheScreen()

    fireEvent.press(screen.getByRole('button', { name: 'Played' }))
    expect(screen.getByRole('button', { name: 'Played' }).props.accessibilityState).toMatchObject({ expanded: true })
    expect(screen.getByLabelText('Date played')).toHaveDisplayValue('07/14/2026')
    fireEvent.changeText(screen.getByLabelText('Date played'), '07/12/2026')
    fireEvent.press(screen.getByRole('button', { name: 'Score' }))
    expect(screen.getByRole('button', { name: 'Played' }).props.accessibilityState).toMatchObject({ expanded: false })
    expect(screen.getByRole('button', { name: 'Score' }).props.accessibilityState).toMatchObject({ expanded: true })
    expect(screen.getByLabelText('Golf score').props.placeholder).toBe('e.g. 82')
    fireEvent.changeText(screen.getByLabelText('Golf score'), '82')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledWith({
      tier: 'green', played_on: '2026-07-12', score: 82,
    }))
    expect(await screen.findByLabelText('Your rating is 9.1 out of 10')).toBeOnTheScreen()
  })

  it.each([
    ['Pebble Beach Golf Links', 'course_a'],
    ['Spyglass Hill', 'course_b'],
    ['Too close', 'too_close'],
  ] as const)('saves immediately when the user chooses %s', async (label, result) => {
    const inputProps = props()
    render(<RatingFlow {...inputProps} />)
    await chooseTierAndOpenRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Which would you play again?')).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Save rating' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Not sure' })).toBeNull()

    fireEvent.press(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledWith(expect.objectContaining({
      comparison_course_id: 2, comparison_result: result,
    })))
    expect(await screen.findByLabelText('Your rating is 9.1 out of 10')).toBeOnTheScreen()
  })

  it('keeps the comparison available after a save failure and retries on the same choice', async () => {
    const saveRating = jest.fn()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ ...existingRating, personal_rating: 8.9 })
    render(<RatingFlow {...props({ saveRating })} />)
    await chooseTierAndOpenRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Too close' }))

    expect(await screen.findByText('Network unavailable')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Too close' }))
    await waitFor(() => expect(saveRating).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText('Your rating is 8.9 out of 10')).toBeOnTheScreen()
  })

  it('clears the old candidate when the user returns and chooses a new tier', async () => {
    const getCandidate = jest.fn()
      .mockResolvedValueOnce({ ...course, id: 2, name: 'Spyglass Hill' })
      .mockResolvedValueOnce({ ...course, id: 3, name: 'Pasatiempo Golf Club' })
    const inputProps = props({ getCandidate })
    render(<RatingFlow {...inputProps} />)

    await chooseTierAndOpenRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.press(screen.getByRole('button', { name: 'Fairway 7–8.4' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    expect(screen.queryByText('Spyglass Hill')).toBeNull()
    fireEvent.press(screen.getByRole('button', { name: 'Pasatiempo Golf Club' }))
    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'fairway', comparison_course_id: 3, comparison_result: 'course_b',
    })))
  })

  it('does not resave unchanged rating data after returning from the reveal', async () => {
    const inputProps = props()
    render(<RatingFlow {...inputProps} />)
    await chooseTierAndOpenRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Too close' }))
    await screen.findByLabelText('Your rating is 9.1 out of 10')

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Your rating is 9.1 out of 10')

    expect(inputProps.getCandidate).toHaveBeenCalledTimes(1)
    expect(inputProps.saveRating).toHaveBeenCalledTimes(1)
  })

  it('keeps only the date summary visible and saves edited details before reveal', async () => {
    const inputProps = props({ initialRating: existingRating })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    expect(screen.getByText('Jul 10, 2026')).toBeOnTheScreen()
    expect(screen.queryByText('Fast greens')).toBeNull()
    fireEvent.press(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByLabelText('Notes (optional)')).toHaveDisplayValue('Fast greens')
    fireEvent.changeText(screen.getByLabelText('Notes (optional)'), 'Perfect sunset round')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ note: 'Perfect sunset round' })))
    expect(inputProps.saveRating).not.toHaveBeenCalled()
    expect(await screen.findByLabelText('Your rating is 9.2 out of 10')).toBeOnTheScreen()
  })

  it('saves collected round details after a new rating and before showing the reveal', async () => {
    const inputProps = props()
    render(<RatingFlow {...inputProps} />)
    await chooseTierAndOpenRound()
    fireEvent.press(screen.getByRole('button', { name: 'Notes' }))
    fireEvent.changeText(screen.getByLabelText('Notes (optional)'), 'Windy back nine')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Pebble Beach Golf Links' }))

    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ note: 'Windy back nine' })))
    expect(await screen.findByLabelText('Your rating is 9.2 out of 10')).toBeOnTheScreen()
  })

  it('shows the photos placeholder and saves selected existing friends from About the round', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))
    expect(screen.getByText('Photo upload is coming soon.')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Who joined' }))
    fireEvent.press(screen.getByRole('button', { name: 'Select Morgan Golfer' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ friend_user_ids: [22] })))
  })

  it('handles Android contacts permission denial without opening the picker', async () => {
    const contacts = { requestPermission: jest.fn().mockResolvedValue('denied' as const), pickContact: jest.fn() }
    render(<RatingFlow {...props({ initialRating: existingRating, contacts, platform: 'android' })} />)
    await openExistingRound()
    fireEvent.press(screen.getByRole('button', { name: 'Who joined' }))
    fireEvent.press(screen.getByRole('button', { name: 'Add guest' }))

    expect(await screen.findByText(/Contacts permission was denied/)).toBeOnTheScreen()
    expect(contacts.pickContact).not.toHaveBeenCalled()
  })

  it('opens SMS only after the explicit Send invite action', async () => {
    const contacts = {
      requestPermission: jest.fn().mockResolvedValue('granted' as const),
      pickContact: jest.fn().mockResolvedValue({ name: 'Alex Guest', phone: '+15551234567' }),
    }
    const sms = { isAvailable: jest.fn().mockResolvedValue(true), send: jest.fn().mockResolvedValue(undefined) }
    render(<RatingFlow {...props({ initialRating: existingRating, contacts, sms, platform: 'ios' })} />)
    await openExistingRound()
    fireEvent.press(screen.getByRole('button', { name: 'Who joined' }))
    fireEvent.press(screen.getByRole('button', { name: 'Add guest' }))

    expect(await screen.findByText('Alex Guest')).toBeOnTheScreen()
    expect(sms.isAvailable).not.toHaveBeenCalled()
    expect(sms.send).not.toHaveBeenCalled()
    fireEvent.press(screen.getByRole('button', { name: 'Send invite to Alex Guest' }))
    await waitFor(() => expect(sms.send).toHaveBeenCalledWith('+15551234567', expect.stringContaining('Pebble Beach Golf Links')))
  })
})
