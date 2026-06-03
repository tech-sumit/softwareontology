import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RolesTable } from './RolesTable';

describe('RolesTable', () => {
  it('renders roles + permission badges', () => {
    render(<RolesTable roles={[{ id: '1', name: 'admin', permissions: ['*'] }, { id: '2', name: 'viewer', permissions: ['datasets:read', 'ontology:read'] }]} />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('datasets:read')).toBeInTheDocument();
  });
  it('empty state', () => { render(<RolesTable roles={[]} />); expect(screen.getByText(/no roles/i)).toBeInTheDocument(); });
});
