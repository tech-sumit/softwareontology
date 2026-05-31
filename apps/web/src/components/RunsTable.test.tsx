import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RunsTable } from './RunsTable';

describe('RunsTable', () => {
  it('renders run status/trigger/error', () => {
    render(<RunsTable runs={[
      { id: '1', status: 'success', trigger: 'manual', rowCount: 3, error: null, startedAt: '2026-05-30T12:00:00Z' },
      { id: '2', status: 'failed', trigger: 'schedule', rowCount: null, error: 'boom', startedAt: '2026-05-30T12:01:00Z' },
    ]} />);
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('schedule')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
  it('empty state', () => {
    render(<RunsTable runs={[]} />);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });
});
