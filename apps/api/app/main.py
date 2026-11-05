from fastapi import FastAPI

app = FastAPI(title="AI Agent Builder API", version="0.0.1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
