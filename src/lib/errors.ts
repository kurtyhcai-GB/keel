export class AppError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.extra = extra;
  }
}
