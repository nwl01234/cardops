import type { AuditQuery, CursorPage, OperationDto } from '@cardops/shared';
import type { Database } from '../../db/client';
import type { Principal } from '../../http/context';
import { listOperations } from './audit.repo';

export class AuditService {
  constructor(private readonly db: Database) {}

  list(principal: Principal, query: AuditQuery): Promise<CursorPage<OperationDto>> {
    return listOperations(this.db, principal, query);
  }
}
