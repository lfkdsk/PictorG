import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GalleryManager from './GalleryManager';
import { listRepos } from '@/lib/github';

jest.mock('@/lib/github', () => ({
  listRepos: jest.fn(),
  createRepo: jest.fn(),
}));

const repos = [
  {
    id: 1,
    full_name: 'octo/gallery',
    html_url: 'https://github.com/octo/gallery',
  },
  {
    id: 2,
    full_name: 'octo/blog',
    html_url: 'https://github.com/octo/blog',
  },
];

describe('GalleryManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'gh_token=token-123; Path=/';
    (listRepos as jest.Mock).mockResolvedValue(repos);
  });

  it('loads repositories, imports a selected gallery, and persists it', async () => {
    render(<GalleryManager />);

    await screen.findByText('暂无画廊，请点击右上角“导入”或“新建”');
    fireEvent.click(screen.getByRole('button', { name: '导入' }));

    const option = await screen.findByRole('button', { name: 'octo/gallery' });
    fireEvent.click(option);

    const dialog = screen.getByText('导入画廊').closest('.dialog') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: '导入' }));

    expect(await screen.findByText('octo/gallery')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pictor_galleries') || '[]')).toEqual([
      {
        id: 1,
        full_name: 'octo/gallery',
        html_url: 'https://github.com/octo/gallery',
      },
    ]);
  });

  it('uses cached repositories before hitting GitHub again', async () => {
    localStorage.setItem('pictor_repos_cache', JSON.stringify(repos));

    render(<GalleryManager />);

    await screen.findByText('暂无画廊，请点击右上角“导入”或“新建”');
    fireEvent.click(screen.getByRole('button', { name: '导入' }));

    expect(await screen.findByRole('button', { name: 'octo/gallery' })).toBeInTheDocument();
    expect(listRepos).not.toHaveBeenCalled();
  });

  it('filters and removes cached galleries', async () => {
    localStorage.setItem(
      'pictor_galleries',
      JSON.stringify([
        { id: 1, full_name: 'octo/gallery', html_url: 'https://github.com/octo/gallery' },
        { id: 2, full_name: 'octo/blog', html_url: 'https://github.com/octo/blog' },
      ])
    );

    render(<GalleryManager />);

    fireEvent.change(screen.getByLabelText('search galleries'), {
      target: { value: 'blog' },
    });

    expect(screen.getByText('octo/blog')).toBeInTheDocument();
    expect(screen.queryByText('octo/gallery')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除' }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('pictor_galleries') || '[]')).toEqual([
        { id: 1, full_name: 'octo/gallery', html_url: 'https://github.com/octo/gallery' },
      ]);
    });
  });
});
