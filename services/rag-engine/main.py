"""
main.py — HHB RAG Engine FastAPI Application
=============================================
Provides endpoints for text/document ingestion and hybrid graph-vector querying
using LightRAG and IBM Docling.

Endpoints:
  POST /api/v1/rag/ingest  → Upload document, parse, index into Knowledge Graph
  POST /api/v1/rag/query   → Query Knowledge Graph with hybrid retrieval
  GET  /api/v1/rag/health  → Health and configuration status
"""

import os
import logging
import tempfile
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load local environment variables
load_dotenv()

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
)
logger = logging.getLogger("rag-engine")

# ── LLM Configuration & LightRAG Initialization ──────────────────────────────
rag = None

def get_rag_instance():
    global rag
    if rag is not None:
        return rag

    provider = os.getenv("LLM_PROVIDER", "").lower()
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")

    # Auto-detect provider if not explicitly set
    if not provider:
        if gemini_key:
            provider = "gemini"
        elif openai_key:
            provider = "openai"
        else:
            provider = "gemini"  # Default fallback

    # Local DB directory for storing database files
    db_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "db"))
    os.makedirs(db_dir, exist_ok=True)
    logger.info(f"Using RAG database directory: {db_dir}")
    logger.info(f"Initializing LightRAG with provider: {provider}")

    from lightrag import LightRAG
    from lightrag.utils import wrap_embedding_func_with_attrs

    if provider == "gemini":
        if not gemini_key:
            logger.warning("GEMINI_API_KEY is not set. API calls to Gemini will fail.")
        
        from lightrag.llm.gemini import gemini_model_complete, gemini_embed
        llm_model = os.getenv("LLM_MODEL", "gemini-2.0-flash")
        embed_model = os.getenv("EMBEDDING_MODEL", "models/text-embedding-004")

        async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
            return await gemini_model_complete(
                prompt,
                system_prompt=system_prompt,
                history_messages=history_messages,
                api_key=gemini_key,
                model_name=llm_model,
                **kwargs
            )

        @wrap_embedding_func_with_attrs(
            embedding_dim=768,
            max_token_size=2048,
            model_name=embed_model
        )
        async def embedding_func(texts: list[str]) -> list[list[float]]:
            return await gemini_embed(texts, api_key=gemini_key)

        rag = LightRAG(
            working_dir=db_dir,
            llm_model_func=llm_model_func,
            embedding_func=embedding_func
        )
    elif provider == "openai":
        if not openai_key:
            logger.warning("OPENAI_API_KEY is not set. API calls to OpenAI will fail.")
        
        # Ensure standard env variable is set for internal lightrag helpers
        os.environ["OPENAI_API_KEY"] = openai_key
        if os.getenv("OPENAI_BASE_URL"):
            os.environ["OPENAI_BASE_URL"] = os.getenv("OPENAI_BASE_URL")

        from lightrag.llm.openai import gpt_4o_mini_complete, openai_embed
        llm_model = os.getenv("LLM_MODEL", "gpt-4o-mini")
        embed_model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

        async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
            return await gpt_4o_mini_complete(
                prompt,
                system_prompt=system_prompt,
                history_messages=history_messages,
                model=llm_model,
                **kwargs
            )

        # text-embedding-3-small uses 1536 dim, text-embedding-3-large uses 3072, text-embedding-ada-002 uses 1536
        dim = 1536
        if "large" in embed_model:
            dim = 3072

        @wrap_embedding_func_with_attrs(
            embedding_dim=dim,
            max_token_size=8192,
            model_name=embed_model
        )
        async def embedding_func(texts: list[str]) -> list[list[float]]:
            return await openai_embed(texts, model=embed_model)

        rag = LightRAG(
            working_dir=db_dir,
            llm_model_func=llm_model_func,
            embedding_func=embedding_func
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")

    return rag


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize LightRAG on startup."""
    try:
        get_rag_instance()
        logger.info("RAG Engine successfully initialized")
    except Exception as e:
        logger.error(f"Error during RAG Engine startup: {e}")
    yield


app = FastAPI(
    title="HHB RAG Engine",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS Middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:3000",
        "https://heatherhollybody.com",
        "https://www.heatherhollybody.com",
        "https://ilovetoridemybicycle.com",
        "https://www.ilovetoridemybicycle.com",
        "https://heather-holly-body.vercel.app",
        "https://heatherhollybody.vercel.app",
        "https://ai-labs.ipopenov.workers.dev",
    ],
    allow_origin_regex=r"https://.*\.(vercel\.app|workers\.dev|trycloudflare\.com)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    query: str
    mode: str = "hybrid"  # naive, local, global, hybrid, mix


# ── Fallback Parser ───────────────────────────────────────────────────────────
def extract_fallback_text(file_path: str, file_suffix: str) -> str:
    """Fallback plain text or basic file parser if Docling fails."""
    suffix = file_suffix.lower()
    
    if suffix in [".txt", ".md", ".json", ".csv"]:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
            
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            if text.strip():
                return text
        except Exception as e:
            logger.warning(f"pypdf fallback failed: {e}")
            
    if suffix == ".docx":
        try:
            import docx
            doc = docx.Document(file_path)
            text = "\n".join([para.text for para in doc.paragraphs])
            if text.strip():
                return text
        except Exception as e:
            logger.warning(f"docx fallback failed: {e}")
            
    raise ValueError(f"Could not extract text from file type {suffix}")


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/api/v1/rag/health")
async def health():
    provider = os.getenv("LLM_PROVIDER", "").lower()
    has_gemini = bool(os.getenv("GEMINI_API_KEY"))
    has_openai = bool(os.getenv("OPENAI_API_KEY"))
    return {
        "status": "ok",
        "provider": provider or ("gemini" if has_gemini else "openai" if has_openai else "not-configured"),
        "features": {
            "gemini_api_key_configured": has_gemini,
            "openai_api_key_configured": has_openai,
        }
    }


@app.post("/api/v1/rag/ingest")
async def ingest_document(file: UploadFile = File(...)):
    try:
        suffix = os.path.splitext(file.filename)[1]
        
        # Save uploaded file bytes to a temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
            
        logger.info(f"Ingesting file: {file.filename} (suffix: {suffix})")
        markdown_content = ""
        parsed_with = "docling"

        try:
            # Attempt to parse with Docling
            from docling.document_converter import DocumentConverter
            converter = DocumentConverter()
            result = converter.convert(tmp_path)
            markdown_content = result.document.export_to_markdown()
            logger.info(f"Successfully parsed {file.filename} with Docling. Extracted {len(markdown_content)} chars.")
        except Exception as e:
            logger.warning(f"Docling failed to parse {file.filename}: {e}. Retrying with fallback parser.")
            try:
                markdown_content = extract_fallback_text(tmp_path, suffix)
                parsed_with = "fallback"
                logger.info(f"Successfully parsed {file.filename} with fallback. Extracted {len(markdown_content)} chars.")
            except Exception as fe:
                logger.error(f"Fallback parser failed for {file.filename}: {fe}")
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Failed to parse document. Docling error: {e}. Fallback error: {fe}"
                )
        finally:
            # Clean up temp file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        if not markdown_content.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Extracted document content is empty."
            )

        # Ingest content into LightRAG instance
        rag_instance = get_rag_instance()
        await rag_instance.insert(markdown_content)

        return {
            "status": "success",
            "filename": file.filename,
            "parsed_with": parsed_with,
            "content_length": len(markdown_content),
            "message": "Document successfully ingested and indexed into knowledge graph."
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Ingestion error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during ingestion: {str(e)}"
        )


@app.post("/api/v1/rag/query")
async def query_rag(req: QueryRequest):
    try:
        if not req.query.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Query text cannot be empty."
            )

        from lightrag import QueryParam
        rag_instance = get_rag_instance()
        
        # Valid modes: naive, local, global, hybrid, mix
        mode = req.mode.lower()
        if mode not in ["naive", "local", "global", "hybrid", "mix"]:
            mode = "hybrid"

        logger.info(f"Querying RAG with mode '{mode}': {req.query}")
        response = await rag_instance.query(req.query, param=QueryParam(mode=mode))
        
        return {
            "query": req.query,
            "mode": mode,
            "answer": response
        }
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during query execution: {str(e)}"
        )
