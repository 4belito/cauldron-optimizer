from flask import Flask, redirect

app = Flask(__name__)


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def redirect_all(path):
    return redirect(
        "https://cauldron-optimizer.vercel.app/" + path,
        code=302,  # temporary redirect
    )
