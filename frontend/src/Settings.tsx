import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/Card"
import { Input } from "./components/ui/Input"
import { Button } from "./components/ui/Button"

export default function Settings() {
    return (
        <div className="flex-1 space-y-6 p-8">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-base-900">Settings</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Account Preferences</CardTitle>
                        <CardDescription>Manage your display and currency preferences.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Input 
                            label="Base Currency" 
                            placeholder="USD ($)" 
                            disabled 
                            helperText="Currency cannot be changed at this time."
                        />
                        <Input 
                            label="Timezone" 
                            placeholder="UTC (GMT+0)" 
                        />
                        <Button variant="primary">Save Preferences</Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Notifications</CardTitle>
                        <CardDescription>Manage your email and push notifications.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium text-base-900">Trade Alerts</p>
                                <p className="text-sm text-base-500">Receive an email when a limit order executes.</p>
                            </div>
                            <Button variant="secondary" size="sm">Disable</Button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium text-base-900">Weekly Summary</p>
                                <p className="text-sm text-base-500">Receive a weekly digest of your portfolio performance.</p>
                            </div>
                            <Button variant="ghost" size="sm">Enable</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}