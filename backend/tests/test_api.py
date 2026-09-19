import unittest

from backend.app.api.app import FastAPI, create_app


class ApiBoundaryTests(unittest.TestCase):
    @unittest.skipIf(FastAPI is None, "install backend[api] to run HTTP boundary tests")
    def test_app_is_constructed_when_fastapi_is_available(self):
        app = create_app()
        routes = {route.path for route in app.routes}
        self.assertIn("/healthz", routes)
        self.assertIn("/api/v4/turns", routes)


if __name__ == "__main__":
    unittest.main()
