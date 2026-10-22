import React, { useEffect, useRef, useState } from "react";
import {
  BrainCircuit, FileText, FileUp, Search, ShieldCheck, CheckCircle2,
  AlertCircle, LoaderCircle, Trash2, File, FileType2, RefreshCw, Sparkles,
  Database, X, MessageSquareText, Send, BookOpen, Network, Bot, UserRound,
  ChevronRight, ExternalLink, Zap, Pencil
} from "lucide-react";

const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
function formatDate(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function FileIcon({ filename = "" }) {
  return filename.toLowerCase().endsWith(".docx") ? <FileType2 size={20} /> : <FileText size={20} />;
}

export default function App() {
  const fileInput = useRef(null);
  const chatEnd = useRef(null);
  const [page, setPage] = useState("documents");
  const [documents, setDocuments] = useState([]);
  const [query, setQuery] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! Ask a question about your uploaded documents. I’ll retrieve relevant passages and cite the source documents. For generated answers, start Ollama locally as described in the README.", sources: [] }
  ]);

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
    return data;
  }
  async function loadDocuments() {
    setLoading(true);
    try { setDocuments(await api("/api/documents")); }
    catch (err) { setError(`${err.message} Make sure the backend is running.`); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadDocuments(); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatLoading]);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setError(""); setNotice("");
    let done = 0; const errors = [];
    for (const file of files) {
      const body = new FormData(); body.append("file", file);
      try {
        const result = await api("/api/documents/upload", { method: "POST", body });
        done++;
        if (result.embedding_status === "ready") {
          // Embeddings were generated automatically.
        }
      } catch (err) { errors.push(`${file.name}: ${err.message}`); }
    }
    await loadDocuments();
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (done) setNotice(`${done} document${done === 1 ? "" : "s"} uploaded. Text extraction and indexing completed where available.`);
    if (errors.length) setError(errors.join(" "));
  }
  async function deleteDocument(id, name) {
    if (!window.confirm(`Delete "${name}" and its chunks/embeddings?`)) return;
    try {
      await api(`/api/documents/${id}`, { method: "DELETE" });
      setDocuments((old) => old.filter((doc) => doc.id !== id));
      setSearchResults((old) => old.filter((item) => item.document_id !== id));
      if (selectedDocument?.id === id) setSelectedDocument(null);
      setNotice("Document and its index deleted.");
    } catch (err) { setError(err.message); }
  }
  async function renameDocument(id, currentName) {
    const nextName = window.prompt("Enter a new document name (keep the file extension):", currentName);
    if (nextName === null) return;
    if (!nextName.trim() || nextName.trim() === currentName) return;
    try {
      const updated = await api(`/api/documents/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: nextName.trim() })
      });
      setDocuments((old) => old.map((doc) => doc.id === id ? { ...doc, ...updated } : doc));
      setSelectedDocument((old) => old?.id === id ? { ...old, ...updated } : old);
      setSearchResults((old) => old.map((item) => item.document_id === id ? { ...item, filename: updated.filename } : item));
      setNotice("Document renamed successfully.");
      setError("");
    } catch (err) { setError(err.message); }
  }
  async function reindexDocument(id, name) {
    setError(""); setNotice("");
    try {
      const result = await api(`/api/documents/${id}/index`, { method: "POST" });
      await loadDocuments();
      setNotice(`Indexed ${name}: ${result.chunk_count} chunks created.`);
    } catch (err) { setError(`Could not index ${name}: ${err.message}`); }
  }

  async function runSearch(event) {
    event?.preventDefault();
    if (!semanticQuery.trim()) return;
    setSearching(true); setError("");
    try {
      const data = await api("/api/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: semanticQuery, top_k: 8 })
      });
      setSearchResults(data.results || []);
    } catch (err) { setError(err.message); }
    finally { setSearching(false); }
  }
  async function sendChat(event) {
    event?.preventDefault();
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    setChatInput("");
    setMessages((old) => [...old, { role: "user", content: question, sources: [] }]);
    setChatLoading(true); setError("");
    try {
      const result = await api("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, top_k: 5 })
      });
      setMessages((old) => [...old, { role: "assistant", content: result.answer, sources: result.sources || [], mode: result.mode }]);
    } catch (err) {
      setMessages((old) => [...old, { role: "assistant", content: `I couldn't answer that request: ${err.message}`, sources: [] }]);
    } finally { setChatLoading(false); }
  }

  const filteredDocuments = documents.filter((doc) =>
    `${doc.filename} ${doc.content_type || ""}`.toLowerCase().includes(query.toLowerCase())
  );
  const totalWords = documents.reduce((sum, doc) => sum + (doc.word_count || 0), 0);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setPage("documents"); }}>
        <span className="brand-mark"><BrainCircuit size={25} /></span>
        <span><strong>DocuMind</strong><small>AI WORKSPACE</small></span>
      </a>
      <div className="workspace-label">WORKSPACE</div>
      <button className={`nav-item ${page === "documents" ? "active" : ""}`} onClick={() => setPage("documents")}><FileText size={18} /> Documents <span className="nav-count">{documents.length}</span></button>
      <button className={`nav-item ${page === "search" ? "active" : ""}`} onClick={() => setPage("search")}><Search size={18} /> Semantic search</button>
      <button className={`nav-item ${page === "chat" ? "active" : ""}`} onClick={() => setPage("chat")}><MessageSquareText size={18} /> Ask your documents</button>
      <div className="sidebar-bottom">
        <div className="privacy-card"><span className="privacy-icon"><ShieldCheck size={18} /></span><strong>Local-first workspace</strong><p>Your documents and index are stored locally. Ollama can generate chat answers without a paid API key.</p></div>
        <div className="profile-row"><div className="avatar">DM</div><div><strong>My workspace</strong><small>Local development</small></div><span className="online-dot" /></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{page === "documents" ? "Documents" : page === "search" ? "Semantic search" : "Document chat"}</strong></div><div className="topbar-right"><span className="status-dot" /> Local environment <span className="topbar-avatar">H</span></div></header>
      <div className="page-content">
        <section className="welcome-row">
          <div><div className="eyebrow"><Sparkles size={14} /> DOCUMENT INTELLIGENCE</div>
            <h1>{page === "documents" ? <>Your documents, <span>understood.</span></> : page === "search" ? <>Find meaning, <span>not just words.</span></> : <>Ask your files, <span>get answers.</span></>}</h1>
            <p className="subtitle">{page === "documents" ? "Upload, organize, and preview documents in your private workspace." : page === "search" ? "Search across document chunks using locally generated semantic embeddings." : "Ask questions and get answers grounded in retrieved passages with source citations."}</p>
          </div>
          {page === "documents" && <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? <LoaderCircle className="spin" size={18}/> : <FileUp size={18}/>} {uploading ? "Processing…" : "Upload documents"}</button>}
          <input ref={fileInput} type="file" accept=".pdf,.docx,.txt" multiple hidden onChange={(e) => uploadFiles(e.target.files)} />
        </section>
        {error && <div className="alert error-alert"><AlertCircle size={18}/><span>{error}</span><button onClick={() => setError("")}><X size={16}/></button></div>}
        {notice && <div className="alert success-alert"><CheckCircle2 size={18}/><span>{notice}</span><button onClick={() => setNotice("")}><X size={16}/></button></div>}

        {page === "documents" && <>
          <section className="stats-grid">
            <div className="stat-card"><div className="stat-icon purple"><FileText size={19}/></div><div className="stat-label">Total documents</div><div className="stat-value">{documents.length}</div><div className="stat-foot">Saved in your workspace</div></div>
            <div className="stat-card"><div className="stat-icon blue"><Database size={19}/></div><div className="stat-label">Extracted words</div><div className="stat-value">{totalWords.toLocaleString()}</div><div className="stat-foot">Across all uploaded files</div></div>
            <div className="stat-card"><div className="stat-icon green"><Network size={19}/></div><div className="stat-label">AI index</div><div className="stat-value">{documents.filter(d => d.chunk_count > 0).length}/{documents.length}</div><div className="stat-foot">Documents chunked and embedded</div></div>
          </section>
          <section className="upload-panel" onDragOver={(e) => {e.preventDefault();setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={(e) => {e.preventDefault();setDragging(false);uploadFiles(e.dataTransfer.files);}}>
            <div className={`dropzone ${dragging ? "dragging" : ""}`}><div className="upload-art"><FileUp size={25}/></div><h2>Upload your knowledge</h2><p>Drag and drop your files here, or <button className="inline-link" onClick={() => fileInput.current?.click()}>browse files</button></p><div className="file-types"><span><FileText size={14}/> PDF</span><span><FileType2 size={14}/> DOCX</span><span><File size={14}/> TXT</span><i>Up to 15 MB per file</i></div></div>
          </section>
          <section className="documents-section">
            <div className="section-heading"><div><h2>Your documents</h2><p>Uploaded files, extracted text, and indexing status</p></div><button className="icon-button" onClick={loadDocuments} title="Refresh"><RefreshCw size={17}/></button></div>
            <div className="document-toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search document names…"/></div><span className="result-count">{filteredDocuments.length} files</span></div>
            {loading ? <div className="empty-state"><LoaderCircle className="spin" size={27}/><p>Loading workspace…</p></div> : filteredDocuments.length === 0 ? <div className="empty-state"><div className="empty-icon"><FileText size={25}/></div><h3>{query ? "No matching documents" : "Your workspace is ready"}</h3><p>{query ? "Try a different search term." : "Upload a PDF, DOCX, or TXT file to extract, chunk, and index its content."}</p><button className="secondary-button" onClick={() => fileInput.current?.click()}><FileUp size={16}/> Upload a document</button></div> :
              <div className="document-list">{filteredDocuments.map((doc) => <article className="document-row" key={doc.id}><div className="file-icon"><FileIcon filename={doc.filename}/></div><button className="document-info" onClick={() => setSelectedDocument(doc)}><strong>{doc.filename}</strong><span>{formatBytes(doc.file_size)} <i>•</i> {doc.word_count.toLocaleString()} words <i>•</i> {doc.chunk_count} chunks <i>•</i> Added {formatDate(doc.created_at)}</span></button><span className="processed-label"><CheckCircle2 size={14}/> {doc.chunk_count ? "Indexed" : "Not indexed"}</span>{!doc.chunk_count && doc.word_count > 0 && <button className="icon-button" title={`Index ${doc.filename}`} onClick={() => reindexDocument(doc.id, doc.filename)}><RefreshCw size={16}/></button>}<button className="icon-button" title={`Rename ${doc.filename}`} onClick={() => renameDocument(doc.id, doc.filename)}><Pencil size={16}/></button><button className="icon-button delete-button" title={`Delete ${doc.filename}`} onClick={() => deleteDocument(doc.id, doc.filename)}><Trash2 size={17}/></button></article>)}</div>}
          </section>
        </>}

        {page === "search" && <section className="work-panel">
          <div className="panel-title"><div className="large-icon"><Search size={22}/></div><div><h2>Semantic document search</h2><p>Search by concept or meaning, not only exact keywords.</p></div></div>
          <form className="big-search" onSubmit={runSearch}><Search size={19}/><input value={semanticQuery} onChange={(e) => setSemanticQuery(e.target.value)} placeholder="e.g. What does the policy say about annual leave?"/><button className="primary-button" disabled={searching || !semanticQuery.trim()}>{searching ? <LoaderCircle className="spin" size={16}/> : <Search size={16}/>} Search</button></form>
          <div className="hint-row"><Zap size={14}/> Powered by local sentence-transformer embeddings <span>·</span> No paid API key</div>
          {searchResults.length > 0 && <div className="results-heading"><h3>Retrieved passages</h3><span>{searchResults.length} results</span></div>}
          {searchResults.map((item, index) => <article className="result-card" key={`${item.document_id}-${item.chunk_index}-${index}`}><div className="result-card-head"><span className="result-number">{index + 1}</span><button className="source-link" onClick={async () => {try {setSelectedDocument(await api(`/api/documents/${item.document_id}`));} catch(err) {setError(err.message);}}}><FileText size={15}/>{item.filename}<ChevronRight size={14}/></button><span className="score-pill">{Math.round(item.score * 100)}% match</span></div><p>{item.text}</p><div className="result-foot">Chunk {item.chunk_index + 1} <span>·</span> Semantic similarity</div></article>)}
          {!searching && searchResults.length === 0 && <div className="empty-state"><div className="empty-icon"><Search size={25}/></div><h3>Search your knowledge base</h3><p>Enter a question or topic above. Upload documents first if your index is empty.</p></div>}
        </section>}

        {page === "chat" && <section className="chat-panel">
          <div className="chat-intro"><div className="large-icon"><MessageSquareText size={22}/></div><div><h2>Chat with your documents</h2><p>Answers are grounded in retrieved text and include source references.</p></div><span className="local-tag"><ShieldCheck size={13}/> Local-first</span></div>
          <div className="chat-messages">{messages.map((message, i) => <div className={`message ${message.role}`} key={i}><div className="message-avatar">{message.role === "assistant" ? <Bot size={18}/> : <UserRound size={18}/>}</div><div className="message-body"><div className="message-role">{message.role === "assistant" ? "DocuMind AI" : "You"} {message.mode && <span className="mode-tag">{message.mode === "ollama" ? "Local LLM" : "Extractive fallback"}</span>}</div><div className="message-text">{message.content}</div>{message.sources?.length > 0 && <div className="citations"><div className="citation-title"><BookOpen size={14}/> Sources used</div>{message.sources.map((source, j) => <button className="citation" key={`${source.document_id}-${j}`} onClick={async () => {try {setSelectedDocument(await api(`/api/documents/${source.document_id}`));} catch(err) {setError(err.message);}}}><span className="citation-index">[{j + 1}]</span><span><strong>{source.filename}</strong><small>{source.excerpt}</small></span><ExternalLink size={13}/></button>)}</div>}</div></div>)}
            {chatLoading && <div className="message assistant"><div className="message-avatar"><Bot size={18}/></div><div className="message-body"><div className="message-role">DocuMind AI</div><div className="typing"><span/><span/><span/></div></div></div>}
            <div ref={chatEnd}/></div>
          <form className="chat-composer" onSubmit={sendChat}><textarea rows="2" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask a question about your uploaded documents…" onKeyDown={(e) => {if (e.key === "Enter" && !e.shiftKey) {e.preventDefault();sendChat();}}}/><button className="primary-button" disabled={chatLoading || !chatInput.trim()} aria-label="Send question">{chatLoading ? <LoaderCircle className="spin" size={18}/> : <Send size={18}/>} Send</button><small>AI answers can be wrong. Verify important details against the cited source documents.</small></form>
        </section>}

        <footer className="footer"><span><BrainCircuit size={15}/> DocuMind AI <span className="footer-separator">·</span> Phases 1–6</span><span>Private, local-first document workflows</span></footer>
      </div>
    </main>
    {selectedDocument && <div className="modal-backdrop" onMouseDown={(e) => {if(e.target === e.currentTarget)setSelectedDocument(null);}}><section className="preview-modal" role="dialog" aria-modal="true"><div className="modal-header"><div className="modal-file-icon"><FileIcon filename={selectedDocument.filename}/></div><div><h2>{selectedDocument.filename}</h2><p>{selectedDocument.word_count?.toLocaleString()} words extracted</p></div><button className="icon-button" onClick={() => setSelectedDocument(null)}><X size={19}/></button></div><div className="preview-meta"><span>{formatDate(selectedDocument.created_at)}</span><span>{formatBytes(selectedDocument.file_size)}</span></div><div className="preview-content">{selectedDocument.extracted_text || "No text was extracted from this file."}</div><div className="modal-footer"><span>Document preview · Original upload is not retained</span><button className="secondary-button" onClick={() => setSelectedDocument(null)}>Close preview</button></div></section></div>}
  </div>;
}
