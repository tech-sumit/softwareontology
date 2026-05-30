import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AppRuntime } from './AppRuntime';
import type { AppDefinition } from '../api';

const definition: AppDefinition = { widgets: [
  { id: 'w1', type: 'object-table', title: 'Flights', config: { objectType: 'Flight' } },
  { id: 'w2', type: 'metric', title: 'Total flights', config: { objectType: 'Flight' } },
  { id: 'w3', type: 'action-button', title: 'Cancel', config: { action: 'cancelFlight' } },
] };
const objects = { Flight: [ { flightNumber: 'FL-1', status: 'Delayed' }, { flightNumber: 'FL-2', status: 'Boarding' } ] };

describe('AppRuntime', () => {
  it('renders table rows, a metric count, and a working action button', () => {
    const onRunAction = vi.fn();
    render(<AppRuntime definition={definition} data={{ objects, onRunAction }} />);
    expect(screen.getByText('FL-1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // metric = 2 flights (unique text node)
    fireEvent.click(screen.getByText('Cancel'));
    expect(onRunAction).toHaveBeenCalledWith('cancelFlight');
  });

  it('shows the empty state when there are no objects for the type', () => {
    render(<AppRuntime definition={{ widgets: [{ id: 'w1', type: 'object-table', config: { objectType: 'Ghost' } }] }} data={{ objects: {}, onRunAction: () => {} }} />);
    expect(screen.getByText(/no objects/i)).toBeInTheDocument();
  });
});
