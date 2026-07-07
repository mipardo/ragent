from pathlib import Path
from dataclasses import asdict
from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, RedirectResponse
from app.core.agent.service import AgentService
from app.core.knowledge_source.service import KnowledgeSourceService
from app.api.schemas.ui import (
    UIDataResponse,
    UIQdrantStatus,
    UIChatBackend,
    UIAgentItem,
    UIKnowledgeSourceItem,
)


UI_TAG = "Admin UI"

# Deben coincidir con las tools registradas en AgentFactory.build
RETRIEVAL_TOOLS = [
    "search_employees",
    "search_articles",
    "search_devices",
    "search_manuals",
    "search_tickets",
]
UTILITY_TOOLS = [
    "calculator",
    "get_current_time",
]

UI_INDEX_FILE = Path(__file__).resolve().parents[2] / "ui" / "index.html"


router = APIRouter()


def get_agent_service(request: Request) -> AgentService:
    return request.app.state.agent_service


def get_knowledge_service(request: Request) -> KnowledgeSourceService:
    return request.app.state.knowledge_service


@router.get(path="/", include_in_schema=False)
async def redirect_root_to_ui() -> RedirectResponse:
    return RedirectResponse(url="/ui")


@router.get(
    path="/ui",
    include_in_schema=False,
)
async def serve_ui() -> FileResponse:
    return FileResponse(UI_INDEX_FILE, media_type="text/html")


@router.get(
    path="/ui/data",
    response_model=UIDataResponse,
    tags=[UI_TAG],
    summary="Datos agregados para el panel de administración",
    description=(
        "Devuelve el estado de Qdrant, el backend de chat, los agentes definidos"
        " y las fuentes de conocimiento con su estado en Qdrant. Pensado para alimentar el panel de administración (/ui)"
    ),
)
async def get_ui_data(
    request: Request,
    agent_service: AgentService = Depends(get_agent_service),
    knowledge_service: KnowledgeSourceService = Depends(get_knowledge_service),
) -> UIDataResponse:
    settings = request.app.state.settings

    qdrant_status = await knowledge_service.get_qdrant_status()

    knowledge_sources: list[UIKnowledgeSourceItem] = []
    for definition in knowledge_service.list_knowledge_sources():
        source_status = await knowledge_service.get_knowledge_source_status(definition.id)
        knowledge_sources.append(
            UIKnowledgeSourceItem.model_validate({**asdict(definition), **source_status})
        )

    agents = [
        UIAgentItem(
            agent_id=agent.agent_id,
            name=agent.name,
            description=agent.description,
            model=agent.backend_chat_model,
            public=agent.public,
            enable_tools=agent.enable_tools,
            system_prompt=agent.system_prompt,
            retrieval_tools=RETRIEVAL_TOOLS if agent.enable_tools else [],
            utility_tools=UTILITY_TOOLS if agent.enable_tools else [],
        )
        for agent in agent_service.list_agents()
    ]

    return UIDataResponse(
        qdrant=UIQdrantStatus(
            url=settings.qdrant_url,
            reachable=qdrant_status["reachable"],
            collections_count=qdrant_status["collections_count"],
        ),
        chat_backend=UIChatBackend(
            model=settings.chat_model,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
        ),
        agents=agents,
        knowledge_sources=knowledge_sources,
    )