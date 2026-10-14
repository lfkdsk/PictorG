import {
  originalUploadSize,
  resolveUploadFile,
  settleDefaultVariant,
} from './uploadVariant';

function file(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

function setOutputFormat(outputFormat: string) {
  localStorage.setItem('compressionSettings', JSON.stringify({ outputFormat }));
}

describe('uploadVariant', () => {
  afterEach(() => localStorage.clear());

  it('keeps the smaller-wins default for browser-displayable originals', async () => {
    const toJpeg = jest.fn();
    const original = file('a.jpg', 100, 'image/jpeg');
    const bigger = file('a.webp', 150, 'image/webp');
    await expect(settleDefaultVariant(original, bigger, toJpeg)).resolves.toEqual({
      useOriginal: true,
    });
    expect(toJpeg).not.toHaveBeenCalled();
  });

  it('does not transcode a HEIC whose compressed encode is already smaller', async () => {
    const toJpeg = jest.fn();
    const heic = file('IMG.HEIC', 200, 'image/heic');
    const compressed = file('IMG.jpg', 150, 'image/jpeg');
    await expect(settleDefaultVariant(heic, compressed, toJpeg)).resolves.toEqual({
      useOriginal: false,
    });
    expect(toJpeg).not.toHaveBeenCalled();
  });

  it('weighs a larger HDR encode against a JPEG transcode, never the raw HEIC', async () => {
    setOutputFormat('ultrahdr');
    const heic = file('IMG.HEIC', 200, 'image/heic');
    const hdr = file('IMG.jpg', 300, 'image/jpeg');
    const sdr = file('IMG.jpg', 180, 'image/jpeg');
    const toJpeg = jest.fn().mockResolvedValue(sdr);

    const settled = await settleDefaultVariant(heic, hdr, toJpeg);
    expect(settled).toEqual({ originalJpeg: sdr, useOriginal: true });

    const photo = { original: heic, compressed: hdr, ...settled };
    expect(originalUploadSize(photo)).toBe(180);
    await expect(resolveUploadFile(photo, toJpeg)).resolves.toBe(sdr);
  });

  it('keeps the compressed encode when the transcode fails', async () => {
    setOutputFormat('ultrahdr');
    const heic = file('IMG.HEIC', 200, 'image/heic');
    const hdr = file('IMG.jpg', 300, 'image/jpeg');
    const toJpeg = jest.fn().mockRejectedValue(new Error('sips missing'));
    await expect(settleDefaultVariant(heic, hdr, toJpeg)).resolves.toEqual({
      useOriginal: false,
    });
  });

  it('transcodes on upload when the user flips a HEIC to original', async () => {
    const heic = file('IMG.HEIC', 200, 'image/heic');
    const webp = file('IMG.webp', 120, 'image/webp');
    const sdr = file('IMG.jpg', 160, 'image/jpeg');
    const toJpeg = jest.fn().mockResolvedValue(sdr);
    await expect(
      resolveUploadFile({ original: heic, compressed: webp, useOriginal: true }, toJpeg)
    ).resolves.toBe(sdr);
    await expect(
      resolveUploadFile({ original: heic, compressed: webp, useOriginal: false }, toJpeg)
    ).resolves.toBe(webp);
  });
});
