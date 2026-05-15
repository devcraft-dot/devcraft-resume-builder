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
  /** intro + tech + final + success (past initial generation) */
  passed_resume_check: number;
  generated: number;
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

export interface MeUser {
  id: number;
  display_name: string;
  role: string;
}

export interface User {
  id: number;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  profile_ids: number[];
}

export interface UserCreateResponse extends User {
  api_token: string;
}

export interface TokenRotateResponse {
  api_token: string;
}

export interface RegisteredProfileSummary {
  id: number;
  name: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface RegisteredProfile extends RegisteredProfileSummary {
  profile_text: string;
}

export interface AssignedProfile {
  id: number;
  name: string;
  model: string;
  profile_text: string;
}

export const ALLOWED_MODELS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "deepseek",
  "deepseek-reasoner",
] as const;
