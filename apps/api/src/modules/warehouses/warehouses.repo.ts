import type { WarehouseDto } from '@cardops/shared';
import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { warehouses } from '../../db/schema';

export async function listWarehouses(db: DbExecutor): Promise<WarehouseDto[]> {
  return db
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      city: warehouses.city,
    })
    .from(warehouses)
    .orderBy(asc(warehouses.code));
}

export async function findWarehouseById(db: DbExecutor, id: string): Promise<WarehouseDto | null> {
  const rows = await db
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      city: warehouses.city,
    })
    .from(warehouses)
    .where(eq(warehouses.id, id))
    .limit(1);
  return rows[0] ?? null;
}
