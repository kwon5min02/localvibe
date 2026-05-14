"""DOCUMENTS 테이블 ORM 및 CRUD."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, select
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.db import Base


class Document(Base):
    __tablename__ = "documents"

    doc_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    place_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("places.place_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    pinecone_id: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def get_document_by_place_id(session, place_id: int) -> Document | None:
    stmt = select(Document).where(Document.place_id == place_id)
    return session.execute(stmt).scalar_one_or_none()


def create_document(session, *, place_id: int, title: str, content: str) -> Document:
    doc = Document(
        place_id=place_id,
        title=title,
        content=content,
        pinecone_id=None,
        created_at=datetime.utcnow(),
    )
    session.add(doc)
    session.flush()
    return doc


def update_document_content(session, doc: Document, *, title: str, content: str) -> None:
    doc.title = title
    doc.content = content
    session.flush()


def set_pinecone_id(session, doc_id: int, pinecone_id: str) -> None:
    doc = session.get(Document, doc_id)
    if doc:
        doc.pinecone_id = pinecone_id
        session.flush()
