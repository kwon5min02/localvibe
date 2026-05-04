from pydantic import BaseModel


class GoogleLoginRequest(BaseModel):
    id_token: str


class UserProfile(BaseModel):
    google_sub: str
    email: str
    name: str
    picture: str = ""


class GoogleLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile
