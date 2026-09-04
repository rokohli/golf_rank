from types import SimpleNamespace

from app.course_images.providers.mapbox import MapboxOptions, MapboxSatelliteImageProvider

OPTIONS = MapboxOptions(width=1280, height=640, zoom=15.5, pixel_ratio=1)


def course(**overrides):
    defaults = dict(name="Pebble Beach Golf Links", latitude=36.5681, longitude=-121.9491)
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_builds_static_image_url_centered_on_course():
    provider = MapboxSatelliteImageProvider(access_token="pk.test")

    result = provider.get_course_image(course(), OPTIONS)

    assert result.type == "SATELLITE"
    assert "36.5681" in result.url
    assert "-121.9491" in result.url
    assert "1280x640" in result.url
    assert "access_token=pk.test" in result.url
    assert result.attribution == "Mapbox"
    assert result.alt_text == "Aerial view of Pebble Beach Golf Links"


def test_2x_pixel_ratio_requests_high_density_tile_and_doubles_reported_size():
    provider = MapboxSatelliteImageProvider(access_token="pk.test")

    result = provider.get_course_image(course(), MapboxOptions(width=640, height=320, zoom=15, pixel_ratio=2))

    assert "@2x" in result.url
    assert result.width == 1280
    assert result.height == 640


def test_missing_token_returns_none():
    provider = MapboxSatelliteImageProvider(access_token=None)

    assert provider.get_course_image(course(), OPTIONS) is None


def test_missing_coordinates_return_none():
    provider = MapboxSatelliteImageProvider(access_token="pk.test")

    assert provider.get_course_image(course(latitude=None, longitude=None), OPTIONS) is None


def test_out_of_range_coordinates_return_none():
    provider = MapboxSatelliteImageProvider(access_token="pk.test")

    assert provider.get_course_image(course(latitude=200, longitude=-121.9), OPTIONS) is None
