import { and, count, eq } from 'drizzle-orm';
import type { AdminUserDto, Role, UserDto, UserRef } from '@cardops/shared';
import type { DbExecutor } from '../../db/client';
import { users, warehouses } from '../../db/schema';

export interface UserRecord {
  id: string;
  login: string;
  passwordHash: string;
  name: string;
  role: Role;
  warehouseId: string | null;
  warehouseName: string | null;
  isActive: boolean;
}

const selection = {
  id: users.id,
  login: users.login,
  passwordHash: users.passwordHash,
  name: users.name,
  role: users.role,
  warehouseId: users.warehouseId,
  warehouseName: warehouses.name,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

function mapUser(row: {
  id: string;
  login: string;
  passwordHash: string;
  name: string;
  role: Role;
  warehouseId: string | null;
  warehouseName: string | null;
  isActive: boolean;
}): UserRecord {
  return row;
}

export async function findUserByLogin(db: DbExecutor, login: string): Promise<UserRecord | null> {
  const rows = await db
    .select(selection)
    .from(users)
    .leftJoin(warehouses, eq(users.warehouseId, warehouses.id))
    .where(eq(users.login, login))
    .limit(1);
  const row = rows[0];
  return row ? mapUser(row) : null;
}

export async function findUserById(db: DbExecutor, id: string): Promise<UserRecord | null> {
  const rows = await db
    .select(selection)
    .from(users)
    .leftJoin(warehouses, eq(users.warehouseId, warehouses.id))
    .where(eq(users.id, id))
    .limit(1);
  const row = rows[0];
  return row ? mapUser(row) : null;
}

export async function findActiveManager(db: DbExecutor, id: string): Promise<UserRef | null> {
  const rows = await db
    .select({ id: users.id, login: users.login, name: users.name })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, 'manager'), eq(users.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listActiveUsersByRole(db: DbExecutor, role: Role): Promise<UserDto[]> {
  const rows = await db
    .select(selection)
    .from(users)
    .leftJoin(warehouses, eq(users.warehouseId, warehouses.id))
    .where(and(eq(users.role, role), eq(users.isActive, true)))
    .orderBy(users.name);

  return rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
  }));
}

export async function countActiveAdmins(db: DbExecutor): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  return rows[0]?.value ?? 0;
}

export async function listAdminUsers(db: DbExecutor): Promise<AdminUserDto[]> {
  const rows = await db
    .select(selection)
    .from(users)
    .leftJoin(warehouses, eq(users.warehouseId, warehouses.id))
    .orderBy(users.login);

  return rows.map((row) => ({
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createUser(
  db: DbExecutor,
  values: {
    login: string;
    passwordHash: string;
    name: string;
    role: Role;
    warehouseId: string | null;
  },
): Promise<AdminUserDto> {
  const rows = await db.insert(users).values(values).returning({ id: users.id });
  const row = rows[0];
  if (!row) throw new Error('User insert returned no row');
  const created = await findAdminUserById(db, row.id);
  if (!created) throw new Error('Created user could not be read back');
  return created;
}

export async function updateUser(
  db: DbExecutor,
  id: string,
  values: Partial<{
    name: string;
    passwordHash: string;
    role: Role;
    warehouseId: string | null;
    isActive: boolean;
  }>,
): Promise<AdminUserDto | null> {
  await db
    .update(users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(users.id, id));
  return findAdminUserById(db, id);
}

export async function findAdminUserById(db: DbExecutor, id: string): Promise<AdminUserDto | null> {
  const rows = await db
    .select(selection)
    .from(users)
    .leftJoin(warehouses, eq(users.warehouseId, warehouses.id))
    .where(eq(users.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    warehouseId: user.warehouseId,
    warehouseName: user.warehouseName,
  };
}

export function toUserRef(user: Pick<UserRecord, 'id' | 'login' | 'name'>): UserRef {
  return { id: user.id, login: user.login, name: user.name };
}
