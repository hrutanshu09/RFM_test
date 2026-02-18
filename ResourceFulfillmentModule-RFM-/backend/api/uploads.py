from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from db.models.auth import User
from utils.dependencies import require_any_role
from utils.storage import StorageService, get_jd_storage_service, get_resume_storage_service

router = APIRouter(prefix="/uploads", tags=["Uploads"])

ALLOWED_CONTENT_TYPES = {"application/pdf", "text/plain"}
RESUME_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_FILE_SIZE = 10 * 1024 * 1024


@router.post("/jd")
async def upload_jd(
    file: UploadFile = File(...),
    storage: StorageService = Depends(get_jd_storage_service),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee")),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 10MB")

    ext = ".pdf" if file.content_type == "application/pdf" else ".txt"
    filename = f"{uuid4().hex}{ext}"

    file_key = storage.save(file, filename)
    file_url = storage.get_url(file_key)

    return {"file_url": file_url}


@router.post("/resume")
async def upload_resume(
    file: UploadFile = File(...),
    storage: StorageService = Depends(get_resume_storage_service),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
):
    """Upload a candidate resume (PDF, DOC, DOCX). Returns the stored file path."""
    if file.content_type not in RESUME_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: PDF, DOC, DOCX")

    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 10MB")

    # Determine extension from content type
    ext_map = {
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    }
    ext = ext_map.get(file.content_type, ".pdf")
    filename = f"{uuid4().hex}{ext}"

    file_key = storage.save(file, filename)
    file_url = storage.get_url(file_key)

    return {"file_url": file_url, "filename": filename}


@router.get("/resume/{filename}")
async def download_resume(
    filename: str,
    storage: StorageService = Depends(get_resume_storage_service),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin", "Manager")),
):
    """Download / serve a candidate resume file."""
    import os
    import mimetypes
    file_path = storage.get_url(filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume file not found")
    media_type, _ = mimetypes.guess_type(file_path)
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type or "application/octet-stream",
    )
