package com.ivanlee.financetracker

import android.app.Application
import com.ivanlee.financetracker.data.net.Api

class WaypointApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Token storage and the base-URL override need a Context; wire them once, here,
        // so no screen has to think about it.
        Api.init(this)
    }
}
