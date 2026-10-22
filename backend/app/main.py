import json
import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload

from . import models
from .database import Base, engine, get_db
from .schemas import ChatRequest, RenameDocumentRequest, SearchRequest
from .services.document_service import ALLOWED_EXTENSIONS, count_words, extract_text, split_into_chunks
from .services.embedding_service import embed_texts
from .services.rag_service import answer_question, retrieve_chunks

Base.metadata.create_all(bind=engine)
app = FastAPI(
    title="DocuMind AI API",
    description="Local document ingestion, semantic retrieval, and RAG chat with source references.",
    version="3.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "15"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "900"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "150"))

def serialize_document(document):
    return {
        "id": document.id,
        "filename": document.filename,
        "content_type": document.content_type,
        "file_size": document.file_size,
        "word_count": document.word_count,
        "extracted_text": document.extracted_text,
        "created_at": document.created_at,
        "chunk_count": len(document.chunks),
    }

@app.get("/")
def root():
    return {"name": "DocuMind AI API", "phases": [1, 2, 3, 4, 5, 6], "status": "running", "docs": "/docs"}

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "documind-ai-api"}

@app.get("/api/status")
def status():
    return {
        "api": "running",
        "embedding_model": os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"),
        "ollama_url": os.getenv("OLLAMA_URL", "http://127.0.0.1:11434"),
        "ollama_model": os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
        "notes": "The embedding model downloads on first indexing/search. Ollama is optional; without it chat returns retrieved excerpts."
    }

@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="A filename is required.")
    if Path(filename).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported file type. Upload a PDF, DOCX, or TXT file.")
    raw_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_MB} MB upload limit.")
    text = extract_text(filename, raw_bytes)
    document = models.Document(
        filename=filename,
        content_type=file.content_type,
        file_size=len(raw_bytes),
        word_count=count_words(text),
        extracted_text=text,
    )
    db.add(document)
    db.flush()
    chunks_text = split_into_chunks(text, CHUNK_SIZE, CHUNK_OVERLAP)
    embedding_status = "no_text"
    if chunks_text:
        try:
            embeddings = embed_texts(chunks_text)
            for index, (chunk_text, vector) in enumerate(zip(chunks_text, embeddings)):
                db.add(models.DocumentChunk(
                    document_id=document.id,
                    chunk_index=index,
                    text=chunk_text,
                    embedding_json=json.dumps(vector),
                ))
            embedding_status = "ready"
        except Exception as exc:
            # Save the uploaded document even if local embedding dependencies/model download fail.
            db.rollback()
            document = models.Document(
                filename=filename,
                content_type=file.content_type,
                file_size=len(raw_bytes),
                word_count=count_words(text),
                extracted_text=text,
            )
            db.add(document)
            db.flush()
            embedding_status = f"pending: {type(exc).__name__}"
    db.commit()
    db.refresh(document)
    return {**serialize_document(document), "embedding_status": embedding_status}

@app.get("/api/documents")
def list_documents(db: Session = Depends(get_db)):
    documents = db.query(models.Document).options(joinedload(models.Document.chunks)).order_by(
        models.Document.created_at.desc(), models.Document.id.desc()
    ).all()
    return [serialize_document(document) for document in documents]

@app.get("/api/documents/{document_id}")
def get_document(document_id: int, db: Session = Depends(get_db)):
    document = db.query(models.Document).options(joinedload(models.Document.chunks)).filter(
        models.Document.id == document_id
    ).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return serialize_document(document)

@app.patch("/api/documents/{document_id}")
def rename_document(document_id: int, payload: RenameDocumentRequest, db: Session = Depends(get_db)):
    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    requested_name = payload.filename.strip()
    filename = Path(requested_name).name
    if not filename or filename in {".", ".."} or "/" in requested_name or "\\" in requested_name:
        raise HTTPException(status_code=400, detail="Enter a valid filename without folder paths.")
    if Path(filename).suffix.lower() != Path(document.filename).suffix.lower():
        raise HTTPException(status_code=400, detail="Keep the original file extension when renaming a document.")
    document.filename = filename
    db.commit()
    db.refresh(document)
    return serialize_document(document)


@app.post("/api/documents/{document_id}/index")
def reindex_document(document_id: int, db: Session = Depends(get_db)):
    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    chunks_text = split_into_chunks(document.extracted_text, CHUNK_SIZE, CHUNK_OVERLAP)
    if not chunks_text:
        raise HTTPException(status_code=422, detail="No extracted text is available to index.")
    try:
        embeddings = embed_texts(chunks_text)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not create embeddings. Check dependencies and model download, then retry ({type(exc).__name__}).") from exc

    # Only replace the existing index after embedding succeeds.
    db.query(models.DocumentChunk).filter(models.DocumentChunk.document_id == document_id).delete(synchronize_session=False)
    for index, (chunk_text, vector) in enumerate(zip(chunks_text, embeddings)):
        db.add(models.DocumentChunk(
            document_id=document_id,
            chunk_index=index,
            text=chunk_text,
            embedding_json=json.dumps(vector),
        ))
    db.commit()
    return {"document_id": document_id, "filename": document.filename, "chunk_count": len(chunks_text), "status": "indexed"}


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: int, db: Session = Depends(get_db)):
    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    db.delete(document)
    db.commit()
    return {"message": "Document and its chunks deleted.", "id": document_id}

@app.post("/api/search")
def semantic_search(payload: SearchRequest, db: Session = Depends(get_db)):
    chunks = db.query(models.DocumentChunk).options(joinedload(models.DocumentChunk.document)).all()
    results = retrieve_chunks(payload.query, chunks, payload.top_k)
    return {"query": payload.query, "results": results, "count": len(results)}

@app.post("/api/chat")
def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    chunks = db.query(models.DocumentChunk).options(joinedload(models.DocumentChunk.document)).all()
    results = retrieve_chunks(payload.question, chunks, payload.top_k)
    answer, mode = answer_question(payload.question, results)
    sources = []
    seen = set()
    for result in results:
        if result["document_id"] in seen:
            continue
        seen.add(result["document_id"])
        sources.append({
            "document_id": result["document_id"],
            "filename": result["filename"],
            "excerpt": result["text"][:320] + ("…" if len(result["text"]) > 320 else ""),
            "score": result["score"],
            "chunk_index": result["chunk_index"],
        })
    return {"question": payload.question, "answer": answer, "mode": mode, "sources": sources}
