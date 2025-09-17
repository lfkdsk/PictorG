import { render, screen } from '@testing-library/react';
import LoginOptions from './LoginOptions';

describe('LoginOptions', () => {
  it('renders GitHub buttons', () => {
    render(<LoginOptions />);
    expect(screen.getByText('Pictor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 GitHub 登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '输入 GitHub Token' })).toBeInTheDocument();
  });
});
