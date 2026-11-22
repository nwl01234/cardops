import type { CardDetailDto } from '@cardops/shared';
import type { AppConfig } from '../../config/env';
import { AppError } from '../../lib/errors';

/**
 * Documents is a separate deployable. It never decides access: core API has
 * already applied object scope before sending the card snapshot.
 */
export class DocumentsClient {
  constructor(private readonly config: AppConfig) {}

  async act(card: CardDetailDto): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(`${this.config.DOCUMENTS_URL}/documents/act`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': this.config.DOCUMENTS_INTERNAL_TOKEN,
        },
        body: JSON.stringify({ card }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError('INTERNAL_ERROR', 'Documents service is unavailable');
    }

    if (!response.ok) {
      throw new AppError('INTERNAL_ERROR', 'Documents service could not build the act');
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
