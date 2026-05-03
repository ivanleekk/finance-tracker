// src/households.loader.ts
import api from "../../lib/api"
import type { HouseholdResponse } from "../../types/types"

export async function householdsLoader() {
    const response = await api.get('/users/households')
    return response.data as HouseholdResponse[]
}