import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SearchResults } from './SearchResults';
describe('SearchResults', () => {
  it('renders ranked hits', () => {
    render(<SearchResults hits={[{ primaryKey: 'BA123', score: 0.87, doc: 'status: delayed' }]} />);
    expect(screen.getByText('BA123')).toBeInTheDocument();
    expect(screen.getByText('0.870')).toBeInTheDocument();
  });
  it('shows an empty state', () => {
    render(<SearchResults hits={[]} />);
    expect(screen.getByText(/No results yet/)).toBeInTheDocument();
  });
});
