"""Admin authorization.

Deliberately separate from auth.py: that module answers "who is this?", this
one answers "may they moderate?". Admin identity is an environment allowlist of
provider subjects (Settings.admin_clerk_subjects) -- there is no is_admin
column, so granting admin is a deploy-time action with an audit trail in the
environment rather than a runtime database write anyone with DB access could
make silently.
"""

from fastapi import Depends, HTTPException

from .auth import CurrentUser, current_user, get_settings
from .config import Settings


def is_admin(settings: Settings, current: CurrentUser) -> bool:
    return current.provider_subject in settings.admin_subject_set


def require_admin(
    settings: Settings = Depends(get_settings),
    current: CurrentUser = Depends(current_user),
) -> CurrentUser:
    """Gate for every admin endpoint.

    Denies with 404, not 403, so the admin surface isn't enumerable by a
    curious user holding a valid token -- the response is indistinguishable
    from a route that doesn't exist. (Production already serves no OpenAPI
    schema, see create_app's openapi_url, so the routes aren't discoverable
    there either.)

    Depending on current_user rather than re-deriving identity means an
    unauthenticated caller still gets its 401 first, and the development
    identity bypass works here exactly as it does everywhere else.

    Fails closed on an empty allowlist: membership is tested directly, with no
    "if the allowlist is non-empty" guard, so an unset ADMIN_CLERK_SUBJECTS
    grants nobody access rather than everybody.
    """
    if not is_admin(settings, current):
        raise HTTPException(status_code=404, detail="Not found")
    return current
