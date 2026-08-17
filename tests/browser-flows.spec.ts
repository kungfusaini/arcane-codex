import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type PageRecord = {
  id: string;
  parentId: string | null;
  title: string;
  revision: number;
};

test('core local workspace flows survive reload and remain recoverable', async ({ page, request }, testInfo) => {
  const createRootResponse = await request.post('/api/pages', { data: { title: 'Field Notes' } });
  expect(createRootResponse.ok()).toBeTruthy();
  const root = (await createRootResponse.json()).page as PageRecord;

  const createChildResponse = await request.post('/api/pages', {
    data: { title: 'Index of Symbols', parentId: root.id, icon: '📚' },
  });
  expect(createChildResponse.ok()).toBeTruthy();
  const child = (await createChildResponse.json()).page as PageRecord;

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = await request.post('/api/assets', {
    multipart: {
      file: { name: 'cover.png', mimeType: 'image/png', buffer: png },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const asset = (await upload.json()).asset as { id: string };

  const contentJson = JSON.stringify([
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ', styles: {} },
        { type: 'link', href: `/page/${child.id}`, content: [{ type: 'text', text: child.title, styles: {} }] },
      ],
    },
    { type: 'image', props: { url: `/api/assets/${asset.id}`, caption: 'Cover study', name: 'cover.png' } },
  ]);
  const enrichRoot = await request.patch(`/api/pages/${root.id}`, {
    data: { revision: root.revision, title: root.title, icon: '🧭', coverAssetId: asset.id, contentJson },
  });
  expect(enrichRoot.ok()).toBeTruthy();

  await page.goto(`/page/${root.id}`);
  await expect(page.locator('.page-title')).toHaveValue('Field Notes');
  await expect(page.locator('.cover-preview-image')).toBeVisible();
  await expect(page.getByRole('button', { name: '🧭' })).toBeVisible();

  let delayed = false;
  await page.route(`**/api/pages/${root.id}`, async (route) => {
    if (route.request().method() === 'PATCH' && !delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    await route.continue();
  });
  await page.locator('.page-title').fill('First queued title');
  await page.waitForTimeout(750);
  await page.locator('.page-title').fill('Latest queued title');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 7_000 });
  await page.unroute(`**/api/pages/${root.id}`);
  await page.reload();
  await expect(page.locator('.page-title')).toHaveValue('Latest queued title');

  const pagesBefore = (await (await request.get('/api/pages')).json()).pages as PageRecord[];
  await page.getByRole('button', { name: 'New child page' }).click();
  await expect.poll(async () => ((await (await request.get('/api/pages')).json()).pages as PageRecord[]).length).toBe(pagesBefore.length + 1);
  const pagesAfter = (await (await request.get('/api/pages')).json()).pages as PageRecord[];
  const nested = pagesAfter.find((candidate) => !pagesBefore.some((before) => before.id === candidate.id));
  expect(nested?.parentId).toBe(root.id);

  await page.goto(`/page/${child.id}`);
  await expect(page.getByRole('heading', { name: 'Backlinks' })).toBeVisible();
  await expect(page.locator('.backlinks').getByRole('link', { name: 'Latest queued title' })).toBeVisible();

  const collectionResponse = await request.post('/api/collections', {
    data: {
      name: 'Research Threads',
      schema: { properties: [{ id: 'status', name: 'Status', type: 'select', options: ['Seed', 'Growing'] }] },
    },
  });
  expect(collectionResponse.ok()).toBeTruthy();
  const collection = (await collectionResponse.json()).collection as { id: string };
  for (const [pageId, status] of [[root.id, 'Growing'], [child.id, 'Seed']]) {
    const added = await request.post(`/api/collections/${collection.id}/items`, { data: { pageId, properties: { status } } });
    expect(added.ok()).toBeTruthy();
  }

  await page.goto(`/collections/${collection.id}`);
  await expect(page.locator('input[name="name"]')).toHaveValue('Research Threads');
  await page.locator('#filter-property').selectOption('status');
  await page.getByPlaceholder('Filter query').fill('No match');
  await expect(page.getByText('No entries match your current filter.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await page.getByRole('button', { name: 'View: Table' }).click();
  await expect(page.getByRole('button', { name: 'View: Gallery' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'View: Gallery' })).toBeVisible();

  const temporaryResponse = await request.post('/api/pages', { data: { title: 'Temporary page' } });
  const temporary = (await temporaryResponse.json()).page as PageRecord;
  await page.goto(`/page/${temporary.id}`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByText('This page is in trash. Restore it before editing.')).toBeVisible();
  await expect(page.locator('.trash-section').getByText('Temporary page')).toBeVisible();
  await page.locator('.trash-section').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('This page is in trash. Restore it before editing.')).toBeHidden();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export ZIP' }).click(),
  ]);
  const exportPath = testInfo.outputPath('workspace.zip');
  await download.saveAs(exportPath);
  const signature = (await readFile(exportPath)).subarray(0, 2).toString('ascii');
  expect(signature).toBe('PK');
});
