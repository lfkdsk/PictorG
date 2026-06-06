import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import GalleryPage from './page';
import { fetchGitHubFile } from '@/lib/github';

jest.mock('next/navigation', () => ({
  useParams: () => ({ owner: 'octo', repo: 'gallery' }),
}));

jest.mock('@/components/AuthGuard', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/lib/sqlite', () => ({
  openGalleryDb: jest.fn().mockResolvedValue({ exec: jest.fn() }),
}));

jest.mock('@/lib/annualSummary', () => ({
  parseGalleryConfig: jest.fn(() => ({
    siteUrl: 'https://octo.github.io/gallery',
    thumbnailUrl: 'https://cdn.example.com/thumbs/',
    baseUrl: 'https://cdn.example.com/base/',
  })),
  listExistingSummaryYears: jest.fn().mockResolvedValue([]),
  listYearsWithPhotos: jest.fn(() => []),
}));

jest.mock('@/lib/github', () => ({
  fetchGitHubFile: jest.fn(),
  getGitHubToken: jest.fn(() => 'token-123'),
  updateGitHubFile: jest.fn(),
  getFileSha: jest.fn(),
  encodeGitHubPath: (path: string) =>
    path.split('/').map((part) => encodeURIComponent(part)).join('/'),
}));

describe('GalleryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchGitHubFile as jest.Mock).mockImplementation(
      async (_token: string, _owner: string, _repo: string, path: string) => {
        if (path === 'CONFIG.yml') {
          return [
            'url: https://octo.github.io/gallery',
            'thumbnail_url: https://cdn.example.com/thumbs/',
            'base_url: https://cdn.example.com/base/',
            'backup_base_url: https://raw.example.com/base',
            'backup_thumbnail_url: https://raw.example.com/thumbs',
          ].join('\n');
        }

        if (path === 'README.yml') {
          return [
            'Ruby Lake:',
            '  url: RubyLakeTrail',
            '  date: "2025-08-31"',
            '  style: fullscreen',
            '  cover: RubyLakeTrail/IMG_3363.webp',
            '  location: [37.4158, -118.7716]',
            'City Walk:',
            '  url: City Walk',
            '  date: "2025-09-02"',
            '  style: fullscreen',
            '  cover: City Walk/cover.jpg',
          ].join('\n');
        }

        throw new Error(`Unexpected path ${path}`);
      }
    );
  });

  it('loads CONFIG.yml and README.yml into ordered album cards', async () => {
    render(<GalleryPage />);

    expect(await screen.findByRole('heading', { name: 'octo/gallery' })).toBeInTheDocument();
    expect(screen.getByText('共 2 个相册')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ruby Lake' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'City Walk' })).toBeInTheDocument();

    const cover = screen.getByAltText('Ruby Lake');
    expect(cover).toHaveAttribute(
      'src',
      expect.stringContaining('RubyLakeTrail%2FIMG_3363.webp')
    );

    await waitFor(() => {
      expect(fetchGitHubFile).toHaveBeenCalledWith(
        'token-123',
        'octo',
        'gallery',
        'CONFIG.yml'
      );
      expect(fetchGitHubFile).toHaveBeenCalledWith(
        'token-123',
        'octo',
        'gallery',
        'README.yml'
      );
    });
  });
});
