import type { CarouselStage, CarouselStatus, JobStatus, TopicStatus } from "./types";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "รอคิว",
  running: "กำลังสร้าง",
  completed: "เสร็จสมบูรณ์",
  partial: "เสร็จบางส่วน",
  failed: "ล้มเหลว",
  cancelled: "ยกเลิกแล้ว",
};

export const CAROUSEL_STAGE_LABELS: Record<CarouselStage, string> = {
  topic: "กำลังคิดหัวข้อ",
  script: "กำลังเขียนสคริปต์",
  illustrate: "กำลังสร้างภาพประกอบ",
  render: "กำลังเรนเดอร์สไลด์",
  done: "เสร็จแล้ว",
};

export const CAROUSEL_STATUS_LABELS: Record<CarouselStatus, string> = {
  queued: "กำลังดำเนินการ",
  completed: "เสร็จแล้ว",
  failed: "ล้มเหลว",
  cancelled: "ยกเลิก",
};

export const TOPIC_STATUS_LABELS: Record<TopicStatus, string> = {
  reserved: "กำลังสร้าง",
  completed: "สร้างสำเร็จ",
  failed: "ล้มเหลว",
  discarded: "ยกเลิก/แทนที่",
};

const STAGE_WEIGHT: Record<CarouselStage, number> = { topic: 0, script: 1, illustrate: 2, render: 3, done: 4 };

export function carouselProgress(stage: CarouselStage, status: CarouselStatus) {
  if (status === "completed") return 1;
  return STAGE_WEIGHT[stage] / 4;
}
