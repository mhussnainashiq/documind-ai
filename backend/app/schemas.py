from pydantic import BaseModel, ConfigDict, Field

class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    content_type: str | None
    file_size: int
    word_count: int
    extracted_text: str
    created_at: object
    chunk_count: int = 0

class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)

class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=10)


class RenameDocumentRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
