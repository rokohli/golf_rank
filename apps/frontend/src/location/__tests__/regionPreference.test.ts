import * as SecureStore from 'expo-secure-store'

import { DEFAULT_COURSE_REGION } from '../currentRegion'
import { loadSavedRegion, saveRegion } from '../regionPreference'

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}))

describe('regionPreference', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns null when saved region is null, empty, or the default placeholder', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null)
    expect(await loadSavedRegion()).toBeNull()

    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('   ')
    expect(await loadSavedRegion()).toBeNull()

    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('All California')
    expect(await loadSavedRegion()).toBeNull()

    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(DEFAULT_COURSE_REGION)
    expect(await loadSavedRegion()).toBeNull()

    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('All region')
    expect(await loadSavedRegion()).toBeNull()

    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('all regions')
    expect(await loadSavedRegion()).toBeNull()
  })

  it('returns the trimmed custom region when an explicit region was saved', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce('  San Francisco, CA  ')
    expect(await loadSavedRegion()).toBe('San Francisco, CA')
  })

  it('deletes the saved key when saving empty, legacy default, or default course region variants', async () => {
    await saveRegion('')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('discover.explicit-region')

    await saveRegion('All California')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('discover.explicit-region')

    await saveRegion(DEFAULT_COURSE_REGION)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('discover.explicit-region')

    await saveRegion('All region')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('discover.explicit-region')

    await saveRegion('all regions')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('discover.explicit-region')
  })

  it('stores the custom region when valid', async () => {
    await saveRegion('Monterey, CA')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('discover.explicit-region', 'Monterey, CA')
  })
})
