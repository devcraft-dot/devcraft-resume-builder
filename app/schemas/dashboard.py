from pydantic import BaseModel


class StageCount(BaseModel):
    stage: str
    count: int


class ModelBreakdown(BaseModel):
    model_name: str
    total: int
    success: int


class ProfileBreakdown(BaseModel):
    profile_name: str
    total: int
    success: int


class DashboardAnalytics(BaseModel):
    total_generations: int
    by_stage: list[StageCount]
    by_model: list[ModelBreakdown]
    by_profile: list[ProfileBreakdown]
