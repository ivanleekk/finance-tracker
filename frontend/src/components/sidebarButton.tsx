import '../index.css'

// Option A: Define an interface (Cleanest for larger components)
interface SidebarButtonProps {
    text: string;
    href: string;
}

function SidebarButton({ text, href }: SidebarButtonProps) {
    return (
        <a href={href} className="bg-base-300 hover:bg-primary-300 p-2 cursor-pointer w-full flex items-center rounded-lg transition-colors duration-200">
            <p className='text-base-950 h-fit m-1'>{text}</p>
        </a>
    )
}

export default SidebarButton