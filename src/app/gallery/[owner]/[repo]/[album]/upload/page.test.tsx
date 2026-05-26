import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlbumUploadPage from './page';
import { compressImage } from '@/lib/compress-image';
import { batchUploadFiles, fileToBase64 } from '@/lib/github';

jest.mock('next/navigation', () => ({
  useParams: () => ({ owner: 'octo', repo: 'gallery', album: 'RubyLakeTrail' }),
}));

jest.mock('@/lib/compress-image', () => ({
  compressImage: jest.fn(),
}));

jest.mock('@/lib/github', () => ({
  batchUploadFiles: jest.fn(),
  fileToBase64: jest.fn(),
  getGitHubToken: jest.fn(() => 'token-123'),
  decodeGitHubPath: (path: string) => decodeURIComponent(path),
  encodeGitHubPath: (path: string) =>
    path.split('/').map((part) => encodeURIComponent(part)).join('/'),
}));

describe('AlbumUploadPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (compressImage as jest.Mock).mockImplementation(async (file: File) => {
      if (file.type.startsWith('image/')) {
        return new File(['tiny-webp'], 'photo.webp', { type: 'image/webp' });
      }
      return file;
    });
    (fileToBase64 as jest.Mock).mockImplementation(async (file: File) => `base64:${file.name}`);
    (batchUploadFiles as jest.Mock).mockResolvedValue(undefined);
  });

  it('selects unrestricted files, compresses images, and batch uploads final files', async () => {
    const { container } = render(<AlbumUploadPage />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    const image = new File(['original-image-data'], 'PHOTO.JPG', { type: 'image/jpeg' });
    const sidecar = new File(['live-photo-data'], 'PHOTO.MOV', { type: 'video/quicktime' });

    fireEvent.change(input, { target: { files: [image, sidecar] } });

    expect(await screen.findByText('选中的文件 (2)')).toBeInTheDocument();
    expect(screen.getByText('PHOTO.JPG')).toBeInTheDocument();
    expect(screen.getByText('PHOTO.MOV')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /压缩/ }));

    expect(await screen.findByText('photo.webp')).toBeInTheDocument();
    expect(compressImage).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /开始上传/ }));

    await waitFor(() => {
      expect(batchUploadFiles).toHaveBeenCalledWith(
        'token-123',
        'octo',
        'gallery',
        [
          { path: 'RubyLakeTrail/photo.webp', content: 'base64:photo.webp' },
          { path: 'RubyLakeTrail/PHOTO.mov', content: 'base64:PHOTO.MOV' },
        ],
        'Upload 2 images to RubyLakeTrail'
      );
    });
    expect(window.alert).toHaveBeenCalledWith('成功上传 2 个文件');
  });
});
