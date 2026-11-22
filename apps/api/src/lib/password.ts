import { hash, verify } from '@node-rs/argon2';

const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Verified for unknown logins so response timing does not reveal account existence. */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$4tTtxbfgPF2I5YUNePJBbA$6ivLZjioWUufcELmNTZOnMJnjqFKhq06yGuhrXuWkJk';

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, OPTIONS);
  } catch {
    return false;
  }
}

export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password);
}
