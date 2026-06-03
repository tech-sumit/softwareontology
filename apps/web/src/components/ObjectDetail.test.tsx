import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectDetail } from './ObjectDetail';

describe('ObjectDetail', () => {
  it('renders properties + runs an action', () => {
    const onRun = vi.fn();
    render(<ObjectDetail object={{ flightNumber: 'FL-204', status: 'Delayed' }} actions={[{ apiName: 'setStatus', kind: 'modify' }]} onRun={onRun} />);
    expect(screen.getByText('FL-204')).toBeInTheDocument();
    expect(screen.getByText('Delayed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('setStatus'));
    expect(onRun).toHaveBeenCalledWith('setStatus');
  });
});
