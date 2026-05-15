export interface ApplicationScreenshot {
  id: number;
  created_at: string;
  drive_url: string;
  filename: string;
  job_title: string;
  company_name: string;
  file_mime: string;
  thumbnail_url: string;
}

export interface ApplicationScreenshotList {
  items: ApplicationScreenshot[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Generation {
  id: number;
  created_at: string;
  user_id?: number | null;
  client_username?: string | null;
  profile_name: string;
  stage: string;
  title: string;
  company_name: string;
  salary_range: string;
  note: string;
  url: string;
  resume_drive_url: string;
  questions_drive_url: string;
  jd_drive_url: string;
  model_name: string;
}

export interface GenerationList {
  items: Generation[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export const STAGES = [
  "generated",
  "applied",
  "intro",
  "tech",
  "final",
  "success",
  "failed",
] as const;

export interface StageCount {
  stage: string;
  count: number;
}

export interface ModelBreakdown {
  model_name: string;
  total: number;
  /** applied + intro + tech + final + success */
  passed_resume_check: number;
  generated: number;
  applied: number;
  intro: number;
  tech: number;
  final: number;
  success: number;
  failed: number;
}

export interface ProfileBreakdown {
  profile_name: string;
  total: number;
  passed_resume_check: number;
  generated: number;
  applied: number;
  intro: number;
  tech: number;
  final: number;
  success: number;
  failed: number;
}

export interface DashboardAnalytics {
  total_generations: number;
  passed_resume_check_total: number;
  by_stage: StageCount[];
  by_model: ModelBreakdown[];
  by_profile: ProfileBreakdown[];
}

export interface RegisteredProfile {
  id: number;
  created_at: string;
  name: string;
  profile_text: string;
}
