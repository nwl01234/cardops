import { count, eq } from 'drizzle-orm';
import type { CardStatus, Role } from '@cardops/shared';
import type { Database } from './client';
import { cards, operations, outboxEvents, users, warehouses } from './schema';
import { hashPassword } from '../lib/password';

interface DemoUser {
  login: string;
  password: string;
  name: string;
  role: Role;
  warehouseCode: string | null;
}

const DEMO_WAREHOUSES = [
  { code: 'WH-MSK', name: 'Москва · Центральный', city: 'Москва' },
  { code: 'WH-SPB', name: 'Санкт-Петербург · Северный', city: 'Санкт-Петербург' },
] as const;

const DEMO_USERS: DemoUser[] = [
  {
    login: 'admin',
    password: 'admin123',
    name: 'Алексей Смирнов',
    role: 'admin',
    warehouseCode: null,
  },
  {
    login: 'manager',
    password: 'manager123',
    name: 'Мария Орлова',
    role: 'manager',
    warehouseCode: null,
  },
  {
    login: 'warehouse',
    password: 'warehouse123',
    name: 'Дмитрий Волков',
    role: 'warehouse',
    warehouseCode: 'WH-MSK',
  },
];

interface DemoCard {
  sku: string;
  title: string;
  status: CardStatus;
  warehouseCode: 'WH-MSK' | 'WH-SPB';
  owner: boolean;
  holder: boolean;
  last4: string;
  notes: string | null;
  createdDaysAgo: number;
  writtenOffReason?: string;
}

const DEMO_CARDS: DemoCard[] = [
  {
    sku: 'CRD-DEMO-01',
    title: 'Карта «Витрина» · Альфа',
    status: 'issued',
    warehouseCode: 'WH-MSK',
    owner: true,
    holder: true,
    last4: '4417',
    notes: 'Демонстрационная карта: выдана менеджеру',
    createdDaysAgo: 7,
  },
  {
    sku: 'CRD-DEMO-02',
    title: 'Карта «Комфорт» · Бета',
    status: 'in_stock',
    warehouseCode: 'WH-MSK',
    owner: true,
    holder: false,
    last4: '9081',
    notes: 'Закреплена за менеджером, лежит на складе',
    createdDaysAgo: 6,
  },
  {
    sku: 'CRD-DEMO-03',
    title: 'Карта «Премиум» · Гамма',
    status: 'in_stock',
    warehouseCode: 'WH-MSK',
    owner: false,
    holder: false,
    last4: '3320',
    notes: null,
    createdDaysAgo: 5,
  },
  {
    sku: 'CRD-DEMO-04',
    title: 'Карта «Старт» · Дельта',
    status: 'in_stock',
    warehouseCode: 'WH-SPB',
    owner: false,
    holder: false,
    last4: '7712',
    notes: 'Второй склад: проверка scope',
    createdDaysAgo: 4,
  },
  {
    sku: 'CRD-DEMO-05',
    title: 'Карта «Бизнес» · Эпсилон',
    status: 'in_stock',
    warehouseCode: 'WH-SPB',
    owner: false,
    holder: false,
    last4: '1190',
    notes: null,
    createdDaysAgo: 4,
  },
  {
    sku: 'CRD-DEMO-06',
    title: 'Карта «Витрина» · возврат',
    status: 'returned',
    warehouseCode: 'WH-SPB',
    owner: true,
    holder: false,
    last4: '5604',
    notes: 'Прошла полный цикл выдачи и возврата',
    createdDaysAgo: 10,
  },
  {
    sku: 'CRD-DEMO-07',
    title: 'Карта «Архив» · Омега',
    status: 'written_off',
    warehouseCode: 'WH-MSK',
    owner: false,
    holder: false,
    last4: '2238',
    notes: null,
    createdDaysAgo: 12,
    writtenOffReason: 'Повреждена при транспортировке',
  },
  {
    sku: 'CRD-DEMO-08',
    title: 'Карта «Комфорт» · новая',
    status: 'in_stock',
    warehouseCode: 'WH-MSK',
    owner: false,
    holder: false,
    last4: '8451',
    notes: null,
    createdDaysAgo: 2,
  },
];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export interface SeedOptions {
  includeDemoCards: boolean;
}

export async function seedDatabase(
  db: Database,
  options: SeedOptions = { includeDemoCards: true },
): Promise<{ users: number; warehouses: number; cards: number }> {
  const passwordHashes = new Map<string, string>();
  for (const user of DEMO_USERS) {
    passwordHashes.set(user.login, await hashPassword(user.password));
  }

  const now = new Date();

  return db.transaction(async (tx) => {
    const warehouseIdByCode = new Map<string, string>();

    for (const warehouse of DEMO_WAREHOUSES) {
      const rows = await tx
        .insert(warehouses)
        .values(warehouse)
        .onConflictDoUpdate({
          target: warehouses.code,
          set: { name: warehouse.name, city: warehouse.city },
        })
        .returning({ id: warehouses.id, code: warehouses.code });
      const row = rows[0];
      if (row) warehouseIdByCode.set(row.code, row.id);
    }

    const userIdByLogin = new Map<string, string>();

    for (const user of DEMO_USERS) {
      const passwordHash = passwordHashes.get(user.login);
      if (!passwordHash) throw new Error(`Missing password hash for ${user.login}`);

      const rows = await tx
        .insert(users)
        .values({
          login: user.login,
          passwordHash,
          name: user.name,
          role: user.role,
          warehouseId: user.warehouseCode ? warehouseIdByCode.get(user.warehouseCode) : null,
          isActive: true,
          updatedAt: now,
        })
        // Demo seed must not reactivate or re-promote an existing account on
        // every container restart. Insert-only is the safe bootstrap.
        .onConflictDoNothing()
        .returning({ id: users.id, login: users.login });

      let row = rows[0];
      if (!row) {
        const existing = await tx
          .select({ id: users.id, login: users.login })
          .from(users)
          .where(eq(users.login, user.login))
          .limit(1);
        row = existing[0];
      }
      if (row) userIdByLogin.set(row.login, row.id);
    }

    if (!options.includeDemoCards) {
      return {
        users: userIdByLogin.size,
        warehouses: warehouseIdByCode.size,
        cards: 0,
      };
    }

    const existing = await tx.select({ value: count() }).from(cards);
    if (Number(existing[0]?.value ?? 0) > 0) {
      return {
        users: userIdByLogin.size,
        warehouses: warehouseIdByCode.size,
        cards: 0,
      };
    }

    const adminId = userIdByLogin.get('admin');
    const managerId = userIdByLogin.get('manager');
    const warehouseUserId = userIdByLogin.get('warehouse');
    const mskId = warehouseIdByCode.get('WH-MSK');
    const spbId = warehouseIdByCode.get('WH-SPB');

    if (!adminId || !managerId || !warehouseUserId || !mskId || !spbId) {
      throw new Error('Seed fixtures are incomplete');
    }

    const cardIdBySku = new Map<string, string>();
    const cardRows: Array<typeof cards.$inferInsert & { sku: string }> = DEMO_CARDS.map((item) => ({
      sku: item.sku,
      title: item.title,
      maskedNumber: `•••• ${item.last4}`,
      status: item.status,
      warehouseId: item.warehouseCode === 'WH-MSK' ? mskId : spbId,
      ownerId: item.owner ? managerId : null,
      holderId: item.holder ? managerId : null,
      notes: item.notes,
      issuedAt: item.status === 'issued' ? daysAgo(Math.max(1, item.createdDaysAgo - 2)) : null,
      writtenOffReason: item.writtenOffReason ?? null,
      version:
        item.status === 'returned'
          ? 2
          : item.status === 'issued' || item.status === 'written_off'
            ? 1
            : 0,
      createdBy: adminId,
      createdAt: daysAgo(item.createdDaysAgo),
      updatedAt: daysAgo(
        item.status === 'issued'
          ? Math.max(1, item.createdDaysAgo - 2)
          : item.status === 'in_stock'
            ? item.createdDaysAgo
            : 3,
      ),
    }));

    for (const row of cardRows) {
      const inserted = await tx
        .insert(cards)
        .values(row)
        .returning({ id: cards.id, sku: cards.sku });
      const created = inserted[0];
      if (created) cardIdBySku.set(created.sku, created.id);
    }

    const operationsToInsert: Array<typeof operations.$inferInsert> = [];

    for (const item of DEMO_CARDS) {
      const cardId = cardIdBySku.get(item.sku);
      if (!cardId) continue;
      const createdAt = daysAgo(item.createdDaysAgo);

      operationsToInsert.push({
        actorId: adminId,
        action: 'card.created',
        entityId: cardId,
        fromStatus: null,
        toStatus: 'in_stock',
        details: { sku: item.sku, seeded: true },
        requestId: `seed-create-${item.sku}`,
        createdAt,
      });

      if (item.status === 'issued' || item.status === 'returned') {
        operationsToInsert.push({
          actorId: warehouseUserId,
          action: 'card.issued',
          entityId: cardId,
          fromStatus: 'in_stock',
          toStatus: 'issued',
          details: { holderId: managerId, seeded: true },
          requestId: `seed-issue-${item.sku}`,
          createdAt: daysAgo(Math.max(1, item.createdDaysAgo - 2)),
        });
      }

      if (item.status === 'returned') {
        operationsToInsert.push({
          actorId: warehouseUserId,
          action: 'card.returned',
          entityId: cardId,
          fromStatus: 'issued',
          toStatus: 'returned',
          details: { previousHolderId: managerId, seeded: true },
          requestId: `seed-return-${item.sku}`,
          createdAt: daysAgo(3),
        });
      }

      if (item.status === 'written_off') {
        operationsToInsert.push({
          actorId: warehouseUserId,
          action: 'card.written_off',
          entityId: cardId,
          fromStatus: 'in_stock',
          toStatus: 'written_off',
          details: { reason: item.writtenOffReason, seeded: true },
          requestId: `seed-writeoff-${item.sku}`,
          createdAt: daysAgo(3),
        });
      }
    }

    if (operationsToInsert.length > 0) {
      // Keep append order aligned with business time. The audit cursor is an
      // id cursor, so back-dated fixtures must be inserted chronologically.
      const timestamp = (value: unknown) => (value instanceof Date ? value.getTime() : 0);
      operationsToInsert.sort(
        (left, right) => timestamp(left.createdAt) - timestamp(right.createdAt),
      );
      await tx.insert(operations).values(operationsToInsert);
    }

    const demoIssuedId = cardIdBySku.get('CRD-DEMO-01');
    const demoIssuedAt = daysAgo(5);
    if (demoIssuedId) {
      await tx.insert(outboxEvents).values({
        topic: 'realtime.dashboard',
        eventType: 'card.issued',
        payload: {
          type: 'card.issued',
          occurredAt: demoIssuedAt.toISOString(),
          card: {
            id: demoIssuedId,
            sku: 'CRD-DEMO-01',
            title: 'Карта «Витрина» · Альфа',
            status: 'issued',
            warehouseId: mskId,
            ownerId: managerId,
            holderId: managerId,
          },
          actor: {
            id: warehouseUserId,
            login: 'warehouse',
            name: 'Дмитрий Волков',
          },
        },
        occurredAt: demoIssuedAt,
      });
    }

    return {
      users: userIdByLogin.size,
      warehouses: warehouseIdByCode.size,
      cards: cardIdBySku.size,
    };
  });
}
