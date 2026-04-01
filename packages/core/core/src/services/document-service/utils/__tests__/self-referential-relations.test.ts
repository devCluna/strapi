import { load, sync } from '../self-referential-relations';

const ID_COLUMN = 'id';

type SyncMockOptions = {
  /** Rows already present in the join table (simulates createEntry having inserted the link) */
  existingJoinRows?: Record<string, unknown>[];
  batchSize?: number;
};

const createSyncStrapiMock = (options: SyncMockOptions = {}) => {
  const { existingJoinRows = [], batchSize = 1000 } = options;
  const mockBatchInsert = jest.fn();
  const mockTrx = Object.assign(
    jest.fn(() => ({
      whereIn: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(existingJoinRows),
      }),
    })),
    { batchInsert: mockBatchInsert }
  );

  (global as any).strapi = {
    db: {
      metadata: { identifiers: { ID_COLUMN } },
      dialect: { getBatchInsertSize: jest.fn().mockReturnValue(batchSize) },
      // eslint-disable-next-line node/no-callback-literal -- Strapi transaction passes { trx }, not (err, result)
      transaction: jest.fn(async (cb: any) => cb({ trx: mockTrx })),
    },
  };

  return { mockBatchInsert, mockTrx };
};

const createChainedQuery = (result: any[]) => {
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.whereIn = jest.fn().mockReturnValue(chain);
  chain.transacting = jest.fn().mockResolvedValue(result);
  return chain;
};

const createMockTransaction = () =>
  // eslint-disable-next-line node/no-callback-literal -- Strapi transaction passes { trx }, not (err, result)
  jest.fn(async (cb: any) => cb({ trx: {} }));

describe('self-referential-relations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Note: load() happy-path SQL correctness (i.e. that whereIn actually filters the right rows)
  // is covered by the API integration test, which runs against a real DB.
  // These unit tests cover the attribute-filtering branches only.
  describe('load', () => {
    it('should skip non-relation and non-self-referential attributes', async () => {
      const chain = createChainedQuery([]);

      (global as any).strapi = {
        db: {
          metadata: {
            get: jest.fn().mockReturnValue({
              attributes: {
                name: { type: 'string' },
                other: {
                  type: 'relation',
                  target: 'api::other.other',
                  joinTable: {
                    name: 'other_lnk',
                    joinColumn: { name: 'a' },
                    inverseJoinColumn: { name: 'b' },
                  },
                },
              },
            }),
          },
          transaction: createMockTransaction(),
          getConnection: jest.fn().mockReturnValue(chain),
        },
      };

      const result = await load('api::category.category' as any, [{ id: '10', locale: 'en' }]);

      expect(result).toHaveLength(0);
      expect(chain.transacting).not.toHaveBeenCalled();
    });

    it('should skip relations without join table (e.g. useJoinTable: false column FK)', async () => {
      (global as any).strapi = {
        db: {
          metadata: {
            get: jest.fn().mockReturnValue({
              attributes: {
                parent: {
                  type: 'relation',
                  target: 'api::category.category',
                },
              },
            }),
          },
          transaction: createMockTransaction(),
          getConnection: jest.fn(),
        },
      };

      const result = await load('api::category.category' as any, [{ id: '10', locale: 'en' }]);

      expect(result).toHaveLength(0);
    });

    it('should skip bidirectional inverse attributes (mappedBy) to avoid duplicating the same join table', async () => {
      const chain = createChainedQuery([{ id: 1, a: '10', b: '10' }]);

      (global as any).strapi = {
        db: {
          metadata: {
            get: jest.fn().mockReturnValue({
              attributes: {
                children: {
                  type: 'relation',
                  target: 'api::category.category',
                  mappedBy: 'parent',
                  joinTable: {
                    name: 'categories_parent_lnk',
                    joinColumn: { name: 'a' },
                    inverseJoinColumn: { name: 'b' },
                  },
                },
              },
            }),
          },
          transaction: createMockTransaction(),
          getConnection: jest.fn().mockReturnValue(chain),
        },
      };

      const result = await load('api::category.category' as any, [{ id: '10', locale: 'en' }]);

      expect(result).toHaveLength(0);
      expect(chain.from).not.toHaveBeenCalled();
    });

    it('should query each join table once when owning and inverse metadata both exist (inverse skipped)', async () => {
      const row = { id: 1, category_id: '10', inv_category_id: '10', field_order: 1 };
      const chain = createChainedQuery([row]);

      (global as any).strapi = {
        db: {
          metadata: {
            get: jest.fn().mockReturnValue({
              attributes: {
                parent: {
                  type: 'relation',
                  target: 'api::category.category',
                  inversedBy: 'children',
                  joinTable: {
                    name: 'categories_parent_lnk',
                    joinColumn: { name: 'category_id' },
                    inverseJoinColumn: { name: 'inv_category_id' },
                  },
                },
                children: {
                  type: 'relation',
                  target: 'api::category.category',
                  mappedBy: 'parent',
                  joinTable: {
                    name: 'categories_parent_lnk',
                    joinColumn: { name: 'inv_category_id' },
                    inverseJoinColumn: { name: 'category_id' },
                  },
                },
              },
            }),
          },
          transaction: createMockTransaction(),
          getConnection: jest.fn().mockReturnValue(chain),
        },
      };

      const result = await load('api::category.category' as any, [{ id: '10', locale: 'en' }]);

      expect(result).toHaveLength(1);
      expect(result[0].relations).toEqual([row]);
      expect(chain.from).toHaveBeenCalledTimes(1);
    });

    it('should coerce entry ids to strings for whereIn (driver may return numbers)', async () => {
      const row = { id: 1, category_id: 10, inv_category_id: 10 };
      const chain = createChainedQuery([row]);

      (global as any).strapi = {
        db: {
          metadata: {
            get: jest.fn().mockReturnValue({
              attributes: {
                parent: {
                  type: 'relation',
                  target: 'api::category.category',
                  inversedBy: 'children',
                  joinTable: {
                    name: 'categories_parent_lnk',
                    joinColumn: { name: 'category_id' },
                    inverseJoinColumn: { name: 'inv_category_id' },
                  },
                },
              },
            }),
          },
          transaction: createMockTransaction(),
          getConnection: jest.fn().mockReturnValue(chain),
        },
      };

      await load('api::category.category' as any, [{ id: 10 as any, locale: 'en' }]);

      expect(chain.whereIn).toHaveBeenCalledWith('category_id', ['10']);
      expect(chain.whereIn).toHaveBeenCalledWith('inv_category_id', ['10']);
    });
  });

  describe('sync', () => {
    it('should remap and insert self-referential relations with new IDs', async () => {
      const { mockBatchInsert } = createSyncStrapiMock();

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [{ id: 1, category_id: '10', inv_category_id: '10', field_order: 1 }],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).toHaveBeenCalledWith(
        'categories_parent_lnk',
        [{ category_id: '20', inv_category_id: '20', field_order: 1 }],
        1000
      );
    });

    it('should pass dialect batch size to batchInsert', async () => {
      const { mockBatchInsert } = createSyncStrapiMock({ batchSize: 500 });

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [{ id: 1, category_id: '10', inv_category_id: '10', field_order: 1 }],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).toHaveBeenCalledWith(
        'categories_parent_lnk',
        [{ category_id: '20', inv_category_id: '20', field_order: 1 }],
        500
      );
    });

    it('should map numeric FK values from the driver the same as string ids', async () => {
      const { mockBatchInsert } = createSyncStrapiMock();

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [{ id: 1, category_id: 10, inv_category_id: 10, field_order: 1 }],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).toHaveBeenCalledWith(
        'categories_parent_lnk',
        [{ category_id: '20', inv_category_id: '20', field_order: 1 }],
        1000
      );
    });

    it('should not batchInsert when the remapped row already exists (idempotent with createEntry)', async () => {
      const { mockBatchInsert } = createSyncStrapiMock({
        existingJoinRows: [{ category_id: '20', inv_category_id: '20' }],
      });

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [{ id: 1, category_id: '10', inv_category_id: '10', field_order: 1 }],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).not.toHaveBeenCalled();
    });

    it('should dedupe duplicate relation rows before insert', async () => {
      const { mockBatchInsert } = createSyncStrapiMock();

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [
            { id: 1, category_id: '10', inv_category_id: '10', field_order: 1 },
            { id: 2, category_id: '10', inv_category_id: '10', field_order: 1 },
          ],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).toHaveBeenCalledTimes(1);
      expect(mockBatchInsert).toHaveBeenCalledWith(
        'categories_parent_lnk',
        [{ category_id: '20', inv_category_id: '20', field_order: 1 }],
        1000
      );
    });

    it('should skip relations where source or target cannot be mapped', async () => {
      const { mockBatchInsert } = createSyncStrapiMock();

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [{ id: 1, category_id: '10', inv_category_id: '99', field_order: 1 }],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).not.toHaveBeenCalled();
    });

    it('should handle multiple locales', async () => {
      const { mockBatchInsert } = createSyncStrapiMock();

      const sourceEntries = [
        { id: '10', locale: 'en' },
        { id: '11', locale: 'fr' },
      ];
      const targetEntries = [
        { id: '20', locale: 'en' },
        { id: '21', locale: 'fr' },
      ];
      const relationData = [
        {
          joinTable: {
            name: 'categories_parent_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [
            { id: 1, category_id: '10', inv_category_id: '10', field_order: 1 },
            { id: 2, category_id: '11', inv_category_id: '11', field_order: 1 },
          ],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).toHaveBeenCalledWith(
        'categories_parent_lnk',
        [
          { category_id: '20', inv_category_id: '20', field_order: 1 },
          { category_id: '21', inv_category_id: '21', field_order: 1 },
        ],
        1000
      );
    });

    it('should do nothing when relationData is empty', async () => {
      (global as any).strapi = {
        db: {
          metadata: { identifiers: { ID_COLUMN } },
          transaction: jest.fn(),
        },
      };

      await sync([{ id: '10', locale: 'en' }], [{ id: '20', locale: 'en' }], []);

      expect(strapi.db.transaction).not.toHaveBeenCalled();
    });

    it('should preserve M2M order columns when remapping (no join-table id column)', async () => {
      const { mockBatchInsert } = createSyncStrapiMock();

      const sourceEntries = [{ id: '10', locale: 'en' }];
      const targetEntries = [{ id: '20', locale: 'en' }];
      const relationData = [
        {
          joinTable: {
            name: 'categories_peers_lnk',
            joinColumn: { name: 'category_id' },
            inverseJoinColumn: { name: 'inv_category_id' },
          },
          relations: [
            {
              id: 1,
              category_id: '10',
              inv_category_id: '10',
              field_order: 2,
              inv_field_order: 3,
            },
          ],
        },
      ];

      await sync(sourceEntries, targetEntries, relationData as any);

      expect(mockBatchInsert).toHaveBeenCalledWith(
        'categories_peers_lnk',
        [
          {
            category_id: '20',
            inv_category_id: '20',
            field_order: 2,
            inv_field_order: 3,
          },
        ],
        1000
      );
    });
  });
});
