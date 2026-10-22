import os
from functools import lru_cache
import numpy as np

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

@lru_cache(maxsize=1)
def get_model():
    # First use downloads the small open model to the local Hugging Face cache.
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME)

def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    vectors = get_model().encode(texts, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
    return vectors.astype(float).tolist()

def cosine_scores(query_vector: list[float], vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    q = np.asarray(query_vector, dtype=np.float32)
    matrix = np.asarray(vectors, dtype=np.float32)
    q_norm = np.linalg.norm(q)
    norms = np.linalg.norm(matrix, axis=1)
    denominator = norms * q_norm
    denominator[denominator == 0] = 1e-12
    return (matrix @ q) / denominator
