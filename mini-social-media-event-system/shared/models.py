from pydantic import BaseModel, field_validator, ConfigDict

class LikeEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    user_id: int
    post_id: int

    @field_validator("user_id", "post_id")
    @classmethod
    def must_be_positive(cls, v, info):
        if v <= 0:
            raise ValueError(f"{info.field_name} must be a positive integer")
        return v

class CommentEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    user_id: int
    post_id: int
    comment: str

    @field_validator("user_id", "post_id")
    @classmethod
    def must_be_positive(cls, v, info):
        if v <= 0:
            raise ValueError(f"{info.field_name} must be a positive integer")
        return v

    @field_validator("comment")
    @classmethod
    def comment_not_empty(cls, v):
        if not v.strip():
            raise ValueError("comment cannot be empty or whitespace")
        return v
