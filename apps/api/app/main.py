from fastapi import FastAPI

from app.api import public, studio

app = FastAPI(title="AI Agent Builder API", version="0.1.0")
app.include_router(studio.router)
app.include_router(public.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
