from http.server import BaseHTTPRequestHandler, HTTPServer
import os

NEW_DOMAIN = "https://cauldron-optimizer.vercel.app"


class RedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        target = NEW_DOMAIN + self.path

        # Send 302 temporary redirect
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Type", "text/html")
        self.end_headers()

        # Optional small message for humans
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>We Moved!</title>
            <meta http-equiv="refresh" content="3;url={target}" />
            <style>
                body {{
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding-top: 80px;
                }}
                a {{
                    color: #0070f3;
                }}
            </style>
        </head>
        <body>
            <h2>🚀 We have moved to a faster server!</h2>
            <p>You are being redirected to:</p>
            <p><a href="{target}">{target}</a></p>
            <p>This is part of a migration/testing phase.</p>
        </body>
        </html>
        """

        self.wfile.write(html.encode("utf-8"))

    def do_POST(self):
        self.do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(("0.0.0.0", port), RedirectHandler)
    server.serve_forever()


# to go back use Start Command on settings/Start Comand on Render Dashboard and change it to:
# gunicorn wsgi:app
