import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/Card"
import { Input } from "./components/ui/Input"
import { Button } from "./components/ui/Button"
import { UserCircle } from "lucide-react"

export default function Profile() {
    return (
        <div className="flex-1 space-y-6 p-8">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight text-base-900">Profile</h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle>Personal Information</CardTitle>
                        <CardDescription>Update your contact details.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center gap-4 pb-4">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-base-100 text-base-500">
                                <UserCircle className="h-12 w-12" />
                            </div>
                            <Button variant="secondary" size="sm">Change Avatar</Button>
                        </div>
                        
                        <div className="grid gap-4 md:grid-cols-2">
                            <Input label="First Name" defaultValue="Ivan" />
                            <Input label="Last Name" defaultValue="Lee" />
                        </div>
                        <Input label="Email Address" defaultValue="ivan@example.com" type="email" />
                        <Input label="Phone Number" placeholder="+1 (555) 000-0000" />
                        
                        <div className="pt-2">
                            <Button variant="primary">Save Changes</Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle>Security</CardTitle>
                        <CardDescription>Manage your password and security settings.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Input label="Current Password" type="password" placeholder="••••••••" />
                        <Input label="New Password" type="password" placeholder="••••••••" />
                        <Input label="Confirm New Password" type="password" placeholder="••••••••" />
                        
                        <div className="pt-2">
                            <Button variant="primary">Update Password</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}