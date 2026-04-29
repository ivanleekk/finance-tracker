import './index.css'

function LandingPage() {

    return (
        <div className="flex flex-col items-center justify-center flex-1 p-4">
            <h1 className='text-6xl font-bold mb-4 mt-16'>Welcome to Finance Tracker</h1>
            <h2 className='text-2xl  mb-2'>Track your finances with ease</h2>
            <a href="/dashboard" className="bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-lg transition-colors duration-200">Get Started</a>

        </div>
    )
}

export default LandingPage