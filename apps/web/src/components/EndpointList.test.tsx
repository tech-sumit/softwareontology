import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EndpointList } from './EndpointList';

describe('EndpointList', () => {
  it('renders method + path rows', () => {
    render(<EndpointList endpoints={[{ method: 'get', path: '/datasets' }, { method: 'post', path: '/pipelines' }]} />);
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('/datasets')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('/pipelines')).toBeInTheDocument();
  });
  it('empty state', () => {
    render(<EndpointList endpoints={[]} />);
    expect(screen.getByText(/no endpoints/i)).toBeInTheDocument();
  });
});
