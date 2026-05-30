import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BarList } from './BarList';

describe('BarList', () => {
  it('renders a labeled bar per bucket', () => {
    render(<BarList buckets={[{ group: 'Delayed', count: 2 }, { group: 'Boarding', count: 1 }]} />);
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Boarding')).toBeInTheDocument();
  });
  it('shows an empty state', () => {
    render(<BarList buckets={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
