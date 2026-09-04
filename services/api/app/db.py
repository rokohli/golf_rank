from collections.abc import Generator

from fastapi import Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .course_images.providers.mapbox import MapboxOptions, SatelliteImageProvider


def make_engine(database_url: str, *, pool_size: int = 5, max_overflow: int = 10) -> Engine:
    if database_url.startswith("sqlite"):
        if database_url == "sqlite+pysqlite://":
            engine = create_engine(
                database_url,
                connect_args={"check_same_thread": False},
                poolclass=StaticPool,
            )
        else:
            engine = create_engine(database_url)

        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine
    return create_engine(
        database_url,
        max_overflow=max_overflow,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=pool_size,
    )


def make_session_factory(
    engine: Engine,
    *,
    course_image_base_url: str | None = None,
    satellite_provider: SatelliteImageProvider | None = None,
    satellite_options: MapboxOptions | None = None,
    wikimedia_cache_positive_ttl_seconds: int = 30 * 24 * 3600,
) -> sessionmaker[Session]:
    return sessionmaker(
        bind=engine,
        expire_on_commit=False,
        info={
            "course_image_base_url": course_image_base_url,
            "satellite_provider": satellite_provider,
            "satellite_options": satellite_options,
            "wikimedia_cache_positive_ttl_seconds": wikimedia_cache_positive_ttl_seconds,
        },
    )


def get_session(request: Request) -> Generator[Session]:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        yield session
