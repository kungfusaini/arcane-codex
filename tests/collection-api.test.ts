import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

import * as collectionsRoute from '../src/app/api/collections/route';
import * as collectionRoute from '../src/app/api/collections/[id]/route';
import * as collectionItemsRoute from '../src/app/api/collections/[id]/items/route';
import * as pagesRoute from '../src/app/api/pages/route';
import { ensureWorkspaceDirs } from '../src/lib/data/workspace';

type Payload = { [key: string]: unknown };

async function callJson(response: Response): Promise<Payload> {
  return (await response.json()) as Payload;
}

function withWorkspace<T>(callback: () => T | Promise<T>): Promise<T> {
  const previous = process.env.XDG_DATA_HOME;
  const base = mkdtempSync(path.join(os.tmpdir(), 'arcane-codex-collection-api-'));
  ensureWorkspaceDirs(base);
  process.env.XDG_DATA_HOME = base;

  const cleanup = () => {
    process.env.XDG_DATA_HOME = previous;
    rmSync(base, { recursive: true, force: true });
  };

  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return Promise.resolve(result);
  } catch (error) {
    cleanup();
    throw error;
  }
}

describe('collections HTTP API', () => {
  it('creates collections, edits items, and supports sort/filter inputs', async () => {
    await withWorkspace(async () => {
      const pageA = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Project A' }),
        }),
      );
      const pageB = await pagesRoute.POST(
        new NextRequest('http://localhost/api/pages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Project B' }),
        }),
      );
      const createdPages = (await callJson(pageA)) as { page: { id: string } };
      const createdPagesB = (await callJson(pageB)) as { page: { id: string } };

      const createCollection = await collectionsRoute.POST(
        new NextRequest('http://localhost/api/collections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Projects',
            schema: {
              properties: [
                { id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done'] },
                { id: 'hours', name: 'Hours', type: 'number' },
              ],
            },
          }),
        }),
      );
      const collectionPayload = (await callJson(createCollection)) as {
        collection: { id: string; schemaJson: string; viewsJson: string };
      };
      assert.equal(createCollection.status, 201);
      const collectionId = collectionPayload.collection.id;

      const addA = await collectionItemsRoute.POST(
        new NextRequest(`http://localhost/api/collections/${collectionId}/items`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageId: createdPages.page.id,
            properties: { status: 'Todo', hours: 5 },
          }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(addA.status, 201);

      const addB = await collectionItemsRoute.POST(
        new NextRequest(`http://localhost/api/collections/${collectionId}/items`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pageId: createdPagesB.page.id,
            properties: { status: 'Done', hours: 12 },
          }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(addB.status, 201);

      const detail = await collectionRoute.GET(
        new NextRequest(`http://localhost/api/collections/${collectionId}?sortBy=title&direction=asc`),
        { params: { id: collectionId } },
      );
      const detailPayload = (await callJson(detail)) as { items: Array<{ page: { title: string } }> };
      assert.equal(detailPayload.items.length, 2);
      assert.equal(detailPayload.items[0].page.title, 'Project A');

      const filtered = await collectionRoute.GET(
        new NextRequest(
          `http://localhost/api/collections/${collectionId}?sortBy=hours&direction=desc&filterBy=status&filterQuery=Done`,
        ),
        { params: { id: collectionId } },
      );
      const filteredPayload = (await callJson(filtered)) as {
        items: Array<{ propertiesJson: string }>;
        availablePages: Array<{ id: string }>;
      };
      assert.equal(filteredPayload.items.length, 1);
      assert.equal(filteredPayload.availablePages.length, 0, 'filtered-out collection members must not become addable again');

      const update = await collectionItemsRoute.PATCH(
        new NextRequest(`http://localhost/api/collections/${collectionId}/items`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId: createdPages.page.id, properties: { hours: 6 } }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(update.status, 200);

      const reorder = await collectionItemsRoute.PATCH(
        new NextRequest(`http://localhost/api/collections/${collectionId}/items`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'reorder',
            moves: [
              { pageId: createdPages.page.id, sortKey: 2 },
              { pageId: createdPagesB.page.id, sortKey: 1 },
            ],
          }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(reorder.status, 200);

      const remove = await collectionItemsRoute.DELETE(
        new NextRequest(`http://localhost/api/collections/${collectionId}/items`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pageId: createdPagesB.page.id }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(remove.status, 200);

      const afterDelete = await collectionRoute.GET(
        new NextRequest(`http://localhost/api/collections/${collectionId}`),
        { params: { id: collectionId } },
      );
      const afterPayload = (await callJson(afterDelete)) as { items: Array<{ pageId: string }> };
      assert.equal(afterPayload.items.length, 1);

      const rename = await collectionRoute.PATCH(
        new NextRequest(`http://localhost/api/collections/${collectionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: collectionId,
            views: {
              mode: 'gallery',
              sort: { propertyId: 'hours', direction: 'desc' },
            },
          }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(rename.status, 200);

      const renamed = await rename.json() as { collection: { viewsJson: string } };
      assert.equal(JSON.parse(renamed.collection.viewsJson).mode, 'gallery');

      const schemaUpdate = await collectionRoute.PATCH(
        new NextRequest(`http://localhost/api/collections/${collectionId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schema: {
              properties: [{ id: 'status', name: 'Status', type: 'select', options: ['Todo', 'Done', 'Blocked'] }],
            },
          }),
        }),
        { params: { id: collectionId } },
      );
      assert.equal(schemaUpdate.status, 200);
      const schemaPayload = await schemaUpdate.json() as { collection: { schemaJson: string } };
      assert.deepEqual(JSON.parse(schemaPayload.collection.schemaJson).properties[0].options, ['Todo', 'Done', 'Blocked']);
    });
  });

  it('rejects an invalid collection host page with a client error', async () => {
    await withWorkspace(async () => {
      const response = await collectionsRoute.POST(
        new NextRequest('http://localhost/api/collections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Broken host', hostPageId: '11111111-1111-4111-8111-111111111111' }),
        }),
      );
      assert.equal(response.status, 400);
      const payload = await callJson(response);
      assert.match(String(payload.error), /host page not found/i);
    });
  });
});
