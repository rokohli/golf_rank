from app.course_images.providers.openverse_query import generate_queries, normalize_course_name


def test_normalize_strips_golf_course_suffix():
    assert normalize_course_name("Pebble Beach Golf Links") == "pebble beach"
    assert normalize_course_name("Pebble Beach Golf Course") == "pebble beach"
    assert normalize_course_name("Pebble Beach") == "pebble beach"


def test_normalize_strips_country_club_and_leading_the():
    assert normalize_course_name("The Olympic Club") == "olympic club"
    assert normalize_course_name("Congressional Country Club") == "congressional"


def test_normalize_strips_abbreviations():
    assert normalize_course_name("Winged Foot GC") == "winged foot"
    assert normalize_course_name("Oakmont CC") == "oakmont"


def test_normalize_strips_punctuation_and_collapses_whitespace():
    # Standalone "Links"/"Course" (without a "golf" prefix) are left alone --
    # they can be a legitimate, distinguishing part of a course's proper name
    # (e.g. St Andrews' "Old Course"), so only "golf club/course/links" is
    # treated as a generic qualifier.
    assert normalize_course_name("St.  Andrews,  Links") == "st andrews links"


def test_normalize_empty_input():
    assert normalize_course_name("") == ""
    assert normalize_course_name(None) == ""


def test_generate_queries_full_priority_order():
    queries = generate_queries(
        course_name="Pebble Beach Golf Links", facility_name=None, city="Pebble Beach", state="CA",
    )
    assert queries == [
        "Pebble Beach Golf Links golf course Pebble Beach CA",
        "Pebble Beach Golf Links Pebble Beach CA",
        "Pebble Beach Golf Links golf club CA",
        "Pebble Beach Golf Links",
    ]


def test_generate_queries_degrades_without_city_or_state():
    queries = generate_queries(course_name="Bethpage Black", facility_name=None, city=None, state=None)
    assert queries == ["Bethpage Black"]


def test_generate_queries_falls_back_to_facility_name():
    queries = generate_queries(course_name=None, facility_name="Bethpage State Park", city="Farmingdale", state="NY")
    assert queries[0] == "Bethpage State Park golf course Farmingdale NY"


def test_generate_queries_no_name_returns_empty():
    assert generate_queries(course_name=None, facility_name=None, city="X", state="Y") == []


def test_generate_queries_deduplicates():
    # With no city/state, the golf-club-with-state query is skipped, and the
    # bare-name query must not duplicate anything already produced.
    queries = generate_queries(course_name="Augusta National", facility_name=None, city=None, state=None)
    assert queries == ["Augusta National"]
