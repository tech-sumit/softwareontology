import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MarkingsTable } from './MarkingsTable';

describe('MarkingsTable', () => {
  it('marks each row cleared or not, per the user clearances', () => {
    render(<MarkingsTable markings={[{ id: '1', name: 'PII' }, { id: '2', name: 'SECRET' }]} clearedIds={new Set(['1'])} />);
    const pii = screen.getByText('PII').closest('tr')!;
    const secret = screen.getByText('SECRET').closest('tr')!;
    expect(pii.textContent).toContain('✓');            // cleared
    expect(secret.textContent).toContain('not cleared'); // not cleared
  });
  it('shows an empty state', () => {
    render(<MarkingsTable markings={[]} clearedIds={new Set()} />);
    expect(screen.getByText(/no markings/i)).toBeInTheDocument();
  });
});
