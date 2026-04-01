/**
 * Integration coverage for join-table self-referential relations with Draft & Publish.
 * CM findOne uses countRelations() unless the request passes an explicit populate for each
 * relation field; otherwise relations resolve to `{ count: n }` instead of linked entities.
 */
import { createTestBuilder } from 'api-tests/builder';
import { createStrapiInstance } from 'api-tests/strapi';
import { createAuthRequest } from 'api-tests/request';

interface CategoryRelation {
  documentId: string;
}

interface CategoryEntry {
  documentId: string;
  name: string;
  parent?: CategoryRelation | null;
  children?: CategoryRelation[];
  related?: CategoryRelation[];
}

const builder = createTestBuilder();
let strapi: any;
let rq: any;

const data: { categories: CategoryEntry[] } = {
  categories: [],
};

const category = {
  displayName: 'category',
  singularName: 'category',
  pluralName: 'categories',
  kind: 'collectionType',
  draftAndPublish: true,
  attributes: {
    name: {
      type: 'string',
    },
    // Bidirectional self-referential: parent ↔ children
    parent: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'api::category.category',
      targetAttribute: 'children',
    },
    // Unidirectional self-referential (join table; no inverse field)
    related: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'api::category.category',
    },
  },
} as const;

/** Populate so CM returns linked documents, not `{ count }` only. */
const categoryRelationPopulate = {
  parent: true,
  children: true,
  related: true,
} as const;

const getCategory = async (
  documentId: string,
  status: 'draft' | 'published' = 'draft'
): Promise<CategoryEntry> => {
  const res = await rq({
    method: 'GET',
    url: `/content-manager/collection-types/api::category.category/${documentId}`,
    qs: {
      status,
      populate: categoryRelationPopulate,
    },
  });
  return res.body.data as CategoryEntry;
};

const getRelatedDocumentIds = (related: CategoryEntry['related']): string[] => {
  if (related == null) return [];
  if (Array.isArray(related)) {
    return related.map((r) => r.documentId);
  }
  const single = related as CategoryRelation;
  return [single.documentId];
};

describe('CM API - Self-referential relations with Draft & Publish', () => {
  beforeAll(async () => {
    await builder.addContentType(category).build();

    strapi = await createStrapiInstance();
    rq = await createAuthRequest({ strapi });

    for (const name of ['Category A', 'Category B']) {
      const res = await rq({
        method: 'POST',
        url: '/content-manager/collection-types/api::category.category',
        body: { name },
      });
      data.categories.push(res.body.data as CategoryEntry);
    }
  });

  afterAll(async () => {
    await strapi.destroy();
    await builder.cleanup();
  });

  test('Self-referential relation (entry to itself) is preserved after publish', async () => {
    const [catA] = data.categories;

    await rq({
      method: 'PUT',
      url: `/content-manager/collection-types/api::category.category/${catA.documentId}`,
      body: {
        name: catA.name,
        parent: { documentId: catA.documentId, locale: null },
      },
    });

    const draftBefore = await getCategory(catA.documentId, 'draft');
    expect(draftBefore.parent).toMatchObject({ documentId: catA.documentId });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${catA.documentId}/actions/publish`,
    });

    const published = await getCategory(catA.documentId, 'published');
    expect(published.parent).toMatchObject({ documentId: catA.documentId });
  });

  test('Self-referential relation between two entries is preserved after publish', async () => {
    const [catA, catB] = data.categories;

    await rq({
      method: 'PUT',
      url: `/content-manager/collection-types/api::category.category/${catB.documentId}`,
      body: {
        name: catB.name,
        parent: { documentId: catA.documentId, locale: null },
      },
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${catB.documentId}/actions/publish`,
    });

    const published = await getCategory(catB.documentId, 'published');
    expect(published.parent).toMatchObject({ documentId: catA.documentId });
  });

  test('Self-referential relation (entry to itself) is preserved after discard draft', async () => {
    const [catA] = data.categories;

    await rq({
      method: 'PUT',
      url: `/content-manager/collection-types/api::category.category/${catA.documentId}`,
      body: {
        name: 'Category A - modified',
        parent: { documentId: catA.documentId, locale: null },
      },
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${catA.documentId}/actions/discard`,
    });

    const draft = await getCategory(catA.documentId, 'draft');
    expect(draft.parent).toMatchObject({ documentId: catA.documentId });
  });

  test('Unidirectional self-referential related (entry to itself) is preserved after publish', async () => {
    const createRes = await rq({
      method: 'POST',
      url: '/content-manager/collection-types/api::category.category',
      body: { name: 'Category unidirectional self' },
    });
    const cat = createRes.body.data as CategoryEntry;

    await rq({
      method: 'PUT',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}`,
      body: {
        name: cat.name,
        related: { connect: [{ documentId: cat.documentId }] },
      },
    });

    const draftBefore = await getCategory(cat.documentId, 'draft');
    expect(getRelatedDocumentIds(draftBefore.related)).toContain(cat.documentId);

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}/actions/publish`,
    });

    const published = await getCategory(cat.documentId, 'published');
    expect(getRelatedDocumentIds(published.related)).toContain(cat.documentId);
  });

  test('Draft keeps self-referential parent after unpublish (published version removed)', async () => {
    const createRes = await rq({
      method: 'POST',
      url: '/content-manager/collection-types/api::category.category',
      body: { name: 'Unpublish draft keep' },
    });
    const cat = createRes.body.data as CategoryEntry;

    await rq({
      method: 'PUT',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}`,
      body: {
        name: cat.name,
        parent: { documentId: cat.documentId, locale: null },
      },
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}/actions/publish`,
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}/actions/unpublish`,
      body: {},
    });

    const draft = await getCategory(cat.documentId, 'draft');
    expect(draft.parent).toMatchObject({ documentId: cat.documentId });
  });

  test('Self-referential parent survives publish → unpublish → publish again', async () => {
    const createRes = await rq({
      method: 'POST',
      url: '/content-manager/collection-types/api::category.category',
      body: { name: 'Republish cycle' },
    });
    const cat = createRes.body.data as CategoryEntry;

    await rq({
      method: 'PUT',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}`,
      body: {
        name: cat.name,
        parent: { documentId: cat.documentId, locale: null },
      },
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}/actions/publish`,
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}/actions/unpublish`,
      body: {},
    });

    await rq({
      method: 'POST',
      url: `/content-manager/collection-types/api::category.category/${cat.documentId}/actions/publish`,
    });

    const published = await getCategory(cat.documentId, 'published');
    expect(published.parent).toMatchObject({ documentId: cat.documentId });
  });
});
