import type { SfErrorCode } from "@sf/protocol";

/** An expected failure with a stable code. `claim_gone` and `claimed` are rejections (exit 3, HTTP 409). */
export class SfError extends Error {
  constructor(
    readonly code: SfErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const HTTP_STATUS: Record<SfErrorCode, number> = {
  claim_gone: 409,
  claimed: 409,
  invalid: 400,
  not_found: 404,
  no_project: 404,
};

export function isRejection(err: unknown) {
  return err instanceof SfError && (err.code === "claim_gone" || err.code === "claimed");
}
