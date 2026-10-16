
from fastapi import FastAPI, Depends
from pydantic import BaseModel
from auth import get_user_id

app = FastAPI()

class ChatIn(BaseModel):
    message: str

@app.post("/fastapi/v1/chat")
async def chat(body: ChatIn, user_id: str = Depends(get_user_id)):
    # 1. call LLM with tool definitions
    # 2. if it requests a tool then  run TOOLS[name](**validated_args, user_id=user_id)
    # 3. send result back to LLM, loop until it gives a final answer
    return {"reply": "..."}