from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import JSONResponse

from services.resume_parser import extract_text_for_resume, parse_resume_bytes, parse_resume_debug_bytes

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


@router.post("/extract-text")
async def extract_resume_text(
    file: UploadFile = File(...),
    preview_chars: int = Query(default=2000, ge=200, le=20000),
    include_full: bool = Query(default=False),
):
    content_type = file.content_type or ""
    file_bytes = await file.read()

    text, error, error_type = extract_text_for_resume(file_bytes, content_type)
    if error or text is None:
        status_code = 400 if error_type in {"unsupported", "extract"} else 500
        return JSONResponse(status_code=status_code, content={"detail": error})

    gemini_text = text[:60000]
    payload = {
        "content_type": content_type,
        "chars_extracted": len(text),
        "chars_sent_to_gemini": len(gemini_text),
        "raw_text_preview": text[:preview_chars],
        "gemini_text_preview": gemini_text[:preview_chars],
    }
    if include_full:
        payload["raw_text"] = text
        payload["gemini_text"] = gemini_text

    return JSONResponse(content=payload)


@router.post("/parse-debug")
async def parse_resume_debug(
    file: UploadFile = File(...),
    preview_chars: int = Query(default=4000, ge=200, le=50000),
    include_full_text: bool = Query(default=False),
):
    content_type = file.content_type or ""
    file_bytes = await file.read()

    payload, error, error_type = parse_resume_debug_bytes(
        file_bytes=file_bytes,
        content_type=content_type,
        preview_chars=preview_chars,
        include_full_text=include_full_text,
    )
    if error:
        status_code = 400 if error_type in {"unsupported", "extract"} else 500
        return JSONResponse(
            status_code=status_code,
            content={"detail": error},
        )

    return JSONResponse(content=payload)
