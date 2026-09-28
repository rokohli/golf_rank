import { fireEvent, render, screen } from '@testing-library/react-native'

import { TagSelector } from '../TagSelector'

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native')
  return { Feather: ({ name }: { name: string }) => <Text>{name}</Text> }
})

describe('TagSelector', () => {
  it('renders taxonomy sections and display labels', () => {
    render(<TagSelector selectedTags={[]} onChange={jest.fn()} />)

    expect(screen.getByText('Locomotion')).toBeOnTheScreen()
    expect(screen.getByText('Bag & Assistance')).toBeOnTheScreen()
    expect(screen.getByText('Setting & Character')).toBeOnTheScreen()
    expect(screen.getByText('Course Conditions')).toBeOnTheScreen()
    expect(screen.getByText('Amenities & Vibe')).toBeOnTheScreen()

    expect(screen.getByRole('button', { name: 'Walked' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Riding Cart' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Ocean Views' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Fast Greens' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Great Food & Drink' })).toBeOnTheScreen()
  })

  it('enforces mutual exclusion between Walked and Riding Cart', () => {
    const onChange = jest.fn()
    render(<TagSelector selectedTags={['cart', 'ocean_views']} onChange={onChange} />)

    // Pressing Walked replaces Riding Cart while preserving other tags
    fireEvent.press(screen.getByRole('button', { name: 'Walked' }))
    expect(onChange).toHaveBeenCalledWith(['ocean_views', 'walked'])

    // Tapping currently selected Riding Cart toggles it off
    onChange.mockClear()
    fireEvent.press(screen.getByRole('button', { name: 'Riding Cart' }))
    expect(onChange).toHaveBeenCalledWith(['ocean_views'])
  })

  it('toggles non-locomotion tags independently', () => {
    const onChange = jest.fn()
    render(<TagSelector selectedTags={['push_cart']} onChange={onChange} />)

    // Add Ocean Views
    fireEvent.press(screen.getByRole('button', { name: 'Ocean Views' }))
    expect(onChange).toHaveBeenCalledWith(['push_cart', 'ocean_views'])

    // Remove Push Cart
    onChange.mockClear()
    fireEvent.press(screen.getByRole('button', { name: 'Push Cart' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('enforces maximum 8 tags limit and disables further selection', () => {
    const eightTags = [
      'walked',
      'push_cart',
      'ocean_views',
      'fast_greens',
      'pristine_fairways',
      'great_practice_facility',
      'welcoming_staff',
      'great_food_drink',
    ]
    const onChange = jest.fn()
    render(<TagSelector selectedTags={eightTags} onChange={onChange} />)

    expect(screen.getByText(/Maximum 8 tags selected/i)).toBeOnTheScreen()

    // Unselected chip (Mountain Views) is disabled
    const mountainChip = screen.getByRole('button', { name: 'Mountain Views' })
    expect(mountainChip.props.accessibilityState).toMatchObject({ disabled: true })

    fireEvent.press(mountainChip)
    expect(onChange).not.toHaveBeenCalled()

    // But already selected chip can still be deselected
    const foodChip = screen.getByRole('button', { name: 'Great Food & Drink' })
    fireEvent.press(foodChip)
    expect(onChange).toHaveBeenCalledWith(eightTags.filter((t) => t !== 'great_food_drink'))
  })
})
