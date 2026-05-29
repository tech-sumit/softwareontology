import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectsTable } from './ObjectsTable';

const rows = [
  { flightNumber: 'FL-204', status: 'Delayed' },
  { flightNumber: 'FL-118', status: 'Boarding' },
];

describe('ObjectsTable', () => {
  it('renders a row per object and calls onSelect with the pk', () => {
    const onSelect = vi.fn();
    render(<ObjectsTable columns={['flightNumber', 'status']} rows={rows} pk="flightNumber" onSelect={onSelect} />);
    expect(screen.getByText('FL-204')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('FL-118'));
    expect(onSelect).toHaveBeenCalledWith('FL-118');
  });

  it('shows an empty state', () => {
    render(<ObjectsTable columns={['x']} rows={[]} pk="x" onSelect={() => {}} />);
    expect(screen.getByText(/no objects/i)).toBeInTheDocument();
  });
});
