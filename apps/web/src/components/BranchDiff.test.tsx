import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BranchDiff } from './BranchDiff';
describe('BranchDiff', () => {
  it('renders edits with a count', () => {
    render(<BranchDiff edits={[{ objectType: 'Flight', primaryKey: 'FL-1', property: 'status', value: 'Delayed' }]} creates={[]} />);
    expect(screen.getByText('Edits (1)')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
  });
  it('shows an empty state', () => {
    render(<BranchDiff edits={[]} creates={[]} />);
    expect(screen.getByText(/No changes on this branch yet/)).toBeInTheDocument();
  });
});
