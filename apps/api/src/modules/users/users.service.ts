import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  AdminUserDto,
  Role,
} from '@cardops/shared';
import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/client';
import { AppError } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import type { AuthService } from '../auth/auth.service';
import { findWarehouseById } from '../warehouses/warehouses.repo';
import {
  countActiveAdmins,
  createUser,
  findAdminUserById,
  listAdminUsers,
  updateUser,
} from './users.repo';

export class UsersService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
  ) {}

  list(): Promise<AdminUserDto[]> {
    return listAdminUsers(this.db);
  }

  async create(input: AdminCreateUserInput): Promise<AdminUserDto> {
    const warehouseId = await this.resolveWarehouse(input.role, input.warehouseId ?? null);
    const passwordHash = await hashPassword(input.password);
    try {
      return await createUser(this.db, {
        login: input.login,
        passwordHash,
        name: input.name,
        role: input.role,
        warehouseId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('CONFLICT', 'A user with this login already exists');
      }
      throw error;
    }
  }

  async update(
    actorId: string,
    userId: string,
    input: AdminUpdateUserInput,
  ): Promise<AdminUserDto> {
    const current = await findAdminUserById(this.db, userId);
    if (!current) throw AppError.notFound('User not found');

    const nextRole = input.role ?? current.role;
    const nextWarehouseId =
      input.warehouseId !== undefined ? input.warehouseId : current.warehouseId;
    const warehouseId = await this.resolveWarehouse(nextRole, nextWarehouseId);

    if (actorId === userId && input.isActive === false) {
      throw new AppError('CONFLICT', 'You cannot deactivate your own account');
    }
    if (actorId === userId && input.role !== undefined && input.role !== current.role) {
      throw new AppError('CONFLICT', 'You cannot change your own role');
    }

    const removesActiveAdmin =
      current.role === 'admin' &&
      current.isActive &&
      ((input.role !== undefined && input.role !== 'admin') || input.isActive === false);
    if (removesActiveAdmin && (await countActiveAdmins(this.db)) <= 1) {
      throw new AppError('CONFLICT', 'At least one active admin must remain');
    }

    const updated = await updateUser(this.db, userId, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.password === undefined ? {} : { passwordHash: await hashPassword(input.password) }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.warehouseId === undefined && input.role === undefined ? {} : { warehouseId }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    });
    if (!updated) throw AppError.notFound('User not found');

    if (
      input.password !== undefined ||
      input.isActive === false ||
      (input.role !== undefined && input.role !== current.role)
    ) {
      await this.auth.revokeUserSessions(userId);
    }

    return updated;
  }

  async revokeSessions(userId: string): Promise<void> {
    const user = await findAdminUserById(this.db, userId);
    if (!user) throw AppError.notFound('User not found');
    await this.auth.revokeUserSessions(userId);
  }

  private async resolveWarehouse(role: Role, warehouseId: string | null): Promise<string | null> {
    if (role !== 'warehouse') return null;
    if (!warehouseId) {
      throw AppError.validation([
        { path: 'warehouseId', message: 'Warehouse is required for role "warehouse"' },
      ]);
    }
    const warehouse = await findWarehouseById(this.db, warehouseId);
    if (!warehouse) {
      throw AppError.validation([{ path: 'warehouseId', message: 'Warehouse not found' }]);
    }
    return warehouseId;
  }
}
