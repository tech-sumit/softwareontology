import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UsersTable } from './UsersTable';

describe('UsersTable', () => {
  it('renders users with roles', () => {
    render(<UsersTable users={[{ id: '1', email: 'a@x.com', roles: ['admin'] }]} />);
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument(); // no onDelete -> no buttons
  });
  it('shows empty state', () => {
    render(<UsersTable users={[]} />);
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
  });
  it('deletes via onDelete but never your own row', () => {
    const onDelete = vi.fn();
    render(<UsersTable users={[{ id: '1', email: 'me@x.com', roles: [] }, { id: '2', email: 'other@x.com', roles: [] }]} onDelete={onDelete} currentEmail="me@x.com" />);
    const buttons = screen.getAllByText('Delete');
    expect(buttons).toHaveLength(1); // own row has no Delete
    fireEvent.click(buttons[0]!);
    expect(onDelete).toHaveBeenCalledWith('2');
  });
});
