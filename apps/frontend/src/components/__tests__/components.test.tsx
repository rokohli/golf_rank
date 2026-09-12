import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Share } from 'react-native'
import * as SecureStore from 'expo-secure-store'

import { CourseList } from '../CourseList'
import { OnboardingForm } from '../OnboardingForm'
import { CourseCard } from '../ProductUI'
import { Course, UserSearchResult } from '../../types'

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}))

const mockLaunchImageLibraryAsync = jest.fn()
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}))

const mockRequestContactsPermission = jest.fn()
const mockGetContacts = jest.fn()
jest.mock('expo-contacts', () => ({
  Fields: { Emails: 'emails', PhoneNumbers: 'phoneNumbers' },
  requestPermissionsAsync: (...args: unknown[]) => mockRequestContactsPermission(...args),
  getContactsAsync: (...args: unknown[]) => mockGetContacts(...args),
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

const alexKim: UserSearchResult = {
  id: 1,
  display_name: 'Alex Kim',
  username: 'alexk',
  home_region: 'Santa Cruz, CA',
  follower_count: 0,
  following_count: 0,
  is_following: false,
}

async function renderAtFriendsStep(props: Partial<Parameters<typeof OnboardingForm>[0]> = {}) {
  const searchCourses = jest.fn().mockResolvedValue([])
  const submit = jest.fn().mockResolvedValue(undefined)
  const onComplete = jest.fn()

  render(<OnboardingForm searchCourses={searchCourses} submit={submit} onComplete={onComplete} {...props} />)

  expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()
  fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
  fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
  fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText("What's your home course?")).toBeOnTheScreen()
  fireEvent.changeText(screen.getByLabelText('Home course'), 'Somewhere golfy')
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

  expect(await screen.findByText('Which courses have you played?')).toBeOnTheScreen()
  fireEvent.press(screen.getByRole('button', { name: 'Skip for now' }))

  expect(await screen.findByText('What courses are on your bucket list?')).toBeOnTheScreen()
  fireEvent.press(screen.getByRole('button', { name: 'Skip' }))

  expect(await screen.findByText('Find your friends')).toBeOnTheScreen()
  return { searchCourses, submit, onComplete }
}

describe('OnboardingForm', () => {
  beforeEach(() => {
    mockRequestContactsPermission.mockReset()
    mockGetContacts.mockReset()
  })

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

  it('picks a profile photo and syncs it via updatePhoto only after the profile save succeeds', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const onComplete = jest.fn()
    const searchCourses = jest.fn().mockResolvedValue([])
    const saveOrder: string[] = []
    const saveProfile = jest.fn().mockImplementation(async () => {
      saveOrder.push('saveProfile')
    })
    const updatePhoto = jest.fn().mockImplementation(async () => {
      saveOrder.push('updatePhoto')
    })
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-avatar.jpg' }],
    })

    render(
      <OnboardingForm
        onComplete={onComplete}
        saveProfile={saveProfile}
        searchCourses={searchCourses}
        submit={submit}
        updatePhoto={updatePhoto}
      />,
    )

    expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()
    fireEvent.press(screen.getByLabelText('Choose profile photo'))
    expect(await screen.findByLabelText('Selected profile photo')).toBeOnTheScreen()

    fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
    fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
    fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(updatePhoto).toHaveBeenCalledWith('file:///picked-avatar.jpg'))
    expect(saveOrder).toEqual(['saveProfile', 'updatePhoto'])
  })

  it('reports a photo-sync failure without losing the already-saved profile', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const searchCourses = jest.fn().mockResolvedValue([])
    const saveProfile = jest.fn().mockResolvedValue(undefined)
    const updatePhoto = jest.fn().mockRejectedValue(new Error('Upload failed'))
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-avatar.jpg' }],
    })

    render(
      <OnboardingForm
        onComplete={jest.fn()}
        saveProfile={saveProfile}
        searchCourses={searchCourses}
        submit={submit}
        updatePhoto={updatePhoto}
      />,
    )

    expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()
    fireEvent.press(screen.getByLabelText('Choose profile photo'))
    await screen.findByLabelText('Selected profile photo')

    fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
    fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
    fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Upload failed')).toBeOnTheScreen()
    expect(saveProfile).toHaveBeenCalled()
  })

  it('imports contacts and advances once syncing succeeds', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'granted' })
    mockGetContacts.mockResolvedValue({ data: [{ emails: [{ email: 'friend@example.com' }], phoneNumbers: [] }] })
    const linkContacts = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    await waitFor(() => expect(linkContacts).toHaveBeenCalledWith(['friend@example.com']))
    expect(await screen.findByText('What matters most in a golf experience?')).toBeOnTheScreen()
  })

  it('surfaces a permission error and stays on the friends step when contacts access is denied', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'denied' })
    const linkContacts = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    expect(await screen.findByText('Contacts permission is needed to find friends who join Fairway.')).toBeOnTheScreen()
    expect(linkContacts).not.toHaveBeenCalled()
    expect(screen.getByText('Find your friends')).toBeOnTheScreen()
  })

  it('surfaces a sync failure without advancing past the friends step', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'granted' })
    mockGetContacts.mockResolvedValue({ data: [{ emails: [{ email: 'friend@example.com' }], phoneNumbers: [] }] })
    const linkContacts = jest.fn().mockRejectedValue(new Error('Unable to link contacts. Please try again.'))

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    expect(await screen.findByText('Unable to link contacts. Please try again.')).toBeOnTheScreen()
    expect(screen.getByText('Find your friends')).toBeOnTheScreen()
  })

  it('treats a contact list with no email or phone as a successful, empty sync', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'granted' })
    mockGetContacts.mockResolvedValue({ data: [{ emails: [], phoneNumbers: [] }] })
    const linkContacts = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    await waitFor(() => expect(linkContacts).toHaveBeenCalledWith([]))
    expect(await screen.findByText('What matters most in a golf experience?')).toBeOnTheScreen()
  })

  it('shares an invite and advances on success', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never)

    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Invite Friends' }))

    await waitFor(() => expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) })))
    expect(await screen.findByText('What matters most in a golf experience?')).toBeOnTheScreen()
    shareSpy.mockRestore()
  })

  it('surfaces an error and stays put when the invite sheet fails to open', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('Sharing unavailable'))

    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Invite Friends' }))

    expect(await screen.findByText('Sharing unavailable')).toBeOnTheScreen()
    expect(screen.getByText('Find your friends')).toBeOnTheScreen()
    shareSpy.mockRestore()
  })

  it('searches golfers by username and follows one from the results', async () => {
    jest.useFakeTimers()
    const searchUsers = jest.fn().mockResolvedValue([alexKim])
    const followUser = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ searchUsers, followUser })
    fireEvent.changeText(screen.getByLabelText('Search usernames'), 'alex')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith('alex'))

    fireEvent.press(await screen.findByRole('button', { name: 'Follow Alex Kim' }))
    await waitFor(() => expect(followUser).toHaveBeenCalledWith(1))
    expect(await screen.findByRole('button', { name: 'Following Alex Kim' })).toBeOnTheScreen()

    jest.useRealTimers()
  })

  it('shows an empty state when no golfers match the search', async () => {
    jest.useFakeTimers()
    const searchUsers = jest.fn().mockResolvedValue([])

    await renderAtFriendsStep({ searchUsers })
    fireEvent.changeText(screen.getByLabelText('Search usernames'), 'nobody')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(await screen.findByText('No golfers matched that search.')).toBeOnTheScreen()
    jest.useRealTimers()
  })

  it('surfaces a search error instead of a silent empty list', async () => {
    jest.useFakeTimers()
    const searchUsers = jest.fn().mockRejectedValue(new Error('Unable to search golfers.'))

    await renderAtFriendsStep({ searchUsers })
    fireEvent.changeText(screen.getByLabelText('Search usernames'), 'alex')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(await screen.findByText('Unable to search golfers.')).toBeOnTheScreen()
    jest.useRealTimers()
  })

  it('keeps the follow button actionable after a follow request fails', async () => {
    jest.useFakeTimers()
    const searchUsers = jest.fn().mockResolvedValue([alexKim])
    const followUser = jest.fn().mockRejectedValue(new Error('Unable to follow this golfer. Please try again.'))

    await renderAtFriendsStep({ searchUsers, followUser })
    fireEvent.changeText(screen.getByLabelText('Search usernames'), 'alex')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    fireEvent.press(await screen.findByRole('button', { name: 'Follow Alex Kim' }))

    expect(await screen.findByText('Unable to follow this golfer. Please try again.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Follow Alex Kim' })).toBeOnTheScreen()

    jest.useRealTimers()
  })

  it('advances past the friends step with a plain Continue button', async () => {
    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('What matters most in a golf experience?')).toBeOnTheScreen()
  })

  it('still shows Following after leaving and re-entering the friends step, because the search API reports the existing relationship', async () => {
    jest.useFakeTimers()
    const searchUsers = jest.fn().mockResolvedValue([alexKim])
    const followUser = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ searchUsers, followUser })
    fireEvent.changeText(screen.getByLabelText('Search usernames'), 'alex')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    fireEvent.press(await screen.findByRole('button', { name: 'Follow Alex Kim' }))
    await waitFor(() => expect(followUser).toHaveBeenCalledWith(1))

    // Continue past this step (the friends-step component unmounts) and come
    // back to it, simulating the reported bug: press Follow, then Continue,
    // then search the same user again.
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('What matters most in a golf experience?')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Go back' }))
    expect(await screen.findByText('Find your friends')).toBeOnTheScreen()

    // The follow is now real backend state, so a fresh search reports it via
    // is_following instead of relying on the (just-destroyed) local state.
    searchUsers.mockResolvedValue([{ ...alexKim, is_following: true }])
    fireEvent.changeText(screen.getByLabelText('Search usernames'), 'alex')
    await act(async () => {
      jest.advanceTimersByTime(300)
    })

    expect(await screen.findByRole('button', { name: 'Following Alex Kim' })).toBeOnTheScreen()
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
