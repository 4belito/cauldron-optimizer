from flask import Flask, Response

app = Flask(__name__)

TARGET = "https://cauldron-optimizer.vercel.app"


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>", methods=["GET", "POST"])
def redirect_all(path):
    target_url = f"{TARGET}/{path}"

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Cauldron Optimizer moved</title>
        <meta http-equiv="refresh" content="2; url={target_url}">
        <style>
            body {{
                font-family: Arial, sans-serif;
                text-align: center;
                margin-top: 80px;
            }}
            a {{
                font-size: 18px;
            }}
        </style>
    </head>
    <body>
        <h2>🔮 Cauldron Optimizer has moved</h2>
        <p>We are testing a faster version of the app.</p>
        <p>You are being redirected automatically...</p>
        <p>If not, click below:</p>
        <p><a href="{target_url}">{target_url}</a></p>
    </body>
    </html>
    """

    return Response(html, status=200, mimetype="text/html")


# to go back use Start Command on settings/Start Comand on Render Dashboard and change it to:
# gunicorn wsgi:app
