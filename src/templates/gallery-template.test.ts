import {
  getGalleryTemplate,
  processTemplateFiles,
  replaceTemplateVariables,
} from './gallery-template';

const variables = {
  USER_NAME: 'octo',
  REPO_NAME: 'travel-gallery',
  GIT_USER: 'Octo Cat',
  GIT_EMAIL: 'octo@example.com',
  GALLERY_TITLE: 'Travel Gallery',
  GALLERY_SUBTITLE: 'Shot on the road',
  GALLERY_DESCRIPTION: 'A tested gallery template',
  FOOTER_LINK: 'https://example.com',
};

describe('gallery template processing', () => {
  it('replaces all matching variable placeholders', () => {
    expect(
      replaceTemplateVariables('https://{{USER_NAME}}.github.io/{{REPO_NAME}}', variables)
    ).toBe('https://octo.github.io/travel-gallery');
  });

  it('keeps template file metadata while processing text content', () => {
    const files = processTemplateFiles(getGalleryTemplate(), variables);

    const config = files.find((file) => file.path === 'CONFIG.yml');
    const workflow = files.find((file) => file.path === '.github/workflows/main.yml');
    const demoImage = files.find((file) => file.path === 'Cat/15.jpg');

    expect(config?.content).toContain('title: Travel Gallery');
    expect(config?.content).toContain('url: https://octo.github.io/travel-gallery');
    expect(config?.content).toContain(
      'thumbnail_url: https://cdn.jsdelivr.net/gh/octo/travel-gallery@thumbnail/'
    );
    expect(workflow?.content).toContain('GIT_USER: Octo Cat');
    expect(workflow?.content).toContain('GIT_EMAIL: octo@example.com');
    expect(demoImage).toMatchObject({
      encoding: 'base64',
      url: '/gallery-assets/15.jpg',
    });
  });
});
