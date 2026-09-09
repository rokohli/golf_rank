import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import { ApiResponseError } from '../../api/client'
import { RatingFlow, RatingFlowProps } from '../RatingFlow'
import { CourseRatingState } from '../../types'

const mockLaunchImageLibraryAsync = jest.fn()
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
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
    photos: [],
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
    startPhotoUpload: jest.fn().mockResolvedValue({ storageKey: 'course-photos/1/staged.jpg' }),
    confirmPhotoUpload: jest.fn().mockResolvedValue({ id: 99, source_type: 'user' }),
    discardPhotoUpload: jest.fn().mockResolvedValue(undefined),
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

  it('shares a new rating with friends by default', async () => {
    render(<RatingFlow {...props({ getCandidate: jest.fn().mockResolvedValue(null) })} />)
    await chooseTierAndOpenRound()

    fireEvent.press(screen.getByRole('button', { name: 'Friends' }))
    expect(screen.getByLabelText('Share with friends').props.value).toBe(true)
  })

  it('respects an existing private round instead of overriding it with the new-rating default', async () => {
    render(<RatingFlow {...props({ initialRating: existingRating })} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Friends' }))
    expect(screen.getByLabelText('Share with friends').props.value).toBe(false)
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
    expect(screen.getByLabelText('Pebble Beach Golf Links image unavailable')).toBeOnTheScreen()
    expect(screen.getByLabelText('Spyglass Hill image unavailable')).toBeOnTheScreen()

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
    expect(screen.getByLabelText('Round notes')).toHaveDisplayValue('Fast greens')
    fireEvent.changeText(screen.getByLabelText('Round notes'), 'Perfect sunset round')
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
    fireEvent.changeText(screen.getByLabelText('Round notes'), 'Windy back nine')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Spyglass Hill')
    fireEvent.press(screen.getByRole('button', { name: 'Pebble Beach Golf Links' }))

    await waitFor(() => expect(inputProps.saveRating).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ note: 'Windy back nine' })))
    expect(await screen.findByLabelText('Your rating is 9.2 out of 10')).toBeOnTheScreen()
  })

  it('saves selected existing friends from About the round', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.press(screen.getByRole('button', { name: 'Select Morgan Golfer' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(inputProps.saveDetails).toHaveBeenCalledWith(expect.objectContaining({ friend_user_ids: [22] })))
  })

  it('stages a picked photo immediately and confirms it once Continue is pressed', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg', width: 1600, height: 1200 }],
    })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))

    await waitFor(() => expect(inputProps.startPhotoUpload).toHaveBeenCalledWith('file:///picked-photo.jpg', 'image/jpeg'))
    expect(await screen.findByText('1 photo added')).toBeOnTheScreen()
    expect(inputProps.confirmPhotoUpload).not.toHaveBeenCalled()

    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(inputProps.confirmPhotoUpload).toHaveBeenCalledWith(
      'course-photos/1/staged.jpg', 4, { width: 1600, height: 1200 },
    ))
  })

  it('drops a photo the server rejected instead of offering to retry it', async () => {
    // confirm_upload deletes the R2 object before responding to a validation
    // rejection (bad type/size, round mismatch, cap exceeded) -- retrying
    // the same storage_key can only ever fail the same way again.
    const inputProps = props({
      initialRating: { ...existingRating, companions: [] },
      confirmPhotoUpload: jest.fn().mockRejectedValue(new ApiResponseError('Unsupported content type', 422)),
    })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg' }],
    })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))
    await screen.findByText('1 photo added')

    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(inputProps.confirmPhotoUpload).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Your round was saved, but one or more photos could not be attached.')).toBeOnTheScreen()
    expect(screen.queryByText(/you can try again/i)).not.toBeOnTheScreen()
  })

  it('keeps a photo staged for retry when confirmation fails for a transient reason', async () => {
    const inputProps = props({
      initialRating: { ...existingRating, companions: [] },
      confirmPhotoUpload: jest.fn().mockRejectedValue(new ApiResponseError('Too many requests', 429)),
    })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg' }],
    })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))
    await screen.findByText('1 photo added')

    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(inputProps.confirmPhotoUpload).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Your round was saved, but one or more photos could not be attached. You can try again.')).toBeOnTheScreen()
  })

  it('discards staged uploads on unmount even if the flow was dismissed without the close controls', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg' }],
    })
    const view = render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))
    await screen.findByText('1 photo added')

    view.unmount()

    await waitFor(() => expect(inputProps.discardPhotoUpload).toHaveBeenCalledWith('course-photos/1/staged.jpg'))
  })

  it('lets the user remove a staged photo before it is confirmed', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg' }],
    })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))
    await screen.findByText('1 photo added')

    fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }))

    expect(screen.queryByText('1 photo added')).not.toBeOnTheScreen()
    await waitFor(() => expect(inputProps.discardPhotoUpload).toHaveBeenCalledWith('course-photos/1/staged.jpg'))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(inputProps.confirmPhotoUpload).not.toHaveBeenCalled())
  })

  it('discards the upload once it lands if the photo was removed while still uploading', async () => {
    const inputProps = props({ initialRating: { ...existingRating, companions: [] } })
    let resolveUpload: (value: { storageKey: string }) => void = () => {}
    inputProps.startPhotoUpload = jest.fn().mockReturnValue(new Promise((resolve) => { resolveUpload = resolve }))
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg' }],
    })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))
    await screen.findByText('Uploading…')

    fireEvent.press(screen.getByRole('button', { name: 'Remove photo' }))
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()

    resolveUpload({ storageKey: 'course-photos/1/late.jpg' })

    await waitFor(() => expect(inputProps.discardPhotoUpload).toHaveBeenCalledWith('course-photos/1/late.jpg'))
    expect(screen.queryByText('1 photo added')).not.toBeOnTheScreen()
  })

  it('shows a retry-able error when the round photo upload fails', async () => {
    const inputProps = props({
      initialRating: { ...existingRating, companions: [] },
      startPhotoUpload: jest.fn().mockRejectedValue(new Error('Too many requests')),
    })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg', mimeType: 'image/jpeg' }],
    })
    render(<RatingFlow {...inputProps} />)
    await openExistingRound()

    fireEvent.press(screen.getByRole('button', { name: 'Photos' }))

    expect(await screen.findByText('Too many requests')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Photos' })).toBeOnTheScreen()
  })

  it('shows a compact friend list and searches additional friends without guest controls', async () => {
    const friends = [
      { id: 22, display_name: 'Morgan Golfer', username: 'morgan' },
      { id: 23, display_name: 'Maya Patel', username: 'maya' },
      { id: 24, display_name: 'Chris Lee', username: 'chris' },
      { id: 25, display_name: 'Jordan Kim', username: 'jordan' },
      { id: 26, display_name: 'Sam Park', username: 'sam' },
    ]
    render(<RatingFlow {...props({ initialRating: { ...existingRating, companions: [] }, friends })} />)
    await openExistingRound()
    fireEvent.press(screen.getByRole('button', { name: 'Friends' }))
    expect(screen.queryByRole('button', { name: 'Select Sam Park' })).toBeNull()
    fireEvent.changeText(screen.getByLabelText('Search friends'), 'Sam')
    fireEvent.press(screen.getByRole('button', { name: 'Select Sam Park' }))
    expect(screen.queryByRole('button', { name: 'Add guest' })).toBeNull()
  })

  it('shows a score range error when score is below 20 or above 200 without mentioning date', async () => {
    render(<RatingFlow {...props({ getCandidate: jest.fn().mockResolvedValue(null) })} />)
    await chooseTierAndOpenRound()

    fireEvent.press(screen.getByRole('button', { name: 'Score' }))
    fireEvent.changeText(screen.getByLabelText('Golf score'), '19')

    expect(screen.getByText('Enter a score from 20 to 200.')).toBeOnTheScreen()
    expect(screen.queryByText(/Enter a valid date/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState).toMatchObject({ disabled: true })

    fireEvent.changeText(screen.getByLabelText('Golf score'), '201')
    expect(screen.getByText('Enter a score from 20 to 200.')).toBeOnTheScreen()
    expect(screen.queryByText(/Enter a valid date/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState).toMatchObject({ disabled: true })
  })

  it('accepts boundary scores 20 and 200 without error', async () => {
    render(<RatingFlow {...props({ getCandidate: jest.fn().mockResolvedValue(null) })} />)
    await chooseTierAndOpenRound()

    fireEvent.press(screen.getByRole('button', { name: 'Score' }))
    fireEvent.changeText(screen.getByLabelText('Golf score'), '20')
    expect(screen.queryByText('Enter a score from 20 to 200.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState?.disabled).toBeFalsy()

    fireEvent.changeText(screen.getByLabelText('Golf score'), '200')
    expect(screen.queryByText('Enter a score from 20 to 200.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState?.disabled).toBeFalsy()
  })

  it('shows date error without mentioning score when date is invalid', async () => {
    render(<RatingFlow {...props({ getCandidate: jest.fn().mockResolvedValue(null) })} />)
    await chooseTierAndOpenRound()

    fireEvent.press(screen.getByRole('button', { name: 'Played' }))
    fireEvent.changeText(screen.getByLabelText('Date played'), '99/99/2026')

    expect(screen.getByText('Enter a valid date in MM/DD/YYYY (not in the future).')).toBeOnTheScreen()
    expect(screen.queryByText('Enter a score from 20 to 200.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' }).props.accessibilityState).toMatchObject({ disabled: true })
  })
})
