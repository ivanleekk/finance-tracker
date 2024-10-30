from fastapi import FastAPI
from google.cloud import firestore
import json

app = FastAPI()

db = firestore.Client.from_service_account_json('serviceAccountKey.json')

@app.get("/")
async def root():
    return {"message": "Hello World"}

@app.get("/cities")
async def get_cities():
    cities_ref = db.collection('cities')
    cities = cities_ref.get()
    res = []
    for city in cities:
        res.append(city.to_dict())
    return res

@app.post("/cities/{code}")
async def create_city(code, body):
    json_data = json.loads(body)
    city_ref = db.collection('cities').document(code)
    city_ref.set(json_data)

    return {"message": "City created successfully", "city": json_data}