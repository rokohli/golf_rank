from dataclasses import asdict, dataclass
from typing import Literal

CourseImageType = Literal["OFFICIAL", "USER", "WIKIMEDIA", "SATELLITE", "NONE"]

# Highest-priority first. The resolver in service.py walks this order and stops
# at the first source that produces a usable image -- it never falls back to a
# lower-priority source once a higher one has resolved.
PRIORITY_ORDER: tuple[CourseImageType, ...] = ("OFFICIAL", "USER", "WIKIMEDIA", "SATELLITE", "NONE")


@dataclass(frozen=True)
class CourseImageResult:
    """The one normalized shape every provider/tier maps into.

    The frontend renders off `type` alone and never needs to know which
    provider produced the image -- see coursePresentation.ts on the frontend.
    """

    type: CourseImageType
    url: str | None
    thumbnail_url: str | None
    attribution: str | None
    license: str | None
    source_url: str | None
    alt_text: str
    width: int | None
    height: int | None

    def to_dict(self) -> dict:
        return asdict(self)


def no_image_result(alt_text: str) -> CourseImageResult:
    return CourseImageResult(
        type="NONE",
        url=None,
        thumbnail_url=None,
        attribution=None,
        license=None,
        source_url=None,
        alt_text=alt_text,
        width=None,
        height=None,
    )
