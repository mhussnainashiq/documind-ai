# DocuMind AI — Full Project 

DocuMind AI is a local-first document intelligence platform built with React + Vite + JavaScript, FastAPI, SQLAlchemy, SQLite, local embeddings, semantic search, and retrieval-augmented generation (RAG).

## Included phases

###  Document workspace
- Responsive React dashboard
- Upload PDF, DOCX, and TXT files (15 MB default maximum)
- Extract text using PyMuPDF and python-docx
- Store metadata and extracted text in SQLite
- Browse, search filenames, preview text, and delete documents
- FastAPI health endpoint and API documentation

###  Semantic search
- Split extracted text into overlapping chunks
- Generate local embeddings using `sentence-transformers/all-MiniLM-L6-v2`
- Save chunk text and embedding vectors in SQLite
- Retrieve semantically similar chunks using cosine similarity
- Search UI shows passages, source filename, chunk, and similarity score

###  RAG chat with citations
- Retrieve the most relevant document chunks for each question
- Use a local Ollama model to generate a grounded answer with inline source markers
- Show clickable source references in the chat UI
- If Ollama is not installed/running, the app transparently shows retrieved passages rather than pretending an LLM answered

No paid API keys or cloud database are required. The first embedding-model use downloads the model from Hugging Face. Ollama downloads a local language model separately. The original uploaded binary files are not retained; extracted text and embeddings are stored locally in SQLite.

## Requirements

- Windows 10/11
- Python 3.11 or 3.12 recommended
- Node.js LTS with npm
- 32 GB RAM is sufficient for this setup
- Internet access for initial package/model downloads; app processing runs locally

## 1. Start the backend

Open PowerShell:

```powershell
cd D:\React\documind-ai\backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The first `pip install` installs PyTorch and sentence-transformers and may take some time. On the first upload with extractable text, Sentence Transformers downloads `all-MiniLM-L6-v2`. Keep the backend terminal open.

If activation is blocked in PowerShell, run this in the current terminal and retry activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```



## 2. Start the frontend

Open a second PowerShell terminal:

```powershell
cd D:\React\documind-ai\frontend
npm install
Copy-Item .env.example .env
npm run dev
```



## 3. Enable generated RAG answers

The app works without Ollama, but without a local LLM it shows relevant passages as a transparent fallback. To enable generated answers:

1. Install Ollama for Windows from the official site: https://ollama.com/download
2. Open a new PowerShell terminal and pull a small model:

```powershell
ollama pull llama3.2:3b
```

3. Ensure Ollama is running (the default local service URL is `http://127.0.0.1:11434`).
4. Ask a question from the DocuMind chat page. The app will retrieve context and request a grounded answer from Ollama.

The model may need several GB of disk space and RAM. You can use another Ollama model by setting `OLLAMA_MODEL` before starting the backend, or editing the default in `backend/app/services/rag_service.py`. The model name must match a model installed in Ollama.

## 4. Tests

Open a third PowerShell terminal:

```powershell
cd D:\React\documind-ai\backend
.\.venv\Scripts\Activate.ps1
pytest -q
```

The test suite checks the health endpoint, text extraction, chunk splitting, unsupported-file rejection, and status endpoint. It does not require Ollama. Since the API uses the local SQLite database, run tests against a disposable database if you need to isolate your own development data.

## Troubleshooting

- **`npm` is not recognized:** install Node.js LTS, close and reopen PowerShell, then run `node -v` and `npm -v`.
- **`py` is not recognized:** install Python 3.11/3.12 and enable PATH; try `python -m venv .venv`.
- **`uvicorn` is not recognized:** activate `.venv`, then use `python -m uvicorn app.main:app --reload`.
- **Frontend says backend is unavailable:** keep the backend running and check `/api/health`.
- **First embedding takes time:** model weights download on first use. Keep the terminal connected to the internet until complete.
- **Embedding error during upload:** the document text is saved, but the document may have no chunks until indexing succeeds. Check the backend terminal for the model/download error.
- **Scanned PDFs:** Phase 1 extraction handles embedded text, not OCR. Image-only PDFs need an OCR stage, which is not included yet.
- **No generated chat answer:** Ollama is optional. Install it, pull `llama3.2:3b`, and ensure its local service is running.

## Security and production limitations

This is a learning/freelance portfolio starter, not a hardened public SaaS deployment. It has no user authentication, per-user document access controls, antivirus scanning, encrypted database, OCR, rate limiting, or background job queue. Do not expose the development API to the public internet or upload sensitive client data until you implement those controls. LLM output can be inaccurate; verify answers against cited passages.

