"""Local entry point for development server."""

from cauldron_optimizer import app

# Vercel serves this module's `app`
__all__ = ["app"]

# if __name__ == "__main__":
#     app.run()
