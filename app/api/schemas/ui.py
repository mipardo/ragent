from typing import Literal
from pydantic import BaseModel
from app.api.schemas.knowledge import KnowledgeSourcePayloadKeys


class UIQdrantStatus(BaseModel):
    url: str
    reachable: bool
    collections_count: int | None = None


class UIChatBackend(BaseModel):
    model: str
    temperature: float
    max_tokens: int


class UIAgentItem(BaseModel):
    agent_id: str
    name: str
    description: str
    model: str
    public: bool
    enable_tools: bool
    system_prompt: str
    retrieval_tools: list[str]
    utility_tools: list[str]


class UIKnowledgeSourceItem(BaseModel):
    id: str
    name: str
    description: str
    collection_name: str
    retrieval_type: Literal["semantic", "lexical", "hybrid"]
    dense_vector_name: str | None
    sparse_vector_name: str | None
    payload_keys: KnowledgeSourcePayloadKeys
    exists: bool
    points_count: int | None = None
    last_data_update: str | None = None


class UIDataResponse(BaseModel):
    status: Literal["ok"] = "ok"
    qdrant: UIQdrantStatus
    chat_backend: UIChatBackend
    agents: list[UIAgentItem]
    knowledge_sources: list[UIKnowledgeSourceItem]