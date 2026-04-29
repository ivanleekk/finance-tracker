import '../index.css'
import SidebarButton from './sidebarButton.tsx'

function Sidebar() {

    return (
        <div className="bg-base-300 flex flex-col items-center w-56 h-screen">
            <a href={'/'} className='text-base-800 text-4xl mx-4 my-2'>Finance Tracker</a>
            <div className='flex flex-col w-full p-2'>
                <SidebarButton text={"Dashboard"} href={'/dashboard'} />
                <SidebarButton text={"Trade"} href={'/trade'} />
                <SidebarButton text={"Portfolio"} href={'/portfolio'} />
                <SidebarButton text={"History"} href={'/history'} />
            </div>
            <div className='flex flex-col w-full p-2 items-end mt-auto'>
                <SidebarButton text={"Settings"} href={'/settings'} />
                <SidebarButton text={"Profile"} href={'/profile'} />
            </div>
        </div>

    )
}

export default Sidebar