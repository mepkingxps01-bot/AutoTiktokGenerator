/**
 * Application error carrying a Thai user-facing message and an HTTP status.
 * `retryable` tells the pipeline whether a failed step may be attempted again.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly thaiMessage: string,
    public readonly status = 400,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(`${code}: ${thaiMessage}`);
    this.name = "AppError";
  }
}

export const Errors = {
  unauthorized: () => new AppError("unauthorized", "กรุณาเข้าสู่ระบบก่อนใช้งาน", 401),
  badInput: (msg: string, details?: unknown) => new AppError("bad_input", msg, 400, false, details),
  notFound: (what = "ข้อมูล") => new AppError("not_found", `ไม่พบ${what}`, 404),
  activeJob: (jobId: string) =>
    new AppError("active_job_exists", "มีงานสร้างคอนเทนต์กำลังทำงานอยู่ กรุณารอให้เสร็จก่อน", 409, false, { jobId }),
  rateLimited: (retryAfterSec: number) =>
    new AppError("rate_limited", `ส่งคำขอถี่เกินไป กรุณาลองใหม่ใน ${retryAfterSec} วินาที`, 429, false, { retryAfterSec }),
  quotaExceeded: (msg: string) => new AppError("quota_exceeded", msg, 429),
  similarTopic: (matches: unknown) =>
    new AppError("similar_topic", "หัวข้อนี้คล้ายกับคอนเทนต์ที่เคยสร้างแล้ว กรุณายืนยันหากต้องการสร้างต่อ", 409, false, matches),
  ai: (msg: string, retryable = true, details?: unknown) =>
    new AppError("ai_error", `ระบบ AI ขัดข้อง: ${msg}`, 502, retryable, details),
  validation: (issues: string[]) =>
    new AppError("content_invalid", `เนื้อหาที่ AI สร้างไม่ผ่านการตรวจสอบ: ${issues.slice(0, 3).join("; ")}`, 422, true, issues),
  config: (msg: string) => new AppError("config_error", `การตั้งค่าระบบไม่ครบ: ${msg}`, 500),
  storage: (msg: string) => new AppError("storage_error", `บันทึกข้อมูลไม่สำเร็จ: ${msg}`, 500, true),
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError("internal_error", "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง", 500, true, message);
}
