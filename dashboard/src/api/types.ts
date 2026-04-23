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
