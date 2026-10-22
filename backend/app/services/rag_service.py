import json
import os
import urllib.error
import urllib.request

from .embedding_service import embed_texts, cosine_scores

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

def retrieve_chunks(question: str, chunks: list, top_k: int = 5) -> list[dict]:
    """Return the most semantically similar chunks from SQLAlchemy chunk objects."""
    usable = [chunk for chunk in chunks if chunk.embedding_json and chunk.text.strip()]
    if not usable:
        return []
    query_vector = embed_texts([question])[0]
    vectors = [json.loads(chunk.embedding_json) for chunk in usable]
    scores = cosine_scores(query_vector, vectors)
    ranked = sorted(zip(usable, scores), key=lambda pair: float(pair[1]), reverse=True)[:top_k]
    results = []
    for chunk, score in ranked:
        results.append({
            "document_id": chunk.document_id,
            "filename": chunk.document.filename,
            "chunk_index": chunk.chunk_index,
            "text": chunk.text,
            "score": max(0.0, float(score)),
        })
    return results

def _call_ollama(question: str, contexts: list[dict]) -> str | None:
    context_block = "\n\n".join(
        f"[Source {i + 1}: {item['filename']} | chunk {item['chunk_index'] + 1}]\n{item['text']}"
        for i, item in enumerate(contexts)
    )
    prompt = f"""You are DocuMind, a careful document question-answering assistant.
Answer the question using ONLY the context below. If the context does not contain the answer, say you could not find enough information in the uploaded documents.
Cite factual claims with source markers such as [1] or [2], matching the source numbers in the context. Never invent source references.

CONTEXT:
{context_block}

QUESTION:
{question}

Answer clearly and concisely. Include relevant source markers inline."""
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1}
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
            return (result.get("response") or "").strip() or None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None

def answer_question(question: str, contexts: list[dict]) -> tuple[str, str]:
    if not contexts:
        return ("I couldn't find any indexed document passages yet. Upload a text-based PDF, DOCX, or TXT file, then try again.", "no_context")
    answer = _call_ollama(question, contexts)
    if answer:
        return answer, "ollama"
    # Transparent offline fallback: show retrieved excerpts instead of pretending an LLM answered.
    excerpts = []
    for index, item in enumerate(contexts[:3], start=1):
        text = item["text"].strip()
        excerpt = text[:650] + ("…" if len(text) > 650 else "")
        excerpts.append(f"[{index}] {item['filename']}: {excerpt}")
    return (
        "Ollama is not reachable, so I have not generated an AI-written answer. Here are the most relevant retrieved passages instead:\n\n"
        + "\n\n".join(excerpts)
        + "\n\nTo enable generated answers, install Ollama, download the configured model, and restart this chat request.",
        "retrieval_fallback",
    )
