import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TopBar } from './TopBar';
describe('TopBar', () => {
  it('renders breadcrumb + signs out', () => {
    const onSignOut = vi.fn();
    render(<TopBar breadcrumb={['Console', 'Marketing', 'Overview']} userEmail="a@x.com" onSignOut={onSignOut} />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('Overview').className).toContain('cur');
    fireEvent.click(screen.getByText('Sign out')); expect(onSignOut).toHaveBeenCalled();
  });

  it('fires onSearch on Enter', () => {
    const onSearch = vi.fn();
    render(<TopBar breadcrumb={['Console']} userEmail="a@x.com" onSignOut={() => {}} onSearch={onSearch} />);
    const box = screen.getByLabelText('search');
    fireEvent.change(box, { target: { value: 'flights' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSearch).toHaveBeenCalledWith('flights');
  });

  it('switches branch', () => {
    const onBranchChange = vi.fn();
    render(<TopBar breadcrumb={['Console']} userEmail="a@x.com" onSignOut={() => {}} branch="main" branches={[{ name: 'main', status: 'main' }, { name: 'feat', status: 'open' }]} onBranchChange={onBranchChange} />);
    fireEvent.change(screen.getByLabelText('branch'), { target: { value: 'feat' } });
    expect(onBranchChange).toHaveBeenCalledWith('feat');
  });
});
