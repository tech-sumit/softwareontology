import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LineageGraph } from './LineageGraph';

describe('LineageGraph', () => {
  it('renders the dataset, object type, action, and linked-type nodes', () => {
    render(
      <LineageGraph
        data={{
          objectType: 'Flight',
          dataset: { id: 'ds1', name: 'flights' },
          actions: ['delayFlight'],
          links: [{ apiName: 'operatedBy', toObjectType: 'Aircraft' }],
        }}
      />,
    );
    expect(screen.getByText('flights')).toBeInTheDocument();
    expect(screen.getByText('Flight')).toBeInTheDocument();
    expect(screen.getByText('delayFlight')).toBeInTheDocument();
    expect(screen.getByText('Aircraft')).toBeInTheDocument();
    expect(screen.getByLabelText('lineage graph for Flight')).toBeInTheDocument();
  });

  it('clicking a linked-type node fires onOpenType with the target type', () => {
    const onOpenType = vi.fn();
    render(
      <LineageGraph
        data={{
          objectType: 'Flight',
          dataset: { id: 'ds1', name: 'flights' },
          actions: [],
          links: [{ apiName: 'operatedBy', toObjectType: 'Aircraft' }],
        }}
        onOpenType={onOpenType}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'open Aircraft' }));
    expect(onOpenType).toHaveBeenCalledWith('Aircraft');
  });

  it('shows placeholders and a dash when there is no dataset, actions, or links', () => {
    render(<LineageGraph data={{ objectType: 'Orphan', dataset: null, actions: [], links: [] }} />);
    expect(screen.getByText('no actions')).toBeInTheDocument();
    expect(screen.getByText('no links')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
