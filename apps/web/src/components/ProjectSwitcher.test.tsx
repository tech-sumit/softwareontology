import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProjectSwitcher } from './ProjectSwitcher';

describe('ProjectSwitcher', () => {
  it('lists projects and selects', () => {
    const onSelect = vi.fn();
    render(<ProjectSwitcher projects={[{ id: 'project_default', name: 'Default' }, { id: 'p2', name: 'Marketing' }]} current="project_default" onSelect={onSelect} onCreate={() => {}} />);
    expect(screen.getByRole('option', { name: 'Marketing' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('project'), { target: { value: 'p2' } });
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});
