import { useState } from "react";
import { Link } from "@remix-run/react";
import { MdOutlineExpandMore } from "react-icons/md";

export default function Sidebar() {
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);

  const togglePortfolio = () => {
    setIsPortfolioOpen(!isPortfolioOpen);
  };

  return (
    <div className="w-full h-full bg-gray-800 text-white">
      <div className="p-4">
        <Link to="/" className="text-white">
          <h2 className="text-2xl font-bold">Finance Tracker</h2>
        </Link>
      </div>
      <nav className="mt-10 ml-5">
        <ul>
          <li className="mb-4">
            <Link to="/dashboard" className="text-lg hover:text-gray-400 transition-all duration-500">
              Dashboard
            </Link>
          </li>
          <li className="mb-4">
            <div className="text-lg hover:text-gray-400 flex items-center transition-all duration-500">
              <button onClick={togglePortfolio}
                      className="text-lg hover:text-gray-400 flex items-center transition-all duration-500">
              <span className="">
                {isPortfolioOpen ? <MdOutlineExpandMore className="rotate-180 transition-transform duration-500"/> :
                    <MdOutlineExpandMore className="transition-transform duration-500"/>}
              </span>
              </button>
              <Link to="/portfolio" className="ml-2">
                Portfolio
              </Link>
            </div>

            <div
                className={`overflow-hidden transition-all ease duration-500 ${isPortfolioOpen ? 'max-h-screen' : 'max-h-0'}`}>
              <ul className="ml-4 mt-2">
                <li className="mb-2">
                  <Link to="/portfolio/transactions"
                        className="text-lg hover:text-gray-400 transition-all duration-500">
                    Transactions
                  </Link>
                </li>
                <li>
                  <Link to="/portfolio/statistics" className="text-lg hover:text-gray-400 transition-all duration-500">
                    Statistics
                  </Link>
                </li>
              </ul>
            </div>
          </li>
          <li className="mb-4">
            <Link to="/settings" className="text-lg hover:text-gray-400 transition-all duration-500">
              Settings
            </Link>
          </li>
          <li>
            <Link to="/login" className="text-lg hover:text-gray-400 transition-all duration-500">
              Login
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}