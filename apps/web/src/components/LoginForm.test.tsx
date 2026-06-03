import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('submits the entered credentials', () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSubmit).toHaveBeenCalledWith('admin@example.com', 'admin');
  });

  it('shows an error when provided', () => {
    render(<LoginForm onSubmit={() => {}} error="invalid credentials" />);
    expect(screen.getByRole('alert')).toHaveTextContent('invalid credentials');
  });

  it('fires onSso when the SSO button is clicked', () => {
    const onSso = vi.fn();
    render(<LoginForm onSubmit={() => {}} onSso={onSso} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with SSO' }));
    expect(onSso).toHaveBeenCalled();
  });
});
