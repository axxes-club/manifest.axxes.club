/** An expected business-rule failure. Its message is safe to show to the user as-is. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "DomainError"
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError
