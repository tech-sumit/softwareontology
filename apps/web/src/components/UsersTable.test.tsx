import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UsersTable } from './UsersTable';

describe('UsersTable', () => {
  it('renders users with roles', () => {
    render(<UsersTable users={[{ id: '1', email: 'a@x.com', roles: ['admin'] }]} />);
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });
  it('shows empty state', () => {
    render(<UsersTable users={[]} />);
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
  });
});
