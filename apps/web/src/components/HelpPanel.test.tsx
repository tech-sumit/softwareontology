import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HelpPanel } from './HelpPanel';
describe('HelpPanel', () => {
  it('starts collapsed and expands its steps on click', () => {
    render(<HelpPanel title="Pipelines" steps={['First step here', 'Second step here']} />);
    expect(screen.getByText(/How to use Pipelines/)).toBeInTheDocument();
    expect(screen.queryByText('First step here')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/How to use Pipelines/));
    expect(screen.getByText('First step here')).toBeInTheDocument();
    expect(screen.getByText('Second step here')).toBeInTheDocument();
  });
});
