// Mirrors apps/api/schemas/feedback.py.

export type FeedbackCategory =
  | "bug"
  | "demo_issue"
  | "idea"
  | "suggestion"
  | "question";

export type FeedbackStatus = "open" | "reviewing" | "resolved" | "dismissed";

export interface FeedbackCreateBody {
  category: FeedbackCategory;
  subject?: string | null;
  body: string;
  pageUrl?: string | null;
  userAgent?: string | null;
  demoId?: number | null;
}

export interface FeedbackPublic {
  id: number;
  status: FeedbackStatus;
  createdAt: string;
}

export interface FeedbackReporter {
  id: string | null;
  nick: string | null;
  steamId: string | null;
  avatarUrl: string | null;
}

export interface FeedbackAdminRecord {
  id: number;
  category: FeedbackCategory;
  subject: string | null;
  body: string;
  status: FeedbackStatus;
  pageUrl: string | null;
  userAgent: string | null;
  demoId: number | null;
  adminNotes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  reporter: FeedbackReporter | null;
}

export interface FeedbackAdminListResponse {
  total: number;
  items: FeedbackAdminRecord[];
  counts: Record<FeedbackStatus, number>;
}

export interface FeedbackAdminUpdateBody {
  status?: FeedbackStatus;
  adminNotes?: string;
}
