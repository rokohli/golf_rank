import { Course } from '../types'
import { attributedCourseImage, attributedCourseImages } from '../coursePresentation'

const baseCourse: Course = {
  id: 1,
  name: 'Test Course',
  region: 'California, US',
  green_fee: 100,
  difficulty: 'intermediate',
  is_public: true,
}

describe('coursePresentation', () => {
  describe('attributedCourseImage', () => {
    it('uses resolved hero_image when provided and not NONE', () => {
      const course: Course = {
        ...baseCourse,
        hero_image: {
          type: 'OFFICIAL',
          url: 'https://images.example/hero.jpg',
          thumbnail_url: 'https://images.example/hero-thumb.jpg',
          attribution: 'Official',
          license: null,
          source_url: 'https://official.example',
          alt_text: 'Test Course hero',
          width: 1200,
          height: 800,
        },
        images: [
          {
            id: 1,
            url: 'https://images.example/wikimedia.jpg',
            alt_text: 'Wikimedia photo',
            source_name: 'Wiki',
            source_url: 'https://commons.wikimedia.org',
            position: 0,
            is_hero: true,
            source_type: 'wikimedia',
          },
        ],
      }

      expect(attributedCourseImage(course)).toEqual({ uri: 'https://images.example/hero.jpg' })
    })

    it('falls back to source priority order when hero_image is absent', () => {
      const course: Course = {
        ...baseCourse,
        images: [
          {
            id: 1,
            url: 'https://images.example/wiki-hero.jpg',
            alt_text: 'Wiki hero',
            source_name: 'Wikimedia',
            source_url: 'https://commons.wikimedia.org/1',
            position: 0,
            is_hero: true,
            source_type: 'wikimedia',
          },
          {
            id: 2,
            url: 'https://images.example/official-hero.jpg',
            alt_text: 'Official hero',
            source_name: 'Club',
            source_url: 'https://club.example/2',
            position: 1,
            is_hero: true,
            source_type: 'official',
          },
        ],
      }

      // Official (priority 1) should beat Wikimedia (priority 3) despite position 1 > 0
      expect(attributedCourseImage(course)).toEqual({ uri: 'https://images.example/official-hero.jpg' })
    })

    it('prioritizes is_hero within the same source tier', () => {
      const course: Course = {
        ...baseCourse,
        images: [
          {
            id: 1,
            url: 'https://images.example/user-plain.jpg',
            alt_text: 'User non-hero',
            source_name: 'Golfer A',
            source_url: 'https://user.example/1',
            position: 0,
            is_hero: false,
            source_type: 'user',
          },
          {
            id: 2,
            url: 'https://images.example/user-featured.jpg',
            alt_text: 'User featured hero',
            source_name: 'Golfer B',
            source_url: 'https://user.example/2',
            position: 1,
            is_hero: true,
            source_type: 'user',
          },
        ],
      }

      expect(attributedCourseImage(course)).toEqual({ uri: 'https://images.example/user-featured.jpg' })
    })

    it('returns undefined if no usable images exist', () => {
      const course: Course = {
        ...baseCourse,
        images: [],
      }

      expect(attributedCourseImage(course)).toBeUndefined()
    })
  })

  describe('attributedCourseImages', () => {
    it('filters out images missing required attribution fields', () => {
      const course: Course = {
        ...baseCourse,
        images: [
          {
            id: 1,
            url: 'https://images.example/good.jpg',
            alt_text: 'Good',
            source_name: 'Author',
            source_url: 'https://source.example',
            position: 0,
            is_hero: true,
          },
          {
            id: 2,
            url: 'https://images.example/no-source.jpg',
            alt_text: 'No source',
            source_name: null,
            source_url: null,
            position: 1,
            is_hero: false,
          },
        ],
      }

      const results = attributedCourseImages(course)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe(1)
    })
  })
})
