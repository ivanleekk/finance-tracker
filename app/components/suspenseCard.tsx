import React from 'react';
import { Suspense } from 'react';
import { Await } from '@remix-run/react';
import { Card, CardHeader, CardContent } from '~/components/ui/card';
import { cn } from '~/lib/utils'; // Assuming you have a cn utility for class merging

interface SuspenseCardProps extends React.HTMLAttributes<HTMLDivElement> {
    title: string;
    loadingMessage?: string;
    resolvePromise: Promise<any>;
    renderContent: (data: any) => React.ReactNode;
    cardClassName?: string;
    headerClassName?: string;
    contentClassName?: string;
}

const SuspenseCard: React.FC<SuspenseCardProps> = ({
    title,
    loadingMessage = 'Loading...',
    resolvePromise,
    renderContent,
    className,
    cardClassName,
    headerClassName,
    contentClassName,
    ...props
}) => {
    return (
        <Suspense fallback={
            <Card className={cn("min-w-fit flex-auto p-2", className)}>
                {loadingMessage}
            </Card>
        }>
            <Await resolve={resolvePromise}>
                {(data) => (
                    <Card className={cn("", cardClassName, className)} {...props}>
                        <CardHeader className={headerClassName}>{title}</CardHeader>
                        <CardContent className={cn("text-3xl font-bold text-preety", contentClassName)}>
                            {renderContent(data)}
                        </CardContent>
                    </Card>
                )}
            </Await>
        </Suspense>
    );
};

export default SuspenseCard;