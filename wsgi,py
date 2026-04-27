def app(environ, start_response):
    path = environ.get("PATH_INFO", "")
    query = environ.get("QUERY_STRING", "")
    location = f"https://cauldron-optimizer.vercel.app{path}"
    if query:
        location += f"?{query}"
    start_response("301 Moved Permanently", [("Location", location)])
    return [b""]
