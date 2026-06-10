import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConnectorList } from './ConnectorList';

describe('ConnectorList', () => {
  it('lists connectors and syncs on click', () => {
    const onSync = vi.fn();
    render(<ConnectorList connectors={[{ id: 'c1', name: 'sales-db' }]} onSync={onSync} />);
    expect(screen.getByText('sales-db')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sync'));
    expect(onSync).toHaveBeenCalledWith('c1');
  });
  it('empty state', () => {
    render(<ConnectorList connectors={[]} onSync={() => {}} />);
    expect(screen.getByText(/none yet/i)).toBeInTheDocument();
  });
  it('hides Delete without onDelete and deletes with it', () => {
    const onDelete = vi.fn();
    const { rerender } = render(<ConnectorList connectors={[{ id: 'c1', name: 'sales-db' }]} onSync={() => {}} />);
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    rerender(<ConnectorList connectors={[{ id: 'c1', name: 'sales-db' }]} onSync={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('c1');
  });
});
