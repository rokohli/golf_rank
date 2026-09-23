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

  expect(await screen.findByText("Pick 2 courses you've played")).toBeOnTheScreen()
  fireEvent.press(screen.getByRole('button', { name: 'Skip for now' }))

  expect(await screen.findByText('What courses are on your bucket list?')).toBeOnTheScreen()
  fireEvent.press(screen.getByRole('button', { name: 'Skip' }))

  expect(await screen.findByText('Connect with friends')).toBeOnTheScreen()
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

    fireEvent.press(screen.getByRole('button', { name: '$$$ Up to $250' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with $$$' }))

    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByText("You're all set!")).toBeOnTheScreen()
    expect(screen.queryByText('AI recommendations ready')).toBeNull()
    expect(screen.getByText('From your played history')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Go to My Profile' }))

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith({
        home_region: 'Santa Cruz, CA',
        max_green_fee: 250,
        difficulty: 'any',
        access: 'any',
        onboarding_data: expect.objectContaining({
          first_name: 'Rohan',
          last_name: 'Kohli',
          username: 'rohank',
          home_course_id: '11',
          played_course_ids: ['12', '13'],
          favorite_wins: ['12'],
          budget: '$$$',
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
    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
  })

  it('surfaces a permission error and stays on the friends step when contacts access is denied', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'denied' })
    const linkContacts = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    expect(await screen.findByText('Contacts permission is needed to find friends who join Fairway.')).toBeOnTheScreen()
    expect(linkContacts).not.toHaveBeenCalled()
    expect(screen.getByText('Connect with friends')).toBeOnTheScreen()
  })

  it('surfaces a sync failure without advancing past the friends step', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'granted' })
    mockGetContacts.mockResolvedValue({ data: [{ emails: [{ email: 'friend@example.com' }], phoneNumbers: [] }] })
    const linkContacts = jest.fn().mockRejectedValue(new Error('Unable to link contacts. Please try again.'))

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    expect(await screen.findByText('Unable to link contacts. Please try again.')).toBeOnTheScreen()
    expect(screen.getByText('Connect with friends')).toBeOnTheScreen()
  })

  it('treats a contact list with no email or phone as a successful, empty sync', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'granted' })
    mockGetContacts.mockResolvedValue({ data: [{ emails: [], phoneNumbers: [] }] })
    const linkContacts = jest.fn().mockResolvedValue(undefined)

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))

    await waitFor(() => expect(linkContacts).toHaveBeenCalledWith([]))
    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
  })

  it('shares an invite and advances on success', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never)

    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Invite Friends' }))

    await waitFor(() => expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) })))
    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
    shareSpy.mockRestore()
  })

  it('surfaces an error and stays put when the invite sheet fails to open', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockRejectedValue(new Error('Sharing unavailable'))

    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Invite Friends' }))

    expect(await screen.findByText('Sharing unavailable')).toBeOnTheScreen()
    expect(screen.getByText('Connect with friends')).toBeOnTheScreen()
    shareSpy.mockRestore()
  })

  it('stays on the friends step when the invite sheet is dismissed without sharing', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction } as never)

    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Invite Friends' }))

    await waitFor(() => expect(shareSpy).toHaveBeenCalled())
    expect(screen.getByText('Connect with friends')).toBeOnTheScreen()
    shareSpy.mockRestore()
  })

  it('does not advance twice when Continue is pressed while a contact sync is still in flight', async () => {
    mockRequestContactsPermission.mockResolvedValue({ status: 'granted' })
    mockGetContacts.mockResolvedValue({ data: [{ emails: [{ email: 'friend@example.com' }], phoneNumbers: [] }] })
    let resolveLinkContacts: (() => void) | undefined
    const linkContacts = jest.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveLinkContacts = resolve }))

    await renderAtFriendsStep({ linkContacts })
    fireEvent.press(screen.getByRole('button', { name: 'Import Contacts' }))
    await waitFor(() => expect(linkContacts).toHaveBeenCalled())

    // Continue is disabled while the sync is in flight, so it cannot fire a
    // second, conflicting advance once linkContacts resolves.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await act(async () => {
      resolveLinkContacts?.()
      await Promise.resolve()
    })

    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
  })

  it('advances past the friends step with a plain Continue button', async () => {
    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
  })

  it('clamps played courses to 2 and shows the count badge', async () => {
    jest.useFakeTimers()
    const searchCourses = jest.fn(async (query: string) => {
      const normalized = query.toLowerCase()
      return [pasatiempo, pebble, spyglass].filter((course) => course.name.toLowerCase().includes(normalized))
    })

    render(<OnboardingForm searchCourses={searchCourses} submit={jest.fn()} onComplete={jest.fn()} />)
    expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
    fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
    fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText("What's your home course?")).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Home course'), 'Somewhere')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText("Pick 2 courses you've played")).toBeOnTheScreen()
    expect(screen.getByText('0 of 2 selected')).toBeOnTheScreen()

    fireEvent.changeText(screen.getByLabelText('Search'), 'Pas')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Pasatiempo Golf Club Santa Cruz, CA' }))
    expect(screen.getByText('1 of 2 selected')).toBeOnTheScreen()

    fireEvent.changeText(screen.getByLabelText('Search'), 'Peb')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Pebble Beach Golf Links Monterey, CA' }))
    expect(screen.getByText('2 of 2 selected ✓')).toBeOnTheScreen()

    // Selecting a third replaces the second course, staying at 2
    fireEvent.changeText(screen.getByLabelText('Search'), 'Spy')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Spyglass Hill Golf Course Pebble Beach, CA' }))
    expect(screen.getByText('2 of 2 selected ✓')).toBeOnTheScreen()

    jest.useRealTimers()
  })

  it('clears a stale ranking win when the played-course pair changes after ranking', async () => {
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

    expect(await screen.findByText("What's your home course?")).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Home course'), 'Pas')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Pasatiempo Golf Club Santa Cruz, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.changeText(screen.getByLabelText('Search'), 'Peb')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Pebble Beach Golf Links Monterey, CA' }))

    fireEvent.changeText(screen.getByLabelText('Search'), 'Spy')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Spyglass Hill Golf Course Pebble Beach, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with 2 selected' }))

    expect(await screen.findByText('Which course did you enjoy more?')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: /Choose Spyglass Hill Golf Course/ }))

    // Navigate back to the played-courses step and swap out the winner for a new course.
    expect(await screen.findByText('What courses are on your bucket list?')).toBeOnTheScreen()
    fireEvent.press(screen.getByLabelText('Go back'))
    expect(await screen.findByText('Which course did you enjoy more?')).toBeOnTheScreen()
    fireEvent.press(screen.getByLabelText('Go back'))
    expect(await screen.findByText("Pick 2 courses you've played")).toBeOnTheScreen()

    // Pebble and Spyglass are already selected; picking a third course (Pasatiempo)
    // replaces Spyglass, changing the pair that was just ranked.
    fireEvent.changeText(screen.getByLabelText('Search'), 'Pas')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Pasatiempo Golf Club Santa Cruz, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with 2 selected' }))

    // The new pair (Pebble vs. Pasatiempo) has never been ranked, so skip it.
    expect(await screen.findByText('Which course did you enjoy more?')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.press(screen.getByRole('button', { name: '$$$ Up to $250' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with $$$' }))
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))

    expect(await screen.findByText("You're all set!")).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Go to My Profile' }))

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          onboarding_data: expect.objectContaining({
            played_course_ids: ['12', '11'],
            favorite_wins: [],
          }),
        }),
      )
    })

    jest.useRealTimers()
  })

  it('clamps a legacy draft with more than 2 played courses to the new 2-course cap', async () => {
    const courseCatalog = {
      '11': { id: '11', name: pasatiempo.name, location: pasatiempo.region, city: pasatiempo.city, region: pasatiempo.region, imageTone: '', meta: '' },
      '12': { id: '12', name: pebble.name, location: pebble.region, city: pebble.city, region: pebble.region, imageTone: '', meta: '' },
      '13': { id: '13', name: spyglass.name, location: spyglass.region, city: spyglass.city, region: spyglass.region, imageTone: '', meta: '' },
    }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draftVersion: 4,
        firstName: 'Rohan',
        lastName: 'Kohli',
        username: 'rohank',
        playedCourseIds: ['11', '12', '13'],
        courseCatalog,
        stepIndex: 2,
      }),
    )

    render(<OnboardingForm searchCourses={jest.fn().mockResolvedValue([])} submit={jest.fn()} onComplete={jest.fn()} />)

    expect(await screen.findByText('2 of 2 selected ✓')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Continue with 2 selected' })).toBeOnTheScreen()
  })

  it('clamps a legacy rankIndex that no longer matches the clamped played-course pair', async () => {
    const courseCatalog = {
      '11': { id: '11', name: pasatiempo.name, location: pasatiempo.region, city: pasatiempo.city, region: pasatiempo.region, imageTone: '', meta: '' },
      '12': { id: '12', name: pebble.name, location: pebble.region, city: pebble.city, region: pebble.region, imageTone: '', meta: '' },
      '13': { id: '13', name: spyglass.name, location: spyglass.region, city: spyglass.city, region: spyglass.region, imageTone: '', meta: '' },
    }
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        draftVersion: 4,
        firstName: 'Rohan',
        lastName: 'Kohli',
        username: 'rohank',
        playedCourseIds: ['11', '12', '13'],
        courseCatalog,
        stepIndex: 3,
        rankIndex: 2,
      }),
    )

    render(<OnboardingForm searchCourses={jest.fn().mockResolvedValue([])} submit={jest.fn()} onComplete={jest.fn()} />)

    expect(await screen.findByText('Which course did you enjoy more?')).toBeOnTheScreen()
  })

  it('allows selecting green fee budget tiers and advancing', async () => {
    await renderAtFriendsStep()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: '$$ Up to $100' }))
    fireEvent.press(screen.getByRole('button', { name: 'Continue with $$' }))

    expect(await screen.findByText('Stay in the loop')).toBeOnTheScreen()
  })

  it('displays contextual wishlist badge on the success screen when a dream course is present', async () => {
    jest.useFakeTimers()
    const searchCourses = jest.fn(async (query: string) => {
      const normalized = query.toLowerCase()
      return [pasatiempo, pebble, spyglass].filter((course) => course.name.toLowerCase().includes(normalized))
    })

    render(<OnboardingForm searchCourses={searchCourses} submit={jest.fn()} onComplete={jest.fn()} />)
    expect(await screen.findByText('Build Your Profile')).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('First Name'), 'Rohan')
    fireEvent.changeText(screen.getByLabelText('Last Name'), 'Kohli')
    fireEvent.changeText(screen.getByLabelText('Username'), 'rohank')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText("What's your home course?")).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Home course'), 'Somewhere')
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    // Skip played
    fireEvent.press(await screen.findByRole('button', { name: 'Skip for now' }))

    // Pick dream course
    expect(await screen.findByText('What courses are on your bucket list?')).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Search dream courses'), 'Peb')
    await act(async () => { jest.advanceTimersByTime(300) })
    fireEvent.press(await screen.findByRole('button', { name: 'Pebble Beach Golf Links Monterey, CA' }))
    fireEvent.press(screen.getByRole('button', { name: 'Save 1 dream courses' }))

    // Skip contacts
    expect(await screen.findByText('Connect with friends')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))
    // Skip budget
    expect(await screen.findByText("What's your typical green fee budget?")).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    // Skip notifications
    expect(await screen.findByText('Stay in the loop')).toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button', { name: 'Skip' }))

    expect(await screen.findByText("You're all set!")).toBeOnTheScreen()
    expect(screen.getByText('First stop on your wishlist')).toBeOnTheScreen()
    expect(screen.queryByText('AI recommendations ready')).toBeNull()

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
