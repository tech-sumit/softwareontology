import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkspaceRail } from './WorkspaceRail';
describe('WorkspaceRail', () => {
  it('renders avatars + console and fires callbacks', () => {
    const onConsole = vi.fn(), onSelectProject = vi.fn(), onNewProject = vi.fn();
    render(<WorkspaceRail projects={[{ id: 'project_default', name: 'Default' }, { id: 'p2', name: 'Marketing' }]} activeProjectId="p2" area="project" userInitial="A" onConsole={onConsole} onSelectProject={onSelectProject} onNewProject={onNewProject} />);
    fireEvent.click(screen.getByLabelText('Console')); expect(onConsole).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('project Marketing')); expect(onSelectProject).toHaveBeenCalledWith('p2');
    fireEvent.click(screen.getByLabelText('New project')); expect(onNewProject).toHaveBeenCalled();
    expect(screen.getByLabelText('project Marketing').className).toContain('active');
  });
});
