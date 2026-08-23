import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { buildPagePathFromPages } from '../src/lib/pageUrls';

type MotionSample = {
  tx: number;
  opacity: number;
};

test.use({ video: 'on' });

function parseDelayMs(rawDelay: string): number {
  const trimmed = rawDelay.trim();
  if (trimmed.endsWith('ms')) {
    return parseFloat(trimmed);
  }
  if (trimmed.endsWith('s')) {
    return parseFloat(trimmed) * 1_000;
  }
  return Number.parseFloat(trimmed);
}

const PASTE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type ClipboardUploadFile = {
  name: string;
  mimeType: string;
  base64: string;
};

type PageBlock = {
  type: string;
  content?: unknown[];
  props?: {
    caption?: string;
    [key: string]: unknown;
  };
};

function parsePageBlocks(contentJson: string): PageBlock[] {
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as PageBlock[];
    }
  } catch {
    // keep empty on malformed payloads
  }
  return [];
}

function blockText(block: PageBlock): string {
  if (block.type !== 'paragraph' || !Array.isArray(block.content)) {
    return '';
  }
  return block.content
    .map((item) => {
      if (item && typeof item === 'object' && 'type' in item && 'text' in item) {
        const text = (item as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

function findTopLevelParagraph(blocks: PageBlock[], text: string): number {
  return blocks.findIndex((block) => blockText(block) === text);
}

function blockSignature(block: PageBlock): string {
  if (block.type === 'paragraph') {
    return `paragraph:${blockText(block)}`;
  }
  if (block.type === 'gallery' && typeof block.props?.images === 'string') {
    try {
      const images = JSON.parse(block.props.images) as unknown;
      if (Array.isArray(images)) {
        const captions = images.map((image) => image && typeof image === 'object' ? (image as { caption?: unknown }).caption : '').filter(Boolean).join('|');
        return `gallery:${captions}`;
      }
    } catch {
      // Fall through to block type.
    }
  }
  return block.type;
}

async function readMotion(locator: Locator): Promise<MotionSample> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : style.transform);
    return {
      tx: matrix.e,
      opacity: Number(style.opacity),
    };
  });
}

async function loadPageBlocks(request: APIRequestContext, pageId: string): Promise<PageBlock[]> {
  const response = await request.get(`/api/pages/${pageId}`);
  const payload = (await response.json()) as { page?: { contentJson: string } };
  return parsePageBlocks(payload.page?.contentJson ?? '[]');
}

async function dispatchPasteIntoEditor(page: Page, editorSelector: string, file: ClipboardUploadFile) {
  await page.evaluate(({ selector, name, mimeType, base64 }) => {
    const editor = document.querySelector(selector);
    if (!(editor instanceof HTMLElement)) {
      return;
    }

    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const uploadFile = new File([bytes], name, { type: mimeType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(uploadFile);

    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
    editor.dispatchEvent(event);
  }, {
    selector: editorSelector,
    name: file.name,
    mimeType: file.mimeType,
    base64: file.base64,
  });
}

async function dispatchDropIntoEditor(page: Page, editorSelector: string, file: ClipboardUploadFile, x: number, y: number) {
  await page.evaluate(({ selector, name, mimeType, base64, x, y }) => {
    const editor = document.querySelector(selector);
    if (!(editor instanceof HTMLElement)) {
      return;
    }

    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const uploadFile = new File([bytes], name, { type: mimeType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(uploadFile);
    dataTransfer.effectAllowed = 'copy';

    const createDragEvent = (type: 'dragenter' | 'dragover' | 'drop' | 'dragleave') => {
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      return event;
    };

    editor.dispatchEvent(createDragEvent('dragenter'));
    editor.dispatchEvent(createDragEvent('dragover'));
    editor.dispatchEvent(createDragEvent('drop'));
    editor.dispatchEvent(createDragEvent('dragleave'));
  }, {
    selector: editorSelector,
    name: file.name,
    mimeType: file.mimeType,
    base64: file.base64,
    x,
    y,
  });
}

type PageRecord = {
  id: string;
  parentId: string | null;
  sortKey: number;
  title: string;
  revision: number;
};

test('core local workspace flows survive reload and remain recoverable', async ({ page, request }) => {
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
        { type: 'link', href: buildPagePathFromPages(child.id, [root, child]), content: [{ type: 'text', text: child.title, styles: {} }] },
      ],
    },
    { type: 'gallery', props: { images: JSON.stringify([{ url: `/api/assets/${asset.id}`, caption: 'Cover study', name: 'cover.png' }]), columns: 3, mode: 'single', captionMode: 'individual', groupCaption: '', width: 100 } },
  ]);
  const enrichRoot = await request.patch(`/api/pages/${root.id}`, {
    data: { revision: root.revision, title: root.title, icon: '🧭', coverAssetId: asset.id, contentJson },
  });
  expect(enrichRoot.ok()).toBeTruthy();

  await page.goto(buildPagePathFromPages(root.id, [root, child]));
  await expect(page.locator('.page-title')).toHaveValue('Field Notes');
  await expect(page.locator('.page-child-links').getByRole('link', { name: /Index of Symbols/ })).toHaveAttribute('href', buildPagePathFromPages(child.id, [root, child]));
  await expect(page.locator('.cover-preview-image')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change page icon' })).toHaveText('🧭');
  await page.keyboard.press('Control+k');
  const workspaceSearch = page.getByRole('search').getByLabel('Search pages');
  await expect(workspaceSearch).toBeFocused();
  await workspaceSearch.fill('Field');
  await page.keyboard.press('Escape');
  await expect(workspaceSearch).toHaveValue('');

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.sidebar')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.sidebar')).not.toHaveAttribute('aria-hidden', 'true');

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
  await expect.poll(async () => {
    const response = await request.get(`/api/pages/${root.id}`);
    return ((await response.json()).page as PageRecord).title;
  }, { timeout: 7_000 }).toBe('Latest queued title');
  await page.unroute(`**/api/pages/${root.id}`);
  await page.reload();
  await expect(page.locator('.page-title')).toHaveValue('Latest queued title');

  const pagesBefore = (await (await request.get('/api/pages')).json()).pages as PageRecord[];
  await page.getByRole('button', { name: 'New child page' }).click();
  await expect.poll(async () => ((await (await request.get('/api/pages')).json()).pages as PageRecord[]).length).toBe(pagesBefore.length + 1);
  const pagesAfter = (await (await request.get('/api/pages')).json()).pages as PageRecord[];
  const nested = pagesAfter.find((candidate) => !pagesBefore.some((before) => before.id === candidate.id));
  expect(nested?.parentId).toBe(root.id);
  await page.waitForLoadState('networkidle');

  await page.goto(`/page/${child.id}`);
  await expect(page.getByRole('heading', { name: 'Backlinks' })).toHaveCount(0);

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
  await expect(page.getByText('No entries match the current search or filter.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filter' }).click();
  const galleryTab = page.getByRole('tab', { name: /Gallery/ });
  await galleryTab.click();
  await expect(galleryTab).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('tab', { name: /Gallery/ })).toHaveAttribute('aria-selected', 'true');

  const temporaryResponse = await request.post('/api/pages', { data: { title: 'Temporary page' } });
  const temporary = (await temporaryResponse.json()).page as PageRecord;
  await page.goto(`/page/${temporary.id}`);
  await page.getByRole('button', { name: 'Page actions' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByText('This page is in trash. Restore it before editing.')).toBeVisible();
  await page.locator('.trash-section').getByText('Trash').click();
  await expect(page.locator('.trash-section').getByText('Temporary page')).toBeVisible();
  await page.locator('.trash-section').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('This page is in trash. Restore it before editing.')).toBeHidden();

});

test('shows page appearance affordances and selects a searchable emoji icon', async ({ page, request }) => {
  const createResponse = await request.post('/api/pages', { data: { title: 'Fresh page' } });
  expect(createResponse.ok()).toBeTruthy();
  const freshPage = (await createResponse.json()).page as PageRecord;

  await page.goto(`/page/${freshPage.id}`);
  const identity = page.locator('.page-identity');
  await identity.hover();
  await expect(page.getByRole('button', { name: 'Add icon' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add cover', exact: true })).toBeVisible();
  const coverChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add cover', exact: true }).click();
  await (await coverChooser).setFiles({
    name: 'fresh-cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.locator('.cover-preview-image')).toBeVisible();

  await page.getByRole('button', { name: 'Add icon' }).click();
  const emojiPopover = page.getByRole('dialog', { name: 'Choose page icon' });
  await expect(emojiPopover).toBeVisible();
  const picker = emojiPopover.locator('em-emoji-picker');
  await expect(picker).toBeVisible();
  const search = picker.locator('input[type="search"]');
  await search.fill('dragon');
  const dragon = picker.locator('button[title="Dragon"]');
  await expect(dragon).toBeVisible();
  await dragon.click();

  await expect(emojiPopover).toBeHidden();
  const titleRow = page.locator('.page-title-row');
  await expect(titleRow.getByRole('button', { name: 'Change page icon' })).toHaveText(/🐉/);
  await expect(titleRow.locator('.page-title')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.querySelector('.page-icon'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Change page icon' })).toHaveText(/🐉/);

  await page.getByRole('button', { name: 'Change page icon' }).click();
  await emojiPopover.getByRole('tab', { name: 'Settings' }).click();
  await expect(emojiPopover.getByText('This page already uses an emoji icon.')).toBeVisible();
  await expect(emojiPopover.getByRole('button', { name: 'Remove icon' })).toBeVisible();
  await expect(emojiPopover.getByLabel('Generate icon')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(emojiPopover).toBeHidden();
  await expect(page.getByRole('button', { name: 'Change page icon' })).toBeFocused();
});

test('allows choosing an uploaded icon image', async ({ page, request }) => {
  const freshResponse = await request.post('/api/pages', { data: { title: 'Page with image icon' } });
  expect(freshResponse.ok()).toBeTruthy();
  const freshPage = (await freshResponse.json()).page as PageRecord;

  await page.goto(`/page/${freshPage.id}`);
  await page.locator('.page-identity').hover();
  await page.getByRole('button', { name: 'Add icon' }).click();

  const iconFileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload image' }).click();
  await (await iconFileChooser).setFiles({
    name: 'icon-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });

  const iconButton = page.getByRole('button', { name: 'Change page icon' });
  await expect(iconButton.locator('img')).toHaveAttribute('src', /\/api\/assets\//);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Change page icon' }).locator('img')).toHaveAttribute('src', /\/api\/assets\//);
});

test('allows choosing an icon image from URL', async ({ page, request }) => {
  const freshResponse = await request.post('/api/pages', { data: { title: 'Page icon from URL' } });
  expect(freshResponse.ok()).toBeTruthy();
  const freshPage = (await freshResponse.json()).page as PageRecord;

  const iconImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const iconUpload = await request.post('/api/assets', {
    multipart: {
      file: {
        name: 'icon-image.png',
        mimeType: 'image/png',
        buffer: iconImage,
      },
    },
  });
  expect(iconUpload.ok()).toBeTruthy();
  const importedAsset = (await iconUpload.json()).asset as { id: string };

  await page.route('**/api/assets/import', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ asset: importedAsset }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/page/${freshPage.id}`);
  await page.locator('.page-identity').hover();
  await page.getByRole('button', { name: 'Add icon' }).click();

  await page.getByLabel('Icon image URL').fill('https://example.com/icon.png');
  await page.getByRole('button', { name: 'Use image URL' }).click();

  const iconButton = page.getByRole('button', { name: 'Change page icon' });
  await expect(iconButton.locator('img')).toHaveAttribute('src', new RegExp(`/api/assets/${importedAsset.id}`));
  await page.unroute('**/api/assets/import');
});

test('shows the generated icon prompt when an image icon is selected', async ({ page, request }) => {
  const createResponse = await request.post('/api/pages', { data: { title: 'Generated icon prompt page' } });
  expect(createResponse.ok()).toBeTruthy();
  const freshPage = (await createResponse.json()).page as PageRecord;

  const iconImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const iconUpload = await request.post('/api/assets', {
    multipart: {
      file: {
        name: 'icon-image.png',
        mimeType: 'image/png',
        buffer: iconImage,
      },
    },
  });
  expect(iconUpload.ok()).toBeTruthy();
  const importedAsset = (await iconUpload.json()).asset as { id: string };

  await page.route('**/api/page-icon-generate', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ asset: importedAsset }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/page/${freshPage.id}`);
  await page.locator('.page-identity').hover();
  await page.getByRole('button', { name: 'Add icon' }).click();
  const emojiPopover = page.getByRole('dialog', { name: 'Choose page icon' });
  await emojiPopover.getByRole('tab', { name: 'Settings' }).click();
  await emojiPopover.getByLabel('Generate icon').fill('The Mona Lisa Very simple');
  await emojiPopover.getByRole('button', { name: 'Generate' }).click();
  await expect(emojiPopover.getByText('Prompt: The Mona Lisa Very simple')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change page icon' }).locator('img')).toHaveAttribute('src', new RegExp(`/api/assets/${importedAsset.id}`));

  await page.unroute('**/api/page-icon-generate');
});

test('toggles local published preview on editor routes without changing the URL', async ({ page, request }) => {
  const createResponse = await request.post('/api/pages', { data: { title: 'Preview toggle source' } });
  expect(createResponse.ok()).toBeTruthy();
  const previewPage = (await createResponse.json()).page as PageRecord;

  await page.goto(`/page/${previewPage.id}`);
  await expect(page.locator('.editor-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Page actions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add icon' })).toBeVisible();

  const previewButton = page.locator('section[aria-label="Published preview mode"]').getByRole('button');
  await expect(previewButton).toHaveText('Preview published');
  const editorUrl = page.url();

  await previewButton.click();
  await expect(page).toHaveURL(editorUrl);
  await expect(previewButton).toHaveText('Back to editor');
  await expect(page.getByRole('button', { name: 'Page actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add icon' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Untitled' })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(editorUrl);
  await expect(page.locator('section[aria-label="Published preview mode"]').getByRole('button')).toHaveText('Back to editor');
  await expect(page.getByRole('button', { name: 'Page actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add icon' })).toHaveCount(0);

  await page.locator('section[aria-label="Published preview mode"]').getByRole('button').click();
  await expect(page).toHaveURL(editorUrl);
  await expect(page.locator('section[aria-label="Published preview mode"]').getByRole('button')).toHaveText('Preview published');
  await expect(page.getByRole('button', { name: 'Page actions' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add icon' })).toBeVisible();
});

test('renders a read-only published site that reflects live workspace content', async ({ page, request }) => {
  const rootResponse = await request.post('/api/pages', { data: { title: 'Published root' } });
  expect(rootResponse.ok()).toBeTruthy();
  const root = (await rootResponse.json()).page as PageRecord;

  const childResponse = await request.post('/api/pages', { data: { title: 'Published child', parentId: root.id } });
  expect(childResponse.ok()).toBeTruthy();
  const child = (await childResponse.json()).page as PageRecord;

  const normalChildResponse = await request.post('/api/pages', { data: { title: 'Published normal child', parentId: root.id } });
  expect(normalChildResponse.ok()).toBeTruthy();
  const normalChild = (await normalChildResponse.json()).page as PageRecord;

  const collectionResponse = await request.post('/api/collections', {
    data: {
      name: 'Published collection',
      hostPageId: root.id,
      schema: { properties: [{ id: 'status', name: 'Status', type: 'text' }] },
    },
  });
  expect(collectionResponse.ok()).toBeTruthy();
  const collection = (await collectionResponse.json()).collection as { id: string };
  const itemResponse = await request.post(`/api/collections/${collection.id}/items`, {
    data: { pageId: child.id, properties: { status: 'Live' } },
  });
  expect(itemResponse.ok()).toBeTruthy();

  await page.goto('/published');
  await expect(page.locator('section[aria-label="Published preview mode"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview published' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to editor' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New page' })).toHaveCount(0);
  await expect(page.getByLabel('Search pages')).toBeVisible();
  await expect(page.locator('.workspace-settings')).toHaveCount(0);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Collections' })).toHaveCount(0);

  await page.goto('/published/collections');
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.getByText('Published collection')).toBeVisible();
  await expect(page.getByText('New collection')).toHaveCount(0);

  await page.goto(`/published/collections/${collection.id}`);
  await expect(page.getByRole('heading', { name: 'Published collection' })).toBeVisible();
  await expect(page.locator('.collection-table').getByRole('link', { name: /Published child/ })).toHaveAttribute('href', buildPagePathFromPages(child.id, [root, child], '/published'));
  await expect(page.locator('.collection-table input')).toHaveCount(0);
  await expect(page.getByText('Delete collection')).toHaveCount(0);

  const publishedPath = buildPagePathFromPages(root.id, [root, child], '/published');
  await page.goto(publishedPath);
  await expect(page.locator('section[aria-label="Published preview mode"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview published' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to editor' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Page actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add icon' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add cover', exact: true })).toHaveCount(0);
  await expect(page.locator('.editor-view .bn-editor[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Published child' })).toHaveCount(0);
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Published normal child' })).toBeVisible();
  await expect(page.locator('.page-child-links').getByRole('link', { name: /Published normal child/ })).toHaveAttribute('href', buildPagePathFromPages(normalChild.id, [root, child, normalChild], '/published'));
  await expect(page.locator('.page-child-links').getByRole('link', { name: /Published child/ })).toHaveCount(0);
  await expect(page.getByText('Live')).toBeVisible();
  await expect(page.locator('.collection-table input')).toHaveCount(0);
});

test('renders custom slash and mention suggestion menus without BlockNote UI context errors', async ({ page, request }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  const targetResponse = await request.post('/api/pages', { data: { title: 'Target reference', icon: '🎯' } });
  expect(targetResponse.ok()).toBeTruthy();
  const target = (await targetResponse.json()).page as PageRecord;

  const slashSourceResponse = await request.post('/api/pages', { data: { title: 'Slash menu source' } });
  expect(slashSourceResponse.ok()).toBeTruthy();
  const slashSource = (await slashSourceResponse.json()).page as PageRecord;

  await page.goto(`/page/${slashSource.id}`);
  await page.locator('.editor-view').click();
  const slashEditor = page.locator('.editor-view .bn-editor[contenteditable="true"]');
  await expect(slashEditor).toBeVisible();
  await slashEditor.click();
  await page.keyboard.type('/');
  const slashMenu = page.getByRole('listbox', { name: 'Editor suggestions' });
  await expect(slashMenu).toBeVisible();
  expect(await slashMenu.getByRole('option').count()).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(slashMenu).toBeHidden();

  const mentionSourceResponse = await request.post('/api/pages', { data: { title: 'Mention menu source' } });
  expect(mentionSourceResponse.ok()).toBeTruthy();
  const mentionSource = (await mentionSourceResponse.json()).page as PageRecord;

  await page.goto(`/page/${mentionSource.id}`);
  await page.locator('.editor-view').click();
  const mentionEditor = page.locator('.editor-view .bn-editor[contenteditable="true"]');
  await expect(mentionEditor).toBeVisible();
  await mentionEditor.click();
  await page.keyboard.type('@Tar');
  const mentionMenu = page.getByRole('listbox', { name: 'Editor suggestions' });
  await expect(mentionMenu).toBeVisible();
  const targetOption = mentionMenu.getByRole('option', { name: /Target reference/ });
  await expect(targetOption).toBeVisible();
  await targetOption.click();
  await expect(mentionMenu).toBeHidden();
  await expect(page.locator(`.editor-view a[href="${buildPagePathFromPages(target.id, [target])}"]`)).toBeVisible();

  expect(pageErrors.map((error) => error.stack ?? error.message)).toEqual([]);
});

test('rolls back a failed inline collection edit and recovers on retry', async ({ page, request }) => {
  const pageResponse = await request.post('/api/pages', { data: { title: 'Inline edit row' } });
  expect(pageResponse.ok()).toBeTruthy();
  const pageRecord = (await pageResponse.json()).page as PageRecord;
  const collectionResponse = await request.post('/api/collections', {
    data: {
      name: 'Inline edit collection',
      schema: { properties: [{ id: 'notes', name: 'Notes', type: 'text' }] },
    },
  });
  expect(collectionResponse.ok()).toBeTruthy();
  const collection = (await collectionResponse.json()).collection as { id: string };
  const addResponse = await request.post(`/api/collections/${collection.id}/items`, {
    data: { pageId: pageRecord.id, properties: { notes: '' } },
  });
  expect(addResponse.ok()).toBeTruthy();

  await page.goto(`/collections/${collection.id}`);
  const field = page.getByPlaceholder('Notes');
  await expect(field).toBeVisible();

  let failNextPatch = true;
  await page.route(`**/api/collections/${collection.id}/items`, async (route) => {
    if (route.request().method() === 'PATCH' && failNextPatch) {
      failNextPatch = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated failure' }) });
      return;
    }
    await route.continue();
  });

  await field.fill('Draft value');
  await field.press('Enter');
  const cell = field.locator('xpath=ancestor::td[contains(@class, "collection-cell")]');
  await expect(cell).toHaveClass(/is-error/);
  await expect(field).toHaveValue('');
  await expect(cell.getByText('Not saved')).toBeVisible();

  await field.fill('Saved value');
  await field.press('Enter');
  await expect(cell).not.toHaveClass(/is-error/);
  await expect.poll(async () => {
    const response = await request.get(`/api/collections/${collection.id}`);
    const payload = await response.json() as { items: Array<{ pageId: string; propertiesJson: string }> };
    const item = payload.items.find((entry) => entry.pageId === pageRecord.id);
    return item ? (JSON.parse(item.propertiesJson) as { notes?: string }).notes : undefined;
  }).toBe('Saved value');
  await page.unroute(`**/api/collections/${collection.id}/items`);
});

test('renders a hosted collection with the host page cover, icon, title, and focal point', async ({ page, request }) => {
  const hostResponse = await request.post('/api/pages', { data: { title: 'Hosted library', icon: '📕' } });
  expect(hostResponse.ok()).toBeTruthy();
  const host = (await hostResponse.json()).page as PageRecord;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const upload = await request.post('/api/assets', { multipart: { file: { name: 'host-cover.png', mimeType: 'image/png', buffer: png } } });
  expect(upload.ok()).toBeTruthy();
  const asset = (await upload.json()).asset as { id: string };
  const hostPatch = await request.patch(`/api/pages/${host.id}`, {
    data: { revision: host.revision, coverAssetId: asset.id, coverFocalX: 70, coverFocalY: 30 },
  });
  expect(hostPatch.ok()).toBeTruthy();
  const collectionResponse = await request.post('/api/collections', {
    data: { name: 'Books', hostPageId: host.id },
  });
  expect(collectionResponse.ok()).toBeTruthy();
  const collection = (await collectionResponse.json()).collection as { id: string };
  const entryResponse = await request.post('/api/pages', { data: { title: 'Dune' } });
  expect(entryResponse.ok()).toBeTruthy();
  const entry = (await entryResponse.json()).page as PageRecord;
  const addResponse = await request.post(`/api/collections/${collection.id}/items`, {
    data: {
      pageId: entry.id,
      properties: {
        author: 'Frank Herbert',
        status: 'Reading',
        type: ['Science fiction', 'Classic'],
        score: 5,
        tags: ['Epic', 'Desert'],
      },
    },
  });
  expect(addResponse.ok()).toBeTruthy();

  await page.goto(`/collections/${collection.id}`);
  await expect(page.locator('.collection-host-cover-image')).toBeVisible();
  await expect(page.locator('.collection-host-cover-image')).toHaveAttribute('style', /object-position:\s*70% 30%/);
  await expect(page.locator('.collection-host-icon')).toHaveText('📕');
  await expect(page.getByRole('main').getByRole('link', { name: 'Hosted library' })).toHaveAttribute('href', buildPagePathFromPages(host.id, [host]));
  await expect(page.locator('input[name="name"]')).toHaveValue('Books');

  await page.getByRole('button', { name: /Collection settings/ }).click();
  const authorRow = page.locator('.collection-property-item').filter({ hasText: 'Author' }).first();
  await expect(authorRow.getByLabel('Type')).toHaveValue('select');

  const authorCell = page.locator('.collection-row').first().locator('.collection-cell-select').first();
  await authorCell.fill('Frank Herbert');
  await authorCell.press('Enter');
  await expect.poll(async () => {
    const response = await request.get(`/api/collections/${collection.id}`);
    const payload = await response.json() as { collection: { schemaJson: string } };
    const schema = JSON.parse(payload.collection.schemaJson) as { properties: Array<{ id: string; options?: string[] }> };
    return schema.properties.find((property) => property.id === 'author')?.options ?? [];
  }).toContain('Frank Herbert');
  await expect(page.locator('#collection-options-author option[value="Frank Herbert"]')).toHaveCount(1);

  await page.goto(buildPagePathFromPages(host.id, [host]));
  await expect(page.locator('.page-collection-embed')).toBeVisible();
  await expect(page.locator('.collection-table')).toBeVisible();

  await page.goto(`/page/${entry.id}`);
  await expect(page.locator('.page-collections-embed')).toBeVisible();
  await expect(page.getByRole('link', { name: /Books.*Open collection/ })).toHaveAttribute('href', `/collections/${collection.id}`);
  await expect(page.locator('.page-collection-embed')).toContainText('Books');
  await expect(page.locator('.page-collection-embed')).toContainText('Frank Herbert');
});

test.describe('cover controls and reference refresh', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('applies and persists cover focal point values on reload', async ({ page, request }) => {
    const createRootResponse = await request.post('/api/pages', { data: { title: 'Cover root' } });
    expect(createRootResponse.ok()).toBeTruthy();
    const root = (await createRootResponse.json()).page as { id: string; revision: number };

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const upload = await request.post('/api/assets', {
      multipart: {
        file: { name: 'cover.png', mimeType: 'image/png', buffer: png },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const asset = (await upload.json()).asset as { id: string };

    const coverApply = await request.patch(`/api/pages/${root.id}`, {
      data: {
        revision: root.revision,
        title: 'Cover root',
        coverAssetId: asset.id,
      },
    });
    expect(coverApply.ok()).toBeTruthy();
    const coverPage = (await coverApply.json()).page as { revision: number };

    const focalApply = await request.patch(`/api/pages/${root.id}`, {
      data: {
        revision: coverPage.revision,
        coverFocalX: 80,
        coverFocalY: 20,
      },
    });
    expect(focalApply.ok()).toBeTruthy();

    await page.goto(`/page/${root.id}`);
    const cover = page.locator('.cover-preview');
    await expect(page.locator('.cover-preview-image')).toHaveAttribute('style', /object-position:\s*80% 20%/);
    await cover.hover();
    await page.getByRole('button', { name: 'Reposition cover' }).click();
    const sizeSlider = page.getByLabel('Cover size');
    await expect(sizeSlider).toHaveValue('100');
    const coverBox = await cover.boundingBox();
    expect(coverBox).not.toBeNull();
    if (coverBox) {
      await page.mouse.move(coverBox.x + coverBox.width / 2, coverBox.y + coverBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(coverBox.x + coverBox.width / 2 - 128, coverBox.y + coverBox.height / 2 + 40);
      await page.mouse.up();
    }
    await expect(page.locator('.cover-preview-image')).not.toHaveAttribute('style', /object-position:\s*80% 20%/);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.cover-preview-image')).toHaveAttribute('style', /object-position:\s*80% 20%/);
    await cover.hover();
    await page.getByRole('button', { name: 'Reposition cover' }).click();
    await sizeSlider.fill('150');
    await expect(page.locator('.cover-preview-image')).toHaveAttribute('style', /transform:\s*scale\(1\.5\)/);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Reposition cover' })).toBeVisible();

    await page.reload();
    await expect(page.locator('.cover-preview-image')).toHaveAttribute('style', /transform:\s*scale\(1\.5\)/);
    await page.locator('.cover-preview').hover();
    await page.getByRole('button', { name: 'Reposition cover' }).click();
    await expect(page.getByLabel('Cover size')).toHaveValue('150');
  });

  test('refreshes inline and card references by stable page id when a target is renamed', async ({ page, request }) => {
    const rootResponse = await request.post('/api/pages', { data: { title: 'Source root' } });
    expect(rootResponse.ok()).toBeTruthy();
    const root = (await rootResponse.json()).page as { id: string; revision: number };

    const targetResponse = await request.post('/api/pages', { data: { title: 'Target old', parentId: root.id } });
    expect(targetResponse.ok()).toBeTruthy();
    const target = (await targetResponse.json()).page as { id: string; revision: number };

    const contentJson = JSON.stringify([
      {
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: buildPagePathFromPages(target.id, [{ ...target, parentId: root.id, sortKey: 2, title: 'Target old' }]),
            content: [{ type: 'text', text: 'Target old', styles: {} }],
          },
        ],
      },
      {
        type: 'pageLink',
        props: {
          pageId: target.id,
          title: 'Target old',
        },
      },
    ]);

    await request.patch(`/api/pages/${root.id}`, {
      data: {
        revision: root.revision,
        title: 'Source root',
        contentJson,
      },
    });

    await page.goto(`/page/${root.id}`);
    await expect(page.getByRole('link', { name: 'Target old' }).first()).toBeVisible();

    const rename = await request.patch(`/api/pages/${target.id}`, {
      data: {
        revision: target.revision,
        title: 'Target renamed',
      },
    });
    expect(rename.ok()).toBeTruthy();

    await page.evaluate(() => {
      window.dispatchEvent(new Event('arcane-pages-changed'));
    });

    await expect(page.getByRole('link', { name: 'Target renamed' }).first()).toBeVisible();
  });
});


test.describe('cover controls at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps navigation and page actions reachable at narrow widths', async ({ page, request }, testInfo: TestInfo) => {
    const createRootResponse = await request.post('/api/pages', { data: { title: 'Narrow root' } });
    expect(createRootResponse.ok()).toBeTruthy();
    const root = (await createRootResponse.json()).page as { id: string; revision: number };

    await page.goto(`/page/${root.id}`);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    const sidebar = page.locator('.sidebar');
    const sidebarScrim = page.locator('.sidebar-scrim');
    const actionsMenuButton = page.getByLabel('Actions for Narrow root');
    const actionsMenu = actionsMenuButton.locator('xpath=ancestor::details[contains(@class, "tree-menu")]');
    const actionsPanel = actionsMenu.locator('.tree-actions');

    await expect(page.locator('.sidebar')).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Control+k');
    await expect(sidebar).toHaveClass(/open/);
    await expect(sidebar.getByLabel('Search pages')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(sidebar).toHaveClass(/open/);

    const openSidebar = await readMotion(sidebar);

    await expect(actionsMenuButton).toBeVisible();
    await actionsMenuButton.click();
    await expect(actionsMenu).toHaveAttribute('open');
    const menuTransition = await actionsPanel.evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(parseDelayMs(menuTransition)).toBeGreaterThan(0);

    await actionsMenuButton.click();
    await page.waitForTimeout(40);
    await expect(actionsMenu).not.toHaveAttribute('open');

    const closeNav = sidebar.getByRole('button', { name: 'Close navigation' });
    await closeNav.click();
    await page.waitForTimeout(40);
    const closingSidebar = await readMotion(sidebar);
    const closingScrim = await readMotion(sidebarScrim);
    expect(closingSidebar.tx).toBeLessThan(openSidebar.tx);
    expect(closingSidebar.opacity).toBe(1);
    expect(closingScrim.opacity).toBeLessThan(openSidebar.opacity);
    expect(closingScrim.opacity).toBeGreaterThan(0);
    await page.waitForTimeout(280);
    const closedSidebar = await readMotion(sidebar);
    const closedScrim = await readMotion(sidebarScrim);
    expect(closedSidebar.tx).toBeLessThan(closingSidebar.tx);
    expect(closedScrim.opacity).toBe(0);
    await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.page-title')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('narrow-mobile-layout.png'), fullPage: true });

    const pageActionsButton = page.getByRole('button', { name: 'Page actions' });
    await pageActionsButton.click();
    const pageActions = page.locator('.action-menu');
    await expect(pageActions).toHaveAttribute('open');
    await expect(pageActions.getByRole('button', { name: 'Add cover', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload file' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove icon' })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('narrow-mobile-page-actions.png'), fullPage: true });
    await page.locator('.page-title').click();
    await expect(pageActions).not.toHaveAttribute('open');
    await pageActionsButton.click();
    await page.keyboard.press('Escape');
    await expect(pageActions).not.toHaveAttribute('open');
    await expect(pageActionsButton).toBeFocused();
  });
});

test.describe('motion reduced-motion behavior', () => {
  test('disables collection stagger delays when reduced-motion is active', async ({ page, request }, testInfo: TestInfo) => {
    const collectionResponse = await request.post('/api/collections', {
      data: {
        name: 'Reduced Motion Motion Collection',
      },
    });
    expect(collectionResponse.ok()).toBeTruthy();
    const collection = (await collectionResponse.json()).collection as { id: string };

    for (let index = 0; index < 8; index += 1) {
      const pageResponse = await request.post('/api/pages', {
        data: { title: `Reduced Motion Page ${index + 1}` },
      });
      expect(pageResponse.ok()).toBeTruthy();
      const pageRecord = (await pageResponse.json()).page as { id: string };

      const addResponse = await request.post(`/api/collections/${collection.id}/items`, {
        data: { pageId: pageRecord.id, properties: {} },
      });
      expect(addResponse.ok()).toBeTruthy();
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/collections/${collection.id}`);

    const tableTab = page.getByRole('tab', { name: /Table/ });
    const galleryTab = page.getByRole('tab', { name: /Gallery/ });
    await expect(tableTab).toBeVisible();
    if (await galleryTab.getAttribute('aria-selected') === 'true') {
      await tableTab.click();
      await page.waitForTimeout(20);
    }
    await expect(tableTab).toHaveAttribute('aria-selected', 'true');

    const tableRows = page.locator('.collection-table tbody tr');
    await expect(tableRows).toHaveCount(8, { timeout: 15_000 });
    const readTableDelays = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        tableRows.nth(index).evaluate((row) => getComputedStyle(row).animationDelay),
      ),
    );
    for (const delay of readTableDelays) {
      expect(parseDelayMs(delay)).toBe(0);
    }

    await page.screenshot({ path: testInfo.outputPath('reduced-motion-table-start.png'), fullPage: true });
    await galleryTab.click();
    await expect(galleryTab).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(120);
    await page.screenshot({ path: testInfo.outputPath('reduced-motion-gallery-view.png'), fullPage: true });
    const galleryCards = page.locator('.collection-gallery-item');
    await expect(galleryCards).toHaveCount(8, { timeout: 15_000 });
    const readGalleryDelays = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        galleryCards.nth(index).evaluate((item) => getComputedStyle(item).animationDelay),
      ),
    );
    for (const delay of readGalleryDelays) {
      expect(parseDelayMs(delay)).toBe(0);
    }
  });
});


test.describe('body uploads from paste and drop', () => {
  const editorSelector = '.editor-view .bn-editor[contenteditable="true"]';

  test('pastes image through clipboard into body, retries on transient failure, and saves at active caret location', async ({ page, request }, testInfo: TestInfo) => {
    const rootResponse = await request.post('/api/pages', { data: { title: 'Paste upload test' } });
    expect(rootResponse.ok()).toBeTruthy();
    const root = (await rootResponse.json()).page as PageRecord;

    const initialContent = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'Paste start', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paste end', styles: {} }] },
    ]);

    await request.patch(`/api/pages/${root.id}`, {
      data: {
        revision: root.revision,
        title: 'Paste upload test',
        contentJson: initialContent,
      },
    });

    await page.goto(`/page/${root.id}`);
    await page.locator('.editor-view').click();
    await expect(page.locator(editorSelector)).toBeVisible();

    const initialBlocks = await loadPageBlocks(request, root.id);
    expect(initialBlocks.map(blockSignature)).toEqual([
      'paragraph:Paste start',
      'paragraph:Paste end',
    ]);

    const firstParagraph = page.locator('.editor-view .bn-block-content[data-content-type="paragraph"]', { hasText: 'Paste start' }).first();
    await firstParagraph.click();
    await page.keyboard.press('End');

    const uploadFile: ClipboardUploadFile = {
      name: 'paste-upload.png',
      mimeType: 'image/png',
      base64: PASTE_PNG_BASE64,
    };

    let blockedFirstAttempt = false;
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() === 'POST' && !blockedFirstAttempt) {
        blockedFirstAttempt = true;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated transient upload failure' }),
        });
        return;
      }
      await route.continue();
    });

    await dispatchPasteIntoEditor(page, editorSelector, uploadFile);

    const uploads = page.locator('.upload-task-list');
    await expect(uploads).toBeVisible();
    await expect(uploads.getByText('paste-upload.png')).toBeVisible();
    await expect(uploads).toContainText('Simulated transient upload failure');

    await page.screenshot({ path: testInfo.outputPath('paste-upload-failure.png'), fullPage: true });

    await page.unroute('**/api/assets');
    await uploads.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(async () => page.locator('.upload-task-list').count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => {
      const blocks = await loadPageBlocks(request, root.id);
      const galleryIndex = blocks.findIndex((block) => block.type === 'gallery');
      const beforeIndex = findTopLevelParagraph(blocks, 'Paste start');
      const afterIndex = findTopLevelParagraph(blocks, 'Paste end');
      return galleryIndex > beforeIndex && galleryIndex > -1 && beforeIndex > -1 && afterIndex > galleryIndex;
    }, { timeout: 20_000 }).toBeTruthy();

    await page.screenshot({ path: testInfo.outputPath('paste-upload-success.png'), fullPage: true });
  });

  test('drops image into body at target paragraph and inserts near active cursor region', async ({ page, request }, testInfo: TestInfo) => {
    const rootResponse = await request.post('/api/pages', { data: { title: 'Drop upload test' } });
    expect(rootResponse.ok()).toBeTruthy();
    const root = (await rootResponse.json()).page as PageRecord;

    const initialContent = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'Drop top', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Drop middle', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Drop bottom', styles: {} }] },
    ]);

    const patchResponse = await request.patch(`/api/pages/${root.id}`, {
      data: {
        revision: root.revision,
        title: 'Drop upload test',
        contentJson: initialContent,
      },
    });
    expect(patchResponse.ok()).toBeTruthy();

    await page.goto(`/page/${root.id}`);
    await page.locator('.editor-view').click();
    await expect(page.locator(editorSelector)).toBeVisible();

    const initialBlocks = await loadPageBlocks(request, root.id);
    expect(initialBlocks.map(blockSignature)).toEqual([
      'paragraph:Drop top',
      'paragraph:Drop middle',
      'paragraph:Drop bottom',
    ]);

    const targetParagraph = page.locator('.editor-view .bn-block-content[data-content-type="paragraph"]', { hasText: 'Drop middle' }).first();
    await targetParagraph.click();

    const targetBox = await targetParagraph.boundingBox();
    expect(targetBox).not.toBeNull();

    const uploadFile: ClipboardUploadFile = {
      name: 'drop-upload.png',
      mimeType: 'image/png',
      base64: PASTE_PNG_BASE64,
    };

    if (!targetBox) {
      throw new Error('Could not locate drop target paragraph.');
    }

    let dropUploads = 0;
    const dropUploadFilenames: string[] = [];
    await page.route('**/api/assets', async (route) => {
      if (route.request().method() === 'POST') {
        dropUploads += 1;
        const postData = route.request().postData() || '';
        const filenameMatch = /filename="([^"]+)"/.exec(postData);
        if (filenameMatch) {
          dropUploadFilenames.push(filenameMatch[1]);
        }
      }
      await route.continue();
    });

    await dispatchDropIntoEditor(page, editorSelector, uploadFile, targetBox.x + targetBox.width * 0.5, targetBox.y + targetBox.height - 1);

    await expect.poll(async () => dropUploads, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(async () => dropUploadFilenames.includes('drop-upload.png'), { timeout: 10_000 }).toBeTruthy();
    await page.unroute('**/api/assets');

    await expect.poll(async () => {
      const blocks = await loadPageBlocks(request, root.id);
      const galleryIndex = blocks.findIndex((block) => block.type === 'gallery');
      const beforeIndex = findTopLevelParagraph(blocks, 'Drop middle');
      const afterIndex = findTopLevelParagraph(blocks, 'Drop bottom');
      return galleryIndex > beforeIndex && galleryIndex > -1 && beforeIndex > -1 && afterIndex > galleryIndex;
    }, { timeout: 10_000 }).toBeTruthy();

    await page.screenshot({ path: testInfo.outputPath('drop-upload-success.png'), fullPage: true });
  });
});
