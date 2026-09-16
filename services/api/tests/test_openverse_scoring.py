from app.course_images.providers.openverse_scoring import OpenverseCandidate, prefilter, score_candidate


def make_candidate(**overrides) -> OpenverseCandidate:
    defaults = dict(
        id="abc123",
        title="",
        description=None,
        url="https://example.com/photo.jpg",
        thumbnail_url="https://example.com/thumb.jpg",
        creator="Jane Doe",
        creator_url="https://example.com/jane",
        license="by",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        license_version="4.0",
        source="flickr",
        foreign_landing_url="https://flickr.com/photos/x/1",
        width=2000,
        height=1200,
        category="photograph",
        tags=[],
    )
    defaults.update(overrides)
    return OpenverseCandidate(**defaults)


# --- prefilter --------------------------------------------------------------

def test_prefilter_accepts_valid_photo():
    candidate = make_candidate()
    assert prefilter(candidate, min_width=1200, allowed_licenses={"by", "cc0"}) is None


def test_prefilter_rejects_unlicensed():
    candidate = make_candidate(license="all-rights-reserved")
    assert prefilter(candidate, min_width=1200, allowed_licenses={"by", "cc0"}) is not None


def test_prefilter_rejects_illustration_category():
    candidate = make_candidate(category="illustration")
    assert prefilter(candidate, min_width=1200, allowed_licenses={"by"}) is not None


def test_prefilter_rejects_low_resolution():
    candidate = make_candidate(width=800, height=500)
    assert prefilter(candidate, min_width=1200, allowed_licenses={"by"}) is not None


def test_prefilter_rejects_portrait_orientation():
    candidate = make_candidate(width=1200, height=1800)
    assert prefilter(candidate, min_width=1200, allowed_licenses={"by"}) is not None


def test_prefilter_rejects_missing_dimensions():
    candidate = make_candidate(width=None, height=None)
    assert prefilter(candidate, min_width=1200, allowed_licenses={"by"}) is not None


# --- scoring: exact / partial match -----------------------------------------

def test_exact_course_name_match_scores_high():
    candidate = make_candidate(title="Pebble Beach Golf Links, 18th hole fairway")
    result = score_candidate(candidate, course_name="Pebble Beach Golf Links", city="Pebble Beach", state="CA", matched_query="q")
    assert result.score >= 70


def test_generic_golf_stock_photo_scores_low():
    candidate = make_candidate(title="golf ball on green", description="a golf ball resting on a putting green")
    result = score_candidate(candidate, course_name="Pebble Beach Golf Links", city="Pebble Beach", state="CA", matched_query="q")
    assert result.score < 50


def test_mini_golf_is_heavily_penalized():
    candidate = make_candidate(title="Mini-golf course clubhouse", tags=["putt-putt"])
    result = score_candidate(candidate, course_name="Pebble Beach Golf Links", city=None, state=None, matched_query="q")
    assert result.score < 0


def test_wrong_city_state_penalized_below_review():
    candidate = make_candidate(title="Random golf course in Ohio", description="a course somewhere in Ohio")
    result = score_candidate(candidate, course_name="Pebble Beach Golf Links", city="Pebble Beach", state="CA", matched_query="q")
    assert result.score < 50


# --- named regression cases: multi-course resorts ---------------------------

def test_bethpage_black_gets_own_course_photo():
    candidate = make_candidate(title="Bethpage Black Course, famous 4th hole")
    result = score_candidate(
        candidate, course_name="Bethpage Black", city="Farmingdale", state="NY", matched_query="q",
        sibling_course_names=["Bethpage Green", "Bethpage Red", "Bethpage Blue", "Bethpage Yellow"],
    )
    assert result.score >= 70


def test_bethpage_black_rejects_generic_facility_photo():
    """A photo only tagged with the shared facility name, naming no specific
    course, must not score high enough to become Bethpage Black's hero."""
    candidate = make_candidate(title="Bethpage State Park Golf Course clubhouse")
    result = score_candidate(
        candidate, course_name="Bethpage Black", city="Farmingdale", state="NY", matched_query="q",
        sibling_course_names=["Bethpage Green", "Bethpage Red", "Bethpage Blue", "Bethpage Yellow"],
    )
    assert result.score < 50


def test_bethpage_black_rejects_a_siblings_photo():
    """A photo that names a *different* sibling course at the same facility
    must be strongly rejected, not merely scored low."""
    candidate = make_candidate(title="Bethpage Green Course, scenic 9th hole")
    result = score_candidate(
        candidate, course_name="Bethpage Black", city="Farmingdale", state="NY", matched_query="q",
        sibling_course_names=["Bethpage Green", "Bethpage Red", "Bethpage Blue", "Bethpage Yellow"],
    )
    assert result.score < 0


def test_torrey_pines_south_gets_own_course_photo():
    candidate = make_candidate(title="Torrey Pines South Course, 18th hole ocean view")
    result = score_candidate(
        candidate, course_name="Torrey Pines South Course", city="La Jolla", state="CA", matched_query="q",
        sibling_course_names=["Torrey Pines North Course"],
    )
    assert result.score >= 70


def test_torrey_pines_south_rejects_north_photo():
    candidate = make_candidate(title="Torrey Pines North Course fairway")
    result = score_candidate(
        candidate, course_name="Torrey Pines South Course", city="La Jolla", state="CA", matched_query="q",
        sibling_course_names=["Torrey Pines North Course"],
    )
    assert result.score < 0


def test_pebble_beach_and_spyglass_hill_stay_distinct():
    """Two courses at the same broader resort but with entirely distinct
    names (not a shared-facility case) -- a Spyglass Hill photo must not
    satisfy Pebble Beach's own-name match."""
    candidate = make_candidate(title="Spyglass Hill Golf Course, 3rd hole")
    result = score_candidate(
        candidate, course_name="Pebble Beach Golf Links", city="Pebble Beach", state="CA", matched_query="q",
    )
    assert result.score < 50
