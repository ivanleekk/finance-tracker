import {Moon, Sun, SunMoon} from "lucide-react"
import {Theme, useTheme} from "remix-themes"

import {Button} from "./ui/button"
import {Tooltip, TooltipContent, TooltipTrigger} from "~/components/ui/tooltip";

export function ModeToggle() {
    const [theme, setTheme] = useTheme()

    return (
        <div>
            <Tooltip>
                <TooltipTrigger>
                    <Button variant="ghost" size="icon"
                            onClick={() => theme === Theme.LIGHT ? setTheme(Theme.DARK) : setTheme(Theme.LIGHT)}>
                        <Sun
                            className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"/>
                        <Moon
                            className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"/>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    Toggle theme
                </TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger>
                    <Button variant="ghost" size="icon"
                            onClick={() => setTheme(null)}>
                        <SunMoon
                            className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all"/>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    Use System theme
                </TooltipContent>
            </Tooltip>

        </div>
    )
}
