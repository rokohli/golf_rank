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

async function chooseTierAndRound(tier = 'Green 8.5–10') {
  fireEvent.press(screen.getByRole('button', { name: tier }))
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('When did you play?')
}

async function openExistingDetails() {
  fireEvent.press(screen.getByRole('button', { name: 'Green 8.5–10' }))
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByText('Your rating')
  fireEvent.press(screen.getByRole('button', { name: 'Add round details' }))
  await screen.findByText('Remember the round')
}

describe('RatingFlow', () => {
  it('has no visible step counter and captures a tier plus optional round inputs', async () => {
    const inputProps = props({ getCandidate: jest.fn().mockResolvedValue(null) })
    render(<RatingFlow {...inputProps} />)

    expect(screen.queryByText(/step\s+\d/i)).not.toBeOnTheScreen()
    await chooseTierAndRound()
    expect(screen.getByLabelText('Date played')).toHaveDisplayValue('2026-07-14')
    fireEvent.changeText(screen.getByLabelText('Date played'), '2026-07-12')
    fireEvent.changeText(screen.getByLabelText('Golf score (optional)'), '82')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledWith({
      tier: 'green', played_on: '2026-07-12', score: 82,
    }))
  })

  it.each([
    ['Too close', 'too_close'],
    ['Not sure', 'not_sure'],
  ] as const)('saves the single comparison choice %s and reveals a /10 rating', async (label, result) => {
    const inputProps = props()
    render(<RatingFlow {...inputProps} />)
    await chooseTierAndRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Spyglass Hill')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: label }))
    fireEvent.press(screen.getByRole('button', { name: 'Save rating' }))

    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledWith(expect.objectContaining({
      comparison_course_id: 2, comparison_result: result,
    })))
    expect(await screen.findByText('/10')).toBeOnTheScreen()
  })

  it('retains comparison state after a save failure and retries it', async () => {
    const saveRating = jest.fn()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ ...existingRating, personal_rating: 8.9 })
    render(<RatingFlow {...props({ saveRating })} />)
    await chooseTierAndRound()
    fireEvent.changeText(screen.getByLabelText('Golf score (optional)'), '84')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Too close' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save rating' }))

    expect(await screen.findByText('Network unavailable')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Too close' }).props.accessibilityState).toMatchObject({ selected: true })
    fireEvent.press(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(saveRating).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('/10')).toBeOnTheScreen()
  })

  it('clears the old comparison answer and candidate when starting a new tier path', async () => {
    const secondCandidate = { ...course, id: 3, name: 'Pasatiempo Golf Club' }
    const getCandidate = jest.fn()
      .mockResolvedValueOnce({ ...course, id: 2, name: 'Spyglass Hill' })
      .mockResolvedValueOnce(secondCandidate)
    const inputProps = props({ getCandidate })
    render(<RatingFlow {...inputProps} />)

    await chooseTierAndRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Prefer this course' }))
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.press(screen.getByRole('button', { name: 'Fairway 7–8.4' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Pasatiempo Golf Club')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Save rating' }).props.accessibilityState).toMatchObject({ disabled: true })
    fireEvent.press(screen.getByRole('button', { name: 'Not sure' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save rating' }))
    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledWith(expect.objectContaining({
      tier: 'fairway', comparison_course_id: 3, comparison_result: 'not_sure',
    })))
  })

  it('advances the unchanged-core baseline after save and does not save again after reveal Back', async () => {
    const inputProps = props()
    render(<RatingFlow {...inputProps} />)
    await chooseTierAndRound()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Too close' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save rating' }))
    await screen.findByText('Your rating')

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Your rating')

    expect(inputProps.getCandidate).toHaveBeenCalledTimes(1)
    expect(inputProps.saveRating).toHaveBeenCalledTimes(1)
  })

  it('prefills an edit and saves details without resaving unchanged core fields', async () => {
    const inputProps = props({ initialRating: existingRating })
    render(<RatingFlow {...inputProps} />)

    expect(screen.getByRole('button', { name: 'Green 8.5–10' }).props.accessibilityState).toMatchObject({ selected: true })
    await openExistingDetails()
    expect(screen.getByLabelText('Notes (optional)')).toHaveDisplayValue('Fast greens')
    fireEvent.changeText(screen.getByLabelText('Notes (optional)'), 'Perfect sunset round')
    fireEvent.press(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ note: 'Perfect sunset round' })))
    expect(inputProps.saveRating).not.toHaveBeenCalled()
  })

  it('shows photo Coming soon and saves selected existing friends', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    render(<RatingFlow {...inputProps} />)
    await openExistingDetails()

    fireEvent.press(screen.getByRole('button', { name: 'Add a photo, Coming soon' }))
    expect(screen.getByText('Photo upload is Coming soon.')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Select Morgan Golfer' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ friend_user_ids: [22] })))
  })

  it('handles Android contacts permission denial without opening the picker', async () => {
    const contacts = { requestPermission: jest.fn().mockResolvedValue('denied' as const), pickContact: jest.fn() }
    render(<RatingFlow {...props({ initialRating: existingRating, contacts, platform: 'android' })} />)
    await openExistingDetails()
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
    await openExistingDetails()
    fireEvent.press(screen.getByRole('button', { name: 'Add guest' }))

    expect(await screen.findByText('Alex Guest')).toBeOnTheScreen()
    expect(sms.isAvailable).not.toHaveBeenCalled()
    expect(sms.send).not.toHaveBeenCalled()
    fireEvent.press(screen.getByRole('button', { name: 'Send invite to Alex Guest' }))
    await waitFor(() => expect(sms.send).toHaveBeenCalledWith('+15551234567', expect.stringContaining('Pebble Beach Golf Links')))
  })
})
