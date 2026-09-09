import { isRetryableConfirmFailure, uploadCoursePhoto } from '../coursePhotoUpload'
import { ApiResponseError } from '../client'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('isRetryableConfirmFailure', () => {
  it('treats network errors, 429, and 5xx as retryable', () => {
    expect(isRetryableConfirmFailure(new Error('network down'))).toBe(true)
    expect(isRetryableConfirmFailure(new ApiResponseError('Too many requests', 429))).toBe(true)
    expect(isRetryableConfirmFailure(new ApiResponseError('Internal server error', 500))).toBe(true)
    expect(isRetryableConfirmFailure(new ApiResponseError('Storage unavailable', 503))).toBe(true)
  })

  it('treats a definitive 4xx rejection as non-retryable', () => {
    expect(isRetryableConfirmFailure(new ApiResponseError('Unsupported content type', 422))).toBe(false)
    expect(isRetryableConfirmFailure(new ApiResponseError('round_id does not match', 400))).toBe(false)
    expect(isRetryableConfirmFailure(new ApiResponseError('storage_key belongs to another user', 403))).toBe(false)
  })
})

describe('uploadCoursePhoto', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it('discards the object after a definitive confirm rejection', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(201, { // upload-url
        upload_url: 'https://r2.example/put', storage_key: 'course-photos/pending/1/x.jpg',
        content_type: 'image/jpeg', expires_in_seconds: 300,
      }))
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob() } as unknown as Response) // fetch(fileUri)
      .mockResolvedValueOnce({ ok: true } as Response) // PUT to storage
      .mockResolvedValueOnce(jsonResponse(422, { detail: 'Uploaded object has an unsupported content type' })) // confirm
      .mockResolvedValueOnce({ ok: true } as Response) // discard

    await expect(
      uploadCoursePhoto(1, 'file:///photo.jpg', 'image/jpeg', {}),
    ).rejects.toThrow('Uploaded object has an unsupported content type')

    const discardCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/photos/discard'))
    expect(discardCall).toBeDefined()
    expect(discardCall?.[1]).toMatchObject({
      body: JSON.stringify({ storage_key: 'course-photos/pending/1/x.jpg' }),
    })
  })

  it('does not discard the object after a retryable (5xx) confirm failure', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(201, {
        upload_url: 'https://r2.example/put', storage_key: 'course-photos/pending/1/x.jpg',
        content_type: 'image/jpeg', expires_in_seconds: 300,
      }))
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob() } as unknown as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce(jsonResponse(500, { detail: 'Internal server error' }))

    await expect(
      uploadCoursePhoto(1, 'file:///photo.jpg', 'image/jpeg', {}),
    ).rejects.toThrow()

    const discardCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/photos/discard'))
    expect(discardCall).toBeUndefined()
  })
})
