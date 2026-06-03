import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PropertyTable } from './PropertyTable';
describe('PropertyTable', () => {
  it('shows type + security and secures on click', () => {
    const onSecure = vi.fn(); const prompt = vi.spyOn(window, 'prompt').mockReturnValue('salary:read');
    render(<PropertyTable properties={[{ apiName: 'salary', column: 'sal', type: 'int', requiredPermission: null }]} onSecure={onSecure} />);
    expect(screen.getByText('int')).toBeInTheDocument();
    expect(screen.getByText('public')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Secure'));
    expect(onSecure).toHaveBeenCalledWith('salary', 'salary:read');
    prompt.mockRestore();
  });
  it('empty state', () => { render(<PropertyTable properties={[]} />); expect(screen.getByText(/no properties/i)).toBeInTheDocument(); });
});
