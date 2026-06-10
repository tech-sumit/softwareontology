import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RolesTable } from './RolesTable';

describe('RolesTable', () => {
  it('renders roles + permission badges', () => {
    render(<RolesTable roles={[{ id: '1', name: 'admin', permissions: ['*'] }, { id: '2', name: 'viewer', permissions: ['datasets:read', 'ontology:read'] }]} />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('datasets:read')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument(); // no onDelete -> no buttons
  });
  it('empty state', () => { render(<RolesTable roles={[]} />); expect(screen.getByText(/no roles/i)).toBeInTheDocument(); });
  it('deletes via onDelete but never an admin (*) role', () => {
    const onDelete = vi.fn();
    render(<RolesTable roles={[{ id: '1', name: 'admin', permissions: ['*'] }, { id: '2', name: 'viewer', permissions: ['datasets:read'] }]} onDelete={onDelete} />);
    const buttons = screen.getAllByText('Delete');
    expect(buttons).toHaveLength(1); // admin role has no Delete
    fireEvent.click(buttons[0]!);
    expect(onDelete).toHaveBeenCalledWith('2');
  });
});
