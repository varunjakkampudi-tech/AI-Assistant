"""
Knowledge Vault (RAG) for Nova AI Assistant
Handles document upload, processing, and retrieval.
Uses MongoDB for storage with text indexing (cost-free, no external APIs).
"""
import io
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Supported file types
SUPPORTED_TYPES = {
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
CHUNK_SIZE = 1000  # Characters per chunk
CHUNK_OVERLAP = 200  # Overlap between chunks


def extract_text_from_pdf(content: bytes) -> str:
    """Extract text from PDF using PyMuPDF (fitz)."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=content, filetype="pdf")
        text_parts = []
        for page in doc:
            text_parts.append(page.get_text())
        doc.close()
        return "\n\n".join(text_parts)
    except ImportError:
        # Fallback: try pdfplumber
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                return "\n\n".join(page.extract_text() or "" for page in pdf.pages)
        except ImportError:
            logger.warning("No PDF library available. Install PyMuPDF or pdfplumber.")
            return "[PDF content - install PyMuPDF to extract]"
    except Exception as e:
        logger.exception("PDF extraction error")
        return f"[PDF extraction failed: {e}]"


def extract_text_from_docx(content: bytes) -> str:
    """Extract text from DOCX."""
    try:
        from docx import Document
        doc = Document(io.BytesIO(content))
        return "\n\n".join(para.text for para in doc.paragraphs if para.text.strip())
    except ImportError:
        logger.warning("python-docx not installed")
        return "[DOCX content - install python-docx to extract]"
    except Exception as e:
        logger.exception("DOCX extraction error")
        return f"[DOCX extraction failed: {e}]"


def extract_text(content: bytes, file_type: str, filename: str) -> str:
    """Extract text from various file types."""
    if file_type == "pdf":
        return extract_text_from_pdf(content)
    elif file_type in ("docx", "doc"):
        return extract_text_from_docx(content)
    elif file_type in ("txt", "md"):
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return content.decode("latin-1", errors="ignore")
    else:
        return f"[Unsupported file type: {file_type}]"


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[Dict[str, Any]]:
    """Split text into overlapping chunks for better retrieval."""
    if not text.strip():
        return []
    
    # Clean text
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r' {2,}', ' ', text)
    
    chunks = []
    start = 0
    chunk_index = 0
    
    while start < len(text):
        end = start + chunk_size
        
        # Try to break at sentence or paragraph boundary
        if end < len(text):
            # Look for paragraph break
            para_break = text.rfind('\n\n', start + chunk_size // 2, end + 100)
            if para_break > start:
                end = para_break
            else:
                # Look for sentence break
                sentence_break = max(
                    text.rfind('. ', start + chunk_size // 2, end + 50),
                    text.rfind('! ', start + chunk_size // 2, end + 50),
                    text.rfind('? ', start + chunk_size // 2, end + 50)
                )
                if sentence_break > start:
                    end = sentence_break + 1
        
        chunk_text = text[start:end].strip()
        if chunk_text:
            chunks.append({
                "index": chunk_index,
                "text": chunk_text,
                "start_char": start,
                "end_char": end
            })
            chunk_index += 1
        
        # Move start with overlap
        start = end - overlap if end < len(text) else len(text)
    
    return chunks


async def process_document(
    content: bytes,
    filename: str,
    content_type: str,
    db,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Process and store a document in the knowledge vault."""
    
    # Validate file size
    if len(content) > MAX_FILE_SIZE:
        return {"success": False, "error": f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"}
    
    # Determine file type
    file_type = SUPPORTED_TYPES.get(content_type)
    if not file_type:
        # Try to guess from extension
        ext = Path(filename).suffix.lower().lstrip('.')
        if ext in ("pdf", "txt", "md", "docx", "doc"):
            file_type = ext
        else:
            return {"success": False, "error": f"Unsupported file type: {content_type}"}
    
    # Extract text
    text = extract_text(content, file_type, filename)
    if not text.strip():
        return {"success": False, "error": "Could not extract text from document"}
    
    # Create chunks
    chunks = chunk_text(text)
    
    # Create document record
    doc_id = str(uuid.uuid4())
    doc = {
        "id": doc_id,
        "user_id": user_id,
        "title": Path(filename).stem,
        "filename": filename,
        "file_type": file_type,
        "content_type": content_type,
        "content": text[:50000],
        "full_text_length": len(text),
        "chunk_count": len(chunks),
        "chunks": chunks,
        "file_size": len(content),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.knowledge_docs.insert_one(doc)
    
    try:
        await db.knowledge_docs.create_index([("content", "text"), ("title", "text"), ("chunks.text", "text")])
    except Exception:
        pass
    
    return {
        "success": True,
        "document": {
            "id": doc_id,
            "title": doc["title"],
            "filename": filename,
            "file_type": file_type,
            "text_length": len(text),
            "chunks": len(chunks)
        }
    }


async def search_documents(query: str, db, limit: int = 5, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Search documents using MongoDB text search, scoped to the signed-in user."""
    results = []
    scope = {"user_id": user_id} if user_id else {}
    try:
        cursor = db.knowledge_docs.find(
            {**scope, "$text": {"$search": query}},
            {"score": {"$meta": "textScore"}, "_id": 0}
        ).sort([("score", {"$meta": "textScore"})]).limit(limit)
        results = await cursor.to_list(limit)
    except Exception as e:
        logger.warning(f"Text search failed: {e}")
    
    if not results:
        regex = {"$regex": query, "$options": "i"}
        cursor = db.knowledge_docs.find(
            {**scope, "$or": [{"content": regex}, {"title": regex}]},
            {"_id": 0}
        ).limit(limit)
        results = await cursor.to_list(limit)
    
    formatted = []
    for doc in results:
        best_chunk = None
        query_lower = query.lower()
        for chunk in doc.get("chunks", []):
            if query_lower in chunk.get("text", "").lower():
                best_chunk = chunk
                break
        formatted.append({
            "id": doc.get("id"),
            "title": doc.get("title"),
            "filename": doc.get("filename"),
            "file_type": doc.get("file_type"),
            "excerpt": best_chunk["text"][:500] if best_chunk else doc.get("content", "")[:500],
            "relevance_score": doc.get("score", 0),
            "created_at": doc.get("created_at")
        })
    
    return formatted


async def get_document(doc_id: str, db, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Get a single document by ID, scoped to user."""
    q = {"id": doc_id}
    if user_id:
        q["user_id"] = user_id
    doc = await db.knowledge_docs.find_one(q, {"_id": 0})
    return doc


async def list_documents(db, skip: int = 0, limit: int = 20, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """List all documents in the knowledge vault for the signed-in user."""
    q = {"user_id": user_id} if user_id else {}
    cursor = db.knowledge_docs.find(
        q,
        {"_id": 0, "chunks": 0, "content": 0}
    ).sort("created_at", -1).skip(skip).limit(limit)
    
    docs = await cursor.to_list(limit)
    return docs


async def delete_document(doc_id: str, db, user_id: Optional[str] = None) -> bool:
    """Delete a document from the knowledge vault (must be owned by the user)."""
    q = {"id": doc_id}
    if user_id:
        q["user_id"] = user_id
    result = await db.knowledge_docs.delete_one(q)
    return result.deleted_count > 0


async def get_vault_stats(db, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Get statistics about the knowledge vault (per-user)."""
    base_filter = {"user_id": user_id} if user_id else {}
    total_docs = await db.knowledge_docs.count_documents(base_filter)
    
    pipeline = [
        {"$match": base_filter},
        {"$group": {
            "_id": "$file_type",
            "count": {"$sum": 1},
            "total_size": {"$sum": "$file_size"}
        }}
    ]
    
    by_type = {}
    async for doc in db.knowledge_docs.aggregate(pipeline):
        by_type[doc["_id"]] = {
            "count": doc["count"],
            "size_bytes": doc["total_size"]
        }
    
    total_size = sum(t["size_bytes"] for t in by_type.values())
    
    return {
        "total_documents": total_docs,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2),
        "by_type": by_type
    }
