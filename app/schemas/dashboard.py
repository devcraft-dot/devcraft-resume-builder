from pydantic import BaseModel


class StageCount(BaseModel):
    stage: str
    count: int


class ModelBreakdown(BaseModel):
    model_name: str
    total: int
    passed_resume_check: int
    generated: int
    intro: int
    tech: int
    final: int
    success: int
    failed: int


class ProfileBreakdown(BaseModel):
    profile_name: str
    total: int
    passed_resume_check: int
    generated: int
    intro: int
    tech: int
    final: int
    success: int
    failed: int


class DashboardAnalytics(BaseModel):
    total_generations: int
    """Rows whose stage is intro, tech, final, or success."""

    passed_resume_check_total: int
    by_stage: list[StageCount]
    by_model: list[ModelBreakdown]
    by_profile: list[ProfileBreakdown]
