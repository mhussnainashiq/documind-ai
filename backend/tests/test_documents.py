from fastapi.testclient import TestClient
from app.main import app
from app.services.document_service import count_words, extract_text, split_into_chunks

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_txt_extraction_and_word_count():
    text = extract_text("sample.txt", b"DocuMind makes documents easier to understand.")
    assert text == "DocuMind makes documents easier to understand."
    assert count_words(text) == 7

def test_chunking_overlap_and_empty_text():
    assert split_into_chunks("") == []
    text = " ".join(f"word{i}" for i in range(250))
    chunks = split_into_chunks(text, chunk_size=100, overlap=20)
    assert len(chunks) >= 3
    assert chunks[0].split()[-1] == chunks[1].split()[19]

def test_unsupported_file_type():
    response = client.post("/api/documents/upload", files={"file": ("bad.exe", b"nope", "application/octet-stream")})
    assert response.status_code == 415

def test_api_status():
    response = client.get("/api/status")
    assert response.status_code == 200
    assert "embedding_model" in response.json()
