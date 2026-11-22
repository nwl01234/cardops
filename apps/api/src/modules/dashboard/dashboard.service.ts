import type { DashboardDto, WarehouseBreakdown } from '@cardops/shared';
import type { Database } from '../../db/client';
import type { Principal } from '../../http/context';
import { listOperations } from '../audit/audit.repo';
import { listWarehouses } from '../warehouses/warehouses.repo';
import { mineCount, statusCounts, warehouseStatusCounts } from './dashboard.repo';

export class DashboardService {
  constructor(private readonly db: Database) {}

  async get(principal: Principal): Promise<DashboardDto> {
    const [counts, mine, warehouseCounts, warehouses, recentOperations] = await Promise.all([
      statusCounts(this.db, principal),
      mineCount(this.db, principal),
      warehouseStatusCounts(this.db, principal),
      listWarehouses(this.db),
      listOperations(this.db, principal, { limit: 8 }),
    ]);

    const visibleWarehouses =
      principal.role === 'warehouse'
        ? warehouses.filter((warehouse) => warehouse.id === principal.warehouseId)
        : warehouses;

    const byWarehouse = new Map<string, WarehouseBreakdown>();
    for (const warehouse of visibleWarehouses) {
      byWarehouse.set(warehouse.id, {
        warehouse,
        inStock: 0,
        issued: 0,
        returned: 0,
        writtenOff: 0,
      });
    }
    for (const row of warehouseCounts) {
      const entry = byWarehouse.get(row.warehouseId);
      if (!entry) continue;
      if (row.status === 'in_stock') entry.inStock = row.value;
      if (row.status === 'issued') entry.issued = row.value;
      if (row.status === 'returned') entry.returned = row.value;
      if (row.status === 'written_off') entry.writtenOff = row.value;
    }

    return {
      stats: {
        total: counts.in_stock + counts.issued + counts.returned + counts.written_off,
        inStock: counts.in_stock,
        issued: counts.issued,
        returned: counts.returned,
        writtenOff: counts.written_off,
        mine,
      },
      warehouses: [...byWarehouse.values()],
      recentOperations: recentOperations.items,
      generatedAt: new Date().toISOString(),
    };
  }
}
