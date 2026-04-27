def app(environ, start_response):
    # Get the path and query string from the incoming request
    path = environ.get("PATH_INFO", "")
    query = environ.get("QUERY_STRING", "")

    # Construct the new Vercel URL
    location = f"https://cauldron-optimizer.vercel.app{path}"
    if query:
        location += f"?{query}"

    # Send the 301 Redirect
    start_response("301 Moved Permanently", [("Location", location)])
    return [b""]
