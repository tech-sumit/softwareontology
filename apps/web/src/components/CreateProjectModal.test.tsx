import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CreateProjectModal } from './CreateProjectModal';
describe('CreateProjectModal', () => {
  it('requires a name, then creates', () => {
    const onCreate = vi.fn();
    render(<CreateProjectModal onCreate={onCreate} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Create project'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('project name'), { target: { value: 'Marketing' } });
    fireEvent.click(screen.getByText('Create project'));
    expect(onCreate).toHaveBeenCalledWith('Marketing', '');
  });
});
