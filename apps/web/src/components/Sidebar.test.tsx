import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from './Sidebar';

const groups = [
  { label: 'PROJECT', items: [{ id: 'data', label: 'Data' }, { id: 'pipelines', label: 'Pipelines' }] },
  { label: 'PLATFORM', items: [{ id: 'admin', label: 'Admin' }] },
];

describe('Sidebar', () => {
  it('renders groups + items and selects on click', () => {
    const onSelect = vi.fn();
    render(<Sidebar groups={groups} active="data" onSelect={onSelect} />);
    expect(screen.getByText('PROJECT')).toBeInTheDocument();
    expect(screen.getByText('Pipelines')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Pipelines'));
    expect(onSelect).toHaveBeenCalledWith('pipelines');
    expect(screen.getByText('Data').className).toContain('active');
  });
});
