import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AgentTrace } from './AgentTrace';
describe('AgentTrace', () => {
  it('shows the answer and the tool steps', () => {
    render(<AgentTrace answer="Top matches in Flight: BA1 (0.90)." steps={[{ tool: 'search', args: { query: 'x' }, observation: '[...]' }]} />);
    expect(screen.getByText(/Top matches in Flight/)).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });
  it('renders nothing when empty', () => {
    const { container } = render(<AgentTrace answer="" steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
