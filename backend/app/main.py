import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from features.routes.url import router as url_router

load_dotenv()
is_production = os.getenv("ENVIRONMENT") == "production"

origin = os.getenv("ORIGIN")


app = FastAPI(
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=origin,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"status": "ok"}


app.include_router(url_router, prefix="/api/v1/url", tags=["url"])
