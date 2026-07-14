import { ImageSourcePropType } from 'react-native'

export type DemoCourse = {
  id: string
  name: string
  location: string
  rating: number
  reviews: string
  distance: string
  price: string
  accent: string
  secondary: string
  image: ImageSourcePropType
  personalRank?: number
  personalRating?: number
  tier?: 'green' | 'fairway' | 'rough' | 'bunker'
}

const coastalCourse = require('../../assets/course-images/coastal-course.png')
const dunesCourse = require('../../assets/course-images/dunes-course.png')
const parklandCourse = require('../../assets/course-images/parkland-course.png')

export const demoCourses: DemoCourse[] = [
  { id: 'pebble', name: 'Pebble Beach Golf Links', location: 'Pebble Beach, California', rating: 9.7, reviews: '2,341', distance: 'Ranked #1 in California', price: '$$$$', accent: '#6E8B84', secondary: '#AEC3B7', image: coastalCourse, personalRank: 1, personalRating: 9.6, tier: 'green' },
  { id: 'pasatiempo', name: 'Pasatiempo Golf Club', location: 'Santa Cruz, CA', rating: 9.4, reviews: '392', distance: '18 mi', price: '$$$', accent: '#668067', secondary: '#AAB994', image: parklandCourse, personalRank: 3, personalRating: 8.6, tier: 'green' },
  { id: 'bandon', name: 'Bandon Dunes', location: 'Bandon, OR', rating: 9.6, reviews: '1.2k', distance: 'Trending this week', price: '$$$', accent: '#718B72', secondary: '#C1B388', image: dunesCourse, personalRank: 2, personalRating: 9.1, tier: 'green' },
  { id: 'torrey', name: 'Torrey Pines (South)', location: 'San Diego, CA', rating: 9.1, reviews: '818', distance: '12 mi', price: '$$$', accent: '#68869A', secondary: '#A9B9AF', image: coastalCourse, personalRank: 4, personalRating: 8.1, tier: 'fairway' },
  { id: 'pinehurst', name: 'Pinehurst No. 2', location: 'Pinehurst, NC', rating: 9.2, reviews: '904', distance: 'Saved by 12 friends', price: '$$$$', accent: '#778161', secondary: '#C2B88B', image: parklandCourse, personalRank: 5, personalRating: 7.5, tier: 'fairway' },
  { id: 'cabot', name: 'Cabot Cliffs', location: 'Inverness, NS', rating: 9.3, reviews: '476', distance: 'Bucket list', price: '$$$$', accent: '#5F7B82', secondary: '#A6B7AD', image: dunesCourse },
]

export const rounds = [
  { id: 'torrey-may', course: demoCourses[3], date: 'May 12, 2024', score: 82, toPar: '+10', weather: 'Sunny' },
  { id: 'pasatiempo-apr', course: demoCourses[1], date: 'Apr 28, 2024', score: 79, toPar: '+7', weather: 'Cloudy' },
  { id: 'pebble-apr', course: demoCourses[0], date: 'Apr 14, 2024', score: 87, toPar: '+15', weather: 'Windy' },
  { id: 'bandon-mar', course: demoCourses[2], date: 'Mar 30, 2024', score: 76, toPar: '+4', weather: 'Clear' },
]

export const friends = [
  { initials: 'JT', name: 'Jake Thompson', course: 'Torrey Pines (South)', score: '82 (+10)', accent: '#496C5D' },
  { initials: 'MP', name: 'Maya Patel', course: 'Bandon Dunes', score: '74 (+2)', accent: '#A27655' },
  { initials: 'AR', name: 'Alex Rivera', course: 'Pinehurst No. 2', score: '86 (+14)', accent: '#6E7A55' },
  { initials: 'CL', name: 'Chris Lee', course: 'Pasatiempo GC', score: '78 (+6)', accent: '#466B76' },
  { initials: 'SK', name: 'Sophie Kim', course: 'CordeValle', score: '80 (+8)', accent: '#96725D' },
]
