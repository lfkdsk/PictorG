import { expect, type Page, type Route, test } from '@playwright/test';

const user = {
  id: 1,
  login: 'octo',
  name: 'Octo Cat',
  email: 'octo@example.com',
  avatar_url: 'https://example.com/avatar.png',
  html_url: 'https://github.com/octo',
};

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

const configYml = [
  'url: https://octo.github.io/gallery',
  'thumbnail_url: https://cdn.example.com/thumbs/',
  'base_url: https://cdn.example.com/base/',
  'backup_base_url: https://raw.example.com/base',
  'backup_thumbnail_url: https://raw.example.com/thumbs',
].join('\n');

const readmeYml = [
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

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

function githubFile(text: string) {
  return {
    sha: 'file-sha',
    content: Buffer.from(text, 'utf8').toString('base64'),
  };
}

async function mockGitHubUser(page: Page) {
  await page.route('https://api.github.com/user', async (route) => {
    await fulfillJson(route, 200, user, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-OAuth-Scopes',
      'X-OAuth-Scopes': 'repo, workflow',
    });
  });
}

async function mockRepoList(page: Page) {
  await page.route('https://api.github.com/user/repos**', async (route) => {
    if (route.request().method() === 'POST') {
      await fulfillJson(route, 201, {
        id: 3,
        size: 0,
        full_name: 'octo/travel-gallery',
        html_url: 'https://github.com/octo/travel-gallery',
      });
      return;
    }

    await fulfillJson(route, 200, repos);
  });
}

async function mockGalleryRead(page: Page) {
  await page.route('https://api.github.com/repos/octo/gallery/contents/CONFIG.yml**', async (route) => {
    await fulfillJson(route, 200, githubFile(configYml));
  });
  await page.route('https://api.github.com/repos/octo/gallery/contents/README.yml**', async (route) => {
    await fulfillJson(route, 200, githubFile(readmeYml));
  });
  await page.route(
    'https://api.github.com/repos/octo/gallery/contents/.analysis/annual-summary**',
    async (route) => {
      await fulfillJson(route, 404, { message: 'Not Found' });
    }
  );
  await page.route('https://octo.github.io/gallery/sqlite.db', async (route) => {
    await route.fulfill({ status: 404, body: '' });
  });
  await page.route('https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/sql-wasm.wasm', async (route) => {
    await route.fulfill({ status: 404, body: '' });
  });
}

async function seedToken(page: Page) {
  await page.context().addCookies([
    {
      name: 'gh_token',
      value: 'token-123',
      domain: '127.0.0.1',
      path: '/',
    },
  ]);
  await page.addInitScript(() => {
    localStorage.setItem('gh_token', 'token-123');
  });
}

async function mockBatchGitEndpoints(
  page: Page,
  owner: string,
  repo: string,
  treeBodies: unknown[],
  options: { includeRepoInfo?: boolean } = {}
) {
  if (options.includeRepoInfo ?? true) {
    await page.route(`https://api.github.com/repos/${owner}/${repo}`, async (route) => {
      await fulfillJson(route, 200, { default_branch: 'main' });
    });
  }
  await page.route(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`,
    async (route) => {
      await fulfillJson(route, 200, { object: { sha: 'head-sha' } });
    }
  );
  await page.route(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/head-sha`,
    async (route) => {
      await fulfillJson(route, 200, { tree: { sha: 'base-tree-sha' } });
    }
  );
  await page.route(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, async (route) => {
    await fulfillJson(route, 201, { sha: `blob-${Date.now()}` });
  });
  await page.route(`https://api.github.com/repos/${owner}/${repo}/git/trees`, async (route) => {
    treeBodies.push(route.request().postDataJSON());
    await fulfillJson(route, 201, { sha: 'new-tree-sha' });
  });
  await page.route(`https://api.github.com/repos/${owner}/${repo}/git/commits`, async (route) => {
    await fulfillJson(route, 201, { sha: 'new-commit-sha' });
  });
}

test.beforeEach(async ({ page }) => {
  await mockGitHubUser(page);
});

test('token login validates, caches the token, and opens the main page', async ({ page }) => {
  await page.goto('/login/token');

  await page.getByLabel('github-token').fill('token-123');
  await page.getByRole('button', { name: '保存' }).click();

  await page.waitForURL('**/main');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gh_token')))
    .toBe('token-123');
});

test('imports a gallery and renders albums from CONFIG.yml and README.yml', async ({ page }) => {
  await seedToken(page);
  await mockRepoList(page);
  await mockGalleryRead(page);

  await page.goto('/main');
  await page.getByRole('button', { name: '导入' }).click();
  await page.getByRole('button', { name: 'octo/gallery' }).click();
  await page.getByRole('button', { name: '导入' }).last().click();

  await expect(page.getByText('octo/gallery')).toBeVisible();
  await page.getByRole('link', { name: '打开' }).click();

  await expect(page).toHaveURL(/\/gallery\/octo\/gallery$/);
  await expect(page.getByRole('heading', { name: 'octo/gallery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ruby Lake' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'City Walk' })).toBeVisible();
});

test('uploads selected album files through the batch GitHub flow', async ({ page }) => {
  const treeBodies: any[] = [];
  await seedToken(page);
  await mockBatchGitEndpoints(page, 'octo', 'gallery', treeBodies);

  await page.goto('/gallery/octo/gallery/RubyLakeTrail/upload');
  await page.setInputFiles('#file-input', [
    {
      name: 'PHOTO.JPG',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('image-data'),
    },
    {
      name: 'PHOTO.MOV',
      mimeType: 'video/quicktime',
      buffer: Buffer.from('video-data'),
    },
  ]);

  await expect(page.getByText('PHOTO.JPG')).toBeVisible();
  await expect(page.getByText('PHOTO.MOV')).toBeVisible();

  const dialogPromise = page.waitForEvent('dialog');
  await page.getByRole('button', { name: /开始上传/ }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('成功上传 2 个文件');
  await dialog.accept();

  await expect.poll(() => treeBodies.length).toBe(1);
  expect(treeBodies[0].tree.map((item: { path: string }) => item.path)).toEqual([
    'RubyLakeTrail/PHOTO.jpg',
    'RubyLakeTrail/PHOTO.mov',
  ]);
});

test('creates a new gallery repository from the template wizard', async ({ page }) => {
  const treeBodies: any[] = [];
  let createdRepoBody: any = null;

  await seedToken(page);
  await mockRepoList(page);
  await page.route('https://api.github.com/repos/octo/travel-gallery', async (route) => {
    await fulfillJson(route, 404, { message: 'Not Found' });
  });
  await page.route(
    'https://api.github.com/repos/octo/travel-gallery/contents/CONFIG.yml',
    async (route) => {
      if (route.request().method() === 'PUT') {
        await fulfillJson(route, 201, { content: { sha: 'config-sha' } });
        return;
      }
      await fulfillJson(route, 404, { message: 'Not Found' });
    }
  );
  await mockBatchGitEndpoints(page, 'octo', 'travel-gallery', treeBodies, {
    includeRepoInfo: false,
  });
  await page.route('https://api.github.com/user/repos', async (route) => {
    createdRepoBody = route.request().postDataJSON();
    await fulfillJson(route, 201, {
      id: 3,
      size: 0,
      full_name: 'octo/travel-gallery',
      html_url: 'https://github.com/octo/travel-gallery',
    });
  });

  await page.goto('/create-gallery');
  await expect(page.getByText('@octo')).toBeVisible();
  await expect(page.getByText(/repo, workflow/)).toBeVisible();

  await page.getByPlaceholder('my-gallery').fill('travel-gallery');
  await expect(page.getByRole('button', { name: /下一步/ })).toBeEnabled();
  await page.getByRole('button', { name: /下一步/ }).click();

  await expect(page.getByPlaceholder('Your Name')).toHaveValue('Octo Cat');
  await expect(page.getByPlaceholder('your.email@example.com')).toHaveValue('octo@example.com');
  await page.getByRole('button', { name: /下一步/ }).click();

  await page.getByPlaceholder('我的摄影画廊').fill('Travel Gallery');
  await page.getByRole('button', { name: '创建画廊' }).click();

  await expect(page.getByText('画廊创建成功！')).toBeVisible({ timeout: 15_000 });
  expect(createdRepoBody).toEqual({ name: 'travel-gallery', private: false });
  expect(treeBodies[0].tree.some((item: { path: string }) => item.path === 'README.yml')).toBe(true);
});
