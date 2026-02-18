from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional
import shutil

from fastapi import UploadFile, HTTPException, status


class StorageService(ABC):
    @abstractmethod
    def save(self, file: UploadFile, filename: str) -> str:
        """Save file and return storage key."""
        raise NotImplementedError

    @abstractmethod
    def get_url(self, key: str) -> str:
        """Return access URL or file path for a stored key."""
        raise NotImplementedError

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete a stored object by key."""
        raise NotImplementedError


class LocalStorageService(StorageService):
    def __init__(self, base_dir: Optional[str] = None) -> None:
        storage_dir = base_dir or os.getenv("STORAGE_LOCAL_DIR", "storage/jd")
        self.base_dir = Path(storage_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _safe_path(self, filename: str) -> Path:
        safe_name = Path(filename).name
        target = (self.base_dir / safe_name).resolve()
        if not str(target).startswith(str(self.base_dir)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid filename",
            )
        return target

    def save(self, file: UploadFile, filename: str) -> str:
        target = self._safe_path(filename)
        with target.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return target.name

    def get_url(self, key: str) -> str:
        target = self._safe_path(key)
        return str(target)

    def delete(self, key: str) -> None:
        target = self._safe_path(key)
        if target.exists():
            target.unlink()


class S3StorageService(StorageService):
    def __init__(self) -> None:
        self.bucket = os.getenv("STORAGE_S3_BUCKET", "")
        self.prefix = os.getenv("STORAGE_S3_PREFIX", "jd")

    def save(self, file: UploadFile, filename: str) -> str:
        if not self.bucket:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="S3 bucket not configured",
            )

        try:
            import boto3  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="S3 storage is not available",
            ) from exc

        key = f"{self.prefix}/{filename}" if self.prefix else filename
        client = boto3.client("s3")
        client.upload_fileobj(
            file.file,
            self.bucket,
            key,
            ExtraArgs={"ContentType": "application/pdf"},
        )
        return key

    def get_url(self, key: str) -> str:
        if not self.bucket:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="S3 bucket not configured",
            )
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"

    def delete(self, key: str) -> None:
        if not self.bucket:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="S3 bucket not configured",
            )

        try:
            import boto3  # type: ignore
        except Exception as exc:  # pragma: no cover
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="S3 storage is not available",
            ) from exc

        client = boto3.client("s3")
        client.delete_object(Bucket=self.bucket, Key=key)


def get_storage_service() -> StorageService:
    storage_type = os.getenv("STORAGE_TYPE", "local").lower()
    if storage_type == "s3":
        return S3StorageService()
    return LocalStorageService()


def get_jd_storage_service() -> StorageService:
    storage_type = os.getenv("STORAGE_TYPE", "local").lower()
    if storage_type == "s3":
        return S3StorageService()
    base_dir = os.getenv("JD_UPLOAD_DIR", "uploads/jd")
    return LocalStorageService(base_dir=base_dir)


def get_resume_storage_service() -> StorageService:
    storage_type = os.getenv("STORAGE_TYPE", "local").lower()
    if storage_type == "s3":
        return S3StorageService()
    base_dir = os.getenv("RESUME_UPLOAD_DIR", "uploads/resumes")
    return LocalStorageService(base_dir=base_dir)
