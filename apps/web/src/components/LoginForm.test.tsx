import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('submits the entered credentials', () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSubmit).toHaveBeenCalledWith('admin@example.com', 'admin');
  });

  it('starts with empty credentials (no dev defaults)', () => {
    render(<LoginForm onSubmit={() => {}} />);
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
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
