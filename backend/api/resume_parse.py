from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from services.resume_parser import parse_resume_bytes

router = APIRouter(prefix="/resumes", tags=["Resume Parsing"])


@router.post("/parse")
async def parse_resume(file: UploadFile = File(...)):
    content_type = file.content_type or ""
    file_bytes = await file.read()

    payload, error, error_type = parse_resume_bytes(file_bytes, content_type)
    if error:
        status_code = 400 if error_type in {"unsupported", "extract"} else 500
        return JSONResponse(
            status_code=status_code,
            content={"detail": error},
        )

    return JSONResponse(content=payload)
