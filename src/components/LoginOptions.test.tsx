import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LoginOptions from './LoginOptions';
import { validateCurrentToken } from '@/lib/github';
import { initiateGitHubOAuth } from '@/lib/auth';

const push = jest.fn();
const getSearchParam = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: getSearchParam }),
}));

jest.mock('@/lib/github', () => ({
  validateCurrentToken: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  initiateGitHubOAuth: jest.fn(),
}));

describe('LoginOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSearchParam.mockReturnValue(null);
    (validateCurrentToken as jest.Mock).mockResolvedValue(false);
  });

  it('renders GitHub and token login entry points', () => {
    render(<LoginOptions />);

    expect(screen.getByText('Pictor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 GitHub 登录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '输入 GitHub Token' })).toBeInTheDocument();
  });

  it('starts GitHub OAuth from the primary login button', () => {
    render(<LoginOptions />);

    fireEvent.click(screen.getByRole('button', { name: '使用 GitHub 登录' }));

    expect(initiateGitHubOAuth).toHaveBeenCalledTimes(1);
  });

  it('routes to token login from the secondary login button', () => {
    render(<LoginOptions />);

    fireEvent.click(screen.getByRole('button', { name: '输入 GitHub Token' }));

    expect(push).toHaveBeenCalledWith('/login/token');
  });

  it('redirects authenticated users to the main page', async () => {
    (validateCurrentToken as jest.Mock).mockResolvedValue(true);

    render(<LoginOptions />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/main'));
  });

  it('surfaces OAuth errors from the query string', () => {
    getSearchParam.mockReturnValue('bad%20state');

    render(<LoginOptions />);

    expect(screen.getByRole('alert')).toHaveTextContent('bad state');
  });
});
