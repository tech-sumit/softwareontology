import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContextSidebar } from './ContextSidebar';
describe('ContextSidebar', () => {
  it('renders header + items and selects', () => {
    const onSelect = vi.fn();
    render(<ContextSidebar header={{ title: 'Marketing', subtitle: 'Project workspace', dotColor: '#4763e4' }} items={[{ id: 'overview', label: 'Overview' }, { id: 'data', label: 'Data' }]} active="overview" onSelect={onSelect} />);
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Data')); expect(onSelect).toHaveBeenCalledWith('data');
    expect(screen.getByText('Overview').className).toContain('active');
  });
});
