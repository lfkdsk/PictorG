import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CreateGalleryPage from './page';
import {
  checkTokenPermissions,
  createRepo,
  fetchImageAsBase64,
  importRepoToProject,
  initializeEmptyRepoWithBatch,
} from '@/lib/github';

const push = jest.fn();
const fetchMock = jest.fn();
let consoleLogSpy: jest.SpyInstance;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/lib/auth', () => ({
  getStoredUser: jest.fn(() => ({
    login: 'octo',
    name: 'Octo Cat',
    email: 'octo@example.com',
    avatar_url: 'https://example.com/avatar.png',
    html_url: 'https://github.com/octo',
  })),
}));

jest.mock('@/lib/github', () => ({
  getGitHubToken: jest.fn(() => 'token-123'),
  checkTokenPermissions: jest.fn(),
  checkRepositorySecret: jest.fn(),
  createRepo: jest.fn(),
  batchUploadFiles: jest.fn(),
  initializeEmptyRepo: jest.fn(),
  initializeEmptyRepoWithBatch: jest.fn(),
  importRepoToProject: jest.fn(),
  fetchImageAsBase64: jest.fn(),
}));

describe('CreateGalleryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({ status: 404, ok: false });
    (checkTokenPermissions as jest.Mock).mockResolvedValue({
      hasRepoAccess: true,
      hasWorkflowAccess: true,
      scopes: ['repo', 'workflow'],
    });
    (createRepo as jest.Mock).mockResolvedValue({
      id: 1,
      size: 0,
      full_name: 'octo/travel-gallery',
      html_url: 'https://github.com/octo/travel-gallery',
    });
    (fetchImageAsBase64 as jest.Mock).mockResolvedValue('aW1hZ2U=');
    (initializeEmptyRepoWithBatch as jest.Mock).mockResolvedValue(undefined);
    (importRepoToProject as jest.Mock).mockResolvedValue(true);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('walks the initialization wizard and uploads processed template files', async () => {
    render(<CreateGalleryPage />);

    expect(await screen.findByText('@octo')).toBeInTheDocument();
    expect(await screen.findByText(/repo, workflow/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('my-gallery'), {
      target: { value: 'travel-gallery' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /下一步/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    expect(screen.getByDisplayValue('Octo Cat')).toBeInTheDocument();
    expect(screen.getByDisplayValue('octo@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    fireEvent.change(screen.getByPlaceholderText('我的摄影画廊'), {
      target: { value: 'Travel Gallery' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建画廊' }));

    await waitFor(
      () => {
        expect(createRepo).toHaveBeenCalledWith('token-123', 'travel-gallery', false);
        expect(fetchImageAsBase64).toHaveBeenCalledWith('/gallery-assets/15.jpg');
        expect(initializeEmptyRepoWithBatch).toHaveBeenCalledWith(
          'token-123',
          'octo',
          'travel-gallery',
          expect.arrayContaining([
            expect.objectContaining({
              path: 'CONFIG.yml',
              content: expect.any(String),
            }),
            expect.objectContaining({
              path: '.github/workflows/main.yml',
              content: expect.any(String),
            }),
            expect.objectContaining({
              path: 'Cat/15.jpg',
              content: 'aW1hZ2U=',
            }),
          ]),
          'Initial gallery setup by PicG',
          'main'
        );
        expect(importRepoToProject).toHaveBeenCalledWith(
          expect.objectContaining({ full_name: 'octo/travel-gallery' })
        );
      },
      { timeout: 5_000 }
    );

    expect(await screen.findByText('画廊创建成功！')).toBeInTheDocument();
  }, 15_000);
});
