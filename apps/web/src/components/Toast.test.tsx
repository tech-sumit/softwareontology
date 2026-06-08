import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Toast } from './Toast';
describe('Toast', () => {
  it('shows the message and dismisses', () => {
    const onClose = vi.fn();
    render(<Toast message="Project updated." onClose={onClose} />);
    expect(screen.getByText('Project updated.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('dismiss'));
    expect(onClose).toHaveBeenCalled();
  });
});
