import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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

function findTopLevelImage(blocks: PageBlock[], caption: string): number {
  return blocks.findIndex(
    (block) => block.type === 'image' && typeof block.props?.caption === 'string' && block.props.caption === caption,
  );
}

function blockSignature(block: PageBlock): string {
  if (block.type === 'paragraph') {
    return `paragraph:${blockText(block)}`;
  }
  if (block.type === 'image' && typeof block.props?.caption === 'string') {
    return `image:${block.props.caption}`;
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
  await page.waitForLoadState('networkidle');

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
  await page.getByRole('button', { name: 'Page actions' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expect(page.getByText('This page is in trash. Restore it before editing.')).toBeVisible();
  await page.locator('.trash-section').getByText('Trash').click();
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
  await expect(page.locator(`.editor-view a[href="/page/${target.id}"]`)).toBeVisible();

  expect(pageErrors.map((error) => error.stack ?? error.message)).toEqual([]);
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
    const xSlider = page.getByLabel('Horizontal');
    const ySlider = page.getByLabel('Vertical');
    await expect(xSlider).toHaveValue('80');
    await expect(ySlider).toHaveValue('20');
    await expect(page.locator('.cover-preview-image')).toHaveAttribute('style', /object-position:\s*80% 20%/);

    await page.reload();
    await expect(page.getByLabel('Horizontal')).toHaveValue('80');
    await expect(page.getByLabel('Vertical')).toHaveValue('20');
    await expect(page.locator('.cover-preview-image')).toHaveAttribute('style', /object-position:\s*80% 20%/);
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
            href: `/page/${target.id}`,
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

  test('shows media controls in stacked layout at narrow widths', async ({ page, request }, testInfo: TestInfo) => {
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
    await page.getByText('Media & page details').click();
    const controls = page.locator('.media-controls');
    await expect(controls).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('narrow-mobile-menu-closed.png'), fullPage: true });
    const groups = controls.locator('.media-control-group');
    await expect(groups).toHaveCount(3);

    const first = await groups.nth(0).boundingBox();
    const second = await groups.nth(1).boundingBox();
    const third = await groups.nth(2).boundingBox();
    expect(first && second && third).toBeTruthy();

    if (first && second && third) {
      expect(second.y).toBeGreaterThan(first.y + first.height - 4);
      expect(third.y).toBeGreaterThan(second.y + second.height - 4);
    }
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

    const viewSwitch = page.locator('.collection-viewbar .view-switch');
    await expect(viewSwitch).toBeVisible();
    const initialView = await viewSwitch.innerText();
    if (initialView.includes('Gallery')) {
      await viewSwitch.click();
      await page.waitForTimeout(20);
      await expect(viewSwitch).toHaveText('View: Table');
    }

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
    await viewSwitch.click();
    await expect(viewSwitch).toHaveText('View: Gallery');
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
      const imageIndex = blocks.findIndex((block) => block.type === 'image');
      const beforeIndex = findTopLevelParagraph(blocks, 'Paste start');
      const afterIndex = findTopLevelParagraph(blocks, 'Paste end');
      return imageIndex > beforeIndex && imageIndex > -1 && beforeIndex > -1 && afterIndex > imageIndex;
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
      const imageIndex = blocks.findIndex((block) => block.type === 'image');
      const beforeIndex = findTopLevelParagraph(blocks, 'Drop middle');
      const afterIndex = findTopLevelParagraph(blocks, 'Drop bottom');
      return imageIndex > beforeIndex && imageIndex > -1 && beforeIndex > -1 && afterIndex > imageIndex;
    }, { timeout: 10_000 }).toBeTruthy();

    await page.screenshot({ path: testInfo.outputPath('drop-upload-success.png'), fullPage: true });
  });
});
