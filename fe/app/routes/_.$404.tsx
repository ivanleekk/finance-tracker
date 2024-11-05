// app/routes/_.$404.tsx (this will catch 404 errors)
export default function NotFound() {
    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-xl text-red-500">Oops! Page not found.</h1>
            <p className="text-gray-500">The page you're looking for doesn't exist.</p>
        </div>
    );
}
