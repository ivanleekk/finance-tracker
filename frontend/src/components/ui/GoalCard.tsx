
import { Card, CardContent, CardHeader, CardTitle } from "./Card"

export interface GoalCardProps {
    title: string
    currentValue: number
    targetValue: number
    formatValue?: (val: number) => string
    className?: string
}

export function GoalCard({
    title,
    currentValue,
    targetValue,
    formatValue = (val) => val.toString(),
    className,
}: GoalCardProps) {
    const percentComplete = Math.min(
        100,
        Math.max(0, (currentValue / targetValue) * 100)
    )

    return (
        <Card className={className}>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-base-800">
                        {title}
                    </CardTitle>
                    <span className="text-xs font-semibold text-secondary-600">
                        {Math.round(percentComplete)}%
                    </span>
                </div>
            </CardHeader>
            <CardContent>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                    <span className="font-bold text-base-900 dark:text-base-50">
                        {formatValue(currentValue)}
                    </span>
                    <span className="text-base-500 dark:text-base-400">
                        of {formatValue(targetValue)}
                    </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-base-100 dark:bg-base-800">
                    <div
                        className="h-full bg-secondary-500 transition-all duration-500 ease-in-out"
                        style={{ width: `${percentComplete}%` }}
                    />
                </div>
            </CardContent>
        </Card>
    )
}
