import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/ui/badge';

describe('StatusBadge', () => {
  it('renders the Russian product label for a status', () => {
    render(<StatusBadge status="issued" />);
    expect(screen.getByText('Выдана')).toBeInTheDocument();
  });

  it('renders the written-off state without losing semantics', () => {
    render(<StatusBadge status="written_off" />);
    expect(screen.getByText('Списана')).toBeInTheDocument();
  });
});
