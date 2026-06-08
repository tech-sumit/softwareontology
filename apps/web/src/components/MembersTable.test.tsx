import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MembersTable } from './MembersTable';
const rows = [{ userId: 'u1', email: 'a@x.com', role: 'owner' as const }, { userId: 'u2', email: 'b@x.com', role: 'viewer' as const }];
describe('MembersTable', () => {
  it('manages members when allowed', () => {
    const onChangeRole = vi.fn(); const onRemove = vi.fn();
    render(<MembersTable members={rows} canManage onChangeRole={onChangeRole} onRemove={onRemove} />);
    expect(screen.getByText('a@x.com')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('role for b@x.com'), { target: { value: 'editor' } });
    expect(onChangeRole).toHaveBeenCalledWith('u2', 'editor');
    fireEvent.click(screen.getAllByText('Remove')[1]!);
    expect(onRemove).toHaveBeenCalledWith('u2');
  });
  it('is read-only when not allowed', () => {
    render(<MembersTable members={rows} canManage={false} onChangeRole={() => {}} onRemove={() => {}} />);
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('role for a@x.com')).not.toBeInTheDocument();
  });
});
