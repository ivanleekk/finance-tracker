
import { Card, CardContent, CardHeader, CardTitle } from "./Card"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

export interface StatCardProps {
    title: string
    value: string
    changeValue?: string
    changePercent?: number
    trend?: "up" | "down" | "neutral"
    description?: string
    className?: string
}

export function StatCard({
    title,
    value,
    changeValue,
    changePercent,
    trend = "neutral",
    description,
    className,
}: StatCardProps) {

    return (
        <Card className={className}>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-base-500 dark:text-base-400">
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold text-base-900 dark:text-base-50">{value}</div>
                {(changeValue || changePercent !== undefined) && (
                    <div className="mt-1 flex items-center text-xs">
                        {trend === "up" && <TrendingUp className="mr-1 h-3 w-3 text-green-600" />}
                        {trend === "down" && <TrendingDown className="mr-1 h-3 w-3 text-red-600" />}
                        {trend === "neutral" && <Minus className="mr-1 h-3 w-3 text-base-500 dark:text-base-400" />}

                        <span
                            className={
                                trend === "up"
                                    ? "text-green-600 dark:text-green-400 font-medium"
                                    : trend === "down"
                                        ? "text-red-600 dark:text-red-400 font-medium"
                                        : "text-base-500 dark:text-base-400 font-medium"
                            }
                        >
                            {trend === "up" ? "+" : trend === "down" ? "-" : ""}
                            {changeValue && <span>{changeValue}</span>}
                            {changePercent !== undefined && (
                                <span> ({Math.abs(changePercent)}%)</span>
                            )}
                        </span>
                    </div>
                )}
                {description && (
                    <p className="mt-2 text-xs text-base-500 dark:text-base-400 leading-relaxed italic">
                        {description}
                    </p>
                )}
            </CardContent>

        </Card>
    )
}
