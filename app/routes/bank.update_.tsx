import { LoaderFunctionArgs } from "@remix-run/node";
import { useRef, useState } from "react";
import { requireUserSession } from "~/utils/auth.server";
import { addBankInfo } from "~/bank/bank";
import { Form, useLoaderData } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "~/components/ui/select";
import { getUserByRequest } from "~/user/user";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await requireUserSession(request);
    return await getUserByRequest(request);
};

export const action = async ({ request }: LoaderFunctionArgs) => {
    return await addBankInfo(request);
};

export default function BankUpdate() {
    // State to track whether the switch is toggled
    const [showDateInput, setShowDateInput] = useState(false);
    const dateInputRef = useRef<HTMLInputElement>(null); // Ref for the date input
    const importantCodes = ["SGD", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY"];
    const otherCodes = ["AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV", "BRL", "BSD", "BTN", "BWP", "BYR", "BZD", "CDF", "CHE", "CHW", "CLF", "CLP", "COP", "COU", "CRC", "CUC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "FJD", "FKP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LTL", "LVL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRO", "MUR", "MVR", "MWK", "MXN", "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SHP", "SLL", "SOS", "SRD", "SSP", "STD", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USN", "USS", "UYI", "UYU", "UZS", "VEF", "VND", "VUV", "WST", "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XDR", "XFU", "XOF", "XPD", "XPF", "XPT", "XTS", "XXX", "YER", "ZAR", "ZMW"];
    const currencyCodes = [...importantCodes, ...otherCodes];

    const userData = useLoaderData<typeof loader>();
    const defaultCurrency = userData?.homeCurrency || "USD";
    const handleDateSwitchChange = (checked: boolean) => {
        setShowDateInput(checked);

        // Reset the date input value when toggling off
        if (!checked && dateInputRef.current) {
            dateInputRef.current.value = ""; // Clear the value
        }
    };

    return (
        <Card className="max-w-xl flex flex-col flex-grow basis-auto p-2">
            <CardHeader className="text-xl font-bold">Update Bank Details</CardHeader>
            <CardContent>
                <Form method="post" className="max-w-md space-y-4">
                    <Label>
                        Bank Name
                        <Input type="text" name="bankName" required />
                    </Label>
                    <Label>
                        Balance
                        <Input type="number" name="balance" step="0.01" required />
                    </Label>
                    <Label>
                        Currency
                        <Select name="currency" defaultValue={defaultCurrency}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Currency" />
                            </SelectTrigger>
                            <SelectContent>
                                {currencyCodes.map((currencyCode) => (
                                    <SelectItem key={currencyCode} value={currencyCode}>
                                        {currencyCode}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Label>

                    <div className="flex items-center space-x-2 h-6">
                        <Switch
                            checked={showDateInput}
                            onCheckedChange={handleDateSwitchChange}
                        />
                        <Label>Date for historical balance</Label>
                    </div>

                    {showDateInput && (
                        <Input type="date" name="date" ref={dateInputRef} />
                    )}


                    <Button type="submit">Add Bank</Button>
                </Form>
            </CardContent>
        </Card>
    );
}
